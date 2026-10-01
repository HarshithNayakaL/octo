import { lazy, Suspense, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Asterisk,
  Building2,
  Check,
  ChevronDown,
  Clock3,
  FileText,
  Globe2,
  LayoutGrid,
  List,
  Paperclip,
  Plus,
  Radio,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { Arc } from "loading-dev";
import Select from "./Select";
import {
  workflowLabels,
  type Configuration,
  type Run,
  type Workflow,
} from "../shared/types";

const ActivityChart = lazy(() => import("./ActivityChart"));
const workflowIcons = { market: Globe2, sales: Building2, monitor: Radio };
const active = (r: Run) =>
  ["starting", "running", "requires_action"].includes(r.status);
const examples: Record<Workflow, { label: string; brief: string }[]> = {
  market: [
    {
      label: "Indian EV charging",
      brief:
        "Research the Indian EV charging market and prepare an investor briefing. Compare competitors, public pricing, regulation, and investment risks. Cite primary sources.",
    },
    {
      label: "Competitor landscape",
      brief:
        "Compare the leading research and market intelligence platforms. Research positioning, public pricing, differentiators, and customer segments. Cite primary sources.",
    },
  ],
  sales: [
    {
      label: "Find my next customers",
      brief:
        "Find companies that match my ideal customer profile. Investigate company size, public buying signals, decision makers, and potential needs. Support each match with evidence.",
    },
    {
      label: "Research an account",
      brief:
        "Build an evidence-backed account briefing for a company I specify, including industry, hiring, recent announcements, technology signals, and potential needs.",
    },
  ],
  monitor: [
    {
      label: "Follow a market",
      brief:
        "Keep researching the Indian EV charging market. Compare new company announcements, pricing changes, and regulations against the previous briefing. Highlight meaningful changes.",
    },
    {
      label: "Track a technology",
      brief:
        "Follow developments in AI research infrastructure over the next few days. Record dated primary sources and summarize meaningful changes between checks.",
    },
  ],
};

interface Props {
  page: "research" | "reports" | "monitors";
  runs: Run[];
  listed: Run[];
  config?: Configuration;
  loading: boolean;
  query: string;
  filter: string;
  setQuery: (s: string) => void;
  setFilter: (s: string) => void;
  onCreate: (workflow: Workflow, brief?: string) => void;
  onOpen: (id: string) => void;
  onSettings: () => void;
}

export default function Overview({
  page,
  runs,
  listed,
  config,
  loading,
  query,
  filter,
  setQuery,
  setFilter,
  onCreate,
  onOpen,
  onSettings,
}: Props) {
  const [workflow, setWorkflow] = useState<Workflow>(
    page === "monitors" ? "monitor" : "market",
  );
  const [brief, setBrief] = useState("");
  const [layout, setLayout] = useState<"grid" | "list">(() =>
    localStorage.getItem("research-layout") === "list" ? "list" : "grid",
  );
  const [statusFilter, setStatusFilter] = useState("all");
  const recent = listed.filter(
    (r) =>
      statusFilter === "all" ||
      (statusFilter === "active" ? active(r) : r.status === statusFilter),
  );
  const liveCount = runs.filter((r) => r.mode === "live").length;
  const reportCount = runs.filter((r) => r.status === "completed").length;
  const pending = runs.find(active);
  const latest = runs.find((r) => r.status === "completed");
  function changeLayout(next: "grid" | "list") {
    setLayout(next);
    localStorage.setItem("research-layout", next);
  }
  return (
    <main className="content overview">
      <div className="overview-heading">
        <div className="overview-title">
          <h1>
            {page === "reports"
              ? "Report library"
              : page === "monitors"
                ? "Ongoing research"
                : "Research overview"}
          </h1>
          <p>
            {page === "reports"
              ? "Manage completed reports, review sources, and continue your research."
              : page === "monitors"
                ? "Scheduled checks build on your previous findings. Your server keeps the work moving."
                : "Create, monitor, and manage your research projects."}
          </p>
        </div>
        <button
          className="primary"
          onClick={() => onCreate(page === "monitors" ? "monitor" : "market")}
        >
          <Plus size={16} />
          New research
        </button>
      </div>
      <section className="workspace-metrics" aria-label="Workspace summary">
        {[
          { label: "Research sessions", value: runs.length, icon: Globe2 },
          { label: "Completed reports", value: reportCount, icon: FileText },
          {
            label: "Active runs",
            value: runs.filter(active).length,
            icon: Radio,
          },
          {
            label: "Saved sources",
            value: runs.reduce((total, run) => total + run.sources.length, 0),
            icon: Search,
          },
        ].map((metric) => (
          <article className="metric-card" key={metric.label}>
            <div>
              <span>{metric.label}</span>
              <metric.icon size={17} />
            </div>
            <strong>{metric.value}</strong>
            <small>Includes demo sessions</small>
          </article>
        ))}
      </section>
      {page === "research" ? (
        <div className="discovery-layout">
          <section className="discovery-main" aria-label="New research brief">
            <div className="create-panel-heading">
              <h2>Create research</h2>
              <span>Choose a workflow and define your brief</span>
            </div>
            <div
              className="mode-selector"
              aria-label="Choose a research workflow"
            >
              {(["market", "sales", "monitor"] as Workflow[]).map((w) => {
                const Icon = workflowIcons[w];
                return (
                  <button
                    key={w}
                    aria-label={workflowLabels[w]}
                    aria-pressed={workflow === w}
                    className={workflow === w ? "selected" : ""}
                    onClick={() => setWorkflow(w)}
                  >
                    <Icon size={16} />
                    <span className="mode-full">{workflowLabels[w]}</span>
                    <span className="mode-short">
                      {w === "market"
                        ? "Market"
                        : w === "sales"
                          ? "Sales"
                          : "Ongoing"}
                    </span>
                    {workflow === w && <span className="mode-dot" />}
                  </button>
                );
              })}
            </div>
            <form
              className="brief-composer"
              onSubmit={(e) => {
                e.preventDefault();
                onCreate(workflow, brief);
              }}
            >
              <div className="composer-label">
                <span>
                  <FileText size={15} />
                  Research brief
                </span>
                <span>
                  {workflow === "sales"
                    ? "Company discovery"
                    : workflow === "monitor"
                      ? "Continuous research"
                      : "Market discovery"}
                </span>
              </div>
              <textarea
                aria-label="Your research question"
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder={
                  workflow === "sales"
                    ? "Find companies that fit our ICP."
                    : workflow === "monitor"
                      ? "Keep researching this topic."
                      : "Research a market. Prepare a briefing."
                }
                maxLength={20000}
                rows={3}
              />
              <div className="composer-bottom">
                <button
                  type="button"
                  className="attach-brief"
                  onClick={() => onCreate(workflow, brief)}
                >
                  <Paperclip size={16} />
                  <span>Add context</span>
                </button>
                <div className="composer-submit">
                  <span className="run-mode-label">
                    <span />
                    {config?.liveReady
                      ? "Live research available"
                      : "Demo mode"}
                  </span>
                  <button className="primary" type="submit">
                    <span>Configure research</span>
                    <ArrowRight size={17} />
                  </button>
                </div>
              </div>
            </form>
            <div className="prompt-suggestions">
              <span>Try a starting point</span>
              {examples[workflow].map((example) => (
                <button
                  key={example.label}
                  onClick={() => {
                    setBrief(example.brief);
                    document
                      .querySelector<HTMLTextAreaElement>(
                        ".brief-composer textarea",
                      )
                      ?.focus();
                  }}
                >
                  {example.label}
                  <ArrowUpRight size={13} />
                </button>
              ))}
            </div>
          </section>
          <aside className="workspace-insights">
            <section className="workspace-pulse">
              <div className="insight-heading">
                <h2>Workspace activity</h2>
                <span>7 days</span>
              </div>
              <div className="pulse-value">
                <strong>{runs.length}</strong>
                <div>
                  research sessions
                  <span>
                    {liveCount} live · {runs.length - liveCount} demo
                  </span>
                </div>
              </div>
              <Suspense
                fallback={
                  <div
                    className="activity-chart chart-placeholder"
                    aria-label="Loading workspace activity"
                  />
                }
              >
                <ActivityChart runs={runs} />
              </Suspense>
              <div className="pulse-footer">
                <span>
                  <i />
                  {reportCount} completed
                </span>
                <span>{runs.filter(active).length} in progress</span>
              </div>
            </section>
            {pending ? (
              <button
                className="resume-card"
                onClick={() => onOpen(pending.id)}
              >
                <div className="resume-top">
                  <Arc size={16} color="var(--accent)" />
                  <span>Research in progress</span>
                  <ArrowUpRight size={15} />
                </div>
                <h3>{pending.title}</h3>
                <p>Open the session to follow your team’s work.</p>
              </button>
            ) : latest ? (
              <button className="resume-card" onClick={() => onOpen(latest.id)}>
                <div className="resume-top">
                  <FileText size={16} />
                  <span>Pick up where you left off</span>
                  <ArrowUpRight size={15} />
                </div>
                <h3>{latest.title}</h3>
                <p>
                  {latest.mode === "demo"
                    ? "Illustrative briefing · demo research"
                    : "Saved briefing · ready to review"}
                </p>
              </button>
            ) : (
              <div className="first-research">
                <FileText size={20} />
                <h3>Your first briefing starts here.</h3>
                <p>Give the team a focused question to investigate.</p>
              </div>
            )}
          </aside>
        </div>
      ) : (
        <div className="library-intro">
          <span>
            {page === "reports"
              ? reportCount
              : runs.filter((r) => r.workflow === "monitor").length}
          </span>
          <div>
            {page === "reports"
              ? "completed briefings"
              : "ongoing research sessions"}
            <p>
              {page === "reports"
                ? "Every report keeps its evidence, notes, and follow-up context."
                : "Set an interval and a check count. Pause a schedule whenever you need."}
            </p>
          </div>
          <button
            className="primary"
            onClick={() => onCreate(page === "monitors" ? "monitor" : "market")}
          >
            <Plus size={16} />
            New research
          </button>
        </div>
      )}
      <section className="dossier-library">
        <div className="library-heading">
          <div>
            <h2>
              {page === "reports"
                ? "Saved reports"
                : page === "monitors"
                  ? "Your research schedules"
                  : "Recent research"}
            </h2>
            <span className="library-count">{recent.length}</span>
          </div>
          <div className="layout-controls" aria-label="Research layout">
            <button
              aria-label="Grid view"
              aria-pressed={layout === "grid"}
              className={layout === "grid" ? "selected" : ""}
              onClick={() => changeLayout("grid")}
            >
              <LayoutGrid size={16} />
            </button>
            <button
              aria-label="List view"
              aria-pressed={layout === "list"}
              className={layout === "list" ? "selected" : ""}
              onClick={() => changeLayout("list")}
            >
              <List size={18} />
            </button>
          </div>
        </div>
        <div className="library-toolbar">
          <div className="research-filters" aria-label="Research status">
            {[
              ["all", "All research"],
              ["active", "In progress"],
              ["completed", "Completed"],
            ].map(([value, label]) => (
              <button
                aria-pressed={statusFilter === value}
                className={statusFilter === value ? "selected" : ""}
                key={value}
                onClick={() => setStatusFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="library-tools">
            <label className="search-field">
              <Search size={15} />
              <input
                id="research-search"
                aria-label="Search research"
                placeholder="Find a briefing…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button aria-label="Clear search" onClick={() => setQuery("")}>
                  <X size={12} />
                </button>
              )}
            </label>
            <label className="filter-field">
              <SlidersHorizontal size={14} />
              <Select
                label="Filter by workflow"
                compact
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All workflows" },
                  { value: "market", label: "Market" },
                  { value: "sales", label: "Sales" },
                  { value: "monitor", label: "Ongoing" },
                ]}
              />
            </label>
          </div>
        </div>
        {loading ? (
          <div className="library-loading" role="status">
            <Arc size={22} />
            <span>Opening your workspace…</span>
          </div>
        ) : recent.length ? (
          <div
            className={`dossier-grid ${layout === "list" ? "list-layout" : ""}`}
          >
            {recent.map((run, i) => {
              const Icon = workflowIcons[run.workflow];
              return (
                <button
                  key={run.id}
                  className={`dossier-card ${active(run) ? "is-working" : ""}`}
                  aria-label={run.title}
                  onClick={() => onOpen(run.id)}
                >
                  <div className="dossier-card-top">
                    <span className={`dossier-type ${run.workflow}`}>
                      <Icon size={14} />
                      {workflowLabels[run.workflow]}
                    </span>
                    <ArrowUpRight className="dossier-open" size={17} />
                  </div>
                  <div className="dossier-body">
                    <span className="dossier-folio">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h3>{run.title}</h3>
                    <p>{run.brief}</p>
                  </div>
                  <div className="dossier-footer">
                    <span className={`dossier-status ${run.status}`}>
                      {active(run) ? (
                        <Arc size={12} />
                      ) : run.status === "completed" ? (
                        <Check size={12} />
                      ) : (
                        <Clock3 size={12} />
                      )}
                      <span>
                        {run.cancelRequested && active(run)
                          ? "Stopping"
                          : run.status.replaceAll("_", " ")}
                      </span>
                    </span>
                    <span className="dossier-mode">
                      {run.mode === "demo"
                        ? "Demo"
                        : new Intl.DateTimeFormat("en-IN", {
                            day: "numeric",
                            month: "short",
                          }).format(new Date(run.createdAt))}
                    </span>
                    {run.nextCheckAt && <Radio size={13} />}
                  </div>
                </button>
              );
            })}
            <button
              className="new-dossier"
              onClick={() =>
                onCreate(page === "monitors" ? "monitor" : "market")
              }
            >
              <span>
                <Plus size={23} strokeWidth={1.3} />
              </span>
              <h3>New research project</h3>
              <p>Create a brief and start a run.</p>
            </button>
          </div>
        ) : (
          <div className="empty">
            <Search size={25} />
            <h3>
              {query ? "No matching briefings" : "Room for your next question."}
            </h3>
            <p>
              {query
                ? "Try a different search or filter."
                : "Your reports and evidence will live here."}
            </p>
            <button
              className="secondary"
              onClick={() => {
                setStatusFilter("all");
                setFilter("all");
                setQuery("");
              }}
            >
              Reset filters
            </button>
          </div>
        )}
      </section>
      <footer className="overview-footer">
        <span>
          <span className="connection-dot" />
          Personal workspace · saved locally
        </span>
        <button onClick={onSettings}>
          {config?.liveReady
            ? "API configuration"
            : "Connect OpenAI for live research"}
          <ArrowUpRight size={13} />
        </button>
      </footer>
    </main>
  );
}
