import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  FileDown,
  History,
  Layers,
  Library,
  MessageCircleQuestion,
  MessagesSquare,
  Mic,
  Scale,
  ShieldCheck,
  Users,
} from "lucide-react";

/** Ask the voice assistant to open, from anywhere in the app. */
export const openVoice = () =>
  window.dispatchEvent(new Event("octo:voice-open"));

const claims = [
  {
    text: "UPI processed 18.4 billion transactions in March 2025",
    source: "npci.org.in",
    status: "supported",
  },
  {
    text: "Pix reached 160 million users within four years",
    source: "bcb.gov.br",
    status: "supported",
  },
  {
    text: "Merchant fees on Pix average 0.22%",
    source: "bcb.gov.br",
    status: "partial",
  },
  {
    text: "Installed capacity doubled in three years",
    source: "No source cited",
    status: "uncited",
  },
] as const;
const claimIcon = {
  supported: CircleCheck,
  partial: CircleAlert,
  uncited: CircleHelp,
};
const claimLabel = {
  supported: "Supported",
  partial: "Partly supported",
  uncited: "No source",
};

const smaller = [
  {
    icon: Layers,
    title: "Knows a regulator from a blog",
    text: "Every source labelled by kind and date; SEO and review sites flagged.",
  },
  {
    icon: MessagesSquare,
    title: "Answers only from your research",
    text: "Questions answered from the report, never from memory.",
  },
  {
    icon: History,
    title: "Keeps research current",
    text: "Refresh any report and see exactly what changed.",
  },
  {
    icon: Library,
    title: "Builds on what you know",
    text: "New research reuses related reports from your workspace.",
  },
  {
    icon: FileDown,
    title: "Survives limits, ships files",
    text: "Half reports continue into one. PDF, Word or CSV out.",
  },
];

/** What Octo does that a chat assistant does not, with the two signature features shown working. */
export default function Bento() {
  return (
    <section className="bento-section" aria-labelledby="why-octo-title">
      <div className="bento-heading">
        <div>
          <span className="eyebrow-strong">Why research in Octo</span>
          <h2 id="why-octo-title">What a chat window can't do</h2>
        </div>
        <p>
          A chat assistant can search. Octo is built around what happens next:
          aiming the research, checking it, and keeping it useful.
        </p>
      </div>
      <div className="bento">
        <article className="bento-tile tile-evidence">
          <div className="tile-copy">
            <span className="tile-icon">
              <ShieldCheck size={18} />
            </span>
            <div>
              <h3>Checks its own citations</h3>
              <p>
                Octo opens every cited page and PDF itself, looks for the
                figures each claim depends on, and scores the report. Flagged
                claims come first.
              </p>
            </div>
            <div className="tile-stat">
              <div>
                <b>Pages + PDFs</b>
                <span>opened by Octo, not guessed</span>
              </div>
              <div>
                <b>5 statuses</b>
                <span>from supported to not found</span>
              </div>
            </div>
          </div>
          <div className="evidence-demo" aria-label="Example evidence check">
            <div className="demo-score">
              <div
                className="demo-ring"
                style={{ ["--score" as string]: "75" }}
              >
                <span>75</span>
              </div>
              <div>
                <b>Evidence score</b>
                <small>3 of 4 claims backed by their source</small>
              </div>
              <span className="demo-tag">Example</span>
            </div>
            <ul>
              {claims.map((c) => {
                const Icon = claimIcon[c.status];
                return (
                  <li key={c.text} className={c.status}>
                    <Icon size={14} />
                    <span>
                      {c.text}
                      <small>{c.source}</small>
                    </span>
                    <em>{claimLabel[c.status]}</em>
                  </li>
                );
              })}
            </ul>
          </div>
        </article>

        <article className="bento-tile tile-voice">
          <div className="tile-copy">
            <span className="tile-icon on-dark">
              <Mic size={18} />
            </span>
            <h3>Talk to it</h3>
            <p>
              Ask about the report you have open, or say what you want
              researched. Octo fills in the form for you to review.
            </p>
          </div>
          <div className="voice-demo" aria-hidden="true">
            <div className="demo-orb">
              <span />
              <i />
              <i />
            </div>
            <p className="bubble you">
              Set up research on EV charging in India for an investor
            </p>
            <p className="bubble octo">
              The research form is ready. Review it and press Continue.
            </p>
          </div>
          <button type="button" className="tile-action" onClick={openVoice}>
            Try the voice assistant
            <ArrowRight size={15} />
          </button>
        </article>

        <article className="bento-tile tile-asks">
          <span className="tile-icon">
            <MessageCircleQuestion size={18} />
          </span>
          <h3>Asks before it researches</h3>
          <p>
            Says what it understood and asks what you need before spending a
            single search.
          </p>
          <div className="chip-demo" aria-hidden="true">
            <span className="on">An investment decision</span>
            <span>A sales plan</span>
            <span>An internal briefing</span>
          </div>
        </article>

        <article className="bento-tile tile-people">
          <span className="tile-icon">
            <Users size={18} />
          </span>
          <h3>Hears what real people say</h3>
          <p>
            Reddit and Hacker News, grouped into themes, quoted word for word
            with links.
          </p>
          <blockquote aria-hidden="true">
            “I spend more time checking the sources than reading the answer.”
            <small>Example theme · 41 posts</small>
          </blockquote>
        </article>

        <article className="bento-tile tile-challenge">
          <span className="tile-icon">
            <Scale size={18} />
          </span>
          <h3>Argues with itself</h3>
          <p>
            Challenge searches for the strongest evidence against its own
            report.
          </p>
          <div className="verdict-demo" aria-hidden="true">
            <span className="stands">Stands</span>
            <span className="weakened">Weakened</span>
            <span className="overturned">Overturned</span>
          </div>
        </article>
      </div>
      <ul className="bento-strip">
        {smaller.map(({ icon: Icon, title, text }) => (
          <li key={title}>
            <Icon size={16} />
            <div>
              <b>{title}</b>
              <span>{text}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
