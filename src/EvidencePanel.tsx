import { useMemo, useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleX,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type { ClaimCheck, ClaimStatus, Run } from "../shared/types";
import { displayUrl } from "./MiddleTruncate";

export const claimLabels: Record<ClaimStatus, string> = {
  supported: "Supported",
  partial: "Partly supported",
  not_found: "Not found in source",
  unreachable: "Could not check",
  uncited: "No source cited",
};
const icons: Record<ClaimStatus, typeof CircleCheck> = {
  supported: CircleCheck,
  partial: CircleAlert,
  not_found: CircleX,
  unreachable: CircleDashed,
  uncited: CircleHelp,
};
const order: ClaimStatus[] = [
  "not_found",
  "uncited",
  "partial",
  "unreachable",
  "supported",
];

export function ClaimBadge({ status }: { status: ClaimStatus }) {
  const Icon = icons[status];
  return (
    <span className={`claim-badge ${status}`}>
      <Icon size={13} />
      {claimLabels[status]}
    </span>
  );
}

export function evidenceChecking(run: Run) {
  return (
    run.evidence?.status === "pending" || run.evidence?.status === "running"
  );
}

/** One-line evidence summary shown above the report. */
export function EvidenceSummary({
  run,
  onOpen,
}: {
  run: Run;
  onOpen: () => void;
}) {
  const e = run.evidence;
  if (!e) return null;
  if (evidenceChecking(run))
    return (
      <button
        type="button"
        className="evidence-strip checking"
        onClick={onOpen}
      >
        <RefreshCw size={14} className="spin" />
        Octo is checking this report's citations against the cited pages…
      </button>
    );
  if (e.status === "failed")
    return (
      <button type="button" className="evidence-strip" onClick={onOpen}>
        <CircleDashed size={14} />
        The evidence check did not finish. Open Evidence to try again.
      </button>
    );
  const supported = e.claims.filter((c) => c.status === "supported").length;
  const flagged = e.claims.filter((c) =>
    ["not_found", "uncited"].includes(c.status),
  ).length;
  return (
    <button
      type="button"
      className={`evidence-strip ${flagged ? "flagged" : "good"}`}
      onClick={onOpen}
    >
      <ShieldCheck size={15} />
      <b>Evidence checked</b>
      {e.claims.length
        ? `${supported} of ${e.claims.length} claims backed by their cited page${flagged ? ` · ${flagged} to review` : ""}`
        : "No checkable claims found"}
      {e.score !== undefined && <span className="score-pill">{e.score}</span>}
    </button>
  );
}

function ScoreRing({ score }: { score?: number }) {
  const value = score ?? 0;
  const tone =
    score === undefined
      ? "none"
      : value >= 75
        ? "good"
        : value >= 50
          ? "mid"
          : "low";
  return (
    <div
      className={`score-ring ${tone}`}
      style={{ ["--score" as string]: `${value * 3.6}deg` }}
      role="img"
      aria-label={
        score === undefined
          ? "No evidence score"
          : `Evidence score ${score} of 100`
      }
    >
      <span>{score ?? "–"}</span>
    </div>
  );
}

export default function EvidencePanel({
  run,
  busy,
  highlight,
  onRecheck,
}: {
  run: Run;
  busy: boolean;
  highlight?: string;
  onRecheck: () => void;
}) {
  const e = run.evidence;
  const [filter, setFilter] = useState<ClaimStatus | "all">("all");
  const counts = useMemo(() => {
    const c: Partial<Record<ClaimStatus, number>> = {};
    for (const claim of e?.claims ?? [])
      c[claim.status] = (c[claim.status] ?? 0) + 1;
    return c;
  }, [e]);
  const claims = [...(e?.claims ?? [])]
    .filter((c) => filter === "all" || c.status === filter)
    .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  const stale =
    e && e.status === "done" && e.reportLength !== run.report.length;
  return (
    <div className="evidence-check">
      <div className="evidence-head">
        <ScoreRing score={e?.status === "done" ? e.score : undefined} />
        <div>
          <span className="small-label">OCTO EVIDENCE CHECK</span>
          <h2>Does each source say what the report claims?</h2>
          <p className="muted">
            {run.mode === "demo"
              ? "Demo: statuses are illustrative. In a live run Octo opens every cited page and PDF itself and looks for the figures and wording each claim depends on."
              : "Octo lists the report's material claims, opens every cited page and PDF itself, and looks for the figures and wording each claim depends on. It is an automatic first pass: review flagged claims before relying on them."}
          </p>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={busy || evidenceChecking(run) || !run.report.trim()}
          onClick={onRecheck}
        >
          <RefreshCw
            size={14}
            className={evidenceChecking(run) ? "spin" : ""}
          />
          {e ? "Check again" : "Check evidence"}
        </button>
      </div>
      {!e && (
        <p className="empty-note">
          This report has not been checked yet. Checking reads the cited pages;
          it does not run new research.
        </p>
      )}
      {e && evidenceChecking(run) && (
        <p className="empty-note">
          <RefreshCw size={14} className="spin" /> Extracting claims and opening
          the cited sources. This usually takes under a minute.
        </p>
      )}
      {e?.status === "failed" && (
        <div className="notice error-notice">
          <p>{e.error ?? "The evidence check failed."}</p>
        </div>
      )}
      {stale && (
        <p className="empty-note">
          The report changed after this check. Check again to verify the new
          version.
        </p>
      )}
      {e?.status === "done" && (
        <>
          <div
            className="claim-filters"
            role="group"
            aria-label="Filter claims"
          >
            <button
              type="button"
              className={filter === "all" ? "on" : ""}
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              All {e.claims.length}
            </button>
            {order
              .filter((s) => counts[s])
              .map((s) => (
                <button
                  type="button"
                  key={s}
                  className={`${filter === s ? "on" : ""} ${s}`}
                  aria-pressed={filter === s}
                  onClick={() => setFilter(s)}
                >
                  {claimLabels[s]} {counts[s]}
                </button>
              ))}
          </div>
          {claims.length === 0 && (
            <p className="empty-note">
              No checkable claims were found in this report.
            </p>
          )}
          <ol className="claim-list">
            {claims.map((c) => (
              <ClaimRow key={c.id} claim={c} highlight={highlight === c.id} />
            ))}
          </ol>
          <p className="muted small">
            Checked {e.claims.length} claims
            {e.method === "model"
              ? " picked by the model"
              : " found in the text"}
            {e.finishedAt
              ? ` on ${new Date(e.finishedAt).toLocaleString()}`
              : ""}
            . Unreachable pages do not count toward the score.
          </p>
        </>
      )}
    </div>
  );
}

function ClaimRow({
  claim,
  highlight,
}: {
  claim: ClaimCheck;
  highlight: boolean;
}) {
  return (
    <li
      id={`claim-${claim.id}`}
      className={`claim-row ${claim.status} ${highlight ? "highlight" : ""}`}
    >
      <div className="claim-top">
        <span className="claim-id">{claim.id}</span>
        <ClaimBadge status={claim.status} />
      </div>
      <p className="claim-text">{claim.claim}</p>
      {claim.note && <p className="claim-note">{claim.note}</p>}
      {claim.excerpt && (
        <blockquote className="claim-excerpt">{claim.excerpt}</blockquote>
      )}
      {claim.sourceUrl && (
        <a
          className="claim-source"
          href={claim.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          {claim.sourceTitle ?? displayUrl(claim.sourceUrl)}
          <ExternalLink size={12} />
        </a>
      )}
    </li>
  );
}
