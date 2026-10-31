import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  cleanHeading,
  deckOutline,
  firstSentence,
  paginate,
  sentences,
  splitLead,
  toPptx,
} from "../server/slides";
import { seedRun } from "../server/demo";
import type { Run } from "../shared/types";

const report = [
  "# EV charging in India",
  "",
  "## Executive summary",
  "",
  "Public charging grew 3.2x in two years. Operators compete on location, not price.",
  "",
  "## 1. Market structure",
  "",
  "- **Operators:** Five operators hold most public points. Tata Power leads.",
  "- **Tariffs:** Fast charging costs 18.4 rupees per kWh on average.",
  "",
  "| Operator | Points |",
  "| --- | --- |",
  "| A | 1,200 |",
  "",
  "## Next steps",
  "",
  "Confirm tariffs with three operators.",
].join("\n");

describe("deck outline", () => {
  it("turns ## sections into slides, with the full text kept for notes", () => {
    const sections = deckOutline(report, "EV charging in India");
    expect(sections.map((s) => s.title)).toEqual([
      "Executive summary",
      "Market structure",
      "Next steps",
    ]);
    const market = sections[1];
    expect(market.bullets.map((b) => b.text)).toEqual([
      "Operators: Five operators hold most public points.",
      "Tariffs: Fast charging costs 18.4 rupees per kWh on average.",
    ]);
    expect(market.notes.join(" ")).toContain("Tata Power leads.");
    expect(market.tables[0]).toEqual([
      ["Operator", "Points"],
      ["A", "1,200"],
    ]);
  });
  it("keeps decimals and short leads inside the first sentence", () => {
    expect(firstSentence("Costs rose 18.4 percent in 2025. Then fell.")).toBe(
      "Costs rose 18.4 percent in 2025.",
    );
    expect(
      firstSentence(
        "Market structure. Define the geography and segments. More.",
      ),
    ).toBe("Market structure. Define the geography and segments.");
  });
  it("cuts long text at a sentence end, not mid-word", () => {
    expect(sentences("One two three. Four five six. Seven.", 20)).toBe(
      "One two three.",
    );
  });
  it("splits a label from its detail for card titles", () => {
    expect(splitLead("Pix (Central Bank): run by the BCB.")).toEqual({
      lead: "Pix (Central Bank)",
      body: "run by the BCB.",
    });
    expect(splitLead("No label here.").lead).toBeUndefined();
  });
  it("drops the report's own numbering from headings", () => {
    expect(cleanHeading("3. User fees")).toBe("User fees");
    expect(cleanHeading("2024 outlook")).toBe("2024 outlook");
  });
  it("never ends a slide on a label that introduces the next points", () => {
    const pages = paginate(
      [
        { text: "a", level: 0 },
        { text: "b", level: 0 },
        { text: "Next steps:", level: 0 },
        { text: "c", level: 1 },
      ],
      3,
    );
    expect(pages.map((p) => p.map((b) => b.text))).toEqual([
      ["a", "b"],
      ["Next steps:", "c"],
    ]);
  });
});

describe("PowerPoint file", () => {
  it("builds title, summary, evidence, sections, claims and method slides with notes", async () => {
    const run: Run = {
      ...seedRun(),
      title: "EV charging in India",
      report,
      mode: "live",
      provider: "google",
      evidence: {
        status: "done",
        reportLength: report.length,
        requestedAt: "",
        score: 50,
        claims: [
          {
            id: "c1",
            claim: "Public charging grew 3.2x in two years.",
            status: "supported",
            sourceUrl: "https://example.gov/a",
          },
          {
            id: "c2",
            claim: "Fast charging costs 18.4 rupees per kWh.",
            status: "uncited",
          },
        ],
      },
    };
    const zip = await JSZip.loadAsync(await toPptx(run));
    const slides = Object.keys(zip.files).filter((f) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(f),
    );
    expect(slides.length).toBeGreaterThanOrEqual(7);
    const all = (
      await Promise.all(slides.map((f) => zip.file(f)!.async("string")))
    ).join(" ");
    for (const text of [
      "EV charging in India",
      "Executive summary",
      "How well the sources back this report",
      "Market structure",
      "Checked claims",
      "How this research was done",
    ])
      expect(all).toContain(text);
    const notes = Object.keys(zip.files).filter((f) =>
      f.startsWith("ppt/notesSlides/"),
    );
    expect(notes.length).toBeGreaterThan(0);
  });
});
