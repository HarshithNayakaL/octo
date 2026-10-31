import { describe, expect, it } from "vitest";
import {
  afterBusy,
  fallbackModels,
  isBusy,
  isBusyMessage,
  withFallback,
} from "../server/fallback";
import { ProviderError } from "../server/provider";

describe("model fallback", () => {
  it("recognises busy and quota rejections, not other errors", () => {
    expect(isBusy(new ProviderError("high demand", 503))).toBe(true);
    expect(isBusy(new ProviderError("quota", 429))).toBe(true);
    expect(isBusy(new ProviderError("bad request", 400))).toBe(false);
    expect(isBusy(new Error("network"))).toBe(false);
    expect(isBusyMessage("The model is overloaded due to high demand.")).toBe(
      true,
    );
    expect(isBusyMessage("Invalid tool call")).toBe(false);
  });
  it("reads the fallback list from the environment, with defaults", () => {
    expect(fallbackModels()).toEqual([
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
    ]);
    expect(fallbackModels(" a, b ,")).toEqual(["a", "b"]);
  });
  it("tries each model in order and reports which one answered", async () => {
    const tried: string[] = [];
    const result = await withFallback(
      "main",
      ["lite-a", "lite-b"],
      async (m) => {
        tried.push(m);
        if (m !== "lite-b") throw new ProviderError("high demand", 503);
        return "ok";
      },
    );
    expect(tried).toEqual(["main", "lite-a", "lite-b"]);
    expect(result).toMatchObject({
      value: "ok",
      model: "lite-b",
      fallback: { from: "main", to: "lite-b" },
    });
  });
  it("does not switch models for errors a lighter model would not fix", async () => {
    await expect(
      withFallback("main", ["lite"], async () => {
        throw new ProviderError("bad request", 400);
      }),
    ).rejects.toThrow("bad request");
  });
  it("rethrows the original error when every model is busy", async () => {
    await expect(
      withFallback("main", ["lite"], async (m) => {
        throw new ProviderError(`${m} busy`, 503);
      }),
    ).rejects.toThrow("main busy");
  });
  it("moves down the list after a busy background turn and stops at the end", () => {
    expect(afterBusy("gemini-3.8-flash", ["a", "b"])).toBe("a");
    expect(afterBusy("a", ["a", "b"])).toBe("b");
    expect(afterBusy("b", ["a", "b"])).toBeUndefined();
  });
});
