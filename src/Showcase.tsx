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
        <p className="fig-label">Fig. 1</p>
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
