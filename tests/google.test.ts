import { afterEach, beforeEach, expect, it, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoogleProvider } from "../server/google-provider";
import { Engine } from "../server/engine";
import { Store } from "../server/store";
import { createApp } from "../server/app";
import { seedRun } from "../server/demo";
import type { Run } from "../shared/types";
let directory: string;
let store: Store;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "google-research-"));
  store = new Store(directory);
});
afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});
const json = (data: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
function run(overrides: Partial<Run> = {}): Run {
  return {
    ...seedRun(),
    id: "google-run",
    provider: "google",
    agentName: "pinned-agent",
    baseModel: "pinned-model",
    mode: "live",
    status: "running",
    sessionId: "int-1",
    startedAt: new Date().toISOString(),
    report: "",
    activities: [],
    attachments: [],
    artifacts: [],
    remainingChecks: 0,
    ...overrides,
  };
}
function setup(
  responses: Response[],
  crm = {
    url: undefined as string | undefined,
    token: undefined as string | undefined,
    tools: [] as string[],
  },
) {
  const fetcher = vi.fn<typeof fetch>();
  for (const response of responses) fetcher.mockResolvedValueOnce(response);
  return {
    fetcher,
    provider: new GoogleProvider(
      "test-secret",
      "default-agent",
      "default-model",
      join(directory, "cache"),
      crm,
      fetcher,
    ),
  };
}
it("creates background research with pinned models, native budget and binary context files", async () => {
  const file = join(directory, "input.pdf");
  writeFileSync(file, Buffer.from([0, 255, 3]));
  const { provider, fetcher } = setup([json({ id: "new" })]);
  await provider.create(
    run({
      attachments: [{ id: "file", name: "input.pdf", path: file, size: 3 }],
      maxTokens: 5000,
    }),
  );
  const options = fetcher.mock.calls[0][1]!;
  expect(options.headers).toMatchObject({ "x-goog-api-key": "test-secret" });
  const body = JSON.parse(options.body as string);
  expect(body).toMatchObject({
    agent: "pinned-agent",
    agent_config: { model: "pinned-model", max_total_tokens: "5000" },
    background: true,
    store: true,
  });
  expect(body.environment.sources[1]).toMatchObject({
    encoding: "base64",
    content: "AP8D",
    target: "/workspace/inputs/file-input.pdf",
  });
  expect(body.tools).toBeUndefined();
  expect(options.body).not.toContain("test-secret");
});
it("extracts final text from raw REST steps and preserves unknown usage", async () => {
  const { provider } = setup([
    json({
      status: "completed",
      steps: [
        { type: "model_output", content: [{ type: "text", text: "# Report" }] },
      ],
    }),
  ]);
  const snap = await provider.snapshot("int-1");
  expect(snap.turns[0].status).toBe("completed");
  expect(snap.items.at(-1)?.content[0].text).toBe("# Report");
  expect(snap.session.usage).toBeUndefined();
  expect(snap.agents).toEqual([]);
});
it("freezes completed files and rejects traversal paths", async () => {
  const interaction = {
    status: "completed",
    environment_id: "env-1",
    steps: [],
  };
  const listing = {
    files: [
      { type: "FILE", path: "workspace/outputs/report.md", size_bytes: "3" },
      { type: "FILE", path: "workspace/outputs/../secret", size_bytes: "3" },
    ],
  };
  const { provider, fetcher } = setup([
    json(interaction),
    json(listing),
    new Response("old"),
    json(interaction),
    json(listing),
  ]);
  const first = await provider.snapshot("int-1");
  const second = await provider.snapshot("int-1");
  expect(first.artifacts).toHaveLength(1);
  expect(second.artifacts).toEqual(first.artifacts);
  expect(
    (await provider.artifact("int-1", first.artifacts[0].id)).toString(),
  ).toBe("old");
  expect(fetcher).toHaveBeenCalledTimes(5);
  await expect(provider.artifact("int-1", "../secret")).rejects.toThrow(
    "Invalid",
  );
});
it("chains follow-ups into the saved environment with a fresh budget", async () => {
  const { provider, fetcher } = setup([
    json({ environment_id: "saved-env" }),
    json({ id: "int-2" }),
  ]);
  expect(
    await provider.message("int-1", "Continue research", "key", run()),
  ).toEqual({ id: "int-2" });
  expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toMatchObject({
    previous_interaction_id: "int-1",
    environment: "saved-env",
    agent: "pinned-agent",
    agent_config: { model: "pinned-model" },
  });
});
it("preserves partial output when native token limits stop research", async () => {
  const { provider } = setup([
    json({
      status: "incomplete",
      steps: [
        {
          type: "model_output",
          content: [{ type: "text", text: "# Partial results" }],
        },
      ],
    }),
  ]);
  store.save(run());
  await new Engine(store, undefined, { google: provider }).process(
    "google-run",
  );
  expect(store.get("google-run")).toMatchObject({
    status: "failed",
    report: "# Partial results",
  });
  expect(store.get("google-run")?.error).toContain("token budget");
});
it("backs off quota polling and redacts credentials in provider errors", async () => {
  const { provider, fetcher } = setup([
    json({ error: { message: "Quota test-secret" } }, 429, {
      "retry-after": "120",
    }),
  ]);
  store.save(run());
  const engine = new Engine(store, undefined, { google: provider });
  await engine.process("google-run");
  expect(store.get("google-run")?.syncError).toBe("Quota [redacted]");
  expect(
    Date.parse(store.get("google-run")!.nextPollAt!) - Date.now(),
  ).toBeGreaterThan(110000);
  await engine.tick();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("retries a create that Google rejected for quota instead of treating it as uncertain", async () => {
  const { provider, fetcher } = setup([
    json({ error: { message: "Quota exhausted" } }, 429, {
      "retry-after": "1",
    }),
    json({ id: "int-new" }),
    json({ status: "in_progress", steps: [] }),
  ]);
  store.save(run({ sessionId: undefined, status: "starting" }));
  const engine = new Engine(store, undefined, { google: provider });
  await engine.process("google-run");
  expect(store.get("google-run")).toMatchObject({ status: "starting" });
  expect(store.get("google-run")?.creationAttempted).toBeFalsy();
  store.save({ ...store.get("google-run")!, nextPollAt: undefined });
  await engine.process("google-run");
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(store.get("google-run")).toMatchObject({
    status: "running",
    sessionId: "int-new",
  });
});
it("retries a follow-up that Google rejected for quota", async () => {
  const { provider, fetcher } = setup([
    json({ environment_id: "env" }),
    json({ error: { message: "Quota exhausted" } }, 429),
    json({ environment_id: "env" }),
    json({ id: "int-2" }),
    json({ status: "in_progress", steps: [] }),
  ]);
  store.save(
    run({ pendingInput: { text: "Continue", key: "k", kind: "followup" } }),
  );
  const engine = new Engine(store, undefined, { google: provider });
  await engine.process("google-run");
  expect(store.get("google-run")?.pendingInput?.attempted).toBeFalsy();
  expect(store.get("google-run")?.status).toBe("running");
  store.save({ ...store.get("google-run")!, nextPollAt: undefined });
  await engine.process("google-run");
  expect(fetcher).toHaveBeenCalledTimes(5);
  expect(store.get("google-run")?.sessionId).toBe("int-2");
  expect(store.get("google-run")?.pendingInput).toBeUndefined();
});
it("never repeats an ambiguous create after restart", async () => {
  const { provider, fetcher } = setup([]);
  store.save(
    run({ sessionId: undefined, status: "starting", creationAttempted: true }),
  );
  await new Engine(store, undefined, { google: provider }).process(
    "google-run",
  );
  expect(fetcher).not.toHaveBeenCalled();
  expect(store.get("google-run")?.status).toBe("failed");
});
it("stores the new interaction ID and never repeats uncertain follow-up submission", async () => {
  const { provider } = setup([
    json({ environment_id: "env" }),
    json({ id: "int-2" }),
    json({ status: "in_progress", steps: [] }),
  ]);
  store.save(
    run({ pendingInput: { text: "Continue", key: "k", kind: "followup" } }),
  );
  await new Engine(store, undefined, { google: provider }).process(
    "google-run",
  );
  expect(store.get("google-run")?.sessionId).toBe("int-2");
  expect(store.get("google-run")?.pendingInput).toBeUndefined();
  const uncertain = setup([]);
  store.save(
    run({
      pendingInput: {
        text: "Continue",
        key: "k",
        kind: "followup",
        attempted: true,
      },
    }),
  );
  await new Engine(store, undefined, { google: uncertain.provider }).process(
    "google-run",
  );
  expect(uncertain.fetcher).not.toHaveBeenCalled();
  expect(store.get("google-run")?.error).toContain("uncertain");
});
it("uses only explicitly allowed CRM tools in a separate export", async () => {
  const { provider, fetcher } = setup([json({ id: "crm" })], {
    url: "https://example.com/mcp",
    token: "crm-secret",
    tools: ["lookup", "upsert"],
  });
  await provider.exportCrm(run());
  const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(body.tools).toEqual([
    {
      type: "mcp_server",
      name: "crm",
      url: "https://example.com/mcp",
      allowed_tools: ["lookup", "upsert"],
      headers: { Authorization: "Bearer crm-secret" },
    },
  ]);
  expect(body.previous_interaction_id).toBeUndefined();
});
it("defaults new runs to Google and blocks live requests without its key", async () => {
  const { app } = createApp({
    store,
    model: "openai-model",
    crmReady: false,
    defaultProvider: "google",
    origin: "http://127.0.0.1:5173",
    providerConfigurations: [
      {
        id: "google",
        name: "Google",
        model: "google-agent",
        baseModel: "google-model",
        agentName: "google-agent",
        ready: false,
        crmReady: false,
      },
      {
        id: "openai",
        name: "OpenAI",
        model: "openai-model",
        ready: false,
        crmReady: false,
      },
    ],
  });
  const payload = {
    title: "Market research",
    workflow: "market",
    brief: "Research the public Indian EV market.",
    mode: "demo",
  };
  const response = await request(app)
    .post("/api/runs")
    .send(payload)
    .expect(201);
  expect(response.body).toMatchObject({
    provider: "google",
    agentName: "google-agent",
    baseModel: "google-model",
  });
  await request(app)
    .post("/api/runs")
    .send({ ...payload, mode: "live" })
    .expect(409)
    .expect((r) => expect(r.body.error).toContain("GEMINI_API_KEY"));
});
