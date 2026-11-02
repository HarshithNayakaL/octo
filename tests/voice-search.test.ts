import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { createApp } from "../server/app";
import {
  GeminiVoice,
  defaultVoiceModels,
  voiceInstructions,
} from "../server/voice";
import { researchLimits, tokensForMinutes } from "../shared/depth";
import { parseCommand } from "../shared/voice-commands";

let directory: string;
let store: Store;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "octo-search-"));
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
const grounded = {
  candidates: [
    {
      content: {
        parts: [{ text: "Lando Norris won the 2025 Formula One title." }],
      },
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: "https://example.com/a", title: "formula1.com" } },
          { web: { uri: "https://example.com/b", title: "formula1.com" } },
          { web: { uri: "https://example.com/c", title: "bbc.com" } },
          { web: { uri: "javascript:alert(1)", title: "bad" } },
        ],
      },
    },
  ],
};

describe("quick web answers", () => {
  it("answers with Google Search grounding and de-duplicated https sources", async () => {
    const calls: { url: string; body: any }[] = [];
    const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return json(grounded);
    }) as unknown as typeof fetch;
    const voice = new GeminiVoice("key", defaultVoiceModels, fetcher);
    const found = await voice.search("Who won the 2025 F1 championship?");
    expect(found.answer).toContain("Lando Norris");
    expect(found.sources.map((s) => s.title)).toEqual([
      "formula1.com",
      "bbc.com",
    ]);
    expect(calls[0].url).toContain(
      `/models/${defaultVoiceModels.turn}:generateContent`,
    );
    expect(calls[0].body.tools).toEqual([{ google_search: {} }]);
  });

  it("falls back to a lighter model when the search model is busy", async () => {
    const models: string[] = [];
    const fetcher = vi.fn(async (url: unknown) => {
      const model = String(url).match(/models\/([^:]+):/)![1];
      models.push(model);
      return model === "busy-model"
        ? json({ error: { message: "The model is overloaded." } }, 503)
        : json(grounded);
    }) as unknown as typeof fetch;
    const voice = new GeminiVoice(
      "key",
      { ...defaultVoiceModels, search: "busy-model" },
      fetcher,
      ["light-model"],
    );
    const found = await voice.search("Who won?");
    expect(models).toEqual(["busy-model", "light-model"]);
    expect(found.model).toBe("light-model");
  });

  it("serves quick answers over the API and validates the question", async () => {
    const fetcher = vi.fn(async () =>
      json(grounded),
    ) as unknown as typeof fetch;
    const app = (voice?: GeminiVoice) =>
      createApp({
        store,
        model: "m",
        crmReady: false,
        origin: "http://x",
        voice,
        background: (w) => void w.catch(() => undefined),
      }).app;
    const withVoice = app(new GeminiVoice("key", defaultVoiceModels, fetcher));
    const ok = await request(withVoice)
      .post("/api/voice/search")
      .send({ question: "Who won the 2025 F1 title?" });
    expect(ok.status).toBe(200);
    expect(ok.body.sources).toHaveLength(2);
    expect(
      (await request(withVoice).post("/api/voice/search").send({})).status,
    ).toBe(400);
    expect(
      (await request(app()).post("/api/voice/search").send({ question: "x y" }))
        .status,
    ).toBe(409);
  });

  it("uses a search for quick questions in push-to-talk instead of research", async () => {
    const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).includes(":generateContent")) return json(grounded);
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.model === defaultVoiceModels.tts) throw new Error("no tts");
      return json({
        output_text: JSON.stringify({
          transcript: "Who won the F1 championship last year?",
          reply: "Let me check.",
          search: "Who won the 2025 Formula One World Championship?",
          prepare_research: { title: "", brief: "", workflow: "general" },
          command: { name: "" },
        }),
      });
    }) as unknown as typeof fetch;
    const voice = new GeminiVoice("key", defaultVoiceModels, fetcher);
    const result = await voice.turn(
      { text: "Who won the F1 championship last year?" },
      {},
    );
    expect(result.reply).toContain("Lando Norris");
    expect(result.sources).toHaveLength(2);
    expect(result.command).toBeUndefined();
    expect(result.action).toBeUndefined();
  });

  it("tells the assistant to triage and to agree the scope before research", () => {
    const text = voiceInstructions({});
    expect(text).toContain("call web_search");
    expect(text).toContain("Do not start a research run for this");
    expect(text).toContain(
      "Never start research until they have agreed the scope",
    );
    const voice = new GeminiVoice("key", defaultVoiceModels, vi.fn());
    expect(
      voice
        .liveConfig({})
        .tools[0].functionDeclarations.map((t: { name: string }) => t.name),
    ).toContain("web_search");
  });
});

describe("custom limits", () => {
  it("fits tokens to a custom time, and an explicit budget always wins", () => {
    expect(tokensForMinutes("google", 3)).toBe(60_000);
    expect(tokensForMinutes("google", 1)).toBe(50_000);
    expect(tokensForMinutes("openai", 3)).toBe(30_000);
    expect(researchLimits("google", { minutes: 3 })).toEqual({
      minutes: 3,
      tokens: 60_000,
    });
    expect(researchLimits("google", { depth: "quick" })).toEqual({
      minutes: 5,
      tokens: 100_000,
    });
    expect(
      researchLimits("google", { depth: "deep", minutes: 10, tokens: 75_000 }),
    ).toEqual({ minutes: 10, tokens: 75_000 });
    // A short time on a deep run does not keep a 1M token budget.
    expect(researchLimits("google", { depth: "deep", minutes: 3 }).tokens).toBe(
      120_000,
    );
  });

  it("parses the new research options and actions", () => {
    expect(
      parseCommand("start_research", {
        tokens: 40_000,
        deliverable: "PPTX",
        provider: "openai",
        ask_questions: true,
        community: "true",
      }),
    ).toMatchObject({
      tokens: 40_000,
      deliverable: "pptx",
      provider: "openai",
      askQuestions: true,
      community: true,
    });
    expect(parseCommand("start_research", { tokens: 5 })?.tokens).toBe(10_000);
    expect(
      parseCommand("schedule_checks", { every_hours: 500, checks: 3 }),
    ).toMatchObject({ everyHours: 168, checks: 3 });
    expect(parseCommand("set_theme", { theme: "Dark" })?.theme).toBe("dark");
    expect(
      parseCommand("ask_research", { question: "What about Pix?" }),
    ).toMatchObject({ question: "What about Pix?" });
  });
});
