import { randomUUID } from "node:crypto";
import type { Run, ProviderId } from "../shared/types.js";
import type { RunStore } from "./store.js";
import { ProviderError, type Provider } from "./provider.js";
import {
  afterBusy,
  fallbackModels,
  isBusy,
  isBusyMessage,
  type Fallback,
} from "./fallback.js";
import { continuationInput } from "./prompts.js";
import {
  finalReport,
  itemText,
  resultSchema,
  sourcesFromReport,
} from "./results.js";
import { demoResult } from "./demo.js";
import { demoPlan } from "./planner.js";
import { checkEvidence, evidenceDue, requestEvidence } from "./evidence.js";
import { describeSources } from "./sources.js";
import type { CheckOptions } from "./evidence.js";
import {
  communityDue,
  runCommunityPulse,
  type GatherOptions,
} from "./community.js";

export const active = (r: Run) =>
  ["planning", "starting", "running", "requires_action"].includes(r.status);
/** Keep the report being replaced, so users can compare versions. */
export function archiveReport(run: Run, next: string) {
  if (!run.report.trim() || run.report === next || run.purpose === "crm")
    return;
  const versions = run.versions ?? [];
  run.versions = [
    ...versions,
    {
      id: randomUUID(),
      at: run.updatedAt,
      label:
        run.status === "partial" ||
        run.reportParts?.at(-1)?.report === run.report
          ? "Partial report"
          : versions.length
            ? "Earlier report"
            : "First report",
      report: run.report,
      sources: run.sources,
      score: run.evidence?.status === "done" ? run.evidence.score : undefined,
    },
  ].slice(-10);
}
export interface EngineOptions {
  /** How cited sources are fetched for evidence checks (tests inject this). */
  evidence?: CheckOptions;
  /** How community discussions are fetched (tests inject this). */
  community?: GatherOptions;
  /** Longest a single step may hold a run. Must stay below the host's request limit. */
  leaseMs?: number;
  /** Minimum gap between steps on one run, so frequent triggers don't over-poll providers. */
  pollGapMs?: number;
}
export class Engine {
  private busy = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private ticking?: Promise<void>;
  readonly leaseMs: number;
  readonly pollGapMs: number;
  readonly evidenceOptions?: CheckOptions;
  readonly communityOptions?: GatherOptions;
  constructor(
    readonly store: RunStore,
    readonly provider?: Provider,
    readonly providers?: Partial<Record<ProviderId, Provider>>,
    options: EngineOptions = {},
  ) {
    this.leaseMs = options.leaseMs ?? 240_000;
    this.pollGapMs = options.pollGapMs ?? 0;
    this.evidenceOptions = options.evidence;
    this.communityOptions = options.community;
  }
  log(run: Run, label: string, text: string, type = "system") {
    run.activities.push({
      id: randomUUID(),
      type,
      label,
      text,
      at: new Date().toISOString(),
    });
    run.activities = run.activities.slice(-500);
  }
  start() {
    this.timer = setInterval(() => {
      void this.tick();
    }, 6000);
    this.timer.unref();
    void this.tick();
  }
  stop() {
    clearInterval(this.timer);
  }
  /** Advance every run that has due work. Concurrent calls in one process share a pass. */
  tick() {
    this.ticking ??= this.sweep().finally(() => {
      this.ticking = undefined;
    });
    return this.ticking;
  }
  private async sweep() {
    for (const row of await this.store.list()) {
      if (this.busy.has(row.id)) continue;
      if (
        row.nextPollAt &&
        Date.parse(row.nextPollAt) > Date.now() &&
        !row.cancelRequested
      )
        continue;
      if (
        active(row) ||
        row.pendingInput ||
        evidenceDue(row) ||
        communityDue(row) ||
        (row.nextCheckAt && Date.parse(row.nextCheckAt) <= Date.now())
      )
        await this.process(row.id);
    }
  }
  async process(id: string) {
    if (this.busy.has(id)) return;
    this.busy.add(id);
    let claimed = false;
    try {
      claimed = await this.store.claim(id, this.leaseMs);
      if (!claimed) return;
      await this.step(id);
    } finally {
      this.busy.delete(id);
      if (claimed)
        await this.store.release(id, this.pollGapMs).catch(() => undefined);
    }
  }
  private async step(id: string) {
    try {
      let run = (await this.store.get(id))!;
      if (!run) return;
      // Research waits for community voices it was asked to include.
      if (
        run.status === "starting" &&
        run.community?.beforeResearch &&
        run.community.status === "running" &&
        !communityDue(run)
      )
        return;
      // Community voices run before research when asked, or any time after.
      if (
        communityDue(run) &&
        !run.pendingInput &&
        (run.status === "starting" || !active(run))
      ) {
        await this.communityStep(run);
        return;
      }
      if (
        !active(run) &&
        !run.pendingInput &&
        evidenceDue(run) &&
        !(run.nextCheckAt && Date.parse(run.nextCheckAt) <= Date.now())
      ) {
        await this.evidenceStep(run);
        return;
      }
      if (
        !active(run) &&
        !run.pendingInput &&
        !(run.nextCheckAt && Date.parse(run.nextCheckAt) <= Date.now())
      )
        return;
      if (
        run.nextCheckAt &&
        Date.parse(run.nextCheckAt) <= Date.now() &&
        !active(run)
      ) {
        if (
          (await this.store.list()).some(
            (other) => other.id !== id && active(other),
          )
        )
          return;
        if (run.remainingChecks <= 0) {
          run.nextCheckAt = undefined;
          await this.store.save(run);
          return;
        }
        run.remainingChecks--;
        run.nextCheckAt = undefined;
        await this.queueMessage(
          run,
          "Research this topic again. Search for new evidence since the previous briefing, compare against saved findings, report only meaningful changes, and update the report and research.json.",
        );
        run = (await this.store.get(id))!;
      }
      if (run.cancelRequested && !run.sessionId) {
        run.status = "cancelled";
        this.log(run, "Run cancelled", "No remote session was started.");
        await this.store.save(run);
        return;
      }
      const provider =
        this.providers?.[run.provider ?? "openai"] ??
        ((run.provider ?? "openai") === "openai" ? this.provider : undefined);
      if (run.status === "planning") {
        await this.planStep(run, provider);
        return;
      }
      if (run.mode === "demo") {
        await this.demo(run);
        return;
      }
      if (!provider)
        throw new Error(
          `Configure ${run.provider === "google" ? "GEMINI_API_KEY" : "OPENAI_API_KEY"} in .env and restart the server to continue this run.`,
        );
      if (!run.sessionId) {
        const recovered = await provider.recover(run.id);
        if (
          !recovered &&
          (run.syncError ||
            (run.provider === "google" && run.creationAttempted))
        ) {
          run.status = "failed";
          run.error =
            "The session creation outcome is uncertain. No matching saved session was found. Check your provider project before starting another run; automatic recreation is disabled to prevent duplicate usage.";
          await this.store.save(run);
          return;
        }
        run.creationAttempted = true;
        await this.store.save(run);
        const session =
          recovered ??
          (await (run.purpose === "crm"
            ? provider.exportCrm(run)
            : provider.create(run)));
        if (typeof session.id !== "string")
          throw new Error("The Agents API did not return a session ID.");
        run = (await this.store.get(id))!;
        run.sessionId = session.id;
        run.status = "running";
        this.noteFallback(run, session.octoFallback);
        this.log(
          run,
          "Research session started",
          "Saved session " +
            session.id +
            ". Progress is recovered from durable API items.",
        );
        await this.store.save(run);
      }
      if (run.pendingInput) {
        const input = run.pendingInput;
        if (run.provider === "google" && input.attempted) {
          run.pendingInput = undefined;
          run.status = "failed";
          run.nextCheckAt = undefined;
          run.remainingChecks = 0;
          run.error =
            "The Google follow-up submission outcome is uncertain. Inspect Google AI Studio before submitting again; automatic repeat is disabled.";
          await this.store.save(run);
          return;
        }
        if (run.provider === "google") {
          input.attempted = true;
          await this.store.save(run);
        }
        const result =
          run.provider === "google"
            ? await provider.message(run.sessionId!, input.text, input.key, run)
            : await provider.message(run.sessionId!, input.text, input.key);
        run = (await this.store.get(id))!;
        if (result?.id) run.sessionId = result.id;
        this.noteFallback(
          run,
          (result as { octoFallback?: Fallback } | undefined)?.octoFallback,
        );
        run.lastInputText = input.text;
        run.pendingInput = undefined;
        await this.store.save(run);
      }
      if (
        !run.cancelRequested &&
        Date.now() - Date.parse(run.startedAt!) > run.maxMinutes * 60000
      ) {
        run.cancelRequested = true;
        run.stopReason = "the time limit was reached";
        run.nextCheckAt = undefined;
        this.log(
          run,
          "Time limit reached",
          "Requesting cancellation before checking further progress.",
          "warning",
        );
        await this.store.save(run);
      }
      if (run.cancelRequested) await provider.cancel(run.sessionId!);
      const snap = await provider.snapshot(run.sessionId!);
      run = (await this.store.get(id))!;
      run.syncError = undefined;
      run.nextPollAt = undefined;
      run.tokenUsage =
        typeof snap.session.usage?.total_tokens === "number"
          ? snap.session.usage.total_tokens
          : undefined;
      run.agents = snap.agents.map((a) => ({
        id: a.id,
        name: a.name ?? a.agent?.name ?? a.task ?? "Research specialist",
        status: a.status ?? "unknown",
      }));
      run.artifacts = snap.artifacts;
      const seen = new Set(run.activities.map((a) => a.id));
      for (const item of snap.items)
        if (!seen.has(item.id) && item.id) {
          const text = itemText(item);
          run.activities.push({
            id: item.id,
            type: item.type ?? "item",
            label:
              item.role === "assistant"
                ? "Research director"
                : item.type?.includes("search")
                  ? "Web search"
                  : (item.type?.replaceAll("_", " ") ?? "Research activity"),
            text:
              text.slice(0, 1000) ||
              item.name ||
              item.status ||
              "Saved research activity",
            at:
              typeof item.created_at === "number"
                ? new Date(item.created_at * 1000).toISOString()
                : new Date().toISOString(),
          });
        }
      run.activities = run.activities.slice(-500);
      const rootTurns = snap.turns.filter((t) => t.subagent_id == null);
      const latest = rootTurns.at(-1);
      // A previous completed turn cannot complete a newly queued follow-up.
      const isNewTurn = latest && latest.id !== run.lastTurnId;
      // The model was busy partway through: carry on with a lighter one.
      const busyMessage =
        snap.session.status === "failed"
          ? snap.session.error?.message
          : isNewTurn && latest.status === "failed"
            ? latest.error?.message
            : undefined;
      const lighter =
        run.provider === "google" && isBusyMessage(busyMessage)
          ? afterBusy(
              run.baseModel,
              fallbackModels(process.env.GEMINI_FALLBACK_MODELS),
            )
          : undefined;
      if (lighter && !run.cancelRequested) {
        const from = run.baseModel ?? "the selected model";
        run.baseModel = lighter;
        const partial = latest
          ? finalReport(snap.items.filter((item) => item.turn_id === latest.id))
          : "";
        if (latest) run.lastTurnId = latest.id;
        if (partial.trim()) {
          archiveReport(run, partial);
          run.report = partial;
          run.sources = sourcesFromReport(partial);
          run.reportParts = [
            ...(run.reportParts ?? []),
            {
              turnId: latest!.id,
              report: partial,
              reason: `${from} was busy`,
              at: new Date().toISOString(),
            },
          ].slice(-10);
          run.pendingInput = {
            text: continuationInput(run),
            key: randomUUID(),
            kind: "followup",
          };
        } else if (run.lastInputText && run.report.trim()) {
          // A follow-up failed before writing anything: send it again.
          run.pendingInput = {
            text: run.lastInputText,
            key: randomUUID(),
            kind: "followup",
          };
        } else {
          // Nothing was written yet: start the research again.
          run.sessionId = undefined;
          run.creationAttempted = false;
          run.status = "starting";
        }
        run.error = undefined;
        this.log(
          run,
          "Switched to a lighter model",
          `${from} is experiencing high demand, so the research continues with ${lighter}${partial.trim() ? " from the saved partial report" : ""}.`,
          "warning",
        );
        await this.store.save(run);
        return;
      }
      if (snap.session.status === "failed") {
        run.status = "failed";
        run.error = snap.session.error?.message ?? "Remote session failed.";
      } else if (snap.session.status === "requires_action") {
        run.status = "requires_action";
        run.error =
          "The session needs external action. Inspect its required actions in the provider dashboard or cancel the run.";
      } else if (
        isNewTurn &&
        ["completed", "failed", "cancelled", "incomplete"].includes(
          latest.status,
        )
      ) {
        run.lastTurnId = latest.id;
        if (latest.status === "completed") {
          const previous = run.report;
          archiveReport(run, "");
          run.report = finalReport(
            snap.items.filter((item) => item.turn_id === latest.id),
          );
          run.sources = sourcesFromReport(run.report);
          const artifact = snap.artifacts.find(
            (a) => a.path.endsWith("/research.json") && a.turn_id === latest.id,
          );
          if (artifact) {
            try {
              const bytes = await provider.artifact(
                run.sessionId!,
                artifact.id,
              );
              if (bytes.byteLength > 3_000_000)
                throw new Error("Research JSON exceeds 3 MB.");
              const output = resultSchema.parse(
                JSON.parse(bytes.toString("utf8")),
              );
              run.report = output.report;
              run.sources = output.sources;
              run.leads = output.leads;
            } catch (err) {
              this.log(
                run,
                "Structured output could not be read",
                err instanceof Error ? err.message : "Invalid output",
                "warning",
              );
            }
          }
          const produced = Boolean(run.report.trim());
          if (
            previous.trim() &&
            run.versions?.at(-1)?.report === previous &&
            (!produced || run.report === previous)
          ) {
            // Nothing new to compare: keep the earlier report in place.
            run.versions.pop();
            if (!produced) {
              run.report = previous;
              run.sources = sourcesFromReport(previous);
            }
          }
          if (!produced) {
            run.status = "failed";
            run.error =
              "The turn completed without a readable report. Inspect activity and artifacts before continuing.";
          } else {
            run.status = "completed";
            run.error = undefined;
            if (run.purpose !== "crm") run.evidence = requestEvidence(run);
            this.log(
              run,
              "Report ready",
              "Review citations and evidence before using or exporting the findings.",
            );
            this.schedule(run);
          }
        } else {
          // Keep whatever the turn produced so the research can be continued.
          const partial = finalReport(
            snap.items.filter((item) => item.turn_id === latest.id),
          );
          const reason =
            latest.status === "incomplete"
              ? "the provider's token budget or limit was reached"
              : latest.status === "cancelled"
                ? (run.stopReason ?? "you stopped it")
                : (latest.error?.message ?? "the agent turn failed");
          if (partial.trim()) {
            archiveReport(run, partial);
            run.report = partial;
            run.evidence = requestEvidence(run);
            run.sources = sourcesFromReport(partial);
            run.reportParts = [
              ...(run.reportParts ?? []),
              {
                turnId: latest.id,
                report: partial,
                reason,
                at: new Date().toISOString(),
              },
            ].slice(-10);
            run.status = "partial";
            run.error = undefined;
            this.log(
              run,
              "Partial report saved",
              `Research stopped because ${reason}. The unfinished report is saved; continue the research to complete it.`,
              "warning",
            );
          } else {
            run.status =
              latest.status === "incomplete" ? "failed" : latest.status;
            run.error =
              latest.status === "cancelled"
                ? undefined
                : latest.status === "failed"
                  ? (latest.error?.message ?? "The agent turn failed.")
                  : `Research stopped because ${reason}, and no report text was produced.`;
          }
          run.stopReason = undefined;
        }
      } else if (!run.cancelRequested) run.status = "running";
      const exceeded =
        active(run) &&
        (Date.now() - Date.parse(run.startedAt!) > run.maxMinutes * 60000 ||
          (run.tokenUsage !== undefined &&
            run.tokenUsage - (run.budgetBaseline ?? 0) >= run.maxTokens));
      if (exceeded && !run.cancelRequested) {
        run.stopReason =
          Date.now() - Date.parse(run.startedAt!) > run.maxMinutes * 60000
            ? "the time limit was reached"
            : "the token limit was reached";
        run.cancelRequested = true;
        run.nextCheckAt = undefined;
        this.log(
          run,
          "Limit reached",
          "Cancellation requested. In-flight model and tool usage can still be billed.",
          "warning",
        );
      }
      if (
        run.status === "cancelled" ||
        run.status === "failed" ||
        run.status === "partial"
      ) {
        run.nextCheckAt = undefined;
        run.remainingChecks = 0;
      }
      const current = await this.store.get(id);
      run.notes = current?.notes ?? run.notes;
      if (current?.cancelRequested) {
        run.cancelRequested = true;
        run.remainingChecks = 0;
        run.nextCheckAt = undefined;
      }
      await this.store.save(run);
    } catch (error) {
      const run = await this.store.get(id);
      if (!run) return;
      const detail =
        error instanceof Error ? error.message : "Unexpected research error";
      if (isBusy(error))
        run.nextPollAt = new Date(
          Date.now() + ((error as ProviderError).retryAfterMs ?? 60000),
        ).toISOString();
      // Durable sessions are never duplicated after a transient polling failure.
      if (
        error instanceof ProviderError &&
        [400, 401, 403, 404, 422].includes(error.status)
      ) {
        run.status = "failed";
        run.error = detail;
        run.pendingInput = undefined;
        run.nextCheckAt = undefined;
        run.remainingChecks = 0;
        this.log(run, "API request rejected", detail, "error");
        await this.store.save(run);
      } else if (
        isBusy(error) &&
        (!run.sessionId || run.pendingInput?.attempted)
      ) {
        // A quota or overload rejection is definitive: nothing was submitted
        // (every fallback model was tried), so retry after backoff.
        if (!run.sessionId) run.creationAttempted = false;
        if (run.pendingInput) run.pendingInput.attempted = false;
        run.syncError = undefined;
        this.log(
          run,
          (error as ProviderError).status === 429
            ? "Provider quota reached"
            : "Models busy",
          `${detail} Retrying the submission after ${run.nextPollAt}.`,
          "warning",
        );
        await this.store.save(run);
      } else if (run.sessionId || run.status === "starting") {
        run.syncError = detail;
        await this.store.save(run);
      } else {
        run.status = "failed";
        run.error = detail;
        this.log(run, "Run failed", detail, "error");
        await this.store.save(run);
      }
    }
  }
  /** Prepare questions and proposed areas; research waits for the user's answers. */
  private async planStep(run: Run, provider?: Provider) {
    if (run.mode === "demo") run.plan = demoPlan(run);
    else if (!provider?.plan)
      run.planError = `Configure ${run.provider === "google" ? "GEMINI_API_KEY" : "OPENAI_API_KEY"} to prepare questions, or start without them.`;
    else
      try {
        run.plan = await provider.plan(run);
        run.planError = undefined;
      } catch (error) {
        if (isBusy(error)) {
          run.nextPollAt = new Date(
            Date.now() + (error.retryAfterMs ?? 60000),
          ).toISOString();
          this.log(
            run,
            (error as ProviderError).status === 429
              ? "Provider quota reached"
              : "Models busy",
            "Preparing questions will be retried shortly.",
            "warning",
          );
          await this.store.save(run);
          return;
        }
        run.planError =
          (error instanceof Error ? error.message : "Planning failed") +
          " You can start the research without questions.";
      }
    const current = await this.store.get(run.id);
    if (current?.cancelRequested || current?.status !== "planning") return;
    run.status = "awaiting_input";
    this.log(
      run,
      run.plan ? "Questions ready" : "Questions unavailable",
      run.plan
        ? "Review what Octo understood, answer the questions, and choose the research areas."
        : (run.planError ?? "Start the research when ready."),
    );
    await this.store.save(run);
  }
  private schedule(run: Run) {
    if (
      run.workflow === "monitor" &&
      run.remainingChecks > 0 &&
      !run.cancelRequested
    )
      run.nextCheckAt = new Date(
        Date.now() + run.intervalHours * 3600000,
      ).toISOString();
  }
  private async demo(run: Run) {
    if (run.cancelRequested) {
      run.status = "cancelled";
      run.nextCheckAt = undefined;
      this.log(run, "Demo cancelled", "No API usage.");
      await this.store.save(run);
      return;
    }
    run.pendingInput = undefined;
    const age = Date.now() - Date.parse(run.startedAt!);
    const steps = [
      [
        "Research director",
        "Planning the research and assigning independent questions.",
      ],
      ...((run.plan?.areas ?? []).filter((a) => a.selected !== false).length >=
      2
        ? (run
            .plan!.areas.filter((a) => a.selected !== false)
            .slice(0, 2)
            .map((a) => [
              a.title,
              `Demonstrating research on ${a.title.toLowerCase()}. No live search is performed.`,
            ]) as string[][])
        : run.workflow === "sales"
          ? [
              [
                "Company discovery",
                "Demonstrating company matching. No live search is performed.",
              ],
              [
                "Company evidence",
                "Demonstrating fit evidence and unknown contacts.",
              ],
            ]
          : [
              [
                "Market researcher",
                "Demonstrating source collection. No live search is performed.",
              ],
              [
                "Competitor researcher",
                "Demonstrating comparison and evidence review.",
              ],
            ]),
      [
        "Final reviewer",
        "Preparing an illustrative report and highlighting unknowns.",
      ],
    ];
    const count = Math.min(4, Math.floor(age / 1500) + 1);
    for (let i = 0; i < count; i++)
      if (
        !run.activities.some(
          (a) => a.id === `${run.id}-demo-${run.startedAt}-${i}`,
        )
      )
        run.activities.push({
          id: `${run.id}-demo-${run.startedAt}-${i}`,
          label: steps[i][0],
          type: "demo",
          text: steps[i][1],
          at: new Date().toISOString(),
        });
    run.status = "running";
    run.agents = steps.slice(1).map((s, i) => ({
      id: String(i),
      name: s[0],
      status:
        age > 6000 ? "completed" : count > i + 1 ? "in_progress" : "queued",
    }));
    if (age > 6000) {
      const result = demoResult(run);
      // Demo follow-ups record the request so the versions view has a change to show.
      const asked = run.report.trim()
        ? [...run.activities]
            .reverse()
            .find((a) => a.label === "Follow-up queued")
        : undefined;
      if (asked)
        result.report += `\n\n## Follow-up ${(run.versions?.length ?? 0) + 1} (illustrative)\n\nYou asked: “${asked.text.split("\n")[0].slice(0, 300)}” A live run researches this and updates the sections above; the demo only records the request.`;
      archiveReport(run, result.report);
      Object.assign(run, result);
      run.status = "completed";
      run.evidence = requestEvidence(run);
      this.log(
        run,
        "Demo report ready",
        "Illustrative output. No claims have been researched.",
      );
      this.schedule(run);
    }
    await this.store.save(run);
  }
  /** Check the report's citations against the cited pages, outside any research turn. */
  private async evidenceStep(run: Run) {
    const provider =
      this.providers?.[run.provider ?? "openai"] ??
      ((run.provider ?? "openai") === "openai" ? this.provider : undefined);
    const requestedAt = new Date().toISOString();
    run.evidence = {
      ...run.evidence!,
      status: "running",
      requestedAt,
      reportLength: run.report.length,
    };
    await this.store.save(run);
    let update: Partial<NonNullable<Run["evidence"]>>;
    let published: Record<string, string> = {};
    try {
      const { published: dates, ...result } = await checkEvidence(
        run,
        provider,
        this.evidenceOptions,
      );
      published = dates ?? {};
      update = { status: "done", ...result };
    } catch (err) {
      update = {
        status: "failed",
        claims: [],
        error:
          err instanceof Error ? err.message : "The evidence check failed.",
      };
    }
    // Save onto the latest copy so notes or a queued follow-up are not lost.
    const latest = await this.store.get(run.id);
    if (!latest || latest.evidence?.requestedAt !== requestedAt) return;
    latest.evidence = {
      ...latest.evidence,
      ...update,
      finishedAt: new Date().toISOString(),
    } as NonNullable<Run["evidence"]>;
    latest.sourceInfo = describeSources(latest);
    for (const [url, date] of Object.entries(published))
      if (latest.sourceInfo[url]) latest.sourceInfo[url].published = date;
    const e = latest.evidence;
    if (e.status === "done")
      this.log(
        latest,
        "Evidence checked",
        `${e.claims.filter((c) => c.status === "supported").length} of ${e.claims.length} claims supported by their cited page${e.score === undefined ? "" : ` · evidence score ${e.score}`}.`,
      );
    await this.store.save(latest);
  }
  /** Gather and group public discussions about the brief. */
  private async communityStep(run: Run) {
    const provider =
      this.providers?.[run.provider ?? "openai"] ??
      ((run.provider ?? "openai") === "openai" ? this.provider : undefined);
    const requestedAt = new Date().toISOString();
    run.community = { ...run.community!, status: "running", requestedAt };
    await this.store.save(run);
    let update: Partial<NonNullable<Run["community"]>>;
    try {
      const result = await runCommunityPulse(
        run,
        provider,
        this.communityOptions,
      );
      update = {
        ...result,
        status: result.items.length || run.mode === "demo" ? "done" : "failed",
      };
    } catch (err) {
      update = {
        status: "failed",
        error: err instanceof Error ? err.message : "Community search failed.",
      };
    }
    const latest = await this.store.get(run.id);
    if (!latest || latest.community?.requestedAt !== requestedAt) return;
    latest.community = {
      ...latest.community,
      ...update,
      finishedAt: new Date().toISOString(),
    } as NonNullable<Run["community"]>;
    const c = latest.community;
    this.log(
      latest,
      c.status === "done"
        ? "Community voices gathered"
        : "Community search failed",
      c.status === "done"
        ? `${c.items.length} relevant posts from ${Object.values(c.scanned).reduce((a, b) => a + (b ?? 0), 0)} scanned, grouped into ${c.themes.length} themes.${c.beforeResearch && latest.status === "starting" ? " Their summary goes to the research agent." : ""}`
        : (c.error ?? "No discussions were collected."),
      c.status === "done" ? "system" : "warning",
    );
    await this.store.save(latest);
  }
  /** Keep later turns on the model Google accepted, and say so in the activity log. */
  private noteFallback(run: Run, fallback?: Fallback) {
    if (!fallback) return;
    run.baseModel = fallback.to;
    this.log(
      run,
      "Switched to a lighter model",
      `${fallback.from} is experiencing high demand, so this research runs on ${fallback.to}.`,
      "warning",
    );
  }
  async queueMessage(run: Run, text: string) {
    run.pendingInput = { text, key: randomUUID(), kind: "followup" };
    run.status = "running";
    run.budgetBaseline = run.provider === "google" ? 0 : (run.tokenUsage ?? 0);
    run.nextPollAt = undefined;
    run.startedAt = new Date().toISOString();
    run.cancelRequested = false;
    run.error = undefined;
    run.syncError = undefined;
    run.nextCheckAt = undefined;
    this.log(run, "Follow-up queued", text, "user");
    await this.store.save(run);
  }
}
