import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Building2,
  Command,
  FileText,
  FolderOpen,
  Globe2,
  Plus,
  Radio,
  Search,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { Arc, Orbit } from "loading-dev";
import Select from "./Select";
import { Mascot, director, playbooks } from "./agents";
import {
  workflowLabels,
  type Configuration,
  type Run,
  type Workflow,
} from "../shared/types";

interface Props {
  page: "research" | "reports" | "monitors";
  runs: Run[];
  listed: Run[];
  config?: Configuration;
  loading: boolean;
  query: string;
  filter: string;
  setQuery: (value: string) => void;
  setFilter: (value: string) => void;
  onCreate: (workflow: Workflow, brief?: string) => void;
  onOpen: (id: string) => void;
  onSettings: () => void;
}
const icons = { market: Globe2, sales: Building2, monitor: Radio };
const active = (run: Run) =>
  ["starting", "running", "requires_action"].includes(run.status);
const descriptions = {
  market: "Understand markets. Map competitors. Find the signals that matter.",
  sales: "Find the right companies, with evidence behind every match.",
  monitor: "Follow a topic over time. Build on what you already know.",
};
const date = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export default function OriginalOverview({
  page,
  runs,
  listed,
  loading,
  query,
  filter,
  setQuery,
  setFilter,
  onCreate,
  onOpen,
  onSettings,
}: Props) {
  return (
    <main className="content dashboard">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR RESEARCH, CONNECTED</div>
          <h1>
            {page === "reports"
              ? "Ideas, backed by evidence."
              : page === "monitors"
                ? "Stay close to what changes."
                : "Research, with a wider lens."}
          </h1>
          <p>
            {page === "reports"
              ? "Your completed briefings, sources, and company research in one place."
              : page === "monitors"
                ? "Keep a topic moving forward with scheduled checks and saved context."
                : "Turn a question into a clear picture. Put a team of research agents to work."}
          </p>
        </div>
        <button
          className="primary"
          onClick={() => onCreate(page === "monitors" ? "monitor" : "market")}
        >
          <Plus size={17} />
          New research
        </button>
      </div>
      {page === "research" && (
        <>
          <section className="hero-panel">
            <div className="hero-copy">
              <span className="hero-tag">
                <span />
                Google Antigravity + OpenAI Agents API
              </span>
              <h2>
                One brief. <br />
                Multiple perspectives.
              </h2>
              <p>
                From the first question to the final report,
                <br className="desktop-break" /> keep the research and the
                reasoning together.
              </p>
              <button onClick={() => onCreate("market")}>
                Start with a question
                <ArrowRight size={17} />
              </button>
            </div>
            <ResearchDiagram />
            <div className="hero-folio">01 / A WORKSPACE FOR DISCOVERY</div>
          </section>
          <div className="section-top">
            <h2>What would you like to explore?</h2>
            <span>Choose a research workflow</span>
          </div>
          <section className="workflow-grid">
            {(["market", "sales", "monitor"] as Workflow[]).map(
              (workflow, i) => {
                const Icon = icons[workflow];
                return (
                  <button
                    className="workflow-card"
                    key={workflow}
                    onClick={() => onCreate(workflow)}
                  >
                    <div className="card-top">
                      <span className="workflow-icon">
                        <Icon size={22} />
                      </span>
                      <span className="card-number">0{i + 1}</span>
                    </div>
                    <h3>
                      {workflowLabels[workflow]}
                      <ArrowUpRight size={18} />
                    </h3>
                    <p>{descriptions[workflow]}</p>
                    <div className="card-footer">
                      <span>
                        {workflow === "market"
                          ? "Investor briefings & competitors"
                          : workflow === "sales"
                            ? "ICP matching & company evidence"
                            : "Saved context & scheduled checks"}
                      </span>
                    </div>
                  </button>
                );
              },
            )}
          </section>
          <ResearchPulse runs={runs} />
        </>
      )}
      <section className="research-list">
        <div className="section-top">
          <div className="research-list-heading">
            <h2>
              {page === "reports"
                ? "Report library"
                : page === "monitors"
                  ? "Research schedules"
                  : "Your research"}
            </h2>
            <span className="count-label">{listed.length}</span>
          </div>
          <div className="list-tools">
            <label className="search-field">
              <Search size={15} />
              <input
                id="research-search"
                aria-label="Search research"
                placeholder="Search research…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd>Ctrl K</kbd>
            </label>
            <div className="filter-field">
              <SlidersHorizontal size={15} />
              <Select
                compact
                label="Filter by workflow"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All workflows" },
                  { value: "market", label: "Market" },
                  { value: "sales", label: "Sales" },
                  { value: "monitor", label: "Ongoing" },
                ]}
              />
            </div>
          </div>
        </div>
        <div className="table-wrap">
          <table className="runs-table">
            <thead>
              <tr>
                <th>RESEARCH</th>
                <th>WORKFLOW</th>
                <th>STATUS</th>
                <th>LAST UPDATED</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {listed.map((run) => {
                const Icon = icons[run.workflow];
                const live = active(run) && !run.cancelRequested;
                return (
                  <tr key={run.id} onClick={() => onOpen(run.id)}>
                    <td>
                      <div className="research-cell">
                        <span className="file-icon">
                          <FileText size={18} />
                        </span>
                        <div>
                          <button
                            className="row-title"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpen(run.id);
                            }}
                          >
                            {run.title}
                          </button>
                          <span>
                            {run.mode === "demo"
                              ? "Demo · illustrative output"
                              : (run.model ?? "Live research")}
                            {run.nextCheckAt
                              ? ` · Next check ${date(run.nextCheckAt)}`
                              : ""}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="workflow-label">
                        <Icon size={14} />
                        {workflowLabels[run.workflow]}
                      </span>
                    </td>
                    <td>
                      <span className={`status ${run.status}`}>
                        {live ? (
                          <Orbit size={11} color="currentColor" />
                        ) : (
                          <span />
                        )}
                        {run.cancelRequested && active(run)
                          ? "Stopping"
                          : run.status.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td className="date-cell">{date(run.updatedAt)}</td>
                    <td>
                      <ArrowUpRight size={17} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {loading ? (
          <div className="empty compact">
            <Arc size={20} />
            Loading your workspace…
          </div>
        ) : !listed.length ? (
          <div className="empty compact">
            <FolderOpen size={30} />
            <h3>
              {query
                ? "No matching research"
                : "A place for your next question"}
            </h3>
            <p>
              {query
                ? "Try another search or workflow filter."
                : "Start a research run to collect sources and build a report."}
            </p>
            {!query && (
              <button
                className="secondary"
                onClick={() =>
                  onCreate(page === "monitors" ? "monitor" : "market")
                }
              >
                Create research
                <Plus size={15} />
              </button>
            )}
          </div>
        ) : null}
      </section>
      <footer className="dashboard-footer">
        <div>
          <ShieldCheck size={15} />
          Your API key stays on your server.
        </div>
        <span>
          {runs.filter(active).length} active ·{" "}
          {runs.filter((run) => run.status === "completed").length} reports ·{" "}
          {runs.reduce((total, run) => total + run.sources.length, 0)} saved
          sources
        </span>
        <button onClick={onSettings}>
          Built to be yours
          <ArrowUpRight size={14} />
        </button>
      </footer>
    </main>
  );
}

function ResearchDiagram() {
  const team = playbooks.market.slice(0, 4);
  return (
    <div
      className="research-diagram"
      role="img"
      aria-label="Illustration: a research director coordinates market, competitor, pricing, and regulation research to produce a report"
    >
      <div className="diagram-grid" />
      <svg
        className="diagram-lines"
        viewBox="0 0 500 230"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M250 48V82M250 82H60V110M250 82H187V110M250 82H313V110M250 82H440V110M60 146V176H250M187 146V176M313 146V176M440 146V176H250M250 176V194"
          fill="none"
          stroke="#002fa7"
          strokeOpacity=".28"
          strokeWidth="1.2"
        />
        <circle cx="250" cy="82" r="3" fill="#002fa7" />
      </svg>
      <div className="director-node">
        <Mascot profile={director} size={26} label="" />
        Research director
      </div>
      <div className="specialist-nodes">
        {team.map((profile) => (
          <div key={profile.id}>
            <Mascot profile={profile} size={30} label="" />
            <span>{profile.name.replace(" researcher", "")}</span>
          </div>
        ))}
      </div>
      <div className="report-node">
        <FileText size={15} />
        Your final report
        <ArrowUpRight size={13} />
      </div>
    </div>
  );
}

const dayKey = (value: Date) =>
  `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
/** Research started per day, from saved run dates. */
function ResearchPulse({ runs }: { runs: Run[] }) {
  const weeks = 26;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - start.getDay() - (weeks - 1) * 7);
  const counts = new Map<string, number>();
  for (const run of runs) {
    const key = dayKey(new Date(run.createdAt));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const days = Array.from({ length: weeks * 7 }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return { day, count: counts.get(dayKey(day)) ?? 0, future: day > today };
  });
  const live = runs.filter((r) => r.mode === "live");
  const stats = [
    ["Active now", runs.filter(active).length],
    ["Reports", runs.filter((r) => r.status === "completed").length],
    ["Saved sources", runs.reduce((n, r) => n + r.sources.length, 0)],
    ["Scheduled checks", runs.filter((r) => r.nextCheckAt).length],
  ] as const;
  const fmt = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
  });
  return (
    <section className="pulse-panel" aria-label="Workspace activity">
      <div className="pulse-stats">
        {stats.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </div>
      <div className="pulse-calendar">
        <div className="pulse-calendar-top">
          <span>Research started · last {weeks} weeks</span>
          <span>
            {live.length} live · {runs.length - live.length} demo
          </span>
        </div>
        <div className="pulse-grid" role="list">
          {days.map(({ day, count, future }) => (
            <span
              role="listitem"
              key={day.toISOString()}
              className={`pulse-cell level-${future ? "x" : Math.min(count, 4)}`}
              title={`${fmt.format(day)} · ${count} research ${count === 1 ? "run" : "runs"}`}
              aria-label={`${fmt.format(day)}: ${count} research ${count === 1 ? "run" : "runs"} started`}
            />
          ))}
        </div>
        <div className="pulse-legend" aria-hidden="true">
          Less
          {[0, 1, 2, 3, 4].map((n) => (
            <span key={n} className={`pulse-cell level-${n}`} />
          ))}
          More
        </div>
      </div>
    </section>
  );
}
