import { describe, expect, it } from "vitest";
import {
  endsRow,
  marksApply,
  overlap,
  placeClaims,
  tokens,
} from "../src/claimPlacement";
import type { ClaimCheck, Run } from "../shared/types";

const claim = (
  id: string,
  text: string,
  status: ClaimCheck["status"] = "supported",
): ClaimCheck => ({
  id,
  claim: text,
  status,
});

const report = [
  "# EV charging in India",
  "",
  "## Market",
  "",
  "- The sample operator lists 1,200 public charging points across 40 cities ([operator](https://example.com/op)).",
  "- The tariff page quotes 18 rupees per kWh for fast charging.",
  "",
  "| Claim | Evidence |",
  "| --- | --- |",
  "| Market size | Dated primary data |",
  "",
  "Installed capacity doubled over 3 years, but no source is cited for it.",
].join("\n");

describe("claim marks", () => {
  it("normalises figures and drops filler words", () => {
    const t = tokens("The operator lists 1,200 points and 18.4 kWh");
    expect([...t.numbers]).toEqual(["1200", "18.4"]);
    expect(t.words.has("the")).toBe(false);
    expect(t.words.has("operator")).toBe(true);
  });

  it("requires a claim's figure to appear in the line", () => {
    expect(
      overlap(
        "The operator lists 1,500 charging points",
        report.split("\n")[4],
      ),
    ).toBe(0);
    expect(
      overlap(
        "The operator lists 1,200 charging points",
        report.split("\n")[4],
      ),
    ).toBeGreaterThan(0.6);
  });

  it("places each claim on the line it came from, as 1-based lines", () => {
    const { byLine, unplaced } = placeClaims(report, [
      claim(
        "c1",
        "The sample operator lists 1,200 public charging points across 40 cities",
      ),
      claim(
        "c2",
        "Fast charging costs 18 rupees per kWh on the tariff page",
        "partial",
      ),
      claim("c3", "Installed capacity doubled over 3 years", "uncited"),
    ]);
    expect(unplaced).toEqual([]);
    expect(byLine.get(5)?.map((p) => p.claim.id)).toEqual(["c1"]);
    expect(byLine.get(6)?.map((p) => [p.claim.id, p.number])).toEqual([
      ["c2", 2],
    ]);
    expect(byLine.get(12)?.map((p) => p.claim.id)).toEqual(["c3"]);
  });

  it("leaves a claim unplaced rather than pinning it to the wrong sentence", () => {
    const { byLine, unplaced } = placeClaims(report, [
      claim("c1", "Hydrogen stations are regulated by the petroleum ministry"),
    ]);
    expect(byLine.size).toBe(0);
    expect(unplaced.map((p) => p.number)).toEqual([1]);
  });

  it("ignores link targets when matching", () => {
    expect(overlap("example com operator", report.split("\n")[4])).toBeLessThan(
      0.6,
    );
  });

  it("shows marks only for a finished check of this exact report", () => {
    const base = {
      report: "abc",
      evidence: {
        status: "done",
        reportLength: 3,
        requestedAt: "",
        claims: [claim("c1", "x")],
      },
    } as unknown as Run;
    expect(marksApply(base)).toBe(true);
    expect(marksApply({ ...base, report: "abcd" })).toBe(false);
    expect(
      marksApply({
        ...base,
        evidence: { ...base.evidence!, status: "running" },
      }),
    ).toBe(false);
  });

  it("finds the last cell of a table row", () => {
    const row = "| Market size | Dated primary data |\nnext";
    const firstEnd = row.indexOf(" |");
    const lastEnd = row.indexOf(" |\n");
    expect(endsRow(row, firstEnd)).toBe(false);
    expect(endsRow(row, lastEnd)).toBe(true);
  });
});
