import { neon } from "@neondatabase/serverless";
import { waitUntil } from "@vercel/functions";
import { createApp } from "./app.js";
import { providersFromEnv } from "./config.js";
import { PostgresStore, type Query } from "./postgres-store.js";
import { seedRun } from "./demo.js";

/*
 * Vercel entry. There is no long-running worker: research advances in short
 * leased steps triggered by API requests (the UI polls while a run is open),
 * kept alive with waitUntil, plus a scheduled backstop at /api/cron/tick.
 */
const env = process.env;
const databaseUrl = env.DATABASE_URL ?? env.POSTGRES_URL;
const missing = !databaseUrl
  ? "Connect a Postgres database to this Vercel project (DATABASE_URL), then redeploy."
  : !env.APP_TOKEN
    ? "Set APP_TOKEN in the Vercel project's environment variables, then redeploy. A public deployment must be protected."
    : undefined;
const sql: Query = databaseUrl
  ? (() => {
      const query = neon(databaseUrl);
      return (text, params) =>
        query.query(text, params) as Promise<Record<string, any>[]>;
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
