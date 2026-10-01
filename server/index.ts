import "dotenv/config";
import { resolve } from "node:path";
import { Store } from "./store.js";
import { createApp } from "./app.js";
import { providersFromEnv } from "./config.js";
import { seedRun } from "./demo.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3001);
if (!["127.0.0.1", "localhost", "::1"].includes(host) && !process.env.APP_TOKEN)
  throw new Error(
    "APP_TOKEN is required to expose this workspace beyond localhost.",
  );
const store = new Store(resolve(process.env.DATA_DIR ?? "data"));
if (!(await store.list()).length) await store.save(seedRun());
const setup = providersFromEnv(process.env, store);
const { app, engine } = createApp({
  store,
  provider: setup.openai,
  providers: { openai: setup.openai, google: setup.google },
  defaultProvider: setup.defaultProvider,
  providerConfigurations: setup.providerConfigurations,
  model: setup.model,
  crmReady: setup.crmReady,
  origin: process.env.APP_ORIGIN ?? "http://127.0.0.1:5173",
  token: process.env.APP_TOKEN,
  production:
    process.env.NODE_ENV === "production" ||
    process.argv.includes("--production"),
});
const server = app.listen(port, host, () => {
  console.log(
    `Research API: http://${host}:${port} · default: ${setup.defaultProvider} · Google: ${setup.google ? "configured" : "not configured"} · OpenAI: ${setup.openai ? "configured" : "not configured"}`,
  );
  engine.start();
});
function shutdown() {
  engine.stop();
  server.close(() => {
    void store.close().then(() => process.exit(0));
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
