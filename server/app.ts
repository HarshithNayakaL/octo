import express from "express";
import helmet from "helmet";
import multer from "multer";
import { z } from "zod";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { resolve, basename } from "node:path";
import type { RunStore } from "./store.js";
import { Engine, active, type EngineOptions } from "./engine.js";
import { ProviderError, type Provider } from "./provider.js";
import type {
  Run,
  ProviderId,
  ProviderConfiguration,
} from "../shared/types.js";
import { renderDeliverable } from "./deliverables.js";
import { challengeInput, continuationInput, refreshInput } from "./prompts.js";
import { requestCommunity } from "./community.js";
import { GeminiVoice, type VoiceProvider } from "./voice.js";
import {
  SharedLimiter,
  nextPacificMidnight,
  pacificDay,
  type ModelLimits,
  type UsageMeter,
} from "./usage.js";
import { requestEvidence } from "./evidence.js";
import { isPatchedNode, refuseCompressedRequests } from "./brotli-guard.js";
import { answerQuestion } from "./ask.js";
import { formatsFor, preferredFormat } from "../shared/formats.js";

const domain = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .transform((d) =>
    d
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, ""),
  )
  .refine(
    (d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d),
    "Enter domains like example.com",
  );
const sourcePolicySchema = z.object({
  prefer: z.enum(["balanced", "primary", "academic"]).default("balanced"),
  trust: z.array(domain).max(30).default([]),
  block: z.array(domain).max(30).default([]),
  freshMonths: z.number().int().min(1).max(240).optional(),
});
const creation = z
  .object({
    title: z.string().trim().min(3).max(140),
    workflow: z.enum(["general", "market", "sales", "monitor"]),
    brief: z.string().trim().min(15).max(20000),
    icp: z.string().trim().max(20000).default(""),
    targetCount: z.number().int().min(1).max(100).default(10),
    outputFormat: z.enum(["auto", "pdf", "docx", "csv", "md"]).default("auto"),
    mode: z.enum(["demo", "live"]).default("demo"),
    provider: z.enum(["openai", "google"]).optional(),
    attachmentIds: z.array(z.string().uuid()).max(5).default([]),
    maxMinutes: z.number().int().min(1).max(180).default(30),
    maxTokens: z.number().int().min(1000).max(2_000_000).default(200_000),
    /** Read the brief and files and ask questions before researching. */
    clarify: z.boolean().default(true),
    intervalHours: z.number().int().min(1).max(168).default(24),
    remainingChecks: z.number().int().min(0).max(30).default(0),
    /** Earlier completed runs in this workspace to build on. */
    buildOn: z.array(z.string().uuid()).max(3).default([]),
    /** Gather Reddit and Hacker News discussions before researching. */
    community: z.boolean().default(false),
    sourcePolicy: sourcePolicySchema.optional(),
  })
  .superRefine((r, ctx) => {
    if (r.workflow === "sales" && r.icp.length < 15)
      ctx.addIssue({
        code: "custom",
        path: ["icp"],
        message:
          "Describe your ideal customer profile in at least 15 characters.",
      });
    if (r.workflow !== "monitor" && r.remainingChecks > 0)
      ctx.addIssue({
        code: "custom",
        path: ["remainingChecks"],
        message: "Only ongoing research can schedule follow-up checks.",
      });
  });
interface AppOptions {
  store: RunStore;
  provider?: Provider;
  providers?: Partial<Record<ProviderId, Provider>>;
  providerConfigurations?: ProviderConfiguration[];
  defaultProvider?: ProviderId;
  model: string;
  crmReady: boolean;
  origin: string;
  token?: string;
  production?: boolean;
  deployment?: "local" | "vercel";
  /** Keeps work alive after the response (Vercel `waitUntil`); defaults to fire-and-forget. */
  background?: (work: Promise<unknown>) => void;
  /** Advance due runs whenever the workspace is read. Needed where no worker runs between requests. */
  driveOnRequest?: boolean;
  /** Shared secret for the scheduled backstop at /api/cron/tick. */
  cronSecret?: string;
  uploadLimitBytes?: number;
  /** Largest response body the host can return (artifact downloads). */
  responseLimitBytes?: number;
  engine?: EngineOptions;
  /** A configuration problem that makes the API unusable; reported instead of serving data. */
  setupError?: string;
  /**
   * When present, live OpenAI work needs an unlock token earned with this word.
   * Without a word the gate stays closed. Omit the object to leave OpenAI open.
   */
  openaiGate?: { word?: string };
  /** Speech provider for the voice assistant (Gemini with the Google key). */
  voice?: VoiceProvider;
  /** Counts Gemini requests per model per day. */
  usage?: UsageMeter;
  /** Free-tier limits copied from AI Studio (GEMINI_RATE_LIMITS). */
  rateLimits?: Record<string, ModelLimits>;
  googleModels?: { agent: string; model: string };
}
const sameSecret = (expected: string, received: string) => {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
};
export const openaiUnlockToken = (word: string) =>
  createHmac("sha256", word).update("octo-openai-unlock:v1").digest("hex");
export function createApp(options: AppOptions) {
  const { store, provider } = options;
  const registry = {
    ...(provider ? { openai: provider } : {}),
    ...options.providers,
  };
  const profiles = options.providerConfigurations ?? [
    {
      id: "openai" as const,
      name: "OpenAI Agents API",
      ready: Boolean(provider),
      model: options.model,
      crmReady: options.crmReady,
    },
  ];
  const defaultProvider = options.defaultProvider ?? "openai";
  const defaultProfile = profiles.find((p) => p.id === defaultProvider)!;
  const getProvider = (run: Run) => registry[run.provider ?? "openai"];
  const engine = new Engine(store, provider, registry, options.engine);
  const background =
    options.background ??
    ((work: Promise<unknown>) => {
      void work.catch(() => undefined);
    });
  const advance = (id?: string) =>
    background(id ? engine.process(id) : engine.tick());
  const uploadLimit = options.uploadLimitBytes ?? 5 * 1024 * 1024;
  const gate = options.openaiGate;
  const openaiAccess = !gate ? "open" : gate.word ? "word" : "disabled";
  const openaiUnlocked = (req: express.Request) =>
    !gate ||
    Boolean(
      gate.word &&
        sameSecret(
          openaiUnlockToken(gate.word),
          String(req.headers["x-openai-unlock"] ?? ""),
        ),
    );
  const openaiLocked = (res: express.Response) =>
    res.status(403).json({
      code: "openai_locked",
      error:
        openaiAccess === "disabled"
          ? "OpenAI is not enabled on this server. Use Google Gemini, or ask the administrator to set an access word."
          : "OpenAI is locked to control API costs. Enter the access word in the research form to unlock it, or use Google Gemini.",
    });
  const unlockFailures = new Map<string, { count: number; at: number }>();
  const app = express();
  app.disable("x-powered-by");
  if (options.deployment === "vercel") {
    app.set("trust proxy", true);
    // A platform rewrite may deliver /api/runs as /api?path=runs; restore the route.
    app.use((req, _res, next) => {
      const url = new URL(req.url, "http://local");
      const path = url.searchParams.get("path");
      if (url.pathname === "/api" && path) {
        url.searchParams.delete("path");
        req.url = `/api/${path.replace(/^\/+/, "")}${url.search}`;
      }
      next();
    });
  }
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "img-src": ["'self'", "data:"],
          // The voice assistant talks to Gemini Live directly, with a short-lived token.
          "connect-src": ["'self'", "wss://generativelanguage.googleapis.com"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "upgrade-insecure-requests": null,
        },
      },
    }),
  );
  app.get("/api/cron/tick", async (req, res) => {
    const expected = Buffer.from(options.cronSecret ?? "");
    const received = Buffer.from(
      req.headers.authorization?.replace(/^Bearer /, "") ?? "",
    );
    if (
      !options.cronSecret ||
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    await engine.tick();
    res.json({ ok: true });
  });
  app.use("/api", (_req, res, next) => {
    if (options.setupError) {
      res.status(503).json({ error: options.setupError });
      return;
    }
    next();
  });
  app.use("/api", (req, res, next) => {
    const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(
      ",",
    )[0];
    if (
      req.headers.origin &&
      req.headers.origin !== options.origin &&
      req.headers.origin !== `http://${req.headers.host}` &&
      req.headers.origin !== `${proto}://${req.headers.host}`
    ) {
      res.status(403).json({ error: "Untrusted request origin" });
      return;
    }
    if (options.token) {
      const presented =
        req.headers.authorization?.replace(/^Bearer /, "") ?? "";
      const expected = Buffer.from(options.token);
      const received = Buffer.from(presented);
      if (
        expected.length !== received.length ||
        !timingSafeEqual(expected, received)
      ) {
        res.status(401).json({ error: "Enter the workspace access token." });
        return;
      }
    }
    next();
  });
  const requests = new Map<string, { count: number; at: number }>();
  app.use("/api", (req, res, next) => {
    if (["POST", "PATCH"].includes(req.method)) {
      const key = req.ip ?? "local";
      const now = Date.now();
      const prev = requests.get(key);
      const entry =
        prev && now - prev.at < 60000 ? prev : { count: 0, at: now };
      entry.count++;
      requests.set(key, entry);
      if (entry.count > 60) {
        res.status(429).json({ error: "Too many requests. Wait a minute." });
        return;
      }
    }
    next();
  });
  // Before any body parser: Express 5 would otherwise decode Brotli bodies.
  app.use(refuseCompressedRequests);
  const json = express.json({ limit: "1mb" });
  // Voice turns carry a short recording; everything else stays at 1 MB.
  const voiceJson = express.json({ limit: "4mb" });
  app.use((req, res, next) =>
    req.path === "/api/voice/turn"
      ? voiceJson(req, res, next)
      : json(req, res, next),
  );
  app.get("/api/config", (_req, res) =>
    res.json({
      liveReady: profiles.some((profile) => Boolean(registry[profile.id])),
      model: defaultProfile.model,
      crmReady: options.crmReady,
      defaultProvider,
      providers: profiles.map((profile) => ({
        ...profile,
        ready: Boolean(registry[profile.id]),
      })),
      authRequired: Boolean(options.token),
      api: defaultProfile.name,
      deployment: options.deployment ?? "local",
      openaiAccess,
      storage: store.kind,
      uploadLimitMb: Math.floor(uploadLimit / (1024 * 1024)),
      runtimePatched: isPatchedNode(),
      voice: options.voice
        ? {
            available: true,
            provider: options.voice.name,
            ...(options.voice instanceof GeminiVoice
              ? {
                  live: options.voice.models.live,
                  turn: options.voice.models.turn,
                  tts: options.voice.models.tts,
                }
              : {}),
          }
        : { available: false },
    }),
  );
  app.post("/api/openai/unlock", (req, res) => {
    const key = req.ip ?? "local";
    const now = Date.now();
    const prev = unlockFailures.get(key);
    const failures =
      prev && now - prev.at < 10 * 60000 ? prev : { count: 0, at: now };
    if (failures.count >= 5) {
      res.status(429).json({
        error: "Too many incorrect attempts. Try again in 10 minutes.",
      });
      return;
    }
    const { word } = z
      .object({ word: z.string().trim().min(1).max(200) })
      .parse(req.body);
    if (!gate || !gate.word) {
      res.status(409).json({
        error:
          openaiAccess === "open"
            ? "OpenAI is not locked on this server."
            : "No access word is configured on this server.",
      });
      return;
    }
    if (!sameSecret(gate.word, word)) {
      failures.count++;
      unlockFailures.set(key, failures);
      res.status(403).json({ error: "That word doesn’t match." });
      return;
    }
    unlockFailures.delete(key);
    res.json({ token: openaiUnlockToken(gate.word) });
  });
  app.get("/api/runs", async (_req, res) => {
    const runs = await store.list();
    res.json(
      runs.map(
        ({
          activities,
          report,
          leads,
          versions,
          questions,
          priorResearch,
          evidence,
          reportParts,
          community,
          sourceInfo,
          ...run
        }) => ({
          ...run,
          report: "",
          leads: [],
          activities: [],
          evidence: evidence && {
            ...evidence,
            claims: [],
          },
          community: community && { ...community, items: [], themes: [] },
          versionCount: versions?.length ?? 0,
          hasReport: Boolean(report.trim()),
        }),
      ),
    );
    if (options.driveOnRequest) advance();
  });
  app.get("/api/runs/:id", async (req, res) => {
    const run = await store.get(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Research not found" });
      return;
    }
    res.json(run);
    if (options.driveOnRequest) advance(run.id);
  });
  app.post("/api/runs", async (req, res) => {
    const data = creation.parse(req.body);
    const providerId = data.provider ?? defaultProvider;
    const profile = profiles.find((p) => p.id === providerId);
    if (!profile) {
      res.status(400).json({ error: "Unsupported research provider" });
      return;
    }
    if (
      providerId === "openai" &&
      data.mode === "live" &&
      !openaiUnlocked(req)
    ) {
      openaiLocked(res);
      return;
    }
    if (data.mode === "live" && !registry[providerId]) {
      res.status(409).json({
        error: `Add ${providerId === "google" ? "GEMINI_API_KEY" : "OPENAI_API_KEY"} ${options.deployment === "vercel" ? "to the Vercel project's environment variables and redeploy" : "to .env and restart the server"} first.`,
      });
      return;
    }
    if ((await store.list()).some(active)) {
      res.status(409).json({
        error:
          "Finish or cancel the active research run before starting another.",
      });
      return;
    }
    if (data.attachmentIds.length !== new Set(data.attachmentIds).size) {
      res.status(400).json({ error: "Duplicate attachment IDs" });
      return;
    }
    const attachments = await Promise.all(
      data.attachmentIds.map(async (id) => {
        const file = await store.getUpload(id);
        if (!file)
          throw new Error("An attachment was not found. Upload it again.");
        return file;
      }),
    );
    const priorResearch: Run["priorResearch"] = [];
    for (const id of new Set(data.buildOn)) {
      const prior = await store.get(id);
      if (!prior?.report.trim() || prior.purpose === "crm") {
        res
          .status(400)
          .json({ error: "Earlier research to build on must have a report." });
        return;
      }
      priorResearch.push({
        runId: prior.id,
        title: prior.title,
        at: prior.updatedAt,
        summary: prior.report.slice(0, 12_000),
      });
    }
    const now = new Date().toISOString();
    const {
      clarify,
      buildOn: _buildOn,
      community,
      sourcePolicy,
      ...fields
    } = data;
    const run: Run = {
      ...fields,
      provider: providerId,
      agentName: profile.agentName,
      baseModel: profile.baseModel,
      id: randomUUID(),
      attachments,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      status: clarify ? "planning" : "starting",
      report: "",
      leads: [],
      sources: [],
      activities: [],
      agents: [],
      artifacts: [],
      notes: "",
      model: data.mode === "live" ? profile.model : undefined,
      priorResearch: priorResearch.length ? priorResearch : undefined,
      sourcePolicy:
        sourcePolicy &&
        (sourcePolicy.prefer !== "balanced" ||
          sourcePolicy.trust.length ||
          sourcePolicy.block.length ||
          sourcePolicy.freshMonths)
          ? sourcePolicy
          : undefined,
      community: community ? requestCommunity(true) : undefined,
    };
    // With questions first, voices are gathered while the user answers.
    engine.log(
      run,
      data.mode === "demo" ? "Demo queued" : "Research queued",
      data.mode === "demo"
        ? "An illustrative run. No live web search or API usage."
        : "The research director will use web search and a hosted sandbox.",
    );
    await store.save(run);
    res.status(201).json(run);
    advance(run.id);
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: uploadLimit, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (!/\.(pdf|csv|txt|md|json|xlsx|docx)$/i.test(file.originalname))
        cb(
          new Error(
            "Supported files: PDF, CSV, TXT, Markdown, JSON, XLSX, DOCX.",
          ),
        );
      else cb(null, true);
    },
  });
  app.post("/api/uploads", upload.single("file"), async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "Choose a file to upload" });
      return;
    }
    const id = randomUUID();
    const name = basename(req.file.originalname)
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(-150);
    await store.saveUpload({ id, name, size: req.file.size }, req.file.buffer);
    res.status(201).json({ id, name, size: req.file.size });
  });
  app.delete("/api/runs/:id", async (req, res) => {
    const run = await store.get(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Research not found" });
      return;
    }
    if (
      run.mode === "live" &&
      ["starting", "running", "requires_action"].includes(run.status)
    ) {
      res.status(409).json({
        error:
          "Stop the research before deleting it, so no remote work keeps running.",
      });
      return;
    }
    await store.delete(run.id);
    res.json({ deleted: true });
  });
  app.post("/api/runs/:id/answers", async (req, res) => {
    const run = await store.get(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Research not found" });
      return;
    }
    if (run.status !== "awaiting_input") {
      res
        .status(409)
        .json({ error: "This research is not waiting for answers." });
      return;
    }
    const body = z
      .object({
        answers: z
          .array(
            z.object({
              questionId: z.string().max(20),
              selected: z.array(z.string().max(200)).max(10).default([]),
              note: z.string().trim().max(2000).optional(),
            }),
          )
          .max(10)
          .default([]),
        areas: z.array(z.string().max(120)).max(12).optional(),
        extraContext: z.string().trim().max(10000).optional(),
        community: z.boolean().optional(),
      })
      .parse(req.body);
    if (
      (run.provider ?? "openai") === "openai" &&
      run.mode === "live" &&
      !openaiUnlocked(req)
    ) {
      openaiLocked(res);
      return;
    }
    if (
      (await store.list()).some((other) => other.id !== run.id && active(other))
    ) {
      res
        .status(409)
        .json({ error: "Finish or cancel the active research run first." });
      return;
    }
    const questions = new Map(
      (run.plan?.questions ?? []).map((q) => [q.id, q]),
    );
    run.answers = body.answers
      .filter((a) => questions.has(a.questionId))
      .map((a) => {
        const q = questions.get(a.questionId)!;
        return {
          questionId: q.id,
          question: q.question,
          // Only offered options count as selections; anything else belongs in the note.
          selected: a.selected.filter((s) => q.options.includes(s)),
          note: a.note || undefined,
        };
      });
    if (run.plan && body.areas) {
      const keep = new Set(body.areas);
      const areas = run.plan.areas.map((a) => ({
        ...a,
        selected: keep.has(a.title),
      }));
      if (areas.some((a) => a.selected)) run.plan = { ...run.plan, areas };
    }
    run.extraContext = body.extraContext || undefined;
    if (body.community === false && run.community?.beforeResearch)
      run.community = undefined;
    else if (body.community && !run.community)
      run.community = requestCommunity(true);
    run.status = "starting";
    run.startedAt = new Date().toISOString();
    engine.log(
      run,
      "Research started",
      run.answers.length || run.extraContext
        ? "Your answers and notes guide the research."
        : "Started without answering the questions.",
      "user",
    );
    await store.save(run);
    res.json(run);
    advance(run.id);
  });
  app.post("/api/runs/:id/continue", async (req, res) => {
    const run = await store.get(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Research not found" });
      return;
    }
    if (run.status !== "partial" || !run.reportParts?.length) {
      res.status(409).json({
        error: "Only research with a saved partial report can be continued.",
      });
      return;
    }
    if (run.mode === "live" && !run.sessionId) {
      res
        .status(409)
        .json({ error: "This run has no remote session to continue." });
      return;
    }
    if (
      (run.provider ?? "openai") === "openai" &&
      run.mode === "live" &&
      !openaiUnlocked(req)
    ) {
      openaiLocked(res);
      return;
    }
    if ((await store.list()).some(active)) {
      res.status(409).json({ error: "A research run is already active." });
      return;
    }
    const { note } = z
      .object({ note: z.string().trim().max(5000).optional() })
      .parse(req.body ?? {});
    await engine.queueMessage(run, continuationInput(run, note));
    res.json(await store.get(run.id));
    advance(run.id);
  });
  /** Re-run Octo's citation check on the current report. */
  app.post("/api/runs/:id/evidence", async (req, res) => {
    const run = await store.get(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Research not found" });
      return;
    }
    if (!run.report.trim() || active(run) || run.purpose === "crm") {
      res
        .status(409)
        .json({ error: "Evidence can be checked once a report is ready." });
      return;
    }
    if (
      run.evidence?.status === "pending" ||
      run.evidence?.status === "running"
    ) {
      res.json(run);
      return;
    }
    if (
      (run.provider ?? "openai") === "openai" &&
      run.mode === "live" &&
      !openaiUnlocked(req)
    ) {
      openaiLocked(res);
      return;
    }
    run.evidence = requestEvidence(run);
    await store.save(run);
    res.json(run);
    advance(run.id);
  });
  /** Answer a question from this research only. */
  app.post("/api/runs/:id/ask", async (req, res) => {
    const run = await store.get(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Research not found" });
      return;
    }
    if (!run.report.trim()) {
      res.status(409).json({ error: "Ask questions once a report is ready." });
      return;
    }
    if ((run.questions?.length ?? 0) >= 30) {
      res.status(409).json({
        error:
          "This research has 30 answered questions. Start new research to ask more.",
      });
      return;
    }
    if (
      (run.provider ?? "openai") === "openai" &&
      run.mode === "live" &&
      !openaiUnlocked(req)
    ) {
      openaiLocked(res);
      return;
    }
    const { question } = z
      .object({ question: z.string().trim().min(3).max(1000) })
      .parse(req.body);
    let answer;
    try {
      answer = await answerQuestion(run, getProvider(run), question);
    } catch (err) {
      const status =
        err instanceof ProviderError && err.status === 429 ? 429 : 502;
      res.status(status).json({
        error:
          status === 429
            ? "The provider's rate limit was reached. Try again in a minute."
            : `The question could not be answered: ${err instanceof Error ? err.message : "provider error"}`,
      });
      return;
    }
    const latest = (await store.get(run.id)) ?? run;
    latest.questions = [...(latest.questions ?? []), answer].slice(-30);
    await store.save(latest);
    res.json(latest);
  });
  /** Bring a finished report up to date and keep the old one as a version. */
  app.post("/api/runs/:id/refresh", async (req, res) => {
    const run = await store.get(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Research not found" });
      return;
    }
    if (
      run.status !== "completed" ||
      !run.report.trim() ||
      run.purpose === "crm"
    ) {
      res
        .status(409)
        .json({ error: "Only completed research can be refreshed." });
      return;
    }
    if (run.mode === "live" && !run.sessionId) {
      res
        .status(409)
        .json({ error: "This run has no remote session to refresh." });
      return;
    }
    if (
      (run.provider ?? "openai") === "openai" &&
      run.mode === "live" &&
      !openaiUnlocked(req)
    ) {
      openaiLocked(res);
      return;
    }
    if ((await store.list()).some(active)) {
      res.status(409).json({ error: "A research run is already active." });
      return;
    }
    const { note } = z
      .object({ note: z.string().trim().max(5000).optional() })
      .parse(req.body ?? {});
    await engine.queueMessage(run, refreshInput(run, note));
    res.json(await store.get(run.id));
    advance(run.id);
  });
  /** Gather what people say about the topic on Reddit and Hacker News. */
  app.post("/api/runs/:id/community", async (req, res) => {
    const run = await store.get(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Research not found" });
      return;
    }
    if (
      active(run) ||
      run.purpose === "crm" ||
      run.status === "awaiting_input"
    ) {
      res.status(409).json({
        error: "Community voices can be gathered when no research is running.",
      });
      return;
    }
    if (
      run.community?.status === "pending" ||
      run.community?.status === "running"
    ) {
      res.json(run);
      return;
    }
    if (
      (run.provider ?? "openai") === "openai" &&
      run.mode === "live" &&
      !openaiUnlocked(req)
    ) {
      openaiLocked(res);
      return;
    }
    run.community = requestCommunity(false);
    await store.save(run);
    res.json(run);
    advance(run.id);
  });
  /** Ask the agent to look for the strongest evidence against its own report. */
  app.post("/api/runs/:id/challenge", async (req, res) => {
    const run = await store.get(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Research not found" });
      return;
    }
    if (
      run.status !== "completed" ||
      !run.report.trim() ||
      run.purpose === "crm"
    ) {
      res
        .status(409)
        .json({ error: "Only completed research can be challenged." });
      return;
    }
    if (run.mode === "live" && !run.sessionId) {
      res.status(409).json({ error: "This run has no remote session." });
      return;
    }
    if (
      (run.provider ?? "openai") === "openai" &&
      run.mode === "live" &&
      !openaiUnlocked(req)
    ) {
      openaiLocked(res);
      return;
    }
    if ((await store.list()).some(active)) {
      res.status(409).json({ error: "A research run is already active." });
      return;
    }
    const { note } = z
      .object({ note: z.string().trim().max(5000).optional() })
      .parse(req.body ?? {});
    await engine.queueMessage(run, challengeInput(run, note));
    res.json(await store.get(run.id));
    advance(run.id);
  });
  // Voice assistant. Free-tier quota is shared, so each caller is limited.
  // Kept in the database so every serverless instance agrees on what is left.
  const liveLimit = new SharedLimiter(store, "voice-live", 12, 60 * 60_000);
  const turnLimit = new SharedLimiter(store, "voice-turn", 20, 10 * 60_000);
  const voiceContext = async (body: unknown) => {
    const { runId, page } = z
      .object({
        runId: z.string().max(100).optional(),
        page: z.string().max(40).optional(),
      })
      .passthrough()
      .parse(body ?? {});
    const run = runId ? await store.get(runId) : undefined;
    return { run: run ?? undefined, page };
  };
  const voiceUnavailable = (res: express.Response) =>
    res.status(409).json({
      error: `The voice assistant needs GEMINI_API_KEY ${options.deployment === "vercel" ? "in the Vercel project's environment variables" : "in .env"}.`,
    });
  const voiceFailed = (res: express.Response, err: unknown, what: string) => {
    const status =
      err instanceof ProviderError
        ? [413, 415, 429].includes(err.status)
          ? err.status
          : 502
        : err instanceof z.ZodError
          ? 400
          : 502;
    res.status(status).json({
      error:
        status === 429
          ? "Gemini's free-tier limit was reached. Try again in a minute."
          : status === 400 || status === 413 || status === 415
            ? err instanceof Error
              ? err.message
              : "Invalid request."
            : `${what}: ${err instanceof Error ? err.message : "provider error"}`,
    });
  };
  app.post("/api/voice/token", async (req, res) => {
    if (!options.voice?.liveToken) {
      voiceUnavailable(res);
      return;
    }
    const wait = await liveLimit.take(req.ip ?? "local");
    if (wait) {
      res.setHeader("Retry-After", String(Math.ceil(wait / 1000)));
      res.status(429).json({
        error:
          "Too many voice sessions. Try again later or type your question.",
      });
      return;
    }
    try {
      const token = await options.voice.liveToken(await voiceContext(req.body));
      await options.usage
        ?.count(`${token.model}#session`)
        .catch(() => undefined);
      res.json(token);
    } catch (err) {
      // A failed start does not use up one of the visitor's sessions.
      await liveLimit.refund(req.ip ?? "local").catch(() => undefined);
      voiceFailed(res, err, "Gemini Live could not start");
    }
  });
  app.post("/api/voice/turn", async (req, res) => {
    if (!options.voice) {
      voiceUnavailable(res);
      return;
    }
    const wait = await turnLimit.take(req.ip ?? "local");
    if (wait) {
      res.setHeader("Retry-After", String(Math.ceil(wait / 1000)));
      res.status(429).json({
        error: "Too many voice messages. Wait a minute and try again.",
      });
      return;
    }
    try {
      const history = z
        .array(
          z.object({
            role: z.enum(["user", "assistant"]),
            text: z.string().max(2000),
          }),
        )
        .max(20)
        .default([]);
      const body = z
        .union([
          z.object({
            audio: z.object({
              data: z.string().min(10).max(4_200_000),
              mimeType: z.string().max(80),
            }),
            history,
          }),
          z.object({ text: z.string().trim().min(1).max(2000), history }),
        ])
        .parse(req.body);
      res.json(await options.voice.turn(body, await voiceContext(req.body)));
    } catch (err) {
      await turnLimit.refund(req.ip ?? "local").catch(() => undefined);
      voiceFailed(res, err, "The voice assistant could not answer");
    }
  });
  /** Gemini usage today, known limits, and this visitor's remaining voice requests. */
  app.get("/api/limits", async (req, res) => {
    const caller = req.ip ?? "local";
    const voice =
      options.voice instanceof GeminiVoice ? options.voice.models : undefined;
    const models = [
      options.googleModels && {
        model: options.googleModels.agent,
        purpose: "Research runs (Antigravity agent)",
        group: "research",
      },
      options.googleModels && {
        model: options.googleModels.model,
        purpose:
          "Questions before research, evidence check, Ask, community voices",
        group: "research",
      },
      voice && {
        model: voice.live,
        purpose: "Voice: live conversation",
        group: "voice",
        sessions: true,
      },
      voice && {
        model: voice.turn,
        purpose: "Voice: push-to-talk answers",
        group: "voice",
      },
      voice && {
        model: voice.tts,
        purpose: "Voice: spoken replies (TTS)",
        group: "voice",
      },
    ].filter(Boolean) as {
      model: string;
      purpose: string;
      group: string;
      sessions?: boolean;
    }[];
    const [today, learned] = options.usage
      ? await Promise.all([
          options.usage.today(),
          options.usage.learned(),
        ]).catch(() => [{}, {}] as const)
      : [{}, {}];
    res.json({
      day: pacificDay(),
      resetsAt: nextPacificMidnight(),
      aiStudioUrl: "https://aistudio.google.com/rate-limit",
      models: models.map((m) => {
        const configured = options.rateLimits?.[m.model];
        const reported = (learned as Record<string, any>)[m.model];
        return {
          ...m,
          requestsToday: (today as Record<string, number>)[m.model] ?? 0,
          sessionsToday: m.sessions
            ? ((today as Record<string, number>)[`${m.model}#session`] ?? 0)
            : undefined,
          rateLimitedToday:
            (today as Record<string, number>)[`${m.model}#429`] ?? 0,
          limits: configured
            ? { ...configured, source: "ai-studio" }
            : reported
              ? {
                  rpm: reported.rpm,
                  rpd: reported.rpd,
                  tpm: reported.tpm,
                  source: "google-error",
                  seenAt: reported.seenAt,
                  quotaId: reported.quotaId,
                }
              : undefined,
        };
      }),
      octo: {
        voiceSessions: await liveLimit.remaining(caller),
        voiceTurns: await turnLimit.remaining(caller),
        writes: { max: 60, windowMinutes: 1 },
      },
    });
  });
  app.patch("/api/runs/:id/notes", async (req, res) => {
    const run = await store.get(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Research not found" });
      return;
    }
    run.notes = z
      .object({ notes: z.string().max(50000) })
      .parse(req.body).notes;
    await store.save(run);
    res.json({ saved: true });
  });
  app.post("/api/runs/:id/followup", async (req, res) => {
    const run = await store.get(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Research not found" });
      return;
    }
    if (active(run) || (await store.list()).some(active)) {
      res.status(409).json({ error: "A research run is already active." });
      return;
    }
    if (run.purpose === "crm") {
      res.status(409).json({
        error:
          "CRM exports cannot accept follow-ups. Start a new reviewed export.",
      });
      return;
    }
    const { message } = z
      .object({ message: z.string().trim().min(5).max(20000) })
      .parse(req.body);
    if (
      (run.provider ?? "openai") === "openai" &&
      run.mode === "live" &&
      !openaiUnlocked(req)
    ) {
      openaiLocked(res);
      return;
    }
    if (run.mode === "live" && !run.sessionId) {
      res
        .status(409)
        .json({ error: "This run has no remote session. Start new research." });
      return;
    }
    await engine.queueMessage(run, message);
    res.json(await store.get(run.id));
    advance(run.id);
  });
  app.post("/api/runs/:id/cancel", async (req, res) => {
    const run = await store.get(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Research not found" });
      return;
    }
    run.remainingChecks = 0;
    run.nextCheckAt = undefined;
    if (run.status === "awaiting_input") {
      run.status = "cancelled";
      engine.log(
        run,
        "Research cancelled",
        "Cancelled before research started. No research was run.",
      );
    } else if (active(run)) {
      run.cancelRequested = true;
      engine.log(
        run,
        "Cancellation requested",
        "Waiting for the remote turn to acknowledge cancellation.",
      );
    }
    await store.save(run);
    res.json(run);
    advance(run.id);
  });
  app.post("/api/runs/:id/schedule", async (req, res) => {
    const run = await store.get(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Research not found" });
      return;
    }
    if (run.workflow !== "monitor") {
      res
        .status(400)
        .json({ error: "This is not an ongoing research session." });
      return;
    }
    const data = z
      .object({
        intervalHours: z.number().int().min(1).max(168),
        remainingChecks: z.number().int().min(0).max(30),
      })
      .parse(req.body);
    Object.assign(run, data);
    run.cancelRequested = false;
    run.nextCheckAt =
      data.remainingChecks && !active(run)
        ? new Date(Date.now() + data.intervalHours * 3600000).toISOString()
        : undefined;
    await store.save(run);
    res.json(run);
  });
  app.get("/api/runs/:id/export", async (req, res) => {
    const run = await store.get(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Research not found" });
      return;
    }
    if (!run.report) {
      res.status(409).json({ error: "No report is ready yet" });
      return;
    }
    const format =
      z
        .enum(["pdf", "docx", "csv", "md", "json"])
        .optional()
        .parse(req.query.format) ?? preferredFormat(run);
    if (!formatsFor(run).includes(format)) {
      res.status(409).json({
        error: "This report has no company records or tables to export as CSV.",
      });
      return;
    }
    const file = await renderDeliverable(run, format);
    const name =
      run.title
        .replace(/[^a-zA-Z0-9-]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80) || `research-${run.id}`;
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${name}.${file.extension}"`,
    );
    res.type(file.contentType).send(file.bytes);
  });
  app.get("/api/runs/:id/artifacts/:artifactId", async (req, res) => {
    const run = await store.get(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Research not found" });
      return;
    }
    const artifact = run.artifacts.find((a) => a.id === req.params.artifactId);
    const selectedProvider = getProvider(run);
    if (!artifact || !run.sessionId || !selectedProvider) {
      res.status(404).json({ error: "Artifact not found" });
      return;
    }
    const buffer = await selectedProvider.artifact(run.sessionId, artifact.id);
    if (
      options.responseLimitBytes &&
      buffer.byteLength > options.responseLimitBytes
    ) {
      res.status(413).json({
        error:
          "This file is larger than the hosting platform can return in one response. Download it from your provider account instead.",
      });
      return;
    }
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${basename(artifact.path).replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
    );
    res.type("application/octet-stream").send(buffer);
  });
  app.post("/api/runs/:id/crm", async (req, res) => {
    const run = await store.get(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Research not found" });
      return;
    }
    z.object({ approved: z.literal(true) }).parse(req.body);
    if ((run.provider ?? "openai") === "openai" && !openaiUnlocked(req)) {
      openaiLocked(res);
      return;
    }
    if (!options.crmReady || !getProvider(run)) {
      res.status(409).json({
        error: "Configure the CRM MCP endpoint and allowed tools first.",
      });
      return;
    }
    if (
      run.mode === "demo" ||
      run.status !== "completed" ||
      !run.leads.length
    ) {
      res
        .status(409)
        .json({ error: "Only completed live sales results can be exported." });
      return;
    }
    if ((await store.list()).some(active)) {
      res
        .status(409)
        .json({ error: "Finish the active run before exporting." });
      return;
    }
    const now = new Date().toISOString();
    const child: Run = {
      ...run,
      id: randomUUID(),
      purpose: "crm",
      title: `CRM export · ${run.title}`.slice(0, 140),
      status: "starting",
      sessionId: undefined,
      creationAttempted: undefined,
      nextPollAt: undefined,
      lastTurnId: undefined,
      report: "",
      sources: [],
      activities: [],
      agents: [],
      artifacts: [],
      attachments: [],
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      nextCheckAt: undefined,
      remainingChecks: 0,
      cancelRequested: false,
      tokenUsage: undefined,
      budgetBaseline: 0,
      pendingInput: undefined,
      notes: "",
      error: undefined,
      syncError: undefined,
    };
    engine.log(
      child,
      "Reviewed CRM export queued",
      "Exporting company records through your configured MCP server.",
    );
    await store.save(child);
    res.status(201).json(child);
    advance(child.id);
  });
  if (options.production) {
    app.use(express.static(resolve("dist")));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(resolve("dist/index.html")),
    );
  }
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        });
        return;
      }
      const message =
        error instanceof Error ? error.message : "Unexpected server error";
      res
        .status(error instanceof multer.MulterError ? 413 : 400)
        .json({ error: message.slice(0, 1500) });
    },
  );
  return { app, engine };
}
