import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { createApp } from "../server/app";
import { instructions } from "../server/prompts";
import { planPrompt } from "../server/planner";
import {
  parseAction,
  prepareResearchTool,
  voiceInstructions,
} from "../server/voice";
import { seedRun } from "../server/demo";
import { depthLimits, depths } from "../shared/depth";

let directory: string;
let store: Store;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "depth-test-"));
  store = new Store(directory);
});
afterEach(async () => {
  await store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("research depth", () => {
  it("grows time and tokens with depth, within the form's options", () => {
    const minutes = [5, 10, 20, 30, 60, 90, 120, 180];
    const tokens = [
      20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000, 2_000_000,
    ];
    for (const provider of ["google", "openai"] as const) {
      const l = depths.map((d) => depthLimits(provider, d));
      for (const x of l) {
        expect(minutes).toContain(x.minutes);
        expect(tokens).toContain(x.tokens);
      }
      expect(l[0].minutes).toBeLessThan(l[1].minutes);
      expect(l[1].minutes).toBeLessThan(l[2].minutes);
      expect(l[0].tokens).toBeLessThan(l[2].tokens);
    }
    expect(depthLimits("google", "quick").minutes).toBe(5);
  });

  it("stores the depth on the run and puts its scope in the agent's instructions", async () => {
    const { app } = createApp({
      store,
      model: "test-model",
      crmReady: false,
      origin: "http://127.0.0.1:5173",
    });
    const created = await request(app).post("/api/runs").send({
      title: "Pix merchants",
      workflow: "general",
      brief: "How fast is Pix growing among merchants in Brazil?",
      mode: "demo",
      depth: "quick",
      maxMinutes: 5,
      maxTokens: 100_000,
      clarify: false,
    });
    expect(created.status).toBe(201);
    expect(created.body.depth).toBe("quick");
    expect(
      (
        await request(app).post("/api/runs").send({
          title: "Pix merchants",
          workflow: "general",
          brief: "How fast is Pix growing among merchants in Brazil?",
          depth: "forever",
        })
      ).status,
    ).toBe(400);
    const run = { ...seedRun(), depth: "quick" as const, maxMinutes: 5 };
    expect(instructions(run)).toContain("Depth: quick scan");
    expect(instructions(run)).toContain("Work within 5 minutes");
    expect(planPrompt(run)).toContain("1-3 research areas");
    expect(instructions({ ...seedRun(), depth: undefined })).not.toContain(
      "Depth:",
    );
  });

  it("has the voice assistant ask for depth and pass it to the form", () => {
    expect(prepareResearchTool.parameters.required).toContain("depth");
    expect(voiceInstructions({ page: "overview" } as never)).toMatch(
      /how in-depth/i,
    );
    expect(
      parseAction({
        title: "Pix growth",
        brief: "How fast is Pix growing among merchants in Brazil?",
        workflow: "general",
        depth: "deep",
      }),
    ).toMatchObject({ depth: "deep" });
    expect(
      parseAction({
        title: "Pix growth",
        brief: "How fast is Pix growing among merchants in Brazil?",
        workflow: "general",
        depth: "",
      })?.depth,
    ).toBeUndefined();
  });
});
