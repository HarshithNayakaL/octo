import { describe, expect, it, vi } from "vitest";
import {
  GeminiVoice,
  defaultVoiceModels,
  voiceInstructions,
} from "../server/voice";
import { timing } from "../server/prompts";
import { seedRun } from "../server/demo";
import {
  commandNames,
  commandTools,
  depthForMinutes,
  parseCommand,
} from "../shared/voice-commands";

const json = (data: unknown) =>
  new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });

describe("voice commands", () => {
  it("declares a Live tool for every command", () => {
    expect(commandTools.map((t) => t.name).sort()).toEqual(
      [...commandNames].sort(),
    );
    const voice = new GeminiVoice("key", defaultVoiceModels, vi.fn());
    const names = voice
      .liveConfig({})
      .tools[0].functionDeclarations.map((t: { name: string }) => t.name);
    for (const name of [...commandNames, "prepare_research", "get_app_status"])
      expect(names).toContain(name);
  });

  it("cleans tool arguments and ignores anything that is not a command", () => {
    expect(parseCommand("delete_everything", {})).toBeUndefined();
    expect(parseCommand("", {})).toBeUndefined();
    expect(
      parseCommand("start_research", {
        title: " Pix ",
        brief: "How fast is Pix growing among merchants?",
        workflow: "nonsense",
        depth: "quick",
        minutes: "3",
      }),
    ).toMatchObject({
      name: "start_research",
      title: "Pix",
      workflow: undefined,
      depth: "quick",
      minutes: 3,
    });
    expect(parseCommand("start_research", { minutes: 999 })?.minutes).toBe(180);
    expect(
      parseCommand("start_research", { minutes: 0 })?.minutes,
    ).toBeUndefined();
    expect(parseCommand("go_to", { page: "Reports" })?.page).toBe("reports");
    expect(parseCommand("download_report", { format: "PPTX" })?.format).toBe(
      "pptx",
    );
  });

  it("maps a spoken time to a depth and a firm deadline for the agent", () => {
    expect(depthForMinutes(3)).toBe("quick");
    expect(depthForMinutes(15)).toBe("standard");
    expect(depthForMinutes(45)).toBe("deep");
    const short = timing({ ...seedRun(), maxMinutes: 3 });
    expect(short).toContain("only 3 minutes");
    expect(short).toContain("by minute 2");
    expect(short).toContain("without delegating");
    expect(timing({ ...seedRun(), maxMinutes: 60 })).toContain("by minute 51");
  });

  it("tells the assistant it can act, and returns commands from push-to-talk", async () => {
    const text = voiceInstructions({});
    expect(text).toContain("start_research");
    expect(text).toContain("Never claim something happened");
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.model === defaultVoiceModels.tts) throw new Error("no tts");
      return json({
        output_text: JSON.stringify({
          transcript: "Start research on Pix in 3 minutes",
          reply: "Starting it now.",
          prepare_research: {
            title: "",
            brief: "",
            workflow: "general",
            depth: "",
          },
          command: {
            name: "start_research",
            title: "Pix merchants",
            brief: "How fast is Pix growing among merchants in Brazil?",
            workflow: "general",
            depth: "quick",
            minutes: 3,
          },
        }),
      });
    }) as unknown as typeof fetch;
    const voice = new GeminiVoice("key", defaultVoiceModels, fetcher);
    const result = await voice.turn(
      { text: "Start research on Pix in 3 minutes" },
      {},
    );
    expect(result.command).toMatchObject({
      name: "start_research",
      minutes: 3,
    });
    expect(result.action).toBeUndefined();
  });
});
