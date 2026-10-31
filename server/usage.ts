import { createHash } from "node:crypto";
import type { RunStore } from "./store.js";

/*
 * Gemini free-tier limits are set per Google Cloud project and shown in AI
 * Studio (https://aistudio.google.com/rate-limit); Google's docs do not publish
 * fixed numbers. So Octo shows only what it can verify:
 *
 * - what Octo itself sent to each model today (Pacific day, the same day
 *   boundary Google uses for daily quotas),
 * - the exact limit Google reports in a 429 quota error for this project,
 * - limits copied from AI Studio into GEMINI_RATE_LIMITS, if set.
 */

export interface ModelLimits {
  rpm?: number;
  rpd?: number;
  tpm?: number;
}
export interface LearnedLimit extends ModelLimits {
  /** The quota Google named, e.g. GenerateRequestsPerDayPerProjectPerModel-FreeTier. */
  quotaId?: string;
  seenAt: string;
  retryAfterSeconds?: number;
}

/** Today's date in Pacific time (YYYY-MM-DD); daily quotas reset at midnight there. */
export function pacificDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** The next midnight in Pacific time, as an ISO timestamp. */
export function nextPacificMidnight(now = new Date()) {
  const [y, m, d] = pacificDay(now).split("-").map(Number);
  const tomorrow = pacificDay(new Date(Date.UTC(y, m - 1, d + 1, 12)));
  // Pacific midnight is 07:00 UTC in summer (PDT) and 08:00 UTC in winter (PST).
  for (const offset of [7, 8]) {
    const t = Date.UTC(y, m - 1, d + 1, offset);
    if (
      pacificDay(new Date(t)) === tomorrow &&
      pacificDay(new Date(t - 60_000)) !== tomorrow
    )
      return new Date(t).toISOString();
  }
  return new Date(Date.UTC(y, m - 1, d + 1, 8)).toISOString();
}

/** The model a Gemini API request is for, or undefined for reads and other calls. */
export function modelOf(url: string, method: string, body: unknown) {
  if (method !== "POST" || !url.includes("generativelanguage.googleapis.com"))
    return undefined;
  const b = (body ?? {}) as Record<string, any>;
  const name =
    b.model ??
    b.agent ??
    b.bidiGenerateContentSetup?.model ??
    /\/models\/([^/:]+):/.exec(url)?.[1];
  return typeof name === "string" ? name.replace(/^models\//, "") : undefined;
}

/** Read Google's quota details from a 429 body (google.rpc.QuotaFailure and RetryInfo). */
export function quotaFrom(
  payload: any,
): Omit<LearnedLimit, "seenAt"> | undefined {
  const details: any[] = payload?.error?.details ?? [];
  const violations = details
    .filter((d) => String(d?.["@type"] ?? "").endsWith("QuotaFailure"))
    .flatMap((d) => d.violations ?? []);
  const retry = details.find((d) =>
    String(d?.["@type"] ?? "").endsWith("RetryInfo"),
  )?.retryDelay;
  const limits: Omit<LearnedLimit, "seenAt"> = {};
  for (const v of violations) {
    const id = String(v.quotaId ?? v.quotaMetric ?? "");
    const value = Number(v.quotaValue);
    if (!Number.isFinite(value) || value <= 0) continue;
    limits.quotaId ??= id;
    if (/token/i.test(id)) limits.tpm = value;
    else if (/PerDay/i.test(id)) limits.rpd = value;
    else if (/PerMinute/i.test(id)) limits.rpm = value;
  }
  if (typeof retry === "string" && /^\d+(\.\d+)?s$/.test(retry))
    limits.retryAfterSeconds = Math.ceil(Number(retry.slice(0, -1)));
  return Object.keys(limits).length ? limits : undefined;
}

/** Limits copied from AI Studio, as JSON: {"gemini-3.8-live": {"rpm": 10, "rpd": 500}}. */
export function configuredLimits(raw?: string): Record<string, ModelLimits> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, ModelLimits>;
    const clean: Record<string, ModelLimits> = {};
    for (const [model, limits] of Object.entries(parsed)) {
      if (!limits || typeof limits !== "object") continue;
      const pick = (n: unknown) =>
        typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
      clean[model] = {
        rpm: pick(limits.rpm),
        rpd: pick(limits.rpd),
        tpm: pick(limits.tpm),
      };
    }
    return clean;
  } catch {
    return {};
  }
}

export class UsageMeter {
  constructor(private store: RunStore) {}
  /** Wrap a fetch so every Gemini request is counted and quota errors are remembered. */
  wrap(base: typeof fetch): typeof fetch {
    return async (input, init) => {
      const url =
        typeof input === "string" || input instanceof URL
          ? String(input)
          : input.url;
      let model: string | undefined;
      try {
        model = modelOf(
          url,
          (init?.method ?? "GET").toUpperCase(),
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        );
      } catch {
        model = undefined;
      }
      const response = await base(input, init);
      // Awaited so a serverless function cannot freeze before the count is saved.
      if (model)
        await this.record(model, response.clone()).catch(() => undefined);
      return response;
    };
  }
  private async record(model: string, response: Response) {
    const day = pacificDay();
    await this.store.bumpUsage(day, model);
    if (response.status !== 429) return;
    await this.store.bumpUsage(day, `${model}#429`);
    const quota = quotaFrom(await response.json().catch(() => undefined));
    if (quota) {
      const previous = await this.learned();
      await this.store.setValue(
        `quota:${model}`,
        JSON.stringify({
          ...previous[model],
          ...quota,
          seenAt: new Date().toISOString(),
        }),
      );
    }
  }
  /** Count something that is not a direct API request, such as a Live session. */
  async count(metric: string) {
    await this.store.bumpUsage(pacificDay(), metric);
  }
  async today() {
    return this.store.readUsage(pacificDay());
  }
  async learned(): Promise<Record<string, LearnedLimit>> {
    const rows = await this.store.readValues("quota:");
    const out: Record<string, LearnedLimit> = {};
    for (const [key, value] of Object.entries(rows))
      try {
        out[key.slice("quota:".length)] = JSON.parse(value);
      } catch {
        // Ignore a corrupt entry.
      }
    return out;
  }
}

/**
 * A per-visitor allowance kept in the database, so every serverless instance
 * agrees. Fixed windows (for example each clock hour); visitors are stored as
 * a hash of their address, not the address itself.
 */
export class SharedLimiter {
  constructor(
    private store: RunStore,
    private name: string,
    readonly max: number,
    private windowMs: number,
  ) {}
  private slot(caller: string, now: number) {
    const start = Math.floor(now / this.windowMs) * this.windowMs;
    const who = createHash("sha256").update(caller).digest("hex").slice(0, 16);
    return {
      bucket: `${this.name}@${new Date(start).toISOString()}`,
      metric: `visitor:${who}`,
      resetsInSeconds: Math.ceil((start + this.windowMs - now) / 1000),
    };
  }
  /** Use one, or say how long to wait. Returns 0 when allowed. */
  async take(caller: string, now = Date.now()) {
    const { bucket, metric, resetsInSeconds } = this.slot(caller, now);
    if ((await this.store.getUsage(bucket, metric)) >= this.max)
      return resetsInSeconds * 1000;
    await this.store.bumpUsage(bucket, metric);
    return 0;
  }
  /** Give back a use whose request failed. */
  async refund(caller: string, now = Date.now()) {
    const { bucket, metric } = this.slot(caller, now);
    if ((await this.store.getUsage(bucket, metric)) > 0)
      await this.store.bumpUsage(bucket, metric, -1);
  }
  async remaining(caller: string, now = Date.now()) {
    const { bucket, metric, resetsInSeconds } = this.slot(caller, now);
    const used = await this.store.getUsage(bucket, metric);
    return {
      remaining: Math.max(0, this.max - used),
      max: this.max,
      windowMinutes: Math.round(this.windowMs / 60_000),
      resetsInSeconds: used ? resetsInSeconds : 0,
    };
  }
}
