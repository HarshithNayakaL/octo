import { useState } from "react";
import { ExternalLink, MessagesSquare, RefreshCw } from "lucide-react";
import type { CommunityItem, CommunityTheme, Run } from "../shared/types";

const kindLabels: Record<CommunityTheme["kind"], string> = {
  pain: "Pain point",
  wish: "Unmet need",
  praise: "What works",
  workaround: "Workaround",
  other: "Theme",
};
const month = (iso: string) =>
  iso
    ? new Intl.DateTimeFormat("en-IN", {
        month: "short",
        year: "numeric",
      }).format(new Date(iso))
    : "";

export const voicesBusy = (run: Run) =>
  run.community?.status === "pending" || run.community?.status === "running";

function Quote({ item }: { item: CommunityItem }) {
  return (
    <blockquote className="voice-quote">
      <p>
        {item.text.length > 420 ? item.text.slice(0, 420) + "…" : item.text}
      </p>
      <a href={item.url} target="_blank" rel="noreferrer">
        {item.source === "reddit" ? item.where : `Hacker News · ${item.where}`}
        {item.score !== undefined ? ` · ${item.score} points` : ""} ·{" "}
        {month(item.at)}
        <ExternalLink size={11} />
      </a>
    </blockquote>
  );
}

/** What real people say about the topic, quoted verbatim with links. */
export default function VoicesPanel({
  run,
  busy,
  onGather,
}: {
  run: Run;
  busy: boolean;
  onGather: () => void;
}) {
  const c = run.community;
  const [open, setOpen] = useState<string>();
  const byId = new Map((c?.items ?? []).map((i) => [i.id, i]));
  const scanned = Object.values(c?.scanned ?? {}).reduce(
    (a, b) => a + (b ?? 0),
    0,
  );
  const max = Math.max(1, ...(c?.themes ?? []).map((t) => t.itemIds.length));
  const canGather =
    !busy &&
    !voicesBusy(run) &&
    run.purpose !== "crm" &&
    ![
      "planning",
      "starting",
      "running",
      "requires_action",
      "awaiting_input",
    ].includes(run.status);
  return (
    <div className="voices-panel">
      <div className="evidence-head">
        <span className="voices-icon">
          <MessagesSquare size={22} />
        </span>
        <div>
          <span className="small-label">COMMUNITY VOICES</span>
          <h2>What real people say about this</h2>
          <p className="muted">
            Octo searches public Reddit and Hacker News discussions, groups them
            into themes, and quotes people word for word with a link to every
            post. Treat it as first-hand experience, not proof.
          </p>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={!canGather}
          onClick={onGather}
        >
          <RefreshCw size={14} className={voicesBusy(run) ? "spin" : ""} />
          {c ? "Gather again" : "Gather voices"}
        </button>
      </div>
      {!c && (
        <p className="empty-note">
          No community search yet. It takes about a minute and does not run new
          research.
        </p>
      )}
      {c && voicesBusy(run) && (
        <p className="empty-note">
          <RefreshCw size={14} className="spin" /> Searching Reddit and Hacker
          News
          {c.queries.length
            ? ` for ${c.queries.map((q) => `“${q}”`).join(", ")}`
            : ""}
          …
        </p>
      )}
      {c?.status === "failed" && (
        <div className="notice error-notice">
          <p>{c.error ?? "The community search failed."}</p>
        </div>
      )}
      {c?.status === "done" && (
        <>
          <div className="voices-stats">
            <span>
              <b>{c.items.length}</b> relevant posts
            </span>
            <span>
              <b>{scanned}</b> scanned
            </span>
            <span>
              <b>{c.themes.length}</b> themes
            </span>
            <span className="muted">
              Searches: {c.queries.map((q) => `“${q}”`).join(", ")}
            </span>
          </div>
          {c.takeaway && <p className="voices-takeaway">{c.takeaway}</p>}
          {c.error && <p className="muted small">{c.error}</p>}
          <ol className="theme-list">
            {c.themes.map((t) => {
              const quotes = t.quoteIds
                .map((id) => byId.get(id))
                .filter(Boolean) as CommunityItem[];
              const more = t.itemIds
                .filter((id) => !t.quoteIds.includes(id))
                .map((id) => byId.get(id))
                .filter(Boolean) as CommunityItem[];
              return (
                <li key={t.title} className={`theme-card ${t.kind}`}>
                  <div className="theme-top">
                    <span className={`theme-kind ${t.kind}`}>
                      {kindLabels[t.kind]}
                    </span>
                    <span className="theme-count">
                      {t.itemIds.length} post{t.itemIds.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <h3>{t.title}</h3>
                  <div className="theme-bar" aria-hidden="true">
                    <span
                      style={{ width: `${(t.itemIds.length / max) * 100}%` }}
                    />
                  </div>
                  <p>{t.summary}</p>
                  {quotes.map((q) => (
                    <Quote key={q.id} item={q} />
                  ))}
                  {more.length > 0 && (
                    <>
                      <button
                        type="button"
                        className="theme-more"
                        aria-expanded={open === t.title}
                        onClick={() =>
                          setOpen(open === t.title ? undefined : t.title)
                        }
                      >
                        {open === t.title ? "Hide" : "Show"} {more.length} more
                        post
                        {more.length === 1 ? "" : "s"}
                      </button>
                      {open === t.title &&
                        more.map((q) => <Quote key={q.id} item={q} />)}
                    </>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="muted small">
            Reddit posts come from the public PullPush archive and Hacker News
            from its Algolia API, over the last two years. Archives can lag, and
            vocal users are not a representative sample.
          </p>
        </>
      )}
    </div>
  );
}
