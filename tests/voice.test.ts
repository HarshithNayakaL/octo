import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { createApp } from "../server/app";
import {
  GeminiVoice,
  Limiter,
  defaultVoiceModels,
  interactionAudio,
  parseAction,
  scriptOf,
  voiceInstructions,
} from "../server/voice";
import { seedRun } from "../server/demo";
import {
  base64ToBytes,
  bytesToBase64,
  downsample,
  floatToPcm16,
  pcm16ToFloat,
  rateOf,
} from "../src/voice/pcm";

let directory: string;
let store: Store;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "octo-voice-"));
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
const wav = Buffer.from("RIFF....WAVEfmt fake").toString("base64");

/** Fake Google: token minting, the turn model and TTS. */
function google(overrides: { tts?: Response } = {}) {
  const calls: { path: string; body: any }[] = [];
  const fetcher = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    const path = String(url).replace(
      "https://generativelanguage.googleapis.com/v1beta",
      "",
    );
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ path, body });
    if (path === "/auth_tokens") return json({ name: "auth_tokens/abc123" });
    if (body.model === defaultVoiceModels.tts)
      return (
        overrides.tts ??
        json({
          steps: [
            { type: "thought" },
            { type: "model_output", content: [{ type: "audio", data: wav }] },
          ],
        })
      );
    return json({
      output_text: JSON.stringify({
        transcript: "Research EV charging in India",
        reply: "I've prepared that research for you.",
        prepare_research: {
          title: "EV charging in India",
          brief:
            "Map India's public EV charging market, operators, tariffs and policy for an investor.",
          workflow: "market",
        },
      }),
    });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}
function server(voice?: GeminiVoice) {
  return createApp({
    store,
    model: "m",
    crmReady: false,
    origin: "http://x",
    voice,
    background: (w) => void w.catch(() => undefined),
  });
}

describe("voice assistant", () => {
  it("mints a single-use Live token locked to Octo's model, voice, prompt and tools", async () => {
    const { fetcher, calls } = google();
    const voice = new GeminiVoice("key", defaultVoiceModels, fetcher);
    await store.save({
      ...seedRun(),
      id: "r",
      title: "Pix vs UPI",
      report: "Pix reached 160 million users.",
    });
    const { app } = server(voice);
    const res = await request(app)
      .post("/api/voice/token")
      .send({ runId: "r", page: "research detail" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      token: "auth_tokens/abc123",
      model: "gemini-3.8-live",
      voice: "Kore",
    });
    expect(res.body.websocketUrl).toContain("BidiGenerateContentConstrained");
    expect(res.body.setup).toMatchObject({
      model: "models/gemini-3.8-live",
      generationConfig: { responseModalities: ["AUDIO"] },
    });
    const sent = calls[0].body;
    expect(sent.uses).toBe(1);
    expect(sent.bidiGenerateContentSetup).toEqual(res.body.setup);
    const config = sent.bidiGenerateContentSetup;
    expect(
      config.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig
        .voiceName,
    ).toBe("Kore");
    expect(config.tools[0].functionDeclarations[0].name).toBe(
      "prepare_research",
    );
    expect(config.inputAudioTranscription).toEqual({});
    const prompt = config.systemInstruction.parts[0].text;
    expect(prompt).toContain("Pix vs UPI");
    expect(prompt).toContain("160 million");
    expect(prompt).toContain("Never claim something happened unless a tool result says it did");
    expect(
      config.tools[0].functionDeclarations.map((f: any) => f.name),
    ).toContain("get_app_status");
    expect(prompt).toContain("App status right now");
    // The key itself never goes to the browser.
    expect(JSON.stringify(res.body)).not.toContain('key"');
  });
  it("answers a recorded question in one call and speaks it with Gemini TTS", async () => {
    const { fetcher, calls } = google();
    const { app } = server(new GeminiVoice("key", defaultVoiceModels, fetcher));
    const audio = Buffer.alloc(1_500_000, 1).toString("base64");
    const res = await request(app)
      .post("/api/voice/turn")
      .send({
        audio: { data: audio, mimeType: "audio/webm;codecs=opus" },
        history: [{ role: "user", text: "hi" }],
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      transcript: "Research EV charging in India",
      reply: "I've prepared that research for you.",
      model: "gemini-3.5-flash-lite",
      action: {
        type: "prepare_research",
        workflow: "market",
        title: "EV charging in India",
      },
      audio: { data: wav, mimeType: "audio/wav" },
    });
    const turn = calls.find(
      (c) => c.body.model === "gemini-3.5-flash-lite",
    )!.body;
    expect(turn.input[1]).toMatchObject({
      type: "audio",
      mime_type: "audio/webm",
    });
    expect(turn.response_format.mime_type).toBe("application/json");
    expect(turn.input[0].text).toContain("Person: hi");
    const tts = calls.find(
      (c) => c.body.model === "gemini-3.8-flash-lite-tts",
    )!.body;
    expect(tts).toMatchObject({
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: "Kore" }] },
    });
  });
  it("still answers when TTS is rate limited, so the browser can speak", async () => {
    const { fetcher } = google({
      tts: json({ error: { message: "quota" } }, 429),
    });
    const { app } = server(new GeminiVoice("key", defaultVoiceModels, fetcher));
    const res = await request(app)
      .post("/api/voice/turn")
      .send({ text: "What can Octo do?" });
    expect(res.status).toBe(200);
    expect(res.body.audio).toBeUndefined();
    expect(res.body.ttsError).toContain("free-tier limit");
    expect(res.body.reply).toBeTruthy();
  });
  it("knows the app's state: busy models, failures and what is running", async () => {
    const now = new Date().toISOString();
    await store.save({
      ...seedRun(),
      id: "busy",
      title: "EV charging in India",
      status: "running",
      provider: "google",
      baseModel: "gemini-3.5-flash-lite",
      activities: [
        {
          id: "a1",
          type: "warning",
          label: "Switched to a lighter model",
          text: "gemini-3.8-flash is experiencing high demand, so this research runs on gemini-3.5-flash-lite.",
          at: now,
        },
      ],
    });
    const { fetcher, calls } = google();
    const { app } = server(new GeminiVoice("key", defaultVoiceModels, fetcher));
    const res = await request(app)
      .post("/api/voice/turn")
      .send({ text: "Is my research working?", runId: "busy" });
    expect(res.status).toBe(200);
    const prompt = calls.find((c) => c.body.model === defaultVoiceModels.turn)!
      .body.input[0].text;
    expect(prompt).toContain("App status right now");
    expect(prompt).toContain("Switched to a lighter model");
    expect(prompt).toContain("high demand");
    expect(prompt).toMatch(
      /Running now: "EV charging in India": running; model gemini-3\.5-flash-lite/,
    );
    const status = await request(app)
      .post("/api/voice/status")
      .send({ runId: "busy" });
    expect(status.status).toBe(200);
    expect(status.body.status).toContain(
      'Open research "EV charging in India"',
    );
    expect(status.body.status).toContain("voice allowance");
  });
  it("tells which writing system a message is in", () => {
    expect(scriptOf("What is the market size?")).toBe("Latin");
    expect(scriptOf("ಮಾರುಕಟ್ಟೆಯ ಗಾತ್ರ ಎಷ್ಟು?")).toBe("Kannada");
    expect(scriptOf("बाज़ार का आकार क्या है?")).toBe("Devanagari");
    expect(scriptOf("ok")).toBeUndefined();
  });
  it("asks again when the reply is in a different language from the person", async () => {
    const replies = [
      // English question answered in Hindi: wrong.
      {
        transcript: "What does Octo check?",
        reply: "ऑक्टो हर स्रोत की जाँच करता है।",
      },
      { transcript: "", reply: "Octo checks every cited source." },
    ];
    const calls: any[] = [];
    const fetcher = vi.fn(
      async (_url: URL | RequestInfo, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        calls.push(body);
        if (body.model === defaultVoiceModels.tts)
          return json({
            steps: [
              { type: "model_output", content: [{ type: "audio", data: wav }] },
            ],
          });
        const next = replies.shift()!;
        return json({
          output_text: JSON.stringify({
            ...next,
            prepare_research: { title: "", brief: "", workflow: "general" },
          }),
        });
      },
    ) as unknown as typeof fetch;
    const voice = new GeminiVoice("key", defaultVoiceModels, fetcher);
    const result = await voice.turn({ text: "What does Octo check?" }, {});
    expect(result.reply).toBe("Octo checks every cited source.");
    expect(result.transcript).toBe("What does Octo check?");
    const retry = calls.filter((c) => c.model === defaultVoiceModels.turn)[1];
    expect(retry.input[0].text).toContain("written in Latin script");
    expect(voiceInstructions({})).toContain("most recent message");
  });
  it("refuses unsupported audio and explains when no key is configured", async () => {
    const { fetcher } = google();
    const { app } = server(new GeminiVoice("key", defaultVoiceModels, fetcher));
    const bad = await request(app)
      .post("/api/voice/turn")
      .send({ audio: { data: "aaaaaaaaaaaa", mimeType: "video/mp4" } });
    expect(bad.status).toBe(415);
    const none = server();
    expect(
      (await request(none.app).post("/api/voice/token").send({})).status,
    ).toBe(409);
    expect((await request(none.app).get("/api/config")).body.voice).toEqual({
      available: false,
    });
    expect((await request(app).get("/api/config")).body.voice).toMatchObject({
      available: true,
      live: "gemini-3.8-live",
      turn: "gemini-3.5-flash-lite",
      tts: "gemini-3.8-flash-lite-tts",
    });
  });
  it("limits voice sessions per caller to protect the free tier", async () => {
    const { fetcher } = google();
    const { app } = server(new GeminiVoice("key", defaultVoiceModels, fetcher));
    for (let i = 0; i < 12; i++)
      expect(
        (await request(app).post("/api/voice/token").send({})).status,
      ).toBe(200);
    const limited = await request(app).post("/api/voice/token").send({});
    expect(limited.status).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    const limiter = new Limiter(2, 1000);
    expect([
      limiter.take("a", 0),
      limiter.take("a", 10),
      limiter.take("a", 20),
    ]).toEqual([0, 0, 980]);
    expect(limiter.take("a", 1001)).toBe(0);
  });
  it("only accepts complete research briefs as actions", () => {
    expect(
      parseAction({ title: "", brief: "", workflow: "general" }),
    ).toBeUndefined();
    expect(parseAction({ title: "Pix", brief: "short" })).toBeUndefined();
    expect(
      parseAction({
        title: "Pix growth",
        brief: "How fast is Pix growing among merchants in Brazil?",
      }),
    ).toMatchObject({ type: "prepare_research", workflow: "general" });
  });
  it("reads TTS audio from every response shape and keeps spoken replies short", () => {
    expect(
      interactionAudio({ output_audio: { data: "x", mime_type: "audio/l16" } }),
    ).toEqual({ data: "x", mimeType: "audio/l16" });
    expect(
      interactionAudio({ outputs: [{ type: "audio", data: "y" }] }),
    ).toEqual({ data: "y", mimeType: "audio/wav" });
    expect(interactionAudio({ steps: [] })).toBeUndefined();
    expect(voiceInstructions({})).toContain("one to three sentences");
  });
});

describe("browser audio helpers", () => {
  it("downsamples, converts to 16-bit PCM and back, and base64-encodes", () => {
    const tone = new Float32Array(480).map((_, i) => Math.sin(i / 10) * 0.5);
    const down = downsample(tone, 48000, 16000);
    expect(down.length).toBe(160);
    const pcm = floatToPcm16(down);
    expect(pcm.length).toBe(320);
    const back = pcm16ToFloat(base64ToBytes(bytesToBase64(pcm)));
    expect(back.length).toBe(160);
    expect(Math.abs(back[50] - down[50])).toBeLessThan(0.001);
    expect(floatToPcm16(new Float32Array([2, -2]))).toEqual(
      new Uint8Array([0xff, 0x7f, 0x00, 0x80]),
    );
    expect(rateOf("audio/pcm;rate=24000")).toBe(24000);
    expect(rateOf("audio/pcm")).toBe(24000);
  });
});
