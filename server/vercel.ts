import "./security.js";
import { neon, neonConfig } from "@neondatabase/serverless";
import { plainFetch } from "./brotli-guard.js";
import { waitUntil } from "@vercel/functions";
import { createApp } from "./app.js";
import { providersFromEnv } from "./config.js";
import { PostgresStore, type Query } from "./postgres-store.js";
import { seedRun } from "./demo.js";

/*
 * Vercel entry. There is no long-running worker: research advances in short
 * leased steps triggered by API requests (the UI polls while a run is open),
 * kept alive with waitUntil. /api/cron/tick is an optional backstop (CRON_SECRET).
 */
const env = process.env;
/**
 * The Neon integration names its variables after the chosen prefix
 * (DATABASE_URL, STORAGE_URL, POSTGRES_URL, …). Accept any of them, preferring
 * the pooled connection string.
 */
export function findDatabaseUrl(vars: Record<string, string | undefined>) {
  const isPostgres = (value?: string) =>
    Boolean(value && /^postgres(ql)?:\/\//i.test(value.trim()));
  for (const name of ["DATABASE_URL", "POSTGRES_URL"])
    if (isPostgres(vars[name])) return vars[name]!.trim();
  const candidates = Object.keys(vars)
    .filter((name) => /_URL$/.test(name) && isPostgres(vars[name]))
    .sort(
      (a, b) =>
        Number(/UNPOOLED|NON_POOLING|NO_SSL/.test(a)) -
          Number(/UNPOOLED|NON_POOLING|NO_SSL/.test(b)) || a.localeCompare(b),
    );
  return candidates[0] ? vars[candidates[0]]!.trim() : undefined;
}
const databaseUrl = findDatabaseUrl(env);
// Neon from the Vercel Marketplace adds DATABASE_URL automatically.
// APP_TOKEN is optional: without it the workspace is open to anyone with the URL.
const missing = !databaseUrl
  ? "No Postgres connection string found. In Vercel, open Storage → your Neon database → Connect Project, select this project for Production, then redeploy."
  : undefined;
/**
 * Neon's free tier suspends idle databases; the first request after a pause can
 * fail at the network level while it wakes. Retry those briefly. SQL errors are
 * never retried, and every write Octo makes is an idempotent upsert.
 */
export function withWakeRetry(query: Query, delays = [400, 1200, 3000]): Query {
  const transient = (error: unknown) => {
    const text = String(
      (error as { message?: string })?.message ?? error,
    ).toLowerCase();
    return /fetch failed|network|econnreset|etimedout|socket|terminated|other side closed/.test(
      text,
    );
  };
  return async (text, params) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await query(text, params);
      } catch (error) {
        if (attempt >= delays.length || !transient(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      }
    }
  };
}
const sql: Query = databaseUrl
  ? (() => {
      // Database queries over HTTP skip Node's fetch decompression as well.
      neonConfig.fetchFunction = plainFetch;
      const query = neon(databaseUrl);
      return withWakeRetry(
        (text, params) =>
          query.query(text, params) as Promise<Record<string, any>[]>,
      );
    })()
  : async () => {
      throw new Error("DATABASE_URL is not configured.");
    };
const store = new PostgresStore(sql);
// Keep stored files and downloads inside the 4.5 MB function payload limit.
const fileLimit = 4 * 1024 * 1024;
const setup = providersFromEnv(env, store, { maxFileBytes: fileLimit });
if (!missing)
  waitUntil(
    store
      .get("sample-briefing")
      .then(async (sample) => {
        if (!sample && !(await store.list()).length)
          await store.save(seedRun());
      })
      .catch(() => undefined),
  );
const production = env.VERCEL_PROJECT_PRODUCTION_URL;
const { app } = createApp({
  store,
  provider: setup.openai,
  providers: { openai: setup.openai, google: setup.google },
  voice: setup.voice,
  usage: setup.usage,
  rateLimits: setup.rateLimits,
  googleModels: setup.googleModels,
  defaultProvider: setup.defaultProvider,
  providerConfigurations: setup.providerConfigurations,
  model: setup.model,
  crmReady: setup.crmReady,
  origin: env.APP_ORIGIN ?? (production ? `https://${production}` : ""),
  token: env.APP_TOKEN,
  openaiGate: { word: env.OPENAI_UNLOCK_WORD || undefined },
  deployment: "vercel",
  background: (work) => waitUntil(work.catch(() => undefined)),
  driveOnRequest: true,
  cronSecret: env.CRON_SECRET,
  uploadLimitBytes: fileLimit,
  responseLimitBytes: Math.floor(4.4 * 1024 * 1024),
  // Each step must finish well inside the 300 s function limit; 4 s spacing
  // keeps frequent UI polling from over-polling the provider.
  engine: { leaseMs: 240_000, pollGapMs: 4_000 },
  setupError: missing,
});
export default app;
