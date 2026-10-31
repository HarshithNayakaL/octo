import type { ClaimCheck, Run } from "../shared/types";

// Words too common to say anything about which line a claim came from.
const stop = new Set(
  "the and for with that this from are was were has have had its their they them than then which who whom what when where while into onto over under about after before more most less least also only such each every other some any all not but can could would should will may might per via our your his her".split(
    " ",
  ),
);

const numberPattern = /\d[\d,]*(?:\.\d+)?/g;

/** Content words and numbers in a piece of text, with numbers normalised ("1,200" → "1200"). */
export function tokens(text: string) {
  const lower = text.toLowerCase();
  const numbers = (lower.match(numberPattern) ?? []).map((n) =>
    n.replace(/,/g, ""),
  );
  const words = lower
    .replace(numberPattern, " ")
    .split(/[^a-zÀ-ɏ]+/)
    .filter((w) => w.length >= 3 && !stop.has(w));
  return { words: new Set(words), numbers: new Set(numbers) };
}

/** Markdown line → plain text, so link targets and syntax do not count as words. */
const plain = (line: string) =>
  line
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#>*_`|[\]-]/g, " ");

/** Share of the claim's words and figures found in the line; 0 if a figure is missing. */
export function overlap(claim: string, line: string) {
  const c = tokens(claim);
  const l = tokens(plain(line));
  // A claim built on a figure only matches a line that has that figure.
  if (c.numbers.size && ![...c.numbers].some((n) => l.numbers.has(n))) return 0;
  const total = c.words.size + c.numbers.size;
  if (!total) return 0;
  let hits = 0;
  for (const w of c.words) if (l.words.has(w)) hits++;
  for (const n of c.numbers) if (l.numbers.has(n)) hits += 1.5;
  return hits / total;
}

export interface PlacedClaim {
  claim: ClaimCheck;
  /** 1-based position in the evidence list, shown as the mark's number. */
  number: number;
}

/**
 * Place each checked claim on the report line it was taken from, by word and
 * figure overlap. Claims below the threshold stay unplaced rather than being
 * pinned to the wrong sentence.
 */
export function placeClaims(report: string, claims: ClaimCheck[], min = 0.6) {
  const lines = report.split("\n");
  const byLine = new Map<number, PlacedClaim[]>();
  const unplaced: PlacedClaim[] = [];
  claims.forEach((claim, i) => {
    const placed = { claim, number: i + 1 };
    let best = -1;
    let bestScore = 0;
    lines.forEach((line, index) => {
      if (!line.trim() || /^\s*\|?\s*:?-{3,}/.test(line)) return;
      const score = overlap(claim.claim, line);
      if (score >= min && score > bestScore) {
        best = index + 1;
        bestScore = score;
      }
    });
    if (best === -1) unplaced.push(placed);
    else byLine.set(best, [...(byLine.get(best) ?? []), placed]);
  });
  return { byLine, unplaced };
}

/** Claims can be shown in the text only when the check ran on this exact report. */
export function marksApply(run: Run) {
  const e = run.evidence;
  return (
    e?.status === "done" &&
    e.claims.length > 0 &&
    (!e.reportLength || e.reportLength === run.report.length)
  );
}

/** True when a table cell ending at this offset is the last cell on its row. */
export function endsRow(report: string, endOffset: number) {
  const lineEnd = report.indexOf("\n", endOffset);
  return /^[\s|]*$/.test(
    report.slice(endOffset, lineEnd === -1 ? undefined : lineEnd),
  );
}
