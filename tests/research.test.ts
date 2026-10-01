import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { createApp } from "../server/app";
import { Engine } from "../server/engine";
import { seedRun } from "../server/demo";
import { toCsv, resultSchema, finalReport } from "../server/results";
import {
  OpenAIProvider,
  ProviderError,
  type Provider,
  type ApiObject,
} from "../server/provider";
import type { Run } from "../shared/types";

let directory: string;
let store: Store;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "research-test-"));
  store = new Store(directory);
});
afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});
const payload = {
  title: "Indian EV market",
  workflow: "market",
  brief: "Research the Indian EV charging market with public evidence.",
  mode: "demo",
};
function run(overrides: Partial<Run> = {}): Run {
  return {
    ...seedRun(),
    id: "test-run",
    sessionId: "sess_1",
    mode: "live",
    status: "running",
    startedAt: new Date().toISOString(),
    report: "",
    activities: [],
    ...overrides,
  };
}
function fakeProvider(): Provider {
  return {
    recover: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue({ id: "sess_1" }),
    snapshot: vi.fn().mockResolvedValue({
      session: { status: "idle", usage: null },
      items: [
        {
          id: "msg_1",
          type: "message",
          role: "assistant",
          phase: "final_answer",
          turn_id: "turn_1",
          content: [
            {
              type: "output_text",
              text: "# Briefing\n\nSource: [Government](https://example.gov/report)",
            },
          ],
        },
      ],
      turns: [{ id: "turn_1", subagent_id: null, status: "completed" }],
      agents: [],
      artifacts: [],
    }),
    message: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    artifact: vi.fn().mockResolvedValue(Buffer.from("{}")),
    exportCrm: vi.fn().mockResolvedValue({ id: "sess_crm" }),
  };
}
function app(provider?: Provider, token?: string) {
  return createApp({
    store,
    provider,
    model: "test-model",
    crmReady: false,
    origin: "http://127.0.0.1:5173",
    token,
  }).app;
}
describe("Research API", () => {
  it("validates briefs and refuses live research without a key", async () => {
    const server = app();
    expect(
      (
        await request(server)
          .post("/api/runs")
          .send({ ...payload, brief: "tiny" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(server)
          .post("/api/runs")
          .send({ ...payload, mode: "live" })
      ).status,
    ).toBe(409);
    expect(store.list()).toHaveLength(0);
  });
  it("requires an ICP for company research and caps target count", async () => {
    const server = app();
    expect(
      (
        await request(server)
          .post("/api/runs")
          .send({ ...payload, workflow: "sales" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(server)
          .post("/api/runs")
          .send({
            ...payload,
            workflow: "sales",
            icp: "Public B2B SaaS companies",
            targetCount: 101,
          })
      ).status,
    ).toBe(400);
  });
  it("prevents concurrent paid sessions", async () => {
    store.save(run());
    const response = await request(app(fakeProvider()))
      .post("/api/runs")
      .send({ ...payload, mode: "live" });
    expect(response.status).toBe(409);
  });
  it("requires the access token and rejects untrusted browser origins", async () => {
    const server = app(undefined, "local-secret");
    expect((await request(server).get("/api/runs")).status).toBe(401);
    expect(
      (
        await request(server)
          .get("/api/runs")
          .set("Authorization", "Bearer local-secret")
      ).status,
    ).toBe(200);
    expect(
      (
        await request(server)
          .post("/api/runs")
          .set("Authorization", "Bearer local-secret")
          .set("Origin", "https://attacker.example")
          .send(payload)
      ).status,
    ).toBe(403);
  });
  it("accepts documents, rejects executables and validates attachment ownership", async () => {
    const server = app();
    const upload = await request(server)
      .post("/api/uploads")
      .attach("file", Buffer.from("Industry: SaaS"), "icp.txt");
    expect(upload.status).toBe(201);
    expect(store.getUpload(upload.body.id)?.name).toBe("icp.txt");
    expect(
      (
        await request(server)
          .post("/api/uploads")
          .attach("file", Buffer.from("code"), "payload.exe")
      ).status,
    ).toBe(400);
    expect(
      (
        await request(server)
          .post("/api/runs")
          .send({
            ...payload,
            attachmentIds: ["00000000-0000-4000-8000-000000000000"],
          })
      ).status,
    ).toBe(400);
  });
  it("saves notes across database reopen and exports reports", async () => {
    const sample = seedRun();
    store.save(sample);
    const server = app();
    expect(
      (
        await request(server)
          .patch("/api/runs/" + sample.id + "/notes")
          .send({ notes: "My durable note" })
      ).status,
    ).toBe(200);
    store.close();
    store = new Store(directory);
    expect(store.get(sample.id)?.notes).toBe("My durable note");
    const response = await request(app()).get(
      "/api/runs/" + sample.id + "/export?format=md",
    );
    expect(response.status).toBe(200);
    expect(response.text).toContain("Demo output");
    expect(response.headers["content-disposition"]).toContain("attachment");
  });
  it("returns clear 404s and no export for an unfinished run", async () => {
    const server = app();
    expect((await request(server).get("/api/runs/missing")).status).toBe(404);
    store.save(run());
    expect(
      (await request(server).get("/api/runs/test-run/export")).status,
    ).toBe(409);
  });
  it("blocks CRM export of illustrative companies", async () => {
    const server = createApp({
      store,
      provider: fakeProvider(),
      model: "test",
      crmReady: true,
      origin: "http://127.0.0.1:5173",
    }).app;
    store.save(run({ mode: "demo", status: "completed" }));
    expect(
      (
        await request(server)
          .post("/api/runs/test-run/crm")
          .send({ approved: true })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(server)
          .post("/api/runs/test-run/crm")
          .send({ approved: false })
      ).status,
    ).toBe(400);
  });
});
describe("Durable workflow engine", () => {
  it("finishes a demo and starts a same-session follow-up", async () => {
    const demo = run({
      mode: "demo",
      sessionId: undefined,
      startedAt: new Date(Date.now() - 10000).toISOString(),
    });
    store.save(demo);
    const engine = new Engine(store);
    await engine.process(demo.id);
    expect(store.get(demo.id)?.status).toBe("completed");
    expect(store.get(demo.id)?.report).toContain("Demo output");
    engine.queueMessage(
      store.get(demo.id)!,
      "Compare the pricing models in more detail.",
    );
    expect(store.get(demo.id)?.status).toBe("running");
    expect(store.get(demo.id)?.pendingInput?.text).toContain("pricing");
  });
  it("recovers remote state and ignores a subagent completion as a root outcome", async () => {
    const provider = fakeProvider();
    vi.mocked(provider.snapshot).mockResolvedValueOnce({
      session: { status: "in_progress" },
      items: [],
      turns: [{ id: "child", subagent_id: "specialist", status: "completed" }],
      agents: [],
      artifacts: [],
    });
    store.save(run());
    const engine = new Engine(store, provider);
    await engine.process("test-run");
    expect(store.get("test-run")?.status).toBe("running");
    await engine.process("test-run");
    expect(store.get("test-run")?.status).toBe("completed");
    expect(store.get("test-run")?.sources).toHaveLength(1);
    expect(provider.create).not.toHaveBeenCalled();
  });
  it("does not accept idle as successful completion", async () => {
    const provider = fakeProvider();
    vi.mocked(provider.snapshot).mockResolvedValue({
      session: { status: "idle" },
      items: [],
      turns: [],
      agents: [],
      artifacts: [],
    });
    store.save(run());
    await new Engine(store, provider).process("test-run");
    expect(store.get("test-run")?.status).toBe("running");
  });
  it("does not reuse a prior completed turn after follow-up input", async () => {
    const provider = fakeProvider();
    store.save(
      run({
        lastTurnId: "turn_1",
        pendingInput: {
          text: "New research",
          key: "input-key",
          kind: "followup",
        },
      }),
    );
    await new Engine(store, provider).process("test-run");
    expect(provider.message).toHaveBeenCalledWith(
      "sess_1",
      "New research",
      "input-key",
    );
    expect(store.get("test-run")?.status).toBe("running");
    expect(store.get("test-run")?.pendingInput).toBeUndefined();
  });
  it("handles failed turns and stops future scheduled checks", async () => {
    const provider = fakeProvider();
    vi.mocked(provider.snapshot).mockResolvedValue({
      session: { status: "idle" },
      items: [],
      turns: [
        {
          id: "turn_2",
          subagent_id: null,
          status: "failed",
          error: { message: "Tool unavailable" },
        },
      ],
      agents: [],
      artifacts: [],
    });
    store.save(run({ workflow: "monitor", remainingChecks: 3 }));
    await new Engine(store, provider).process("test-run");
    expect(store.get("test-run")?.status).toBe("failed");
    expect(store.get("test-run")?.error).toBe("Tool unavailable");
    expect(store.get("test-run")?.remainingChecks).toBe(0);
  });
  it("preserves session IDs after network failures without duplicate creation", async () => {
    const provider = fakeProvider();
    vi.mocked(provider.snapshot).mockRejectedValueOnce(
      new Error("Network timeout"),
    );
    store.save(run());
    const engine = new Engine(store, provider);
    await engine.process("test-run");
    expect(store.get("test-run")?.sessionId).toBe("sess_1");
    expect(store.get("test-run")?.syncError).toContain("Network");
    await engine.process("test-run");
    expect(provider.create).not.toHaveBeenCalled();
    expect(store.get("test-run")?.status).toBe("completed");
  });
  it("recovers a session when the creation response was lost", async () => {
    const provider = fakeProvider();
    vi.mocked(provider.recover).mockResolvedValue({
      id: "sess_1",
      metadata: { local_run_id: "test-run" },
    });
    store.save(
      run({
        sessionId: undefined,
        status: "starting",
        syncError: "Connection lost",
      }),
    );
    await new Engine(store, provider).process("test-run");
    expect(provider.create).not.toHaveBeenCalled();
    expect(store.get("test-run")?.sessionId).toBe("sess_1");
  });
  it("stops rather than recreating a session after an uncertain create", async () => {
    const provider = fakeProvider();
    store.save(
      run({
        sessionId: undefined,
        status: "starting",
        syncError: "Connection lost",
      }),
    );
    await new Engine(store, provider).process("test-run");
    expect(provider.create).not.toHaveBeenCalled();
    expect(store.get("test-run")?.status).toBe("failed");
    expect(store.get("test-run")?.error).toContain("uncertain");
  });
  it("marks invalid credentials as failed, rather than retrying forever", async () => {
    const provider = fakeProvider();
    vi.mocked(provider.create).mockRejectedValue(
      new ProviderError("Invalid API key", 401),
    );
    store.save(run({ sessionId: undefined, status: "starting" }));
    await new Engine(store, provider).process("test-run");
    expect(store.get("test-run")?.status).toBe("failed");
  });
  it("cancels when limits are exceeded and waits for acknowledgement", async () => {
    const provider = fakeProvider();
    vi.mocked(provider.snapshot).mockResolvedValue({
      session: { status: "in_progress", usage: { total_tokens: 25000 } },
      items: [],
      turns: [{ id: "turn_1", status: "in_progress", subagent_id: null }],
      agents: [],
      artifacts: [],
    });
    store.save(run({ maxTokens: 20000 }));
    const engine = new Engine(store, provider);
    await engine.process("test-run");
    expect(store.get("test-run")?.cancelRequested).toBe(true);
    expect(store.get("test-run")?.status).toBe("running");
    await engine.process("test-run");
    expect(provider.cancel).toHaveBeenCalledWith("sess_1");
  });
  it("applies token limits to the new follow-up rather than previous usage", async () => {
    const provider = fakeProvider();
    vi.mocked(provider.snapshot).mockResolvedValue({
      session: { status: "in_progress", usage: { total_tokens: 31000 } },
      items: [],
      turns: [],
      agents: [],
      artifacts: [],
    });
    store.save(run({ tokenUsage: 30000 }));
    const engine = new Engine(store, provider);
    engine.queueMessage(
      store.get("test-run")!,
      "Investigate the pricing again.",
    );
    await engine.process("test-run");
    expect(store.get("test-run")?.cancelRequested).toBe(false);
  });
  it("preserves missing usage as unknown and validates structured company evidence", async () => {
    const provider = fakeProvider();
    const result = {
      report: "# Verified report",
      sources: [{ title: "Company", url: "https://example.com" }],
      leads: [
        {
          company: "A",
          website: "https://example.com",
          industry: "Energy",
          size: "Unknown",
          fit: "unknown",
          evidence: "Missing verified size",
          needs: "Hypothesis only",
          decisionMaker: "Unknown",
          sources: [],
        },
      ],
    };
    vi.mocked(provider.artifact).mockResolvedValue(
      Buffer.from(JSON.stringify(result)),
    );
    const snap = await provider.snapshot("sess_1");
    snap.artifacts = [
      {
        id: "artifact",
        path: "/workspace/outputs/research.json",
        turn_id: "turn_1",
      },
    ];
    vi.mocked(provider.snapshot).mockResolvedValue(snap);
    store.save(run());
    await new Engine(store, provider).process("test-run");
    expect(store.get("test-run")?.tokenUsage).toBeUndefined();
    expect(store.get("test-run")?.leads[0].fit).toBe("unknown");
  });
  it("schedules bounded checks and preserves the session on recurring work", async () => {
    const provider = fakeProvider();
    store.save(
      run({ workflow: "monitor", remainingChecks: 2, intervalHours: 24 }),
    );
    const engine = new Engine(store, provider);
    await engine.process("test-run");
    expect(store.get("test-run")?.nextCheckAt).toBeDefined();
    const saved = store.get("test-run")!;
    saved.nextCheckAt = new Date(Date.now() - 1000).toISOString();
    store.save(saved);
    await engine.process("test-run");
    expect(provider.message).toHaveBeenCalled();
    expect(store.get("test-run")?.remainingChecks).toBe(1);
    expect(store.get("test-run")?.sessionId).toBe("sess_1");
  });
});
describe("Output and API transport contracts", () => {
  it("rejects unsafe result URLs and malformed structured research", () => {
    expect(
      resultSchema.safeParse({
        report: "Report",
        sources: [{ title: "Bad", url: "javascript:alert(1)" }],
        leads: [],
      }).success,
    ).toBe(false);
    expect(
      finalReport([
        {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          content: [{ type: "output_text", text: "Final" }],
        },
      ]),
    ).toBe("Final");
  });
  it("escapes CSV quotes, newlines and spreadsheet formulas", () => {
    const csv = toCsv([
      {
        company: "=DANGEROUS()",
        website: "https://example.com",
        industry: 'a,"b"',
        size: "Unknown",
        fit: "unknown",
        evidence: "line\nbreak",
        needs: "Unknown",
        decisionMaker: "Unknown",
        sources: [],
      },
    ]);
    expect(csv).toContain('"\'=DANGEROUS()"');
    expect(csv).toContain('"a,""b"""');
    expect(csv).toContain('"line\nbreak"');
  });
  it("uses the actual Agents API endpoint, beta header, hosted environment and web search", async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "sess_contract" }), { status: 200 }),
      );
    const provider = new OpenAIProvider(
      "server-secret",
      "chosen-model",
      { tools: [] },
      transport as typeof fetch,
    );
    await provider.create(run({ sessionId: undefined }));
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/agents/sessions");
    expect(init.headers["OpenAI-Beta"]).toBe("agents=v1");
    const body = JSON.parse(init.body);
    expect(body.agent.model).toBe("chosen-model");
    expect(body.environment).toMatchObject({
      type: "openai_hosted",
      container_size: "small",
    });
    expect(body.agent.tools).toEqual([
      { type: "web_search", mode: "live", context_size: "low" },
    ]);
    expect(body.agent.multi_agent.max_concurrent_subagents).toBe(2);
    expect(init.body).not.toContain("server-secret");
  });
});
