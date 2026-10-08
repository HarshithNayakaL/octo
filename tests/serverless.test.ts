import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PostgresStore } from "../server/postgres-store";
import { Store, type RunStore } from "../server/store";
import { Engine } from "../server/engine";
import { createApp } from "../server/app";
import { GoogleProvider } from "../server/google-provider";
import { seedRun } from "../server/demo";
import type { Provider } from "../server/provider";
import type { Run } from "../shared/types";

// PGlite (Postgres in WebAssembly) can take several seconds to start cold.
vi.setConfig({ testTimeout: 20_000 });
let pg: PGlite;
let store: PostgresStore;
beforeEach(async () => {
  pg = new PGlite();
  store = new PostgresStore(
    async (text, params) =>
      (await pg.query(text, params as unknown[])).rows as Record<string, any>[],
  );
});
afterEach(async () => {
  await pg.close();
});
const run = (overrides: Partial<Run> = {}): Run => ({
  ...seedRun(),
  id: "run-1",
  mode: "live",
  provider: "google",
  status: "starting",
  sessionId: undefined,
  startedAt: new Date().toISOString(),
  report: "",
  activities: [],
  remainingChecks: 0,
  ...overrides,
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
function slowProvider(): Provider {
  return {
    recover: vi.fn().mockResolvedValue(undefined),
    create: vi.fn(
      () =>
        new Promise<Record<string, unknown>>((resolve) =>
          setTimeout(() => resolve({ id: "remote-1" }), 30),
        ),
    ),
    snapshot: vi.fn().mockResolvedValue({
      session: { status: "running" },
      items: [],
      turns: [],
      agents: [],
      artifacts: [],
    }),
    message: vi.fn(),
    cancel: vi.fn(),
    artifact: vi.fn().mockResolvedValue(Buffer.alloc(10)),
    exportCrm: vi.fn(),
  };
}
const options = (extra: Partial<Parameters<typeof createApp>[0]> = {}) => ({
  store,
  model: "m",
  crmReady: false,
  origin: "https://octo.example",
  token: "secret-token",
  deployment: "vercel" as const,
  ...extra,
});
const auth = { Authorization: "Bearer secret-token" };

describe("Postgres storage", () => {
  it("persists runs, uploads and files across store instances", async () => {
    await store.save(run({ id: "older", createdAt: "2026-01-01T00:00:00Z" }));
    await store.save(run({ id: "newer", createdAt: "2026-02-01T00:00:00Z" }));
    const file = await store.saveUpload(
      { id: "u1", name: "icp.pdf", size: 3 },
      Buffer.from([0, 255, 7]),
    );
    await store.blobs("cache").put("a/b", Buffer.from("hello"));
    const again = new PostgresStore(
      async (text, params) =>
        (await pg.query(text, params as unknown[])).rows as Record<
          string,
          any
        >[],
    );
    expect((await again.list()).map((r) => r.id)).toEqual(["newer", "older"]);
    expect(file.path).toBeUndefined();
    expect([...(await again.readUpload(file))]).toEqual([0, 255, 7]);
    expect((await again.getUpload("u1"))?.name).toBe("icp.pdf");
    expect(await again.blobs("cache").has("a/b")).toBe(true);
    expect((await again.blobs("cache").get("a/b")).toString()).toBe("hello");
    expect(await again.blobs("other").has("a/b")).toBe(false);
  });
  it("grants a lease to one holder until it expires or is released", async () => {
    expect(await store.claim("run-1", 60_000)).toBe(true);
    expect(await store.claim("run-1", 60_000)).toBe(false);
    await store.release("run-1");
    expect(await store.claim("run-1", 60_000)).toBe(true);
    await store.release("run-1", 60_000);
    expect(await store.claim("run-1", 60_000)).toBe(false);
    expect(await store.claim("run-2", 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    expect(await store.claim("run-2", 60_000)).toBe(true);
  });
});

describe("concurrent workers", () => {
  const stores: Array<[string, () => RunStore]> = [
    ["postgres", () => store],
    ["sqlite", () => new Store(mkdtempSync(join(tmpdir(), "octo-lease-")))],
  ];
  for (const [name, make] of stores)
    it(`creates one remote session when two instances step the same run (${name})`, async () => {
      const shared = make();
      await shared.save(run());
      const provider = slowProvider();
      // Two engines model two serverless instances sharing one database.
      const a = new Engine(shared, undefined, { google: provider });
      const b = new Engine(shared, undefined, { google: provider });
      await Promise.all([a.process("run-1"), b.process("run-1")]);
      expect(provider.create).toHaveBeenCalledTimes(1);
      expect((await shared.get("run-1"))?.sessionId).toBe("remote-1");
      if (shared instanceof Store) {
        const dir = shared.directory;
        await shared.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  it("spaces steps on one run by the poll gap", async () => {
    await store.save(run({ sessionId: "remote-1", status: "running" }));
    const provider = slowProvider();
    const engine = new Engine(
      store,
      undefined,
      { google: provider },
      {
        pollGapMs: 60_000,
      },
    );
    await engine.process("run-1");
    await engine.process("run-1");
    expect(provider.snapshot).toHaveBeenCalledTimes(1);
  });
});

describe("Vercel API", () => {
  it("reports a missing setup instead of serving data", async () => {
    const { app } = createApp(
      options({ setupError: "Set APP_TOKEN in the Vercel project." }),
    );
    const res = await request(app).get("/api/config").set(auth);
    expect(res.status).toBe(503);
    expect(res.body.error).toContain("APP_TOKEN");
  });
  it("advances research from ordinary reads, kept alive by background()", async () => {
    const pending: Promise<unknown>[] = [];
    const { app } = createApp(
      options({ driveOnRequest: true, background: (w) => pending.push(w) }),
    );
    const startedAt = new Date(Date.now() - 10_000).toISOString();
    await store.save(
      run({ id: "demo-1", mode: "demo", status: "running", startedAt }),
    );
    const list = await request(app).get("/api/runs").set(auth);
    expect(list.status).toBe(200);
    await Promise.all(pending);
    expect((await store.get("demo-1"))?.status).toBe("completed");
  });
  it("protects the cron backstop with CRON_SECRET", async () => {
    const { app } = createApp(options({ cronSecret: "cron-secret" }));
    expect((await request(app).get("/api/cron/tick")).status).toBe(401);
    expect((await request(app).get("/api/cron/tick").set(auth)).status).toBe(
      401,
    );
    const ok = await request(app)
      .get("/api/cron/tick")
      .set("Authorization", "Bearer cron-secret");
    expect(ok.status).toBe(200);
    const disabled = createApp(options()).app;
    expect(
      (
        await request(disabled)
          .get("/api/cron/tick")
          .set("Authorization", "Bearer ")
      ).status,
    ).toBe(401);
  });
  it("accepts same-host HTTPS origins behind the platform proxy", async () => {
    const { app } = createApp(options());
    const res = await request(app)
      .get("/api/config")
      .set(auth)
      .set("Host", "octo-git-preview.vercel.app")
      .set("X-Forwarded-Proto", "https")
      .set("Origin", "https://octo-git-preview.vercel.app");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      deployment: "vercel",
      storage: "postgres",
    });
    const foreign = await request(app)
      .get("/api/config")
      .set(auth)
      .set("Origin", "https://evil.example");
    expect(foreign.status).toBe(403);
  });
  it("stores uploads in the database within the platform payload limit", async () => {
    const { app } = createApp(options({ uploadLimitBytes: 8 }));
    const ok = await request(app)
      .post("/api/uploads")
      .set(auth)
      .attach("file", Buffer.from("tiny"), "icp.txt");
    expect(ok.status).toBe(201);
    const stored = await store.getUpload(ok.body.id);
    expect((await store.readUpload(stored!)).toString()).toBe("tiny");
    const big = await request(app)
      .post("/api/uploads")
      .set(auth)
      .attach("file", Buffer.alloc(20), "big.txt");
    expect(big.status).toBe(413);
  });
  it("refuses artifact downloads larger than one response can carry", async () => {
    const provider = slowProvider();
    const { app } = createApp(
      options({ providers: { google: provider }, responseLimitBytes: 5 }),
    );
    await store.save(
      run({
        sessionId: "remote-1",
        status: "completed",
        artifacts: [{ id: "f1", path: "/workspace/outputs/big.csv" }],
      }),
    );
    const res = await request(app)
      .get("/api/runs/run-1/artifacts/f1")
      .set(auth);
    expect(res.status).toBe(413);
  });
  it("sends database-stored attachments to Google and caches outputs in Postgres", async () => {
    const file = await store.saveUpload(
      { id: "u1", name: "brief.pdf", size: 2 },
      Buffer.from([1, 2]),
    );
    const fetcher = vi.fn<typeof fetch>();
    fetcher
      .mockResolvedValueOnce(json({ id: "int-1" }))
      .mockResolvedValueOnce(
        json({
          status: "completed",
          environment_id: "env-1",
          steps: [
            {
              type: "model_output",
              content: [{ type: "text", text: "# Report" }],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        json({
          files: [
            {
              path: "/workspace/outputs/report.md",
              type: "FILE",
              size_bytes: 3,
            },
            {
              path: "/workspace/outputs/huge.bin",
              type: "FILE",
              size_bytes: 99,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(new Response("abc"));
    const google = new GoogleProvider(
      "key",
      "agent",
      "model",
      store.blobs("google-artifacts"),
      { tools: [] },
      fetcher,
      store.readUpload.bind(store),
      10,
    );
    await google.create(run({ attachments: [file] }));
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body.environment.sources[1]).toMatchObject({
      encoding: "base64",
      content: Buffer.from([1, 2]).toString("base64"),
    });
    const snap = await google.snapshot("int-1");
    expect(snap.artifacts).toHaveLength(1);
    expect(
      (await google.artifact("int-1", snap.artifacts[0].id)).toString(),
    ).toBe("abc");
  });
});
it("restores API routes delivered through the platform rewrite", async () => {
  const { app } = createApp(options());
  await store.save(run({ id: "r-9" }));
  const res = await request(app).get("/api?path=runs/r-9").set(auth);
  expect(res.status).toBe(200);
  expect(res.body.id).toBe("r-9");
});
it("finds the Neon connection string under any integration prefix", async () => {
  const { findDatabaseUrl } = await import("../server/vercel");
  expect(findDatabaseUrl({ DATABASE_URL: "postgres://a" })).toBe(
    "postgres://a",
  );
  expect(
    findDatabaseUrl({
      STORAGE_URL_UNPOOLED: "postgresql://direct",
      STORAGE_URL: "postgresql://pooled",
      GEMINI_API_KEY: "x",
    }),
  ).toBe("postgresql://pooled");
  expect(findDatabaseUrl({ STORAGE_URL: "https://not-a-db" })).toBeUndefined();
  expect(findDatabaseUrl({})).toBeUndefined();
});
