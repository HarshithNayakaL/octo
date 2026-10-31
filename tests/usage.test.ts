import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { Store } from "../server/store";
import { PostgresStore } from "../server/postgres-store";
import { createApp } from "../server/app";
import {
  SharedLimiter,
  UsageMeter,
  configuredLimits,
  modelOf,
  nextPacificMidnight,
  pacificDay,
  quotaFrom,
} from "../server/usage";
import { GeminiVoice, Limiter, defaultVoiceModels } from "../server/voice";

vi.setConfig({ testTimeout: 20000 });
let directory: string;
let store: Store;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "octo-usage-"));
  store = new Store(directory);
});
afterEach(async () => {
  await store.close();
  rmSync(directory, { recursive: true, force: true });
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
/** The shape of a real Gemini 429 quota error. */
const quotaError = {
  error: {
    code: 429,
    message: "You exceeded your current quota.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [
          {
            quotaMetric:
              "generativelanguage.googleapis.com/generate_content_free_tier_requests",
            quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
            quotaDimensions: {
              model: "gemini-3.5-flash-lite",
              location: "global",
            },
            quotaValue: "1000",
          },
          {
            quotaMetric:
              "generativelanguage.googleapis.com/generate_content_free_tier_requests",
            quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
            quotaValue: "15",
          },
        ],
      },
      {
        "@type": "type.googleapis.com/google.rpc.RetryInfo",
        retryDelay: "27s",
      },
    ],
  },
};

describe("Gemini usage and limits", () => {
  it("uses the Pacific day, when Google resets daily quotas", () => {
    expect(pacificDay(new Date("2026-10-31T06:59:00Z"))).toBe("2026-10-30");
    expect(pacificDay(new Date("2026-10-31T07:01:00Z"))).toBe("2026-10-31");
    expect(nextPacificMidnight(new Date("2026-10-31T03:00:00Z"))).toBe(
      "2026-10-31T07:00:00.000Z",
    );
    // After the November daylight-saving change, midnight is 08:00 UTC.
    expect(nextPacificMidnight(new Date("2026-11-10T12:00:00Z"))).toBe(
      "2026-11-11T08:00:00.000Z",
    );
  });
  it("knows which model a request is for", () => {
    const base = "https://generativelanguage.googleapis.com/v1beta";
    expect(
      modelOf(`${base}/interactions`, "POST", { model: "gemini-3.8-flash" }),
    ).toBe("gemini-3.8-flash");
    expect(
      modelOf(`${base}/interactions`, "POST", {
        agent: "antigravity-preview-09-2026",
      }),
    ).toBe("antigravity-preview-09-2026");
    expect(
      modelOf(`${base}/auth_tokens`, "POST", {
        bidiGenerateContentSetup: { model: "models/gemini-3.8-live" },
      }),
    ).toBe("gemini-3.8-live");
    expect(
      modelOf(`${base}/models/gemini-3.8-flash:generateContent`, "POST", {}),
    ).toBe("gemini-3.8-flash");
    expect(
      modelOf(`${base}/interactions/abc`, "GET", undefined),
    ).toBeUndefined();
    expect(
      modelOf("https://example.com/x", "POST", { model: "m" }),
    ).toBeUndefined();
  });
  it("reads the exact limits from a Google quota error", () => {
    expect(quotaFrom(quotaError)).toEqual({
      quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
      rpd: 1000,
      rpm: 15,
      retryAfterSeconds: 27,
    });
    expect(quotaFrom({ error: { message: "x" } })).toBeUndefined();
  });
  it("accepts limits copied from AI Studio and ignores junk", () => {
    expect(
      configuredLimits(
        '{"gemini-3.8-live":{"rpm":10,"rpd":500},"bad":{"rpm":-1}}',
      ),
    ).toEqual({
      "gemini-3.8-live": { rpm: 10, rpd: 500, tpm: undefined },
      bad: { rpm: undefined, rpd: undefined, tpm: undefined },
    });
    expect(configuredLimits("not json")).toEqual({});
  });
  it("counts each Gemini request and remembers the limit Google reports", async () => {
    const meter = new UsageMeter(store);
    let calls = 0;
    const fetcher = meter.wrap((async () =>
      ++calls === 3 ? json(quotaError, 429) : json({})) as typeof fetch);
    const url = "https://generativelanguage.googleapis.com/v1beta/interactions";
    for (let i = 0; i < 3; i++)
      await fetcher(url, {
        method: "POST",
        body: JSON.stringify({ model: "gemini-3.5-flash-lite" }),
      });
    await fetcher(`${url}/abc`, {});
    await meter.count("gemini-3.8-live#session");
    expect(await meter.today()).toEqual({
      "gemini-3.5-flash-lite": 3,
      "gemini-3.5-flash-lite#429": 1,
      "gemini-3.8-live#session": 1,
    });
    expect((await meter.learned())["gemini-3.5-flash-lite"]).toMatchObject({
      rpd: 1000,
      rpm: 15,
    });
  });
  it("stores usage in Postgres too, shared by every serverless instance", async () => {
    const pg = new PGlite();
    const pgStore = new PostgresStore(
      async (text, params) =>
        (await pg.query(text, params as unknown[])).rows as Record<
          string,
          any
        >[],
    );
    await pgStore.bumpUsage("2026-10-31", "m");
    await pgStore.bumpUsage("2026-10-31", "m");
    await pgStore.bumpUsage("2026-10-30", "m");
    expect(await pgStore.readUsage("2026-10-31")).toEqual({ m: 2 });
    await pgStore.setValue("quota:m", "{}");
    await pgStore.setValue("quota:m", '{"rpd":5}');
    await pgStore.setValue("other", "x");
    expect(await pgStore.readValues("quota:")).toEqual({
      "quota:m": '{"rpd":5}',
    });
    await pg.close();
  });
  it("reports usage, limits and the visitor's remaining voice allowance", async () => {
    const meter = new UsageMeter(store);
    const fetcher = meter.wrap((async (url: any) =>
      String(url).endsWith("/auth_tokens")
        ? json({ name: "auth_tokens/x" })
        : json({})) as typeof fetch);
    const voice = new GeminiVoice("key", defaultVoiceModels, fetcher);
    const { app } = createApp({
      store,
      model: "m",
      crmReady: false,
      origin: "http://x",
      voice,
      usage: meter,
      googleModels: {
        agent: "antigravity-preview-09-2026",
        model: "gemini-3.8-flash",
      },
      rateLimits: { "gemini-3.8-live": { rpm: 3, rpd: 50 } },
      background: (w) => void w.catch(() => undefined),
    });
    await request(app).post("/api/voice/token").send({});
    await request(app).post("/api/voice/token").send({});
    const res = await request(app).get("/api/limits");
    expect(res.status).toBe(200);
    expect(res.body.aiStudioUrl).toBe("https://aistudio.google.com/rate-limit");
    expect(res.body.day).toBe(pacificDay());
    const live = res.body.models.find(
      (m: any) => m.model === "gemini-3.8-live",
    );
    expect(live).toMatchObject({
      group: "voice",
      sessions: true,
      sessionsToday: 2,
      requestsToday: 2,
      limits: { rpm: 3, rpd: 50, source: "ai-studio" },
    });
    expect(res.body.models.map((m: any) => m.purpose)).toContain(
      "Research runs (Antigravity agent)",
    );
    expect(
      res.body.models.find((m: any) => m.model === "gemini-3.5-flash-lite")
        .limits,
    ).toBeUndefined();
    expect(res.body.octo.voiceSessions).toMatchObject({
      remaining: 10,
      max: 12,
      windowMinutes: 60,
    });
    expect(res.body.octo.voiceTurns).toMatchObject({
      remaining: 20,
      max: 20,
      windowMinutes: 10,
    });
  });
  it("does not charge a visitor for a voice session Google failed to start", async () => {
    const voice = new GeminiVoice("key", defaultVoiceModels, (async () =>
      json({ error: { message: "API key not valid" } }, 400)) as typeof fetch);
    const { app } = createApp({
      store,
      model: "m",
      crmReady: false,
      origin: "http://x",
      voice,
      background: (w) => void w.catch(() => undefined),
    });
    expect((await request(app).post("/api/voice/token").send({})).status).toBe(
      502,
    );
    const res = await request(app).get("/api/limits");
    expect(res.body.octo.voiceSessions.remaining).toBe(12);
  });
  it("shares the voice allowance across instances through the database", async () => {
    const pg = new PGlite();
    const pgStore = new PostgresStore(
      async (text, params) =>
        (await pg.query(text, params as unknown[])).rows as Record<
          string,
          any
        >[],
    );
    // Two limiters stand in for two serverless instances using one database.
    const a = new SharedLimiter(pgStore, "voice-turn", 2, 600_000);
    const b = new SharedLimiter(pgStore, "voice-turn", 2, 600_000);
    const now = Date.UTC(2026, 9, 31, 10, 3);
    expect(await a.take("1.2.3.4", now)).toBe(0);
    expect(await b.take("1.2.3.4", now)).toBe(0);
    expect(await a.take("1.2.3.4", now)).toBe(420_000);
    expect(await b.remaining("1.2.3.4", now)).toMatchObject({
      remaining: 0,
      max: 2,
      resetsInSeconds: 420,
    });
    await b.refund("1.2.3.4", now);
    expect((await a.remaining("1.2.3.4", now)).remaining).toBe(1);
    expect((await a.remaining("5.6.7.8", now)).remaining).toBe(2);
    // The next window starts fresh, and no raw address is stored.
    expect((await a.remaining("1.2.3.4", now + 600_000)).remaining).toBe(2);
    const rows = await pg.query("SELECT day, metric FROM octo_usage");
    expect(JSON.stringify(rows.rows)).not.toContain("1.2.3.4");
    await pg.close();
  });
  it("tells a caller how much of their allowance is left without using it", () => {
    const limiter = new Limiter(3, 60_000);
    limiter.take("a", 0);
    expect(limiter.remaining("a", 1000)).toEqual({
      remaining: 2,
      max: 3,
      windowMinutes: 1,
      resetsInSeconds: 59,
    });
    expect(limiter.remaining("a", 1000).remaining).toBe(2);
    expect(limiter.remaining("b").remaining).toBe(3);
    limiter.refund("a");
    expect(limiter.remaining("a", 1000).remaining).toBe(3);
  });
});
