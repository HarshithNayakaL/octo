import type { ProviderConfiguration, Run } from "../shared/types.js";
import type { LearnedLimit, ModelLimits } from "./usage.js";

/**
 * What the voice assistant knows about the app right now: providers, what is
 * running, recent problems (busy models, quota, failures), Gemini usage and
 * the open research. Built on the server from the same data the app shows,
 * and handed to the model as data, never as instructions.
 */
export interface StatusInput {
  runs: Run[];
  open?: Run;
  providers: ProviderConfiguration[];
  fallbacks: string[];
  usage?: Record<string, number>;
  learned?: Record<string, LearnedLimit>;
  configured?: Record<string, ModelLimits>;
  voice?: { live: number; turns: number };
  now?: Date;
}

const ACTIVE = ["planning", "starting", "running", "requires_action"];
const PROBLEM = ["warning", "error"];
const DAY = 24 * 60 * 60_000;

const clip = (text: string | undefined, n: number) => {
  // Trailing full stops are dropped: the status adds its own punctuation.
  const t = (text ?? "").replace(/\s+/g, " ").trim().replace(/\.+$/, "");
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** "12 min ago", "3 h ago", or a date for anything older than a day. */
export function ago(at: string, now: Date) {
  const minutes = Math.round((now.getTime() - Date.parse(at)) / 60_000);
  if (!Number.isFinite(minutes)) return "at an unknown time";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `on ${at.slice(0, 10)}`;
}

const modelOf = (run: Run, providers: ProviderConfiguration[]) =>
  run.provider === "openai"
    ? (providers.find((p) => p.id === "openai")?.model ?? "OpenAI")
    : (run.baseModel ??
      providers.find((p) => p.id === "google")?.baseModel ??
      "Gemini");

function runLine(run: Run, providers: ProviderConfiguration[], now: Date) {
  const last = run.activities.at(-1);
  const parts = [
    `"${clip(run.title, 80)}": ${run.cancelRequested ? "stopping" : run.status.replaceAll("_", " ")}`,
    `model ${modelOf(run, providers)}`,
  ];
  if (run.syncError)
    parts.push(`last sync problem: ${clip(run.syncError, 160)}`);
  if (run.nextPollAt && Date.parse(run.nextPollAt) > now.getTime())
    parts.push(`waiting to retry until ${run.nextPollAt.slice(11, 16)} UTC`);
  if (last)
    parts.push(`latest step ${ago(last.at, now)}: ${clip(last.label, 60)}`);
  return parts.join("; ");
}

/** Why cited pages could not be checked, most common reasons first. */
function unreachableReasons(claims: { status: string; note?: string }[]) {
  const counts = new Map<string, number>();
  for (const c of claims)
    if (c.status === "unreachable" && c.note) {
      const reason = clip(c.note, 90);
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return top.length
    ? ` (reasons: ${top.map(([r, n]) => `${r}${n > 1 ? ` ×${n}` : ""}`).join("; ")})`
    : "";
}

export function statusText(input: StatusInput) {
  const now = input.now ?? new Date();
  const lines: string[] = [];

  const google = input.providers.find((p) => p.id === "google");
  const openai = input.providers.find((p) => p.id === "openai");
  lines.push(
    `Research providers: Google ${google?.ready ? `ready (agent ${google.agentName ?? google.model}, model ${google.baseModel ?? "default"}; if it is busy Octo switches to ${input.fallbacks.join(", then ") || "no fallback"})` : "not configured (GEMINI_API_KEY missing)"}; OpenAI ${openai?.ready ? "configured, unlocked only with the access word because it is billed" : "not configured"}.`,
  );

  const active = input.runs.filter((r) => ACTIVE.includes(r.status));
  lines.push(
    active.length
      ? `Running now: ${active.map((r) => runLine(r, input.providers, now)).join(" | ")}.`
      : "Nothing is running right now.",
  );

  // Problems from every run in the last day, newest first.
  const problems = input.runs
    .flatMap((run) =>
      run.activities
        .filter(
          (a) =>
            PROBLEM.includes(a.type) && now.getTime() - Date.parse(a.at) < DAY,
        )
        .map((a) => ({ run, a })),
    )
    .sort((x, y) => y.a.at.localeCompare(x.a.at))
    .slice(0, 8);
  const failed = input.runs.filter(
    (r) =>
      r.status === "failed" &&
      r.error &&
      now.getTime() - Date.parse(r.updatedAt ?? r.createdAt) < DAY,
  );
  if (problems.length || failed.length) {
    lines.push("Recent problems (last 24 h):");
    for (const { run, a } of problems)
      lines.push(
        `- ${ago(a.at, now)}, "${clip(run.title, 60)}": ${a.label}. ${clip(a.text, 200)}.`,
      );
    for (const run of failed)
      if (!problems.some((p) => p.run.id === run.id))
        lines.push(
          `- "${clip(run.title, 60)}" failed: ${clip(run.error, 200)}`,
        );
  } else lines.push("No problems recorded in the last 24 hours.");

  const usage = Object.entries(input.usage ?? {}).filter(
    ([metric]) => !metric.startsWith("visitor:"),
  );
  if (usage.length) {
    const models = usage.filter(([m]) => !m.includes("#"));
    const describe = ([model, count]: [string, number]) => {
      const limit =
        input.configured?.[model]?.rpd ?? input.learned?.[model]?.rpd;
      const quotaHits = input.usage?.[`${model}#429`] ?? 0;
      return `${model} ${count}${limit ? ` of ${limit}` : ""} ${count === 1 && !limit ? "request" : "requests"}${quotaHits ? `, ${quotaHits} refused for quota` : ""}`;
    };
    lines.push(
      `Gemini requests sent by Octo today (Pacific day; daily limits reset at midnight Pacific): ${models.map(describe).join("; ")}.`,
    );
  }
  if (input.voice)
    lines.push(
      `This person's voice allowance: ${input.voice.live} live chats left this hour, ${input.voice.turns} push-to-talk or typed questions left in the current 10 minutes.`,
    );

  const open = input.open;
  if (open) {
    const detail = [
      `Open research "${clip(open.title, 80)}": status ${open.status.replaceAll("_", " ")}, model ${modelOf(open, input.providers)}`,
    ];
    if (open.error) detail.push(`error: ${clip(open.error, 240)}`);
    if (open.syncError)
      detail.push(`sync problem: ${clip(open.syncError, 200)}`);
    if (open.planError)
      detail.push(`questions problem: ${clip(open.planError, 200)}`);
    const e = open.evidence;
    if (e)
      detail.push(
        e.status === "done"
          ? `evidence check done, score ${e.score ?? "n/a"}, ${e.claims.filter((c) => c.status === "supported").length} of ${e.claims.length} claims supported, ${e.claims.filter((c) => c.status === "unreachable").length} could not be checked${unreachableReasons(e.claims)}`
          : `evidence check ${e.status}${e.error ? `: ${clip(e.error, 160)}` : ""}`,
      );
    if (open.community)
      detail.push(
        `community voices ${open.community.status}${open.community.error ? `: ${clip(open.community.error, 120)}` : ""}`,
      );
    if (open.reportParts?.length)
      detail.push(
        `partial report saved because ${clip(open.reportParts.at(-1)!.reason, 120)}`,
      );
    lines.push(`${detail.join("; ")}.`);
    const recent = open.activities.slice(-6);
    if (recent.length)
      lines.push(
        `Its latest steps: ${recent.map((a) => `${ago(a.at, now)} ${a.label}${PROBLEM.includes(a.type) ? ` (${a.type}: ${clip(a.text, 120)})` : ""}`).join("; ")}.`,
      );
  }
  return lines.join("\n");
}
