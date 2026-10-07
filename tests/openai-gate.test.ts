import { afterEach, beforeEach, expect, it, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { createApp, openaiUnlockToken } from "../server/app";
import { seedRun } from "../server/demo";
import type { Provider } from "../server/provider";
import type { Run } from "../shared/types";

let directory: string;
let store: Store;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "octo-gate-"));
  store = new Store(directory);
});
afterEach(async () => {
  await store.close();
  rmSync(directory, { recursive: true, force: true });
});
const provider = (): Provider => ({
  recover: vi.fn().mockResolvedValue(undefined),
  create: vi.fn().mockResolvedValue({ id: "sess" }),
  snapshot: vi.fn().mockResolvedValue({
    session: { status: "running" },
    items: [],
    turns: [],
    agents: [],
    artifacts: [],
  }),
  message: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn(),
  artifact: vi.fn(),
  exportCrm: vi.fn().mockResolvedValue({ id: "crm" }),
});
function app(word?: string, gated = true) {
  const openai = provider();
  const google = provider();
  const { app } = createApp({
    store,
    providers: { openai, google },
    defaultProvider: "google",
    providerConfigurations: [
      {
        id: "google",
        name: "Google Antigravity",
        ready: true,
        model: "g",
        crmReady: true,
      },
      {
        id: "openai",
        name: "OpenAI Agents API",
        ready: true,
        model: "m",
        crmReady: true,
      },
    ],
    model: "m",
    crmReady: true,
    origin: "http://127.0.0.1:5173",
    ...(gated ? { openaiGate: { word } } : {}),
  });
  return { app, openai, google };
}
const live = (provider: "openai" | "google") => ({
  title: "Gate test",
  workflow: "market",
  brief: "Research the Indian EV charging market with public evidence.",
  mode: "live",
  provider,
});

it("reports the gate in configuration", async () => {
  expect(
    (await request(app("secret").app).get("/api/config")).body.openaiAccess,
  ).toBe("word");
  expect((await request(app().app).get("/api/config")).body.openaiAccess).toBe(
    "disabled",
  );
  expect(
    (await request(app(undefined, false).app).get("/api/config")).body
      .openaiAccess,
  ).toBe("open");
});
it("blocks live OpenAI runs until the access word is entered", async () => {
  const { app: server, openai } = app("blue-heron");
  const blocked = await request(server).post("/api/runs").send(live("openai"));
  expect(blocked.status).toBe(403);
  expect(blocked.body.code).toBe("openai_locked");
  expect(openai.create).not.toHaveBeenCalled();
  const wrong = await request(server)
    .post("/api/openai/unlock")
    .send({ word: "red-heron" });
  expect(wrong.status).toBe(403);
  const right = await request(server)
    .post("/api/openai/unlock")
    .send({ word: "blue-heron" });
  expect(right.status).toBe(200);
  expect(right.body.token).not.toContain("blue-heron");
  const allowed = await request(server)
    .post("/api/runs")
    .set("X-OpenAI-Unlock", right.body.token)
    .send(live("openai"));
  expect(allowed.status).toBe(201);
});
it("keeps Google and OpenAI demo runs available while OpenAI is locked", async () => {
  const { app: server } = app("blue-heron");
  expect(
    (await request(server).post("/api/runs").send(live("google"))).status,
  ).toBe(201);
  await store.save({ ...(await store.list())[0], status: "completed" });
  const demo = await request(server)
    .post("/api/runs")
    .send({ ...live("openai"), mode: "demo" });
  expect(demo.status).toBe(201);
});
it("cannot be unlocked when no word is configured", async () => {
  const { app: server } = app();
  expect(
    (
      await request(server)
        .post("/api/openai/unlock")
        .send({ word: "anything" })
    ).status,
  ).toBe(409);
  expect(
    (await request(server).post("/api/runs").send(live("openai"))).status,
  ).toBe(403);
});
it("gates follow-ups and CRM exports on existing OpenAI runs, including legacy runs", async () => {
  const { app: server, openai } = app("blue-heron");
  const legacy: Run = {
    ...seedRun(),
    id: "legacy",
    provider: undefined,
    mode: "live",
    status: "completed",
    sessionId: "sess",
    report: "# Report",
    leads: [
      {
        company: "Example",
        website: "https://example.com",
        industry: "x",
        size: "x",
        fit: "high",
        evidence: "x",
        needs: "x",
        decisionMaker: "x",
        sources: [],
      },
    ],
  };
  await store.save(legacy);
  const followup = await request(server)
    .post("/api/runs/legacy/followup")
    .send({ message: "Continue the research please." });
  expect(followup.status).toBe(403);
  const crm = await request(server)
    .post("/api/runs/legacy/crm")
    .send({ approved: true });
  expect(crm.status).toBe(403);
  expect(openai.message).not.toHaveBeenCalled();
  const ok = await request(server)
    .post("/api/runs/legacy/followup")
    .set("X-OpenAI-Unlock", openaiUnlockToken("blue-heron"))
    .send({ message: "Continue the research please." });
  expect(ok.status).toBe(200);
});
it("rejects unlock tokens from a previous word", async () => {
  const { app: server } = app("new-word");
  const stale = await request(server)
    .post("/api/runs")
    .set("X-OpenAI-Unlock", openaiUnlockToken("old-word"))
    .send(live("openai"));
  expect(stale.status).toBe(403);
});
it("limits repeated wrong guesses", async () => {
  const { app: server } = app("blue-heron");
  for (let i = 0; i < 5; i++)
    expect(
      (
        await request(server)
          .post("/api/openai/unlock")
          .send({ word: "guess" + i })
      ).status,
    ).toBe(403);
  const limited = await request(server)
    .post("/api/openai/unlock")
    .send({ word: "blue-heron" });
  expect(limited.status).toBe(429);
});
