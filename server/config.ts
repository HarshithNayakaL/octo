import { OpenAIProvider } from "./provider.js";
import { fallbackModels } from "./fallback.js";
// Provider APIs go through node:http too, so no reply is ever Brotli-decoded (CVE-2026-111497).
import { plainFetch } from "./brotli-guard.js";
import { GeminiVoice, defaultVoiceModels } from "./voice.js";
import { UsageMeter, configuredLimits } from "./usage.js";
import { GoogleProvider } from "./google-provider.js";
import type { RunStore } from "./store.js";
import type { ProviderConfiguration, ProviderId } from "../shared/types.js";

type Env = Record<string, string | undefined>;

/** Provider registry from environment variables. Keys never leave the server. */
export function providersFromEnv(
  env: Env,
  store: RunStore,
  { maxFileBytes }: { maxFileBytes?: number } = {},
) {
  const model = env.OPENAI_MODEL ?? "gpt-6-astra";
  const crm = {
    url: env.CRM_MCP_URL || undefined,
    token: env.CRM_MCP_TOKEN || undefined,
    tools: (env.CRM_MCP_ALLOWED_TOOLS ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  };
  if (crm.url && new URL(crm.url).protocol !== "https:")
    throw new Error("CRM_MCP_URL must use HTTPS.");
  const readAttachment = store.readUpload.bind(store);
  // Every Gemini request is counted per model per day for the usage view.
  const usage = new UsageMeter(store);
  const googleFetch = usage.wrap(plainFetch);
  const openai = env.OPENAI_API_KEY
    ? new OpenAIProvider(
        env.OPENAI_API_KEY,
        model,
        crm,
        plainFetch,
        readAttachment,
      )
    : undefined;
  const googleAgent = env.GEMINI_AGENT ?? "antigravity-preview-09-2026";
  const googleModel = env.GEMINI_MODEL ?? "gemini-3.8-flash";
  const google = env.GEMINI_API_KEY
    ? new GoogleProvider(
        env.GEMINI_API_KEY,
        googleAgent,
        googleModel,
        store.blobs("google-artifacts"),
        crm,
        googleFetch,
        readAttachment,
        maxFileBytes,
        fallbackModels(env.GEMINI_FALLBACK_MODELS),
      )
    : undefined;
  const crmReady = Boolean(crm.url && crm.tools.length);
  const defaultProvider: ProviderId =
    env.DEFAULT_PROVIDER === "openai" ? "openai" : "google";
  const providerConfigurations: ProviderConfiguration[] = [
    {
      id: "google",
      name: "Google Antigravity",
      ready: Boolean(google),
      model: googleAgent,
      agentName: googleAgent,
      baseModel: googleModel,
      crmReady,
    },
    {
      id: "openai",
      name: "OpenAI Agents API",
      ready: Boolean(openai),
      model,
      crmReady,
    },
  ];
  // The same Google key powers the voice assistant: Gemini Live, a fast audio model and Gemini TTS.
  const voice = env.GEMINI_API_KEY
    ? new GeminiVoice(
        env.GEMINI_API_KEY,
        {
          live: env.GEMINI_LIVE_MODEL ?? defaultVoiceModels.live,
          turn: env.GEMINI_VOICE_MODEL ?? defaultVoiceModels.turn,
          tts: env.GEMINI_TTS_MODEL ?? defaultVoiceModels.tts,
          voice: env.GEMINI_VOICE ?? defaultVoiceModels.voice,
        },
        googleFetch,
      )
    : undefined;
  return {
    usage,
    rateLimits: configuredLimits(env.GEMINI_RATE_LIMITS),
    googleModels: env.GEMINI_API_KEY
      ? { agent: googleAgent, model: googleModel }
      : undefined,
    fallbacks: fallbackModels(env.GEMINI_FALLBACK_MODELS),
    voice,
    openai,
    google,
    model,
    crmReady,
    defaultProvider,
    providerConfigurations,
  };
}
