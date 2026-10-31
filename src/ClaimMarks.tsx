import { claimIcons, claimLabels } from "./EvidencePanel";
import type { PlacedClaim } from "./claimPlacement";

/** Small numbered marks after a sentence, one per checked claim taken from it. */
export function ClaimMarks({
  placed,
  onOpen,
}: {
  placed: PlacedClaim[];
  onOpen: (id: string) => void;
}) {
  return (
    <span className="claim-marks">
      {placed.map(({ claim, number }) => {
        const Icon = claimIcons[claim.status];
        const label = `Claim ${number}: ${claimLabels[claim.status]}`;
        return (
          <button
            key={claim.id}
            id={`mark-${claim.id}`}
            type="button"
            className={`claim-mark ${claim.status}`}
            aria-label={`${label}. Open in Evidence`}
            title={`${label}${claim.sourceUrl ? ` · ${hostOf(claim.sourceUrl)}` : ""}`}
            onClick={() => onOpen(claim.id)}
          >
            <Icon size={12} aria-hidden="true" />
            {number}
          </button>
        );
      })}
    </span>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** Desktop margin: every placed claim in reading order; flagged ones in bold. */
export function ClaimRail({
  placed,
  unplaced,
  onJump,
  onOpenEvidence,
}: {
  placed: PlacedClaim[];
  unplaced: number;
  onJump: (id: string) => void;
  onOpenEvidence: () => void;
}) {
  // Same rule as the summary strip: only claims the check found against.
  const flagged = placed.filter((p) =>
    ["not_found", "uncited"].includes(p.claim.status),
  ).length;
  return (
    <aside className="claim-rail" aria-label="Checked claims in this report">
      <p className="claim-rail-head">
        {placed.length} {placed.length === 1 ? "claim" : "claims"} marked
        {flagged ? <b> · {flagged} to review</b> : null}
      </p>
      <ol>
        {placed.map(({ claim, number }) => {
          const Icon = claimIcons[claim.status];
          return (
            <li key={claim.id}>
              <button
                type="button"
                className={`rail-item ${claim.status}`}
                onClick={() => onJump(claim.id)}
              >
                <span className="rail-number">{number}</span>
                <Icon size={13} aria-hidden="true" />
                {claimLabels[claim.status]}
              </button>
            </li>
          );
        })}
      </ol>
      {unplaced > 0 && (
        <button type="button" className="rail-more" onClick={onOpenEvidence}>
          {unplaced} more {unplaced === 1 ? "claim" : "claims"} in Evidence
        </button>
      )}
    </aside>
  );
}

/** Lines a rendered block came from, excluding nested lists (they get their own marks). */
export function blockLines(node: unknown): [number, number] | undefined {
  const n = node as {
    position?: { start: { line: number }; end: { line: number } };
    children?: {
      type: string;
      tagName?: string;
      position?: { start: { line: number } };
    }[];
  };
  if (!n?.position) return undefined;
  let end = n.position.end.line;
  for (const child of n.children ?? [])
    if (
      child.type === "element" &&
      (child.tagName === "ul" || child.tagName === "ol") &&
      child.position
    )
      end = Math.min(end, child.position.start.line - 1);
  return [n.position.start.line, end];
}

export const hasParagraph = (node: unknown) =>
  (
    (node as { children?: { type: string; tagName?: string }[] })?.children ??
    []
  ).some((c) => c.type === "element" && c.tagName === "p");
