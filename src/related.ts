import type { Run } from "../shared/types";

const stop = new Set(
  "about after also among and are based between both brief but can compare could does each for from have how including into its more most other our research should such than that the their them these they this those through what when which while who why will with would your".split(
    " ",
  ),
);
const terms = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length > 2 && !stop.has(w)),
  );

/** Earlier runs with a report whose topic overlaps the new brief, best first. */
export function relatedRuns(
  runs: Run[],
  title: string,
  brief: string,
  max = 3,
) {
  const wanted = terms(`${title} ${brief}`);
  if (wanted.size < 2) return [];
  return runs
    .filter(
      (r) =>
        r.purpose !== "crm" &&
        (r as Run & { hasReport?: boolean }).hasReport !== false &&
        ["completed", "partial"].includes(r.status),
    )
    .map((r) => {
      const theirs = terms(`${r.title} ${r.title} ${r.brief}`);
      const shared = [...wanted].filter((w) => theirs.has(w));
      return {
        run: r,
        shared,
        score: shared.length / Math.sqrt(theirs.size || 1),
      };
    })
    .filter((x) => x.shared.length >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}
