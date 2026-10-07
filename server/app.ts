import express from "express";
import helmet from "helmet";
import multer from "multer";
import { z } from "zod";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { resolve, basename } from "node:path";
import type { RunStore } from "./store.js";
import { Engine, active, type EngineOptions } from "./engine.js";
import type { Provider } from "./provider.js";
import type {
  Run,
  ProviderId,
  ProviderConfiguration,
} from "../shared/types.js";
import { toCsv } from "./results.js";

const creation = z
  .object({
    title: z.string().trim().min(3).max(140),
    workflow: z.enum(["market", "sales", "monitor"]),
    brief: z.string().trim().min(15).max(20000),
    icp: z.string().trim().max(20000).default(""),
    targetCount: z.number().int().min(1).max(100).default(10),
    mode: z.enum(["demo", "live"]).default("demo"),
    provider: z.enum(["openai", "google"]).optional(),
    attachmentIds: z.array(z.string().uuid()).max(5).default([]),
    maxMinutes: z.number().int().min(1).max(30).default(5),
    maxTokens: z.number().int().min(1000).max(200000).default(20000),
    intervalHours: z.number().int().min(1).max(168).default(24),
    remainingChecks: z.number().int().min(0).max(30).default(0),
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
          "connect-src": ["'self'"],
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
  app.use(express.json({ limit: "1mb" }));
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
      runs.map(({ activities, report, leads, ...run }) => ({
        ...run,
        report: "",
        leads: [],
        activities: [],
      })),
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
    const now = new Date().toISOString();
    const run: Run = {
      ...data,
      provider: providerId,
      agentName: profile.agentName,
      baseModel: profile.baseModel,
      id: randomUUID(),
      attachments,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      status: "starting",
      report: "",
      leads: [],
      sources: [],
      activities: [],
      agents: [],
      artifacts: [],
      notes: "",
      model: data.mode === "live" ? profile.model : undefined,
    };
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
    if (active(run)) {
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
    const format = z
      .enum(["md", "json", "csv"])
      .parse(req.query.format ?? "md");
    if (!run.report) {
      res.status(409).json({ error: "No report is ready yet" });
      return;
    }
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="research-${run.id}.${format}"`,
    );
    if (format === "csv") res.type("text/csv").send(toCsv(run.leads));
    else if (format === "json")
      res.json({
        title: run.title,
        mode: run.mode,
        brief: run.brief,
        report: run.report,
        sources: run.sources,
        leads: run.leads,
        notes: run.notes,
      });
    else res.type("text/markdown").send(run.report);
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
