import { randomUUID } from "node:crypto";
import type { Run, ProviderId } from "../shared/types.js";
import { Store } from "./store.js";
import { ProviderError, type Provider } from "./provider.js";
import {
  finalReport,
  itemText,
  resultSchema,
  sourcesFromReport,
} from "./results.js";
import { demoResult } from "./demo.js";

export const active = (r: Run) =>
  ["starting", "running", "requires_action"].includes(r.status);
export class Engine {
  private busy = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    readonly store: Store,
    readonly provider?: Provider,
    readonly providers?: Partial<Record<ProviderId, Provider>>,
  ) {}
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
  async tick() {
    for (const row of this.store.list()) {
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
        (row.nextCheckAt && Date.parse(row.nextCheckAt) <= Date.now())
      )
        await this.process(row.id);
    }
  }
  async process(id: string) {
    if (this.busy.has(id)) return;
    this.busy.add(id);
    try {
      let run = this.store.get(id)!;
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
        if (this.store.list().some((other) => other.id !== id && active(other)))
          return;
        if (run.remainingChecks <= 0) {
          run.nextCheckAt = undefined;
          this.store.save(run);
          return;
        }
        run.remainingChecks--;
        run.nextCheckAt = undefined;
        this.queueMessage(
          run,
          "Research this topic again. Search for new evidence since the previous briefing, compare against saved findings, report only meaningful changes, and update the report and research.json.",
        );
        run = this.store.get(id)!;
      }
      if (run.cancelRequested && !run.sessionId) {
        run.status = "cancelled";
        this.log(run, "Run cancelled", "No remote session was started.");
        this.store.save(run);
        return;
      }
      if (run.mode === "demo") {
        await this.demo(run);
        return;
      }
      const provider =
        this.providers?.[run.provider ?? "openai"] ??
        ((run.provider ?? "openai") === "openai" ? this.provider : undefined);
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
          this.store.save(run);
          return;
        }
        run.creationAttempted = true;
        this.store.save(run);
        const session =
          recovered ??
          (await (run.purpose === "crm"
            ? provider.exportCrm(run)
            : provider.create(run)));
        if (typeof session.id !== "string")
          throw new Error("The Agents API did not return a session ID.");
        run = this.store.get(id)!;
        run.sessionId = session.id;
        run.status = "running";
        this.log(
          run,
          "Research session started",
          "Saved session " +
            session.id +
            ". Progress is recovered from durable API items.",
        );
        this.store.save(run);
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
          this.store.save(run);
          return;
        }
        if (run.provider === "google") {
          input.attempted = true;
          this.store.save(run);
        }
        const result =
          run.provider === "google"
            ? await provider.message(run.sessionId!, input.text, input.key, run)
            : await provider.message(run.sessionId!, input.text, input.key);
        run = this.store.get(id)!;
        if (result?.id) run.sessionId = result.id;
        run.pendingInput = undefined;
        this.store.save(run);
      }
      if (
        !run.cancelRequested &&
        Date.now() - Date.parse(run.startedAt!) > run.maxMinutes * 60000
      ) {
        run.cancelRequested = true;
        run.nextCheckAt = undefined;
        this.log(
          run,
          "Time limit reached",
          "Requesting cancellation before checking further progress.",
          "warning",
        );
        this.store.save(run);
      }
      if (run.cancelRequested) await provider.cancel(run.sessionId!);
      const snap = await provider.snapshot(run.sessionId!);
      run = this.store.get(id)!;
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
      if (snap.session.status === "failed") {
        run.status = "failed";
        run.error = snap.session.error?.message ?? "Remote session failed.";
      } else if (snap.session.status === "requires_action") {
        run.status = "requires_action";
        run.error =
          "The session needs external action. Inspect its required actions in the provider dashboard or cancel the run.";
      } else if (
        isNewTurn &&
        ["completed", "failed", "cancelled"].includes(latest.status)
      ) {
        run.lastTurnId = latest.id;
        if (latest.status === "completed") {
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
          if (!run.report.trim()) {
            run.status = "failed";
            run.error =
              "The turn completed without a readable report. Inspect activity and artifacts before continuing.";
          } else {
            run.status = "completed";
            run.error = undefined;
            this.log(
              run,
              "Report ready",
              "Review citations and evidence before using or exporting the findings.",
            );
            this.schedule(run);
          }
        } else {
          run.status = latest.status;
          if (run.provider === "google") {
            const partial = finalReport(
              snap.items.filter((item) => item.turn_id === latest.id),
            );
            if (partial.trim()) {
              run.report = partial;
              run.sources = sourcesFromReport(partial);
            }
          }
          run.error =
            latest.status === "failed"
              ? (latest.error?.message ?? "The agent turn failed.")
              : undefined;
        }
      } else if (!run.cancelRequested) run.status = "running";
      const exceeded =
        active(run) &&
        (Date.now() - Date.parse(run.startedAt!) > run.maxMinutes * 60000 ||
          (run.tokenUsage !== undefined &&
            run.tokenUsage - (run.budgetBaseline ?? 0) >= run.maxTokens));
      if (exceeded && !run.cancelRequested) {
        run.cancelRequested = true;
        run.nextCheckAt = undefined;
        this.log(
          run,
          "Limit reached",
          "Cancellation requested. In-flight model and tool usage can still be billed.",
          "warning",
        );
      }
      if (run.status === "cancelled" || run.status === "failed") {
        run.nextCheckAt = undefined;
        run.remainingChecks = 0;
      }
      const current = this.store.get(id);
      run.notes = current?.notes ?? run.notes;
      if (current?.cancelRequested) {
        run.cancelRequested = true;
        run.remainingChecks = 0;
        run.nextCheckAt = undefined;
      }
      this.store.save(run);
    } catch (error) {
      const run = this.store.get(id);
      if (!run) return;
      const detail =
        error instanceof Error ? error.message : "Unexpected research error";
      if (error instanceof ProviderError && error.status === 429)
        run.nextPollAt = new Date(
          Date.now() + (error.retryAfterMs ?? 60000),
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
        this.store.save(run);
      } else if (
        error instanceof ProviderError &&
        error.status === 429 &&
        (!run.sessionId || run.pendingInput?.attempted)
      ) {
        // A quota rejection is a definitive response: nothing was submitted, so retry after backoff.
        if (!run.sessionId) run.creationAttempted = false;
        if (run.pendingInput) run.pendingInput.attempted = false;
        run.syncError = undefined;
        this.log(
          run,
          "Provider quota reached",
          `${detail} Retrying the submission after ${run.nextPollAt}.`,
          "warning",
        );
        this.store.save(run);
      } else if (run.sessionId || run.status === "starting") {
        run.syncError = detail;
        this.store.save(run);
      } else {
        run.status = "failed";
        run.error = detail;
        this.log(run, "Run failed", detail, "error");
        this.store.save(run);
      }
    } finally {
      this.busy.delete(id);
    }
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
      this.store.save(run);
      return;
    }
    run.pendingInput = undefined;
    const age = Date.now() - Date.parse(run.startedAt!);
    const steps = [
      [
        "Research director",
        "Planning the research and assigning independent questions.",
      ],
      [
        "Market researcher",
        "Demonstrating source collection. No live search is performed.",
      ],
      [
        "Competitor researcher",
        "Demonstrating comparison and evidence review.",
      ],
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
      Object.assign(run, demoResult(run));
      run.status = "completed";
      this.log(
        run,
        "Demo report ready",
        "Illustrative output. No claims have been researched.",
      );
      this.schedule(run);
    }
    this.store.save(run);
  }
  queueMessage(run: Run, text: string) {
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
    this.store.save(run);
  }
}
