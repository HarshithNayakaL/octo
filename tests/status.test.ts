import { describe, expect, it } from "vitest";
import { ago, statusText } from "../server/status";
import { seedRun } from "../server/demo";
import type { ProviderConfiguration, Run } from "../shared/types";

const now = new Date("2026-10-31T12:00:00Z");
const providers: ProviderConfiguration[] = [
  {
    id: "google",
    name: "Google Antigravity",
    ready: true,
    model: "antigravity-preview-09-2026",
    agentName: "antigravity-preview-09-2026",
    baseModel: "gemini-3.8-flash",
    crmReady: false,
  },
  { id: "openai", name: "OpenAI", ready: false, model: "gpt", crmReady: false },
];
const run = (o: Partial<Run>): Run => ({ ...seedRun(), activities: [], ...o });

describe("app status for the voice assistant", () => {
  it("summarises providers, running work, problems, usage and allowance", () => {
    const text = statusText({
      now,
      providers,
      fallbacks: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
      runs: [
        run({
          id: "a",
          title: "Pix vs UPI",
          status: "running",
          provider: "google",
          nextPollAt: "2026-10-31T12:05:00Z",
          activities: [
            {
              id: "1",
              type: "warning",
              label: "Models busy",
              text: "The model is overloaded due to high demand.",
              at: "2026-10-31T11:50:00Z",
            },
          ],
        }),
        run({
          id: "b",
          title: "Old run",
          status: "failed",
          error: "Gemini returned HTTP 500",
          updatedAt: "2026-10-31T10:00:00Z",
        }),
      ],
      usage: {
        "gemini-3.8-flash": 41,
        "gemini-3.8-flash#429": 2,
        "visitor:x": 3,
      },
      learned: { "gemini-3.8-flash": { rpd: 250, seenAt: "" } },
      voice: { live: 11, turns: 18 },
    });
    expect(text).toContain(
      "if it is busy Octo switches to gemini-3.5-flash-lite, then gemini-3.1-flash-lite",
    );
    expect(text).toContain(
      'Running now: "Pix vs UPI": running; model gemini-3.8-flash; waiting to retry until 12:05 UTC',
    );
    expect(text).toContain(
      '10 min ago, "Pix vs UPI": Models busy. The model is overloaded due to high demand.',
    );
    expect(text).toContain('"Old run" failed: Gemini returned HTTP 500');
    expect(text).toContain(
      "gemini-3.8-flash 41 of 250 requests, 2 refused for quota",
    );
    expect(text).not.toContain("visitor:");
    expect(text).toContain("11 live chats left");
  });
  it("writes one request in the singular and never doubles full stops", () => {
    const text = statusText({
      now,
      providers,
      fallbacks: [],
      runs: [],
      usage: { "gemini-3.8-live": 1 },
      open: run({
        id: "o",
        title: "T",
        community: {
          status: "done",
          error: "Some searches failed: HTTP 403.",
        } as Run["community"],
      }),
    });
    expect(text).toContain("gemini-3.8-live 1 request.");
    expect(text).not.toContain("..");
  });
  it("says so plainly when all is quiet", () => {
    const text = statusText({ now, providers, fallbacks: [], runs: [] });
    expect(text).toContain("Nothing is running right now.");
    expect(text).toContain("No problems recorded in the last 24 hours.");
  });
  it("describes the open research in detail", () => {
    const open = run({
      id: "o",
      title: "EV charging",
      status: "partial",
      reportParts: [
        {
          turnId: "t",
          report: "x",
          reason: "gemini-3.8-flash was busy",
          at: "",
        },
      ],
      evidence: {
        status: "done",
        reportLength: 1,
        requestedAt: "",
        score: 50,
        claims: [
          { id: "c1", claim: "a", status: "supported" },
          {
            id: "c2",
            claim: "b",
            status: "unreachable",
            note: "The site blocked automated access (HTTP 403).",
          },
        ],
      },
    });
    const text = statusText({
      now,
      providers,
      fallbacks: [],
      runs: [open],
      open,
    });
    expect(text).toContain('Open research "EV charging": status partial');
    expect(text).toContain(
      "score 50, 1 of 2 claims supported, 1 could not be checked",
    );
    expect(text).toContain(
      "partial report saved because gemini-3.8-flash was busy",
    );
  });
  it("words times relative to now", () => {
    expect(ago("2026-10-31T11:58:00Z", now)).toBe("2 min ago");
    expect(ago("2026-10-31T09:00:00Z", now)).toBe("3 h ago");
    expect(ago("2026-10-20T09:00:00Z", now)).toBe("on 2026-10-20");
  });
});
