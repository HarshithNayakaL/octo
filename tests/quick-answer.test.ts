import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { createApp } from "../server/app";
import { GoogleProvider } from "../server/google-provider";
import {
  OpenAIProvider,
  ProviderError,
  type Provider,
} from "../server/provider";
import { GeminiVoice, defaultVoiceModels } from "../server/voice";
import { parseQuick } from "../server/quick";

let directory: string;
let store: Store;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "octo-quick-"));
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
const agentReply =
  "Lando Norris won the 2025 drivers' title.\nSOURCE: 2025 season | https://www.formula1.com/en/results/2025\nSOURCE: BBC | https://www.bbc.com/sport/f1";

describe("quick answers from the agents", () => {
  it("splits the spoken answer from its sources", () => {
    const q = parseQuick(agentReply, "m");
    expect(q?.answer).toBe("Lando Norris won the 2025 drivers' title.");
    expect(q?.sources.map((s) => s.title)).toEqual(["2025 season", "BBC"]);
    expect(parseQuick("Answer [here](https://x.com/a).", "m")?.answer).toBe(
      "Answer here.",
    );
  });

  it("runs one short Antigravity pass in the background and polls it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ id: "int_1", status: "in_progress" }))
      .mockResolvedValueOnce(json({ id: "int_1", status: "in_progress" }))
      .mockResolvedValueOnce(
        json({
          id: "int_1",
          status: "completed",
          steps: [
            {
              type: "model_output",
              content: [{ type: "text", text: agentReply }],
            },
          ],
        }),
      );
    const google = new GoogleProvider(
      "k",
      "antigravity-agent",
      "flash-model",
      join(directory, "cache"),
      { tools: [] },
      fetcher,
    );
    const answer = google.quickAnswer("Who won the 2025 F1 title?");
    await vi.advanceTimersByTimeAsync(4000);
    const result = await answer;
    vi.useRealTimers();
    expect(result?.answer).toContain("Lando Norris");
    expect(result?.sources).toHaveLength(2);
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.agent).toBe("antigravity-agent");
    expect(body.agent_config.max_total_tokens).toBe("40000");
    expect(body.background).toBe(true);
  });

  it("cancels an agent pass that runs past its deadline", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: unknown) => {
      calls.push(String(url));
      return json({ id: "int_2", status: "in_progress" });
    }) as unknown as typeof fetch;
    const google = new GoogleProvider(
      "k",
      "agent",
      "model",
      join(directory, "cache"),
      { tools: [] },
      fetcher,
    );
    await expect(google.quickAnswer("Slow question?", 10)).rejects.toThrow(
      "took too long",
    );
    expect(calls.some((u) => u.endsWith(":cancel"))).toBe(true);
  });

  it("uses OpenAI web search with url citations", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: "McLaren won the 2025 constructors' title.",
                annotations: [
                  {
                    type: "url_citation",
                    title: "F1 results",
                    url: "https://www.formula1.com/results",
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    const openai = new OpenAIProvider("k", "gpt-model", { tools: [] }, fetcher);
    const result = await openai.quickAnswer("Who won the constructors?");
    expect(result?.answer).toContain("McLaren");
    expect(result?.sources[0].url).toBe("https://www.formula1.com/results");
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.tools).toEqual([{ type: "web_search" }]);
  });

  it("falls back from grounding to the Google agent, then to Wikipedia", async () => {
    const quota = () =>
      json({ error: { message: "You exceeded your current quota" } }, 429);
    const voiceFetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("wikipedia.org") && u.includes("list=search"))
        return json({
          query: {
            search: [
              {
                title: "2025 Formula One World Championship",
                snippet: "Champion: Lando Norris",
              },
            ],
          },
        });
      if (u.includes("wikipedia.org"))
        return new Response("busy", { status: 429 });
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.tools) return quota();
      return json({
        candidates: [
          { content: { parts: [{ text: "From Wikipedia: Lando Norris." }] } },
        ],
      });
    }) as unknown as typeof fetch;
    const app = (agent: Provider["quickAnswer"]) =>
      createApp({
        store,
        model: "m",
        crmReady: false,
        origin: "http://x",
        voice: new GeminiVoice("key", defaultVoiceModels, voiceFetch),
        providers: { google: { quickAnswer: agent } as unknown as Provider },
        background: (w) => void w.catch(() => undefined),
      }).app;
    const fromAgent = await request(
      app(async () => parseQuick(agentReply, "antigravity")),
    )
      .post("/api/voice/search")
      .send({ question: "Who won the 2025 F1 title?" });
    expect(fromAgent.status).toBe(200);
    expect(fromAgent.body.model).toBe("antigravity");
    const fromWiki = await request(
      app(async () => {
        throw new ProviderError("The quick search took too long.", 504);
      }),
    )
      .post("/api/voice/search")
      .send({ question: "Who won the 2025 F1 title?" });
    expect(fromWiki.status).toBe(200);
    expect(fromWiki.body.answer).toContain("Wikipedia");
  });
});
