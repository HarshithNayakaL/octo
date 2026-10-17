import { useMemo, useState } from "react";
import { diffLines } from "diff";
import { GitCompareArrows, History, RefreshCw } from "lucide-react";
import type { Run, Source } from "../shared/types";
import { displayUrl } from "./MiddleTruncate";

const when = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

interface Block {
  kind: "added" | "removed" | "same";
  lines: string[];
}
function blocks(before: string, after: string): Block[] {
  return diffLines(before, after).map((part) => ({
    kind: part.added ? "added" : part.removed ? "removed" : "same",
    lines: part.value.replace(/\n$/, "").split("\n"),
  }));
}
const sourceDiff = (before: Source[], after: Source[]) => {
  const was = new Set(before.map((s) => s.url));
  const now = new Set(after.map((s) => s.url));
  return {
    added: after.filter((s) => !was.has(s.url)),
    removed: before.filter((s) => !now.has(s.url)),
  };
};

/** Every saved version of the report, and what changed between them. */
export default function VersionsPanel({
  run,
  busy,
  onRefresh,
}: {
  run: Run;
  busy: boolean;
  onRefresh?: (note: string) => void;
}) {
  const versions = run.versions ?? [];
  const [base, setBase] = useState(versions.at(-1)?.id ?? "");
  const [note, setNote] = useState("");
  const selected = versions.find((v) => v.id === base) ?? versions.at(-1);
  const diff = useMemo(
    () => (selected ? blocks(selected.report, run.report) : []),
    [selected, run.report],
  );
  const added = diff
    .filter((b) => b.kind === "added")
    .reduce((n, b) => n + b.lines.length, 0);
  const removed = diff
    .filter((b) => b.kind === "removed")
    .reduce((n, b) => n + b.lines.length, 0);
  const sources = selected
    ? sourceDiff(selected.sources, run.sources)
    : undefined;
  const score =
    run.evidence?.status === "done" ? run.evidence.score : undefined;
  return (
    <div className="versions-panel">
      <div className="ask-head">
        <History size={20} />
        <div>
          <span className="small-label">LIVING RESEARCH</span>
          <h2>Keep this research current</h2>
          <p className="muted">
            Refreshing searches for evidence published since this report,
            re-checks its figures, and keeps the old version so you can see
            exactly what changed.
          </p>
        </div>
      </div>
      {onRefresh && (
        <form
          className="ask-form"
          onSubmit={(e) => {
            e.preventDefault();
            onRefresh(note);
            setNote("");
          }}
        >
          <input
            aria-label="What to focus on when refreshing"
            placeholder="Optional: what to focus on (e.g. new regulation since June)"
            value={note}
            maxLength={5000}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="primary" disabled={busy}>
            <RefreshCw size={15} />
            Refresh research
          </button>
        </form>
      )}
      {!versions.length ? (
        <p className="empty-note">
          This is the only version so far. After a refresh, a follow-up or a
          continued run, earlier versions appear here with a side-by-side change
          view.
        </p>
      ) : (
        <>
          <div className="version-row">
            <label>
              <GitCompareArrows size={15} />
              Compare the current report with
              <select
                value={selected?.id}
                onChange={(e) => setBase(e.target.value)}
              >
                {[...versions].reverse().map((v, i) => (
                  <option key={v.id} value={v.id}>
                    {v.label} · {when(v.at)}
                    {i === 0 ? " (previous)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="change-stats">
              <span className="plus">+{added} lines</span>
              <span className="minus">−{removed} lines</span>
              {sources && (
                <span>
                  {sources.added.length} new · {sources.removed.length} dropped
                  sources
                </span>
              )}
              {selected?.score !== undefined && score !== undefined && (
                <span>
                  Evidence {selected.score} → {score}
                </span>
              )}
            </div>
          </div>
          {sources &&
            (sources.added.length > 0 || sources.removed.length > 0) && (
              <div className="source-changes">
                {sources.added.map((s) => (
                  <a
                    key={s.url}
                    className="plus"
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    + {s.title || displayUrl(s.url)}
                  </a>
                ))}
                {sources.removed.map((s) => (
                  <span key={s.url} className="minus">
                    − {s.title || displayUrl(s.url)}
                  </span>
                ))}
              </div>
            )}
          <div className="diff-view" aria-label="Changes in the report">
            {added + removed === 0 && (
              <p className="empty-note">No text changed.</p>
            )}
            {diff.map((b, i) =>
              b.kind === "same" ? (
                b.lines.length > 6 ? (
                  <div key={i} className="diff-same">
                    {b.lines.slice(0, 2).join("\n")}
                    <span className="diff-gap">
                      … {b.lines.length - 4} unchanged lines …
                    </span>
                    {b.lines.slice(-2).join("\n")}
                  </div>
                ) : (
                  <div key={i} className="diff-same">
                    {b.lines.join("\n")}
                  </div>
                )
              ) : (
                <div key={i} className={`diff-${b.kind}`}>
                  {b.lines.join("\n")}
                </div>
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}
