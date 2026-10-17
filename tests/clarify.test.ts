import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { createApp } from "../server/app";
import { Engine } from "../server/engine";
import { GoogleProvider } from "../server/google-provider";
import {
  OpenAIProvider,
  ProviderError,
  type Provider,
} from "../server/provider";
import {
  initialInput,
  instructions,
  continuationInput,
} from "../server/prompts";
import { normalisePlan } from "../server/planner";
import { seedRun } from "../server/demo";
import type { Run } from "../shared/types";

let directory: string;
let store: Store;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "octo-clarify-"));
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
const planJson = {
  understanding:
    "You want to know whether solar microgrids suit rural clinics.",
  outcome: "Decide whether to fund a pilot.",
  areas: [
    { title: "Clinic energy demand", focus: "Load profiles of rural clinics." },
    { title: "Microgrid costs", focus: "Capex and maintenance evidence." },
  ],
  questions: [
    {
      question: "Which region matters most?",
      why: "Changes sources and costs.",
      options: ["Sub-Saharan Africa", "South Asia", "Latin America"],
      multiple: true,
    },
  ],
};
function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    recover: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue({ id: "sess" }),
    snapshot: vi.fn().mockResolvedValue({
      session: { status: "running" },
      items: [],
      turns: [],
      agents: [],
      artifacts: [],
    }),
    message: vi.fn().mockResolvedValue({ id: "sess-2" }),
    cancel: vi.fn().mockResolvedValue(undefined),
    artifact: vi.fn(),
    exportCrm: vi.fn(),
    plan: vi.fn().mockResolvedValue(normalisePlan(planJson)),
    ...overrides,
  };
}
function server(google: Provider = provider()) {
  return createApp({
    store,
    providers: { google },
    defaultProvider: "google",
    providerConfigurations: [
      {
        id: "google",
        name: "Google",
        ready: true,
        model: "g",
        crmReady: false,
      },
    ],
    model: "m",
    crmReady: false,
    origin: "http://x",
    background: (w) => void w.catch(() => undefined),
  });
}
const brief = {
  title: "Solar clinics",
  workflow: "general",
  brief: "Should we fund solar microgrids for rural health clinics?",
  mode: "live",
  provider: "google",
};

describe("questions before research", () => {
  it("prepares a plan, waits for answers, then starts with them", async () => {
    const google = provider();
    const { app, engine } = server(google);
    const created = await request(app).post("/api/runs").send(brief);
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("planning");
    await engine.process(created.body.id);
    const waiting = (await store.get(created.body.id))!;
    expect(waiting.status).toBe("awaiting_input");
    expect(waiting.plan?.questions[0].id).toBe("q1");
    expect(google.create).not.toHaveBeenCalled();

    const answered = await request(app)
      .post(`/api/runs/${created.body.id}/answers`)
      .send({
        answers: [
          {
            questionId: "q1",
            selected: ["South Asia", "Not an option"],
            note: "Focus on Bihar",
          },
        ],
        areas: ["Microgrid costs"],
        extraContext: "Budget is $200k.",
      });
    expect(answered.status).toBe(200);
    expect(answered.body.status).toBe("starting");
    const run = (await store.get(created.body.id))!;
    expect(run.answers![0].selected).toEqual(["South Asia"]);
    expect(run.plan!.areas.map((a) => a.selected)).toEqual([false, true]);
    const input = initialInput(run);
    expect(input).toContain("Microgrid costs");
    expect(input).not.toContain("Clinic energy demand");
    expect(input).toContain("South Asia; Focus on Bihar");
    expect(input).toContain("Budget is $200k.");
    expect(input).toContain("Decide whether to fund a pilot.");
    await engine.process(created.body.id);
    expect(google.create).toHaveBeenCalledTimes(1);
  });
  it("skips questions when asked and never researches before answers", async () => {
    const { app } = server();
    const created = await request(app)
      .post("/api/runs")
      .send({ ...brief, clarify: false });
    expect(created.body.status).toBe("starting");
    const other = await request(app).post("/api/runs").send(brief);
    expect(other.status).toBe(409);
  });
  it("lets research start without questions when planning fails", async () => {
    const google = provider({
      plan: vi
        .fn()
        .mockRejectedValue(new ProviderError("Model unavailable", 400)),
    });
    const { app, engine } = server(google);
    const created = await request(app).post("/api/runs").send(brief);
    await engine.process(created.body.id);
    const run = (await store.get(created.body.id))!;
    expect(run.status).toBe("awaiting_input");
    expect(run.planError).toContain("Model unavailable");
    const start = await request(app)
      .post(`/api/runs/${run.id}/answers`)
      .send({});
    expect(start.body.status).toBe("starting");
  });
  it("retries planning after a quota rejection", async () => {
    const google = provider({
      plan: vi.fn().mockRejectedValue(new ProviderError("Quota", 429, 30000)),
    });
    const { app, engine } = server(google);
    const created = await request(app).post("/api/runs").send(brief);
    await engine.process(created.body.id);
    const run = (await store.get(created.body.id))!;
    expect(run.status).toBe("planning");
    expect(Date.parse(run.nextPollAt!) - Date.now()).toBeGreaterThan(20000);
  });
  it("uses an illustrative plan for demo runs without calling a model", async () => {
    const google = provider();
    const { app, engine } = server(google);
    const created = await request(app)
      .post("/api/runs")
      .send({ ...brief, mode: "demo" });
    await engine.process(created.body.id);
    const run = (await store.get(created.body.id))!;
    expect(run.status).toBe("awaiting_input");
    expect(run.plan!.understanding).toContain("Demo");
    expect(google.plan).not.toHaveBeenCalled();
  });
  it("cancels a run waiting for answers immediately", async () => {
    const { app, engine } = server();
    const created = await request(app).post("/api/runs").send(brief);
    await engine.process(created.body.id);
    const res = await request(app).post(`/api/runs/${created.body.id}/cancel`);
    expect(res.body.status).toBe("cancelled");
  });
});

describe("provider planning calls", () => {
  it("asks Gemini for structured JSON with PDFs attached inline", async () => {
    const pdf = join(directory, "brief.pdf");
    writeFileSync(pdf, Buffer.from("%PDF-1.4 test"));
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ output_text: JSON.stringify(planJson) }));
    const google = new GoogleProvider(
      "k",
      "agent",
      "gemini-3.8-flash",
      directory,
      { tools: [] },
      fetcher,
    );
    const plan = await google.plan({
      ...seedRun(),
      workflow: "general",
      attachments: [{ id: "a", name: "brief.pdf", size: 13, path: pdf }],
    } as Run);
    expect(plan.areas[0].title).toBe("Clinic energy demand");
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body.model).toBe("gemini-3.8-flash");
    expect(body.agent).toBeUndefined();
    expect(body.response_format).toMatchObject({
      type: "text",
      mime_type: "application/json",
    });
    expect(body.input[0]).toMatchObject({
      type: "document",
      mime_type: "application/pdf",
    });
    expect(body.input.at(-1).text).toContain("Do not research yet");
  });
  it("reads Gemini output from model_output steps", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        steps: [
          {
            type: "model_output",
            content: [
              {
                type: "text",
                text: "```json\n" + JSON.stringify(planJson) + "\n```",
              },
            ],
          },
        ],
      }),
    );
    const google = new GoogleProvider(
      "k",
      "a",
      "m",
      directory,
      { tools: [] },
      fetcher,
    );
    expect((await google.plan(seedRun())).questions).toHaveLength(1);
  });
  it("asks OpenAI for a strict JSON schema", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        output: [
          {
            content: [{ type: "output_text", text: JSON.stringify(planJson) }],
          },
        ],
      }),
    );
    const openai = new OpenAIProvider("k", "gpt", { tools: [] }, fetcher);
    const plan = await openai.plan(seedRun());
    expect(plan.outcome).toContain("pilot");
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(init!.body as string);
    expect(body.text.format).toMatchObject({
      type: "json_schema",
      strict: true,
    });
    expect(body.text.format.schema.additionalProperties).toBe(false);
  });
});

describe("prompts", () => {
  it("lets the agent choose areas instead of a fixed template", () => {
    const run = { ...seedRun(), workflow: "general" as const, plan: undefined };
    expect(instructions(run)).toContain("Do not apply a fixed template");
    expect(instructions(run)).not.toContain(
      "market, competitor, pricing, and regulation specialists",
    );
    expect(initialInput(run)).toContain("Answer the user's research question");
  });
});

describe("delete", () => {
  it("removes finished or waiting runs and refuses running live research", async () => {
    const { app } = server();
    await store.save({ ...seedRun(), id: "done", status: "completed" });
    expect((await request(app).delete("/api/runs/done")).status).toBe(200);
    expect(await store.get("done")).toBeUndefined();
    await store.save({
      ...seedRun(),
      id: "busy",
      mode: "live",
      status: "running",
      sessionId: "s",
    });
    expect((await request(app).delete("/api/runs/busy")).status).toBe(409);
    expect((await request(app).delete("/api/runs/missing")).status).toBe(404);
  });
});

describe("partial reports", () => {
  const stopped = (status: string) =>
    provider({
      snapshot: vi.fn().mockResolvedValue({
        session: { status: "idle" },
        items: [
          {
            id: "m1",
            type: "message",
            role: "assistant",
            phase: "final_answer",
            turn_id: "t1",
            content: [
              { type: "output_text", text: "# Half done\n\nFirst findings." },
            ],
          },
        ],
        turns: [{ id: "t1", subagent_id: null, status }],
        agents: [],
        artifacts: [],
      }),
    });
  it("saves the unfinished report when a limit stops research, then continues into one report", async () => {
    const google = stopped("cancelled");
    const { app, engine } = server(google);
    await store.save({
      ...seedRun(),
      id: "r",
      provider: "google",
      mode: "live",
      status: "running",
      sessionId: "sess",
      report: "",
      startedAt: new Date(Date.now() - 10 * 60000).toISOString(),
      maxMinutes: 1,
      remainingChecks: 0,
    });
    await engine.process("r");
    const run = (await store.get("r"))!;
    expect(run.status).toBe("partial");
    expect(run.report).toContain("Half done");
    expect(run.reportParts![0].reason).toContain("time limit");

    const res = await request(app)
      .post("/api/runs/r/continue")
      .send({ note: "Also cover financing." });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("running");
    expect(res.body.pendingInput.text).toContain("ONE complete final report");
    expect(res.body.pendingInput.text).toContain("First findings.");
    expect(res.body.pendingInput.text).toContain("Also cover financing.");
  });
  it("only continues runs that have a saved partial report", async () => {
    const { app } = server();
    await store.save({ ...seedRun(), id: "c", status: "completed" });
    expect(
      (await request(app).post("/api/runs/c/continue").send({})).status,
    ).toBe(409);
  });
  it("asks for one merged report in the continuation text", () => {
    const text = continuationInput({
      ...seedRun(),
      reportParts: [
        {
          turnId: "t",
          report: "# Part",
          reason: "the token limit was reached",
          at: "",
        },
      ],
    });
    expect(text).toContain("the token limit was reached");
    expect(text).toContain("# Part");
  });
});

describe("Google continuation", () => {
  it("starts a fresh interaction carrying the task when the environment is gone", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ id: "old", status: "incomplete" }))
      .mockResolvedValueOnce(json({ id: "fresh" }));
    const google = new GoogleProvider(
      "k",
      "a",
      "m",
      directory,
      { tools: [] },
      fetcher,
    );
    const run = { ...seedRun(), provider: "google" as const, attachments: [] };
    const result = await google.message("old", "Continue please", "key", run);
    expect(result).toEqual({ id: "fresh" });
    const body = JSON.parse(fetcher.mock.calls[1][1]!.body as string);
    expect(body.previous_interaction_id).toBeUndefined();
    expect(body.input).toContain("Continue please");
    expect(body.input).toContain(run.brief);
  });
  it("falls back to a fresh interaction when Google rejects chaining", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ id: "old", environment_id: "env" }))
      .mockResolvedValueOnce(
        json({ error: { message: "cannot continue" } }, 400),
      )
      .mockResolvedValueOnce(json({ id: "fresh" }));
    const google = new GoogleProvider(
      "k",
      "a",
      "m",
      directory,
      { tools: [] },
      fetcher,
    );
    const result = await google.message("old", "Continue", "key", {
      ...seedRun(),
      attachments: [],
    });
    expect(result).toEqual({ id: "fresh" });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
