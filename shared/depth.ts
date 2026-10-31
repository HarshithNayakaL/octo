import type { ProviderId } from "./types.js";

/** How far a research run should go. Sets the time and token limits and the scope. */
export type Depth = "quick" | "standard" | "deep";
export const depths: Depth[] = ["quick", "standard", "deep"];

export const depthLabels: Record<Depth, string> = {
  quick: "Quick scan",
  standard: "Standard",
  deep: "Deep dive",
};

export const depthHints: Record<Depth, string> = {
  quick: "A direct answer from a handful of strong sources.",
  standard: "Each research area covered with a focused pass.",
  deep: "Every area investigated and figures cross-checked.",
};

/**
 * Limits per depth. Google's free tier allows more; OpenAI is billed per use,
 * so its limits stay smaller. Values match the form's time and token options.
 */
const limits: Record<
  ProviderId,
  Record<Depth, { minutes: number; tokens: number }>
> = {
  google: {
    quick: { minutes: 5, tokens: 100_000 },
    standard: { minutes: 20, tokens: 500_000 },
    deep: { minutes: 60, tokens: 1_000_000 },
  },
  openai: {
    quick: { minutes: 5, tokens: 50_000 },
    standard: { minutes: 10, tokens: 100_000 },
    deep: { minutes: 30, tokens: 200_000 },
  },
};

export const depthLimits = (provider: ProviderId, depth: Depth) =>
  limits[provider][depth];

/** Scope instructions the research agent follows for each depth. */
export const depthScope: Record<Depth, string> = {
  quick:
    "Depth: quick scan. The user wants a fast, direct answer. Answer the core question from the 3-6 strongest primary sources in a single research pass, without delegating, and keep the report to roughly 300-600 words. Do not widen the scope.",
  standard:
    "Depth: standard. Cover each research area with one focused pass and keep the report to roughly 800-1,500 words.",
  deep: "Depth: deep dive. Investigate every research area thoroughly, cross-check key figures across independent sources, and use tables where they help. Length follows the evidence.",
};
