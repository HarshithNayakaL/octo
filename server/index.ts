import "dotenv/config";
import { resolve } from "node:path";
import { Store } from "./store.js";
import { OpenAIProvider } from "./provider.js";
import { GoogleProvider } from "./google-provider.js";
import type { ProviderId } from "../shared/types.js";
import { createApp } from "./app.js";
import { seedRun } from "./demo.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3001);
if (!["127.0.0.1", "localhost", "::1"].includes(host) && !process.env.APP_TOKEN)
  throw new Error(
    "APP_TOKEN is required to expose this workspace beyond localhost.",
  );
const model = process.env.OPENAI_MODEL ?? "gpt-6-astra";
const crm = {
  url: process.env.CRM_MCP_URL,
  token: process.env.CRM_MCP_TOKEN,
  tools: (process.env.CRM_MCP_ALLOWED_TOOLS ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
};
if (crm.url && new URL(crm.url).protocol !== "https:")
  throw new Error("CRM_MCP_URL must use HTTPS.");
const store = new Store(resolve(process.env.DATA_DIR ?? "data"));
if (!store.list().length) store.save(seedRun());
const provider = process.env.OPENAI_API_KEY
  ? new OpenAIProvider(process.env.OPENAI_API_KEY, model, crm)
  : undefined;
const googleAgent = process.env.GEMINI_AGENT ?? "antigravity-preview-09-2026";
const googleModel = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
const googleProvider = process.env.GEMINI_API_KEY
  ? new GoogleProvider(
      process.env.GEMINI_API_KEY,
      googleAgent,
      googleModel,
      resolve(store.directory, "google-artifacts"),
      crm,
    )
  : undefined;
const defaultProvider: ProviderId =
  process.env.DEFAULT_PROVIDER === "openai" ? "openai" : "google";
const { app, engine } = createApp({
  store,
  provider,
  providers: { openai: provider, google: googleProvider },
  defaultProvider,
  providerConfigurations: [
    {
      id: "google",
      name: "Google Antigravity",
      ready: Boolean(googleProvider),
      model: googleAgent,
      agentName: googleAgent,
      baseModel: googleModel,
      crmReady: Boolean(crm.url && crm.tools.length),
    },
    {
      id: "openai",
      name: "OpenAI Agents API",
      ready: Boolean(provider),
      model,
      crmReady: Boolean(crm.url && crm.tools.length),
    },
  ],
  model,
  crmReady: Boolean(crm.url && crm.tools.length),
  origin: process.env.APP_ORIGIN ?? "http://127.0.0.1:5173",
  token: process.env.APP_TOKEN,
  production:
    process.env.NODE_ENV === "production" ||
    process.argv.includes("--production"),
});
const server = app.listen(port, host, () => {
  console.log(
    `Research API: http://${host}:${port} · default: ${defaultProvider} · Google: ${googleProvider ? "configured" : "not configured"} · OpenAI: ${provider ? "configured" : "not configured"}`,
  );
  engine.start();
});
function shutdown() {
  engine.stop();
  server.close(() => {
    store.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
