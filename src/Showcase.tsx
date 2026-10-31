import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleX,
  Mic,
  Plus,
} from "lucide-react";
import type { ReactNode } from "react";
import { Mascot, areaProfile, director } from "./agents";
import type { ClaimStatus } from "../shared/types";

/** Ask the voice assistant to open, from anywhere in the app. */
export const openVoice = () =>
  window.dispatchEvent(new Event("octo:voice-open"));

type SpecimenStatus = Exclude<ClaimStatus, "unreachable">;
const specimenIcon: Record<SpecimenStatus, typeof CircleCheck> = {
  supported: CircleCheck,
  partial: CircleAlert,
  not_found: CircleX,
  uncited: CircleHelp,
};
const specimenLabel: Record<SpecimenStatus, string> = {
  supported: "Supported",
  partial: "Partly supported",
  not_found: "Not found in source",
  uncited: "No source cited",
};

/** One claim in the specimen: the sentence underlined, then its numbered mark. */
function Claim({
  n,
  status,
  children,
}: {
  n: number;
  status: SpecimenStatus;
  children: ReactNode;
}) {
  const Icon = specimenIcon[status];
  return (
    <>
      <span className={`specimen-claim ${status}`}>{children}</span>
      <span className={`claim-mark ${status}`} aria-hidden="true">
        <Icon size={12} />
        {n}
      </span>
    </>
  );
}

const specimenNotes: { n: number; status: SpecimenStatus; source: string }[] = [
  { n: 1, status: "supported", source: "Network page" },
  { n: 2, status: "partial", source: "Tariff page" },
  { n: 3, status: "not_found", source: "Analyst note" },
  { n: 4, status: "uncited", source: "No source cited" },
];

/**
 * The overview opens on what Octo produces: a report page with every claim
 * underlined by status and noted in the margin. Content is a labelled example.
 */
export function SpecimenHero({ onStart }: { onStart: () => void }) {
  return (
    <section className="specimen-hero" aria-labelledby="overview-title">
      <div className="specimen-copy">
        <p className="fig-label">Runs on Google Gemini or OpenAI</p>
        <h1 id="overview-title">Research you can check</h1>
        <p className="lede">
          Octo researches your question, then opens every page it cites and
          marks which claims hold up.
        </p>
        <div className="hero-actions">
          <button type="button" className="primary" onClick={onStart}>
            <Plus size={17} />
            Start research
          </button>
          <button type="button" className="hero-say" onClick={openVoice}>
            <Mic size={16} />
            Say it instead
          </button>
        </div>
      </div>
      <figure className="specimen">
        <div className="specimen-sheet">
          <div className="specimen-page">
            <p className="specimen-kicker">Example report · illustrative</p>
            <h2>EV charging pricing in India</h2>
            <div
              className="specimen-ledger"
              role="img"
              aria-label="Example evidence: 1 supported, 1 partly supported, 1 not found, 1 without a source"
            >
              <span>
                <i className="supported" />
                <i className="partial" />
                <i className="not_found" />
                <i className="uncited" />
              </span>
              <b>38</b>
              <small>/100</small>
            </div>
            <p>
              Public charging is growing fastest in the large cities.{" "}
              <Claim n={1} status="supported">
                The largest operator lists 1,200 public points across 40 cities.
              </Claim>{" "}
              <Claim n={2} status="partial">
                Its tariff page quotes 18 rupees per kWh for fast charging,
              </Claim>{" "}
              but does not say which cities that applies to.
            </p>
            <p>
              <Claim n={3} status="not_found">
                Analysts put break-even utilisation at 15%.
              </Claim>{" "}
              <Claim n={4} status="uncited">
                Installed capacity doubled in three years.
              </Claim>
            </p>
          </div>
          <ol className="specimen-notes" aria-label="Margin notes">
            {specimenNotes.map(({ n, status, source }) => {
              const Icon = specimenIcon[status];
              return (
                <li key={n} className={`note-row ${status}`}>
                  <span className="note-top">
                    <span className="note-number">{n}</span>
                    <Icon size={12} aria-hidden="true" />
                    {specimenLabel[status]}
                  </span>
                  <span className="note-source">{source}</span>
                </li>
              );
            })}
          </ol>
        </div>
        <figcaption>
          Each claim is underlined in its status and noted in the margin. Open a
          mark to see the passage Octo found, or didn't.
        </figcaption>
      </figure>
    </section>
  );
}

const team = ["Market", "Tariffs", "Regulation"].map((title, i) =>
  areaProfile(title, i),
);

const stations: {
  title: string;
  who: "you" | "octo" | "both";
  text: string;
  extra?: ReactNode;
}[] = [
  {
    title: "Brief",
    who: "you",
    text: "Type the question or say it. Attach files if you have them.",
  },
  {
    title: "Questions",
    who: "both",
    text: "Octo says what it understood and asks what the research is for.",
  },
  {
    title: "Plan",
    who: "you",
    text: "One area per part of the question. Keep or drop each before a single search runs.",
  },
  {
    title: "Research",
    who: "octo",
    text: "A specialist per area searches the web. Reddit and Hacker News add first-hand views.",
    extra: (
      <span className="station-team" aria-hidden="true">
        <Mascot profile={director} size={22} label="" />
        {team.map((p) => (
          <Mascot key={p.id} profile={p} size={22} label="" />
        ))}
      </span>
    ),
  },
  {
    title: "Report",
    who: "octo",
    text: "Cited throughout, with every source labelled by kind and date.",
  },
  {
    title: "Check",
    who: "octo",
    text: "Opens each cited page and PDF and marks every claim it can find.",
  },
  {
    title: "Challenge",
    who: "you",
    text: "When you ask, Octo searches for the strongest evidence against its own report.",
  },
];

const whoLabel = { you: "You", octo: "Octo", both: "Octo asks, you answer" };

/** The process as a schematic: numbered stations on one track, who acts at each. */
export function ProcessMap() {
  return (
    <section className="process-map" aria-labelledby="process-title">
      <div className="map-head">
        <p className="fig-label">Fig. 2</p>
        <h2 id="process-title">How a report gets made</h2>
        <p>
          Seven steps. You steer at three of them; Octo does the searching,
          writing and checking.
        </p>
        <p className="map-legend" aria-hidden="true">
          <span className="legend-octo">Octo</span>
          <span className="legend-you">You</span>
          <span className="legend-both">Both</span>
        </p>
      </div>
      <ol className="map-track">
        {stations.map((s, i) => (
          <li key={s.title} className={`station ${s.who}`}>
            <span className="station-node">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="station-who">{whoLabel[s.who]}</span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
            {s.extra}
          </li>
        ))}
      </ol>
      <p className="map-loop">
        Later: refresh any report and Octo shows what changed, keeping every
        version. Ask follow-up questions and it answers only from the research.
      </p>
    </section>
  );
}

/** The pipeline split into the part a model does and the parts Octo runs itself. */
const lanes: { title: string; text: string; model?: boolean }[] = [
  {
    title: "Your plan",
    text: "You keep or drop each research area before any search runs.",
  },
  {
    title: "A model writes",
    text: "Gemini or OpenAI researches and drafts the cited report.",
    model: true,
  },
  {
    title: "Octo fetches",
    text: "Its own fetcher opens every cited page and PDF.",
  },
  {
    title: "Octo compares",
    text: "Figures and wording in the claim against the page itself.",
  },
  {
    title: "Octo marks",
    text: "Each verdict lands on the sentence it belongs to.",
  },
];

const ledger: {
  question: string;
  engine: string;
  chat: string;
  octo: string;
}[] = [
  {
    question: "Before it searches",
    engine: "Takes the keywords you typed.",
    chat: "Starts answering straight away.",
    octo: "Says what it understood, proposes research areas for your brief, and waits for you to keep or drop each.",
  },
  {
    question: "Are the citations right?",
    engine: "You open each link to find out.",
    chat: "You open each link to find out.",
    octo: "Opens every cited page and PDF itself, compares the figures, and marks each claim Supported, Partly supported, Not found or No source.",
  },
  {
    question: "Which sources count",
    engine: "Whatever ranks, SEO pages included.",
    chat: "Whatever the search returned.",
    octo: "Every source labelled by kind and date, blogs and review sites flagged, primary sources first, your trusted and blocked domains respected.",
  },
  {
    question: "What people actually experience",
    engine: "Forum threads mixed into results.",
    chat: "Only if the search happens to find them.",
    octo: "Themes from Reddit and Hacker News discussions, quoted word for word with a link to each post.",
  },
  {
    question: "The other side",
    engine: "A separate search, if you think of it.",
    chat: "Usually one confident answer.",
    octo: "Challenge searches for the strongest evidence against the report and records whether each point stands.",
  },
  {
    question: "Follow-up questions",
    engine: "A new search from scratch.",
    chat: "Answered partly from the model's memory.",
    octo: "Answered only from the report and its checked claims; what it can't answer becomes follow-up research.",
  },
  {
    question: "Next month",
    engine: "Search again.",
    chat: "Ask again and get a different answer.",
    octo: "Refresh the report; every version is kept with a line-by-line view of what changed.",
  },
];

/** Where Octo differs from search engines and AI chat, and why it is not a wrapper. */
export function DifferenceSection() {
  return (
    <section className="difference" aria-labelledby="difference-title">
      <div className="map-head">
        <p className="fig-label">Fig. 1</p>
        <h2 id="difference-title">Not another way to ask a model</h2>
        <p>
          A search engine hands you links. An AI chat hands you an answer with
          links. Both leave the checking to you. Octo is the work around the
          model: it plans with you before searching and checks what the model
          wrote against the pages it cites.
        </p>
      </div>

      <figure className="lanes">
        <ol aria-label="Who does what in a research run">
          {lanes.map((lane) => (
            <li key={lane.title} className={lane.model ? "lane model" : "lane"}>
              <span className="lane-tag">
                {lane.model
                  ? "Swappable model"
                  : lane.title === "Your plan"
                    ? "You"
                    : "Octo's own code"}
              </span>
              <b>{lane.title}</b>
              <span>{lane.text}</span>
            </li>
          ))}
        </ol>
        <figcaption>
          The model lists the claims to check, with a rule-based fallback if it
          can't; the verdicts come from Octo reading the cited page. Switch
          Gemini for OpenAI and the planning, checking, source labels, versions
          and challenge work the same way.
        </figcaption>
      </figure>

      <div
        className="ledger-table"
        role="table"
        aria-label="Octo compared with a search engine and an AI chat"
      >
        <div className="ledger-row ledger-header" role="row">
          <span role="columnheader">
            <span className="sr-only">Question</span>
          </span>
          <span role="columnheader">Search engine</span>
          <span role="columnheader">AI chat with search</span>
          <span role="columnheader" className="octo-col">
            Octo
          </span>
        </div>
        {ledger.map((row) => (
          <div className="ledger-row" role="row" key={row.question}>
            <span role="rowheader" className="ledger-q">
              {row.question}
            </span>
            <span role="cell" data-label="Search engine">
              {row.engine}
            </span>
            <span role="cell" data-label="AI chat with search">
              {row.chat}
            </span>
            <span role="cell" data-label="Octo" className="octo-col">
              {row.octo}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
