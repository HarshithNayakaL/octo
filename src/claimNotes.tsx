import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { claimIcons, claimLabels } from "./EvidencePanel";
import { bestSentence, type PlacedClaim } from "./claimPlacement";
import type { ClaimStatus } from "../shared/types";

const statuses: ClaimStatus[] = [
  "supported",
  "partial",
  "not_found",
  "unreachable",
  "uncited",
];

/** Text nodes of a block, skipping the claim marks themselves. */
function textNodes(block: Element) {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest(".claim-marks")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

/** A DOM range for [start, end) offsets into the block's visible text. */
function rangeFor(nodes: Text[], start: number, end: number) {
  const range = document.createRange();
  let offset = 0;
  let started = false;
  for (const node of nodes) {
    const length = node.data.length;
    if (!started && start < offset + length) {
      range.setStart(node, start - offset);
      started = true;
    }
    if (started && end <= offset + length) {
      range.setEnd(node, end - offset);
      return range;
    }
    offset += length;
  }
  return started ? range : undefined;
}

/**
 * Underline the exact sentence each claim was taken from, coloured by status,
 * using the CSS Custom Highlight API: no DOM changes, so React keeps
 * ownership of the report. Browsers without the API just show the marks.
 */
export function useClaimHighlights(
  container: RefObject<HTMLElement | null>,
  placed: PlacedClaim[],
  report: string,
) {
  useLayoutEffect(() => {
    const registry = (globalThis.CSS as { highlights?: Map<string, unknown> })
      ?.highlights;
    const HighlightCtor = (
      globalThis as { Highlight?: new (...r: Range[]) => unknown }
    ).Highlight;
    if (!registry || !HighlightCtor || !container.current) return;
    const ranges = new Map<ClaimStatus, Range[]>();
    for (const { claim } of placed) {
      const block = document
        .getElementById(`mark-${claim.id}`)
        ?.closest("p, li, td");
      if (!block) continue;
      const nodes = textNodes(block);
      const span = bestSentence(nodes.map((n) => n.data).join(""), claim.claim);
      const range = span && rangeFor(nodes, span[0], span[1]);
      if (range)
        ranges.set(claim.status, [...(ranges.get(claim.status) ?? []), range]);
    }
    for (const status of statuses) {
      const list = ranges.get(status);
      if (list?.length)
        registry.set(`claim-${status}`, new HighlightCtor(...list));
      else registry.delete(`claim-${status}`);
    }
    return () => statuses.forEach((s) => registry.delete(`claim-${s}`));
  }, [container, placed, report]);
}

const hostOf = (url?: string) => {
  if (!url) return "No source cited";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/**
 * Margin notes beside the report: one card per paragraph, level with it,
 * listing that paragraph's claims. Cards that would overlap are pushed down,
 * keeping reading order.
 */
export function ClaimNotes({
  groups,
  unplaced,
  active,
  onActive,
  onOpen,
  onOpenEvidence,
}: {
  /** Claims grouped by the report line they sit on, in reading order. */
  groups: PlacedClaim[][];
  unplaced: number;
  active?: string;
  onActive: (id?: string) => void;
  onOpen: (id: string) => void;
  onOpenEvidence: () => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [tops, setTops] = useState<number[]>([]);
  const [height, setHeight] = useState(0);
  const all = groups.flat();
  const flagged = all.filter((p) =>
    ["not_found", "uncited"].includes(p.claim.status),
  ).length;

  useLayoutEffect(() => {
    // The notes' parent is the report body. (A ref from the parent would
    // still be null here: child layout effects run before parent refs attach.)
    const notes = rail.current;
    const host = notes?.parentElement;
    if (!host || !notes) return;
    const layout = () => {
      if (getComputedStyle(notes).display === "none") return;
      const base = notes.getBoundingClientRect().top;
      const cards = [...notes.querySelectorAll<HTMLElement>(".claim-note")];
      const gap = 10;
      const head = notes.querySelector<HTMLElement>(".claim-notes-head");
      let floor = (head?.offsetHeight ?? 0) + 14;
      const next = groups.map((group, i) => {
        const block = document
          .getElementById(`mark-${group[0].claim.id}`)
          ?.closest("p, li, td");
        const want = block ? block.getBoundingClientRect().top - base : floor;
        const top = Math.max(want, floor);
        floor = top + (cards[i]?.offsetHeight ?? 64) + gap;
        return Math.round(top);
      });
      setTops((prev) =>
        prev.length === next.length && prev.every((t, i) => t === next[i])
          ? prev
          : next,
      );
      setHeight(floor);
    };
    layout();
    const observer = new ResizeObserver(layout);
    observer.observe(host);
    return () => observer.disconnect();
  }, [groups]);

  return (
    <aside
      className="claim-notes"
      aria-label="Checked claims in this report"
      ref={rail}
      style={{ minHeight: height }}
    >
      <p className="claim-notes-head">
        {all.length} {all.length === 1 ? "claim" : "claims"} checked
        {flagged ? <b> · {flagged} to review</b> : null}
        {unplaced > 0 && (
          <button type="button" onClick={onOpenEvidence}>
            +{unplaced} more in Evidence
          </button>
        )}
      </p>
      {groups.map((group, i) => (
        <div
          key={group[0].claim.id}
          className="claim-note"
          style={{ top: tops[i] ?? 0, opacity: tops.length ? 1 : 0 }}
        >
          {group.map(({ claim, number }) => {
            const Icon = claimIcons[claim.status];
            return (
              <button
                key={claim.id}
                type="button"
                className={`note-row ${claim.status} ${active === claim.id ? "active" : ""}`}
                title={claim.claim}
                onMouseEnter={() => onActive(claim.id)}
                onMouseLeave={() => onActive(undefined)}
                onFocus={() => onActive(claim.id)}
                onBlur={() => onActive(undefined)}
                onClick={() => onOpen(claim.id)}
              >
                <span className="note-top">
                  <span className="note-number">{number}</span>
                  <Icon size={12} aria-hidden="true" />
                  {claimLabels[claim.status]}
                </span>
                <span className="note-source">{hostOf(claim.sourceUrl)}</span>
              </button>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
