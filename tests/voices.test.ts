import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { createApp } from "../server/app";
import type { Provider } from "../server/provider";
import {
  communityContext,
  fallbackQueries,
  gather,
  keywordAnalysis,
  normaliseThemes,
  selectItems,
} from "../server/community";
import {
  classifySource,
  describeSources,
  policyInstructions,
  publishedDate,
} from "../server/sources";
import { challengeInput, instructions, initialInput } from "../server/prompts";
import { seedRun } from "../server/demo";
import type { Run } from "../shared/types";

let directory: string;
let store: Store;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "octo-voices-"));
  store = new Store(directory);
});
afterEach(async () => {
  await store.close();
  rmSync(directory, { recursive: true, force: true });
});

const ok = (data: unknown) =>
  new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });
/** Fake Hacker News and PullPush responses keyed by URL. */
const communityFetch = vi.fn(async (url: URL | RequestInfo) => {
  const u = String(url);
  if (u.includes("hn.algolia.com"))
    return ok({
      hits: [
        {
          objectID: "1",
          comment_text:
            "Otter meeting notes miss half of what people say when accents are strong, I wish it let me fix speakers.",
          story_title: "Ask HN: Meeting notes",
          points: 12,
          created_at_i: 1780000000,
        },
        {
          objectID: "2",
          comment_text:
            "Unrelated comment about databases and query planners and indexes.",
          story_title: "Postgres",
          created_at_i: 1780000000,
        },
      ],
    });
  if (u.includes("/comment/"))
    return ok({
      data: [
        {
          id: "c1",
          body: "I switched from Otter meeting notes to writing my own because the summaries were generic.",
          subreddit: "productivity",
          permalink: "/r/productivity/comments/x/y/c1",
          score: 40,
          created_utc: 1780000000,
        },
        {
          id: "c2",
          body: "[removed]",
          subreddit: "x",
          created_utc: 1780000000,
        },
      ],
    });
  return ok({
    data: [
      {
        id: "s1",
        title: "Otter meeting notes are great for interviews",
        selftext:
          "Love how otter meeting notes let me search old calls quickly.",
        subreddit: "UXResearch",
        permalink: "/r/UXResearch/comments/s1/t",
        score: 8,
        created_utc: 1780000000,
      },
    ],
  });
}) as unknown as typeof fetch;

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    recover: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue({ id: "sess" }),
    snapshot: vi.fn(),
    message: vi.fn().mockResolvedValue({ id: "sess-2" }),
    cancel: vi.fn().mockResolvedValue(undefined),
    artifact: vi.fn(),
    exportCrm: vi.fn(),
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
    engine: { community: { request: communityFetch, pauseMs: 0 } },
  });
}
const liveRun = (fields: Partial<Run> = {}): Run => ({
  ...seedRun(),
  id: "r",
  provider: "google",
  mode: "live",
  status: "completed",
  sessionId: "sess",
  title: "Otter meeting notes",
  brief: "What do people dislike about Otter meeting notes?",
  ...fields,
});

describe("community voices", () => {
  it("collects relevant posts and drops removed or off-topic ones", async () => {
    const { items, scanned } = await gather(["otter meeting notes"], {
      request: communityFetch,
      pauseMs: 0,
    });
    expect(scanned).toEqual({ hackernews: 2, reddit: 3 });
    const kept = selectItems(items);
    expect(kept.map((i) => i.id).sort()).toEqual(["h1", "rc1", "rs1"]);
    expect(kept.find((i) => i.id === "rc1")).toMatchObject({
      where: "r/productivity",
      url: "https://www.reddit.com/r/productivity/comments/x/y/c1",
    });
  });
  it("keeps only known ids and draws quotes from the theme's own posts", () => {
    const items = [
      {
        id: "a",
        source: "reddit" as const,
        where: "r/x",
        url: "https://reddit.com/a",
        text: "aaa",
        at: "",
      },
      {
        id: "b",
        source: "reddit" as const,
        where: "r/x",
        url: "https://reddit.com/b",
        text: "bbb",
        at: "",
      },
    ];
    const { themes } = normaliseThemes(
      {
        takeaway: "t",
        themes: [
          {
            title: "Pain",
            summary: "s",
            sentiment: "negative",
            kind: "pain",
            itemIds: ["a", "zz"],
            quoteIds: ["b", "zz"],
          },
          {
            title: "Empty",
            summary: "s",
            sentiment: "neutral",
            kind: "other",
            itemIds: ["nope"],
            quoteIds: [],
          },
        ],
      },
      items,
    );
    expect(themes).toHaveLength(1);
    expect(themes[0]).toMatchObject({ itemIds: ["a"], quoteIds: ["a"] });
  });
  it("groups posts by keywords without a model", () => {
    const { themes } = keywordAnalysis([
      {
        id: "1",
        source: "reddit",
        where: "r/x",
        url: "u",
        text: "This is so frustrating and broken",
        at: "",
      },
      {
        id: "2",
        source: "reddit",
        where: "r/x",
        url: "u",
        text: "I wish it exported to Notion",
        at: "",
      },
    ]);
    expect(themes.map((t) => t.kind)).toEqual(["pain", "wish"]);
  });
  it("makes plain keyword searches from the brief", () => {
    const queries = fallbackQueries(liveRun());
    expect(queries[0]).toBe("otter meeting notes");
    expect(queries.join(" ")).not.toMatch(/\b(dislike|people|what)\b/);
  });
  it("gathers voices on request and summarises them with a model", async () => {
    const structured = vi
      .fn()
      .mockResolvedValueOnce({ queries: ["otter meeting notes"] })
      .mockResolvedValueOnce({
        takeaway: "People like search but distrust summaries.",
        themes: [
          {
            title: "Generic summaries",
            summary: "Summaries miss detail.",
            sentiment: "negative",
            kind: "pain",
            itemIds: ["rc1", "h1"],
            quoteIds: ["rc1"],
          },
          {
            title: "Searchable history",
            summary: "Search is valued.",
            sentiment: "positive",
            kind: "praise",
            itemIds: ["rs1"],
            quoteIds: ["rs1"],
          },
        ],
      });
    const { app, engine } = server(provider({ structured }));
    await store.save(liveRun({ report: "Report" }));
    const res = await request(app).post("/api/runs/r/community").send({});
    expect(res.status).toBe(200);
    expect(res.body.community.status).toBe("pending");
    await engine.process("r");
    const run = (await store.get("r"))!;
    expect(run.community).toMatchObject({
      status: "done",
      method: "model",
      queries: ["otter meeting notes"],
      takeaway: "People like search but distrust summaries.",
    });
    expect(run.community!.themes[0].itemIds).toEqual(["rc1", "h1"]);
    const context = communityContext(run.community);
    expect(context).toContain("Generic summaries (2 posts, negative)");
    expect(context).toContain("I switched from Otter");
    expect(context).toContain(
      "https://www.reddit.com/r/productivity/comments/x/y/c1",
    );
    // The list endpoint leaves the posts out.
    const list = await request(app).get("/api/runs");
    expect(list.body[0].community.items).toEqual([]);
  });
  it("gathers voices before research starts and gives them to the agent", async () => {
    const google = provider();
    const { app, engine } = server(google);
    const created = await request(app).post("/api/runs").send({
      title: "Otter meeting notes",
      workflow: "general",
      brief: "What do people dislike about Otter meeting notes?",
      mode: "live",
      provider: "google",
      clarify: false,
      community: true,
    });
    expect(created.body.community).toMatchObject({
      status: "pending",
      beforeResearch: true,
    });
    for (let i = 0; i < 4 && !(google.create as any).mock.calls.length; i++)
      await engine.process(created.body.id);
    expect(google.create).toHaveBeenCalledTimes(1);
    const run = (google.create as any).mock.calls[0][0] as Run;
    // The session is only created once the voices are in.
    expect(run.community!.status).toBe("done");
    expect(initialInput(run)).toContain(
      "What people say in public discussions",
    );
  });
});

describe("source quality and policy", () => {
  it("classifies sources by address", () => {
    expect(classifySource("https://www.rbi.org.in/x")).toBe("government");
    expect(classifySource("https://www.sec.gov/filing")).toBe("government");
    expect(classifySource("https://arxiv.org/abs/2509.04499")).toBe("academic");
    expect(classifySource("https://www.mit.edu/paper")).toBe("academic");
    expect(classifySource("https://www.reuters.com/a")).toBe("news");
    expect(classifySource("https://en.wikipedia.org/wiki/Pix")).toBe(
      "reference",
    );
    expect(classifySource("https://www.reddit.com/r/x")).toBe("forum");
    expect(classifySource("https://someone.substack.com/p/x")).toBe("blog");
    expect(classifySource("https://example.com/best-ev-chargers-2026")).toBe(
      "blog",
    );
    expect(classifySource("https://acme.com/investors/annual-report")).toBe(
      "company",
    );
  });
  it("reads publication dates from page metadata", () => {
    expect(
      publishedDate(
        '<meta property="article:published_time" content="2025-03-18T10:00:00Z">',
      ),
    ).toBe("2025-03-18");
    expect(
      publishedDate('<script>{"datePublished":"2024-11-02"}</script>'),
    ).toBe("2024-11-02");
    expect(publishedDate("<p>no date</p>")).toBeUndefined();
  });
  it("applies trusted and blocked domains", () => {
    const run = liveRun({
      sources: [
        { title: "a", url: "https://news.example.com/a" },
        { title: "b", url: "https://www.trusted.org/b" },
      ],
      sourcePolicy: {
        prefer: "primary",
        trust: ["trusted.org"],
        block: ["example.com"],
      },
    });
    const info = describeSources(run);
    expect(info["https://news.example.com/a"].blocked).toBe(true);
    expect(info["https://www.trusted.org/b"].trusted).toBe(true);
    const text = instructions(run);
    expect(text).toContain("Do not use or cite these domains: example.com");
    expect(text).toContain("Rely on primary sources");
    expect(policyInstructions(undefined)).toBe("");
  });
  it("accepts a source policy when research is created", async () => {
    const { app } = server();
    const res = await request(app)
      .post("/api/runs")
      .send({
        title: "Policy run",
        workflow: "general",
        brief: "A brief that is long enough for the schema.",
        mode: "demo",
        sourcePolicy: {
          prefer: "academic",
          trust: [],
          block: ["https://www.Forbes.com/sites"],
        },
      });
    expect(res.status).toBe(201);
    expect(res.body.sourcePolicy).toMatchObject({
      prefer: "academic",
      block: ["forbes.com"],
    });
    const bad = await request(app)
      .post("/api/runs")
      .send({
        title: "Policy run",
        workflow: "general",
        brief: "A brief that is long enough for the schema.",
        mode: "demo",
        sourcePolicy: { prefer: "balanced", block: ["not a domain"] },
      });
    expect(bad.status).toBe(400);
  });
  it("asks every run for balanced, dated, primary evidence", () => {
    const text = instructions(liveRun());
    expect(text).toContain("present the main positions");
    expect(text).toContain("never treat those as primary evidence");
  });
});

describe("challenge this report", () => {
  it("queues a counter-evidence pass on completed research only", async () => {
    const { app } = server();
    await store.save(liveRun({ report: "Report" }));
    const res = await request(app)
      .post("/api/runs/r/challenge")
      .send({ note: "Focus on fees" });
    expect(res.status).toBe(200);
    expect(res.body.pendingInput.text).toContain(
      "Challenges and counter-evidence",
    );
    expect(res.body.pendingInput.text).toContain("Focus on fees");
    await store.save(liveRun({ id: "p", status: "partial", report: "x" }));
    expect(
      (await request(app).post("/api/runs/p/challenge").send({})).status,
    ).toBe(409);
    expect(challengeInput(liveRun())).toContain("strongest counter-evidence");
  });
});

describe("Reddit's official API", () => {
  it("signs in app-only, searches posts and reads top comments instead of the archive", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(
      async (url: URL | RequestInfo, init?: RequestInit) => {
        const u = String(url);
        calls.push(u);
        if (u.includes("access_token")) {
          expect(String((init?.headers as any).Authorization)).toBe(
            "Basic " + Buffer.from("id:secret").toString("base64"),
          );
          return ok({ access_token: "tok" });
        }
        if (u.includes("oauth.reddit.com/search"))
          return ok({
            data: {
              children: [
                {
                  data: {
                    id: "p1",
                    title: "Otter meeting notes keep mislabelling speakers",
                    selftext:
                      "Anyone else find otter meeting notes unreliable for interviews?",
                    subreddit: "UXResearch",
                    permalink: "/r/UXResearch/comments/p1/x/",
                    score: 55,
                    num_comments: 9,
                    created_utc: 1780000000,
                  },
                },
              ],
            },
          });
        if (u.includes("oauth.reddit.com/comments/p1"))
          return ok([
            {},
            {
              data: {
                children: [
                  {
                    data: {
                      id: "k1",
                      body: "Yes, I gave up and switched to recording locally and transcribing later.",
                      subreddit: "UXResearch",
                      permalink: "/r/UXResearch/comments/p1/x/k1/",
                      score: 20,
                      created_utc: 1780000100,
                    },
                  },
                ],
              },
            },
          ]);
        return ok({ hits: [] });
      },
    ) as unknown as typeof fetch;
    const { items, scanned, errors } = await gather(["otter meeting notes"], {
      request: fetcher,
      pauseMs: 0,
      redditApp: { clientId: "id", clientSecret: "secret" },
    });
    expect(errors).toEqual([]);
    expect(calls.some((c) => c.includes("pullpush"))).toBe(false);
    expect(scanned.reddit).toBe(2);
    const kept = selectItems(items);
    expect(kept.map((i) => i.id).sort()).toEqual(["rk1", "rp1"]);
  });
  it("explains a refused archive request", async () => {
    const fetcher = vi.fn(async (url: URL | RequestInfo) =>
      String(url).includes("pullpush")
        ? new Response("no", { status: 403 })
        : ok({ hits: [] }),
    ) as unknown as typeof fetch;
    const { errors } = await gather(["x y"], { request: fetcher, pauseMs: 0 });
    expect(errors[0]).toContain("REDDIT_CLIENT_ID");
  });
});
