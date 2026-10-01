import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Search,
  Settings2,
  PanelLeftClose,
  Globe2,
  Building2,
  Radio,
  FolderOpen,
  FileText,
  Command,
  BookOpen,
  SlidersHorizontal,
  X,
  ChevronDown,
  ChevronLeft,
  Clock3,
  Download,
  Upload,
  Check,
  LoaderCircle,
  CircleHelp,
  Link2,
  Play,
  Square,
  ExternalLink,
  Users,
  Network,
  ShieldCheck,
  MoreHorizontal,
  AlertCircle,
  Paperclip,
  RefreshCw,
} from "lucide-react";
import Overview from "./OriginalOverview";
import SearchDialog from "./SearchDialog";
import Select from "./Select";
import { Arc } from "loading-dev";
import AsciiField from "./AsciiField";
import MiddleTruncate, { displayUrl } from "./MiddleTruncate";
import SlideConfirm from "./SlideConfirm";
import {
  Mascot,
  TeamStack,
  agentState,
  crmProfile,
  director,
  directorState,
  playbooks,
  profileFor,
} from "./agents";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, download } from "./api";
import {
  workflowLabels,
  type Run,
  type Workflow,
  type Configuration,
  type ProviderId,
} from "../shared/types";

const EvidenceRadar = lazy(() => import("./EvidenceRadar"));
type Page = "research" | "reports" | "monitors" | "connections";
const isActive = (run: Run) =>
  ["starting", "running", "requires_action"].includes(run.status);
const icons = { market: Globe2, sales: Building2, monitor: Radio };
const date = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

function Status({ run }: { run: Run }) {
  return (
    <span className={`status ${run.status}`}>
      <span />
      {run.cancelRequested && isActive(run)
        ? "Stopping"
        : run.status.replaceAll("_", " ")}
    </span>
  );
}
function Mark({ small = false }: { small?: boolean }) {
  return (
    <svg
      className={small ? "brand-mark small" : "brand-mark"}
      viewBox="0 0 36 36"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="18" cy="18" r="11" stroke="currentColor" strokeWidth="3.2" />
      <circle cx="18" cy="18" r="3.4" fill="currentColor" />
      <circle cx="30.5" cy="8.5" r="3" fill="currentColor" />
    </svg>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = box.current;
    const focusable = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          "button, input, textarea, select, a[href]",
        ) ?? [],
      ).filter(
        (el) =>
          !el.hasAttribute("disabled") &&
          el.tabIndex >= 0 &&
          el.getClientRects().length > 0,
      );
    focusable()[0]?.focus();
    const handler = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        document.querySelector("[data-research-select-content]")
      )
        return;
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const els = focusable();
        if (e.shiftKey && document.activeElement === els[0]) {
          e.preventDefault();
          els.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === els.at(-1)) {
          e.preventDefault();
          els[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [initialBrief, setInitialBrief] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [page, setPage] = useState<Page>("research");
  const [runs, setRuns] = useState<Run[]>([]);
  const [config, setConfig] = useState<Configuration>();
  const [selected, setSelected] = useState<Run>();
  const [newWorkflow, setNewWorkflow] = useState<Workflow>();
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sidebar, setSidebar] = useState(false);
  const [token, setToken] = useState("");
  const [locked, setLocked] = useState(false);
  const selectedId = useRef<string | undefined>(undefined);
  selectedId.current = selected?.id;
  async function refresh() {
    try {
      const [c, r] = await Promise.all([
        api<Configuration>("/config"),
        api<Run[]>("/runs"),
      ]);
      setConfig(c);
      setRuns(r);
      setLocked(false);
      setConnectionError("");
      if (selectedId.current) {
        const detail = await api<Run>("/runs/" + selectedId.current);
        if (selectedId.current === detail.id) setSelected(detail);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not connect";
      if (message.includes("access token")) setLocked(true);
      else setConnectionError(message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setSearchOpen((value) => !value);
      }
      if (event.key === "Escape") setSidebar(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const navigate = (next: Page) => {
    setPage(next);
    setSelected(undefined);
    setSidebar(false);
    setQuery("");
    setFilter("all");
  };
  const open = async (id: string) => {
    try {
      setSelected(await api<Run>("/runs/" + id));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const changed = (run: Run) => {
    setSelected(run);
    void refresh();
  };
  const counts = {
    active: runs.filter(isActive).length,
    reports: runs.filter((r) => r.status === "completed").length,
    sources: runs.reduce((n, r) => n + r.sources.length, 0),
  };
  const listed = runs
    .filter((r) =>
      page === "reports"
        ? r.status === "completed"
        : page === "monitors"
          ? r.workflow === "monitor"
          : true,
    )
    .filter(
      (r) =>
        (filter === "all" || r.workflow === filter) &&
        `${r.title} ${r.brief}`.toLowerCase().includes(query.toLowerCase()),
    );
  return (
    <div className={`app-shell ${collapsed ? "rail-collapsed" : ""}`}>
      <aside className={`sidebar ${sidebar ? "open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("research");
          }}
        >
          <Mark />
          <div>
            Octo<span>RESEARCH WORKSPACE</span>
          </div>
        </a>
        <div className="workspace-switch">
          <div className="workspace-avatar">P</div>
          <div>
            Personal workspace<span>Local · self-hosted</span>
          </div>
          <ChevronDown size={15} />
        </div>
        <button
          className="primary sidebar-new"
          onClick={() => setNewWorkflow("market")}
        >
          <Plus size={17} />
          New research
          <ArrowUpRight size={14} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button
            className={page === "research" && !selected ? "active" : ""}
            onClick={() => navigate("research")}
          >
            <Search size={18} />
            All research<span>{runs.length}</span>
          </button>
          <button
            className={page === "reports" && !selected ? "active" : ""}
            onClick={() => navigate("reports")}
          >
            <BookOpen size={18} />
            Reports<span>{counts.reports}</span>
          </button>
          <button
            className={page === "monitors" && !selected ? "active" : ""}
            onClick={() => navigate("monitors")}
          >
            <Radio size={18} />
            Ongoing research
          </button>
          <button
            className={page === "connections" && !selected ? "active" : ""}
            onClick={() => navigate("connections")}
          >
            <Network size={18} />
            Connections
          </button>
        </nav>
        <div className="nav-label recent-label">RECENT RESEARCH</div>
        <div className="recent-links">
          {runs.slice(0, 4).map((r) => (
            <button
              key={r.id}
              className={selected?.id === r.id ? "selected" : ""}
              onClick={() => void open(r.id)}
            >
              <FileText size={15} />
              <span>{r.title}</span>
            </button>
          ))}
          {!runs.length && <p>Your research will appear here.</p>}
        </div>
        <div className="sidebar-bottom">
          <div className="engine-card">
            <div>
              <span
                className={`connection-dot ${config?.liveReady ? "connected" : ""}`}
              />
              {config?.liveReady
                ? "API key configured"
                : "Explore in demo mode"}
            </div>
            <p>
              {config?.liveReady
                ? "Choose Google or OpenAI for live research."
                : "Try the workspace. Add your API key when you’re ready."}
            </p>
            <button onClick={() => setSettings(true)}>
              {config?.liveReady ? "View configuration" : "Connect a provider"}
              <ArrowUpRight size={14} />
            </button>
          </div>
          <button className="quiet" onClick={() => setHelp(true)}>
            <CircleHelp size={17} />
            Help & documentation
            <ArrowUpRight size={14} />
          </button>
          <button className="profile" onClick={() => setSettings(true)}>
            <span className="profile-avatar">P</span>
            <div>
              Personal workspace<small>Workspace settings</small>
            </div>
            <Settings2 size={17} />
          </button>
        </div>
      </aside>
      {sidebar && (
        <div className="sidebar-scrim" onClick={() => setSidebar(false)} />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="icon-button navigation-toggle"
              aria-label="Toggle navigation"
              onClick={() => {
                if (window.innerWidth <= 760) setSidebar(!sidebar);
                else setCollapsed(!collapsed);
              }}
            >
              <PanelLeftClose size={19} />
            </button>
            <span className="breadcrumb">
              Workspace <span>/</span>{" "}
              <b>
                {selected
                  ? selected.title
                  : page === "reports"
                    ? "Reports"
                    : page === "monitors"
                      ? "Ongoing research"
                      : page === "connections"
                        ? "Connections"
                        : "All research"}
              </b>
            </span>
          </div>
          <div className="top-actions">
            <button
              className="global-search"
              onClick={() => setSearchOpen(true)}
              aria-label="Search workspace"
            >
              <Search size={15} />
              <span>Search workspace</span>
              <kbd>Ctrl K</kbd>
            </button>
            <span className="local-pill">
              <span />
              Local workspace
            </span>
            <button
              className="icon-button"
              onClick={() => setHelp(true)}
              aria-label="Help"
            >
              <CircleHelp size={18} />
            </button>
            <button
              className="icon-button"
              onClick={() => setSettings(true)}
              aria-label="Settings"
            >
              <Settings2 size={18} />
            </button>
          </div>
        </header>
        {(error || connectionError) && (
          <div className="error-bar" role="alert">
            <AlertCircle size={17} />
            {error || connectionError}
            <button
              onClick={() => {
                setError("");
                setConnectionError("");
              }}
              aria-label="Dismiss error"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {locked ? (
          <main className="content">
            <div className="empty">
              <ShieldCheck size={32} />
              <h1>Unlock your workspace</h1>
              <p>Enter the APP_TOKEN configured on this server.</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sessionStorage.setItem("workspace-token", token);
                  void refresh();
                }}
              >
                <input
                  aria-label="Workspace access token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
                <button className="primary">Unlock workspace</button>
              </form>
            </div>
          </main>
        ) : selected ? (
          <RunDetail
            run={selected}
            config={config}
            onBack={() => setSelected(undefined)}
            onChange={changed}
            onError={setError}
          />
        ) : page === "connections" ? (
          <Connections config={config} onSettings={() => setSettings(true)} />
        ) : (
          <Overview
            page={page}
            runs={runs}
            listed={listed}
            config={config}
            loading={loading}
            query={query}
            filter={filter}
            setQuery={setQuery}
            setFilter={setFilter}
            onCreate={(workflow, brief = "") => {
              setInitialBrief(brief);
              setNewWorkflow(workflow);
            }}
            onOpen={(id) => void open(id)}
            onSettings={() => setSettings(true)}
          />
        )}
      </div>
      <SearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        runs={runs}
        onOpen={(id) => void open(id)}
        onCreate={(workflow) => {
          setInitialBrief("");
          setNewWorkflow(workflow);
        }}
        onSettings={() => setSettings(true)}
      />
      {newWorkflow && (
        <NewResearch
          workflow={newWorkflow}
          initialBrief={initialBrief}
          config={config}
          onClose={() => {
            setNewWorkflow(undefined);
            setInitialBrief("");
          }}
          onCreated={(run) => {
            setNewWorkflow(undefined);
            setInitialBrief("");
            setPage("research");
            changed(run);
          }}
        />
      )}
      {settings && (
        <Modal title="Workspace settings" onClose={() => setSettings(false)}>
          <div className="modal-body settings-body">
            {(config?.providers ?? []).map((profile) => (
              <div className="setting-status" key={profile.id}>
                <span
                  className={`connection-dot ${profile.ready ? "connected" : ""}`}
                />
                <div>
                  <b>
                    {profile.name} -{" "}
                    {profile.ready ? "key configured" : "not configured"}
                  </b>
                  <p>
                    {profile.model}. Access is verified by a successful live
                    request.
                  </p>
                </div>
              </div>
            ))}
            <h3>Connect Google for testing</h3>
            <p>
              Add your Google AI Studio key to the server's <code>.env</code>,
              then restart. Credentials stay on the server.
            </p>
            <pre>
              DEFAULT_PROVIDER=google{"\n"}GEMINI_API_KEY=your_key_here{"\n"}
              GEMINI_AGENT=antigravity-preview-09-2026{"\n"}
              GEMINI_MODEL=gemini-3.8-flash
            </pre>
            <p>
              Use a free-tier Google project to test within its quotas. Paid
              projects follow their billing settings. No automatic fallback to
              OpenAI occurs.
            </p>
            <h3>OpenAI remains available</h3>
            <pre>
              OPENAI_API_KEY=your_key_here{"\n"}OPENAI_MODEL=
              {config?.providers?.find((p) => p.id === "openai")?.model ??
                "gpt-6-astra"}
            </pre>
            <p>
              OpenAI requires Agents API access. Existing research keeps its
              original provider.
            </p>
            <div className="setting-line">
              <span>Storage</span>
              <b>Local SQLite · data/research.sqlite</b>
            </div>
            <div className="setting-line">
              <span>Default agent</span>
              <b>
                {config?.providers?.find((p) => p.id === config.defaultProvider)
                  ?.model ??
                  config?.model ??
                  "Not available"}
              </b>
            </div>
            <div className="setting-line">
              <span>API</span>
              <b>
                {config?.providers?.find((p) => p.id === config.defaultProvider)
                  ?.name ?? "OpenAI Agents API"}
              </b>
            </div>
            <div className="notice">
              <Clock3 size={18} />
              <p>
                Time and token limits request cancellation. Usage reporting can
                lag, and tools and sandboxes have separate charges. Use your
                Google or OpenAI project’s quota and billing controls for spend
                management.
              </p>
            </div>
            <a
              className="text-link"
              href="https://developers.openai.com/api/docs/guides/agents-api/quickstart"
              target="_blank"
              rel="noreferrer"
            >
              Open API setup guide
              <ExternalLink size={15} />
            </a>
          </div>
        </Modal>
      )}
      {help && (
        <Modal
          title="Built for questions worth asking"
          onClose={() => setHelp(false)}
        >
          <div className="modal-body settings-body">
            <p>
              Start with a clear brief, choose a workflow, and review the
              evidence before using the results.
            </p>
            <h3>How it works</h3>
            <ol>
              <li>
                A research director plans the work. OpenAI can delegate to
                specialists; Google investigates separate research passes.
              </li>
              <li>
                Specialists use web search and a hosted sandbox to inspect files
                and calculate.
              </li>
              <li>
                The director produces a cited report and structured company
                records.
              </li>
              <li>
                Follow-ups continue the same saved session. Scheduled checks run
                while the server is online.
              </li>
            </ol>
            <h3>Demo and live research</h3>
            <p>
              Demo runs illustrate the workflow with sample output. Live
              research requires a key with access to the selected provider.
              Source quality and model output still need human review.
            </p>
            <div className="help-links">
              <a
                href="https://ai.google.dev/gemini-api/docs/antigravity-agent"
                target="_blank"
                rel="noreferrer"
              >
                Google Antigravity documentation
                <ArrowUpRight size={16} />
              </a>
              <a
                href="https://developers.openai.com/api/docs/guides/agents-api/overview"
                target="_blank"
                rel="noreferrer"
              >
                Agents API documentation
                <ArrowUpRight size={16} />
              </a>
              <a
                href="https://developers.openai.com/api/docs/guides/agents-api/observability"
                target="_blank"
                rel="noreferrer"
              >
                Usage and accounting
                <ArrowUpRight size={16} />
              </a>
              <a
                href="https://platform.openai.com/usage"
                target="_blank"
                rel="noreferrer"
              >
                OpenAI project usage
                <ArrowUpRight size={16} />
              </a>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function NewResearch({
  workflow,
  initialBrief = "",
  config,
  onClose,
  onCreated,
}: {
  workflow: Workflow;
  initialBrief?: string;
  config?: Configuration;
  onClose: () => void;
  onCreated: (run: Run) => void;
}) {
  const [kind, setKind] = useState(workflow);
  const [title, setTitle] = useState(
    initialBrief ? initialBrief.replace(/\s+/g, " ").slice(0, 80) : "",
  );
  const [brief, setBrief] = useState(initialBrief);
  const [icp, setIcp] = useState("");
  const [count, setCount] = useState(10);
  const profiles = config?.providers ?? [
    {
      id: "openai" as const,
      name: "OpenAI Agents API",
      ready: Boolean(config?.liveReady),
      model: config?.model ?? "",
    },
  ];
  const [provider, setProvider] = useState<ProviderId>(
    config?.defaultProvider ?? "openai",
  );
  const profile = profiles.find((p) => p.id === provider);
  const [mode, setMode] = useState<"demo" | "live">(
    profile?.ready ? "live" : "demo",
  );
  const [minutes, setMinutes] = useState(5);
  const [tokens, setTokens] = useState(20000);
  const [interval, setIntervalHours] = useState(24);
  const [checks, setChecks] = useState(3);
  const [files, setFiles] = useState<
    { id: string; name: string; size: number }[]
  >([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  function example() {
    if (kind === "sales") {
      setTitle("India SaaS company shortlist");
      setBrief(
        "Find Indian B2B SaaS companies that could benefit from an analytics platform. Research public company information, hiring signals, and potential needs.",
      );
      setIcp(
        "B2B SaaS companies in India with 50–500 employees, a growing engineering team, and evidence of a data-intensive product. Exclude agencies and consulting firms.",
      );
    } else {
      setTitle("Indian EV charging market");
      setBrief(
        "Research the Indian EV charging market and prepare an investor briefing. Compare companies, public pricing, business models, current regulations, and investment risks. Cite primary sources and identify gaps in the evidence.",
      );
    }
  }
  async function addFile(file: File) {
    setError("");
    if (files.length >= 5) {
      setError("Attach up to five files.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const uploaded = await api<{ id: string; name: string; size: number }>(
        "/uploads",
        { method: "POST", body: form },
      );
      setFiles((prev) => [...prev, uploaded]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      onCreated(
        await api<Run>("/runs", {
          method: "POST",
          body: JSON.stringify({
            title,
            workflow: kind,
            brief,
            icp: kind === "sales" ? icp : "",
            targetCount: count,
            mode,
            provider,
            attachmentIds: files.map((f) => f.id),
            maxMinutes: minutes,
            maxTokens: tokens,
            intervalHours: interval,
            remainingChecks: kind === "monitor" ? checks : 0,
          }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <Modal title="Configure your research" onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="modal-body">
          <p className="modal-intro">
            Define the scope, add your context, and choose how far the research
            should go.
          </p>
          <div className="workflow-tabs">
            {(["market", "sales", "monitor"] as Workflow[]).map((w) => {
              const Icon = icons[w];
              return (
                <button
                  key={w}
                  type="button"
                  aria-pressed={kind === w}
                  className={kind === w ? "selected" : ""}
                  onClick={() => setKind(w)}
                >
                  <Icon size={17} />
                  {workflowLabels[w]}
                </button>
              );
            })}
          </div>
          <div className="team-preview">
            <TeamStack team={playbooks[kind]} size={28} />
            <p>
              <b>Your research team</b>
              {kind === "sales"
                ? "Discovery and evidence specialists, then a final review."
                : kind === "monitor"
                  ? "Builds the first briefing, then compares each check with saved findings."
                  : "Market, competitor, pricing and regulation passes, then a final review."}
              {provider === "google" &&
                " Google runs these as passes inside one Antigravity session."}
            </p>
          </div>
          <div className="form-topline">
            <label className="field grow">
              Research title
              <input
                autoComplete="off"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                minLength={3}
                maxLength={140}
                placeholder="e.g. Indian EV charging market"
              />
            </label>
            <button
              type="button"
              className="text-link sample-button"
              onClick={example}
            >
              Use an example
              <ArrowUpRight size={13} />
            </button>
          </div>
          <label className="field">
            Research brief
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              required
              minLength={15}
              maxLength={20000}
              rows={4}
              placeholder="What would you like to understand? Include geography, scope, comparisons, and the report you need."
            />
          </label>
          {kind === "sales" && (
            <>
              <label className="field">
                Ideal customer profile
                <textarea
                  value={icp}
                  onChange={(e) => setIcp(e.target.value)}
                  required
                  minLength={15}
                  maxLength={20000}
                  rows={3}
                  placeholder="Describe industry, size, geography, technology, buying signals, and exclusions. If uploading an ICP, explain how the agent should use it."
                />
              </label>
              <label className="field inline-field">
                Target companies
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                />
                <small>
                  Up to 100. A small budget may return fewer verified matches.
                </small>
              </label>
            </>
          )}
          <div className="file-attach">
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.csv,.txt,.md,.json,.xlsx,.docx"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void addFile(file);
              }}
            />
            <button
              type="button"
              className="secondary"
              disabled={uploading || files.length >= 5}
              onClick={() => fileInput.current?.click()}
            >
              {uploading ? <Arc size={15} /> : <Paperclip size={15} />}
              Attach context
            </button>
            <span>PDF, CSV, documents · 5 MB each · up to 5 files</span>
          </div>
          <div className="attached-files">
            {files.map((f) => (
              <div key={f.id}>
                <FileText size={14} />
                {f.name}
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => setFiles(files.filter((x) => x.id !== f.id))}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
          <label className="field">
            Research provider
            <Select
              label="Research provider"
              value={provider}
              onChange={(value) => {
                setProvider(value as ProviderId);
                if (!profiles.find((p) => p.id === value)?.ready)
                  setMode("demo");
              }}
              options={profiles.map((p) => ({ value: p.id, label: p.name }))}
            />
          </label>
          <div className="run-options">
            <label className="field">
              Run mode
              <Select
                label="Run mode"
                value={mode}
                onChange={(value) => setMode(value as "demo" | "live")}
                options={[
                  { value: "demo", label: "Demo · no API usage" },
                  {
                    value: "live",
                    label: `Live · your ${provider === "google" ? "Google" : "OpenAI"} project`,
                    disabled: !profile?.ready,
                  },
                ]}
              />
            </label>
            <label className="field">
              Time limit
              <Select
                label="Time limit"
                value={String(minutes)}
                onChange={(value) => setMinutes(Number(value))}
                options={[1, 3, 5, 10, 20, 30].map((n) => ({
                  value: String(n),
                  label: `${n} minute${n > 1 ? "s" : ""}`,
                }))}
              />
            </label>
            <label className="field">
              Token limit
              <Select
                label="Token limit"
                value={String(tokens)}
                onChange={(value) => setTokens(Number(value))}
                options={[5000, 10000, 20000, 50000, 100000].map((n) => ({
                  value: String(n),
                  label: n.toLocaleString(),
                }))}
              />
            </label>
          </div>
          {kind === "monitor" && (
            <div className="schedule-options">
              <label className="field">
                Check every
                <Select
                  label="Check every"
                  value={String(interval)}
                  onChange={(value) => setIntervalHours(Number(value))}
                  options={[
                    { value: "1", label: "Hour" },
                    { value: "6", label: "6 hours" },
                    { value: "24", label: "Day" },
                    { value: "168", label: "Week" },
                  ]}
                />
              </label>
              <label className="field">
                Follow-up checks
                <input
                  type="number"
                  min={0}
                  max={30}
                  value={checks}
                  onChange={(e) => setChecks(Number(e.target.value))}
                />
              </label>
              <p>
                Checks reuse the same session while your server is online. Every
                live check incurs API usage.
              </p>
            </div>
          )}
          <div className="notice">
            <ShieldCheck size={17} />
            <p>
              {mode === "demo"
                ? "Demo mode produces clearly labelled illustrative output. It does not research your topic or process attachments."
                : provider === "google"
                  ? "Google uses web search, a hosted sandbox, and saved interaction context. The native token budget is best effort. Free-tier availability and quotas depend on your Google project."
                  : "OpenAI uses web search, specialist agents, and a hosted sandbox. Limits request cancellation; they are not exact dollar caps."}
            </p>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="modal-footer">
          <button className="quiet" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={submitting || uploading}>
            {submitting ? <Arc size={16} /> : <ArrowRight size={16} />}
            Start {mode === "demo" ? "demo" : "research"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function Connections({
  config,
  onSettings,
}: {
  config?: Configuration;
  onSettings: () => void;
}) {
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">TOOLS FOR YOUR RESEARCH</div>
          <h1>Connect the bigger picture.</h1>
          <p>
            Bring your research engine and CRM together. Credentials stay on
            your server.
          </p>
        </div>
      </div>
      <div className="connection-grid">
        {(config?.providers ?? []).map((profile) => (
          <article className="connection-card" key={profile.id}>
            <Command size={30} />
            <h2>{profile.name}</h2>
            <p>
              {profile.id === "google"
                ? "Web research, hosted file processing, and saved context through Gemini Interactions. Free-tier project quotas apply."
                : "Durable research sessions, web search, managed specialists, and hosted file processing."}
            </p>
            <span className="connection-state">
              {profile.ready
                ? "Key configured  -  access verified by live requests"
                : "Not configured"}
            </span>
            <button className="secondary" onClick={onSettings}>
              View setup
              <ArrowUpRight size={16} />
            </button>
          </article>
        ))}
        <article className="connection-card">
          <Network size={30} />
          <h2>Your CRM, through MCP</h2>
          <p>
            Export reviewed company records through a remote MCP server with an
            explicit tool allowlist.
          </p>
          <span className="connection-state">
            {config?.crmReady
              ? "Endpoint configured · awaiting a live test"
              : "Not configured"}
          </span>
          <p className="code-hint">
            Set <code>CRM_MCP_URL</code>, <code>CRM_MCP_TOKEN</code> and{" "}
            <code>CRM_MCP_ALLOWED_TOOLS</code> in your server’s .env file.
          </p>
          <a
            className="text-link"
            target="_blank"
            rel="noreferrer"
            href="https://developers.openai.com/api/docs/guides/agents-api/tools/mcp"
          >
            MCP connection guide
            <ExternalLink size={15} />
          </a>
        </article>
      </div>
      <div className="notice connection-note">
        <ShieldCheck size={20} />
        <p>
          Research sessions cannot access CRM tools. An export starts a separate
          session only after you review and approve the results. No outreach is
          sent.
        </p>
      </div>
    </main>
  );
}

function RunDetail({
  run,
  config,
  onBack,
  onChange,
  onError,
}: {
  run: Run;
  config?: Configuration;
  onBack: () => void;
  onChange: (run: Run) => void;
  onError: (error: string) => void;
}) {
  const [tab, setTab] = useState("report");
  const [notes, setNotes] = useState(run.notes);
  const [noteDirty, setNoteDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [followup, setFollowup] = useState("");
  const [busy, setBusy] = useState(false);
  const [crm, setCrm] = useState(false);
  const [approved, setApproved] = useState(false);
  const [schedule, setSchedule] = useState(false);
  const [hours, setHours] = useState(run.intervalHours);
  const [checks, setChecks] = useState(run.remainingChecks);
  useEffect(() => {
    setNotes(run.notes);
    setNoteDirty(false);
    setTab("report");
    setSaved(false);
    setFollowup("");
  }, [run.id]);
  async function action(path: string, body: unknown = {}) {
    setBusy(true);
    try {
      onChange(
        await api<Run>(`/runs/${run.id}/${path}`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveNotes() {
    setBusy(true);
    try {
      await api(`/runs/${run.id}/notes`, {
        method: "PATCH",
        body: JSON.stringify({ notes }),
      });
      setNoteDirty(false);
      setSaved(true);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportFile(format: string) {
    try {
      await download(
        `/runs/${run.id}/export?format=${format}`,
        `${run.title.replace(/[^a-zA-Z0-9-]/g, "-")}.${format}`,
      );
    } catch (e) {
      onError((e as Error).message);
    }
  }
  const Icon = icons[run.workflow];
  return (
    <main className="content detail">
      <button className="back-button" onClick={onBack}>
        <ChevronLeft size={15} />
        All research
      </button>
      <div className="detail-heading">
        <div>
          <div className="detail-kicker">
            <Icon size={15} />
            {workflowLabels[run.workflow]}
            <span>·</span>
            {run.mode === "demo" ? "Demo research" : "Live research"}
          </div>
          <h1>{run.title}</h1>
          <div className="detail-meta">
            <Status run={run} />
            <span>Updated {date(run.updatedAt)}</span>
            {run.tokenUsage !== undefined && (
              <span>{run.tokenUsage.toLocaleString()} tokens reported</span>
            )}
          </div>
        </div>
        <div className="detail-actions">
          {isActive(run) ? (
            <button
              className="secondary"
              onClick={() => void action("cancel")}
              disabled={busy || run.cancelRequested}
            >
              <Square size={14} />
              Stop research
            </button>
          ) : run.workflow === "monitor" ? (
            <button className="secondary" onClick={() => setSchedule(true)}>
              <Clock3 size={15} />
              Schedule
            </button>
          ) : null}
          <button
            className="primary"
            disabled={!run.report}
            onClick={() => void exportFile("md")}
          >
            <Download size={15} />
            Download report
          </button>
        </div>
      </div>
      {run.mode === "demo" && (
        <div className="demo-banner">
          <span>DEMO</span>This run is illustrative. No live research or API
          calls were made.
        </div>
      )}
      {run.error && (
        <div className="notice error-notice">
          <AlertCircle size={18} />
          <p>{run.error}</p>
        </div>
      )}
      {run.syncError && (
        <div className="notice error-notice">
          <RefreshCw size={18} />
          <p>
            Progress sync interrupted: {run.syncError}. The saved session will
            be checked again; no duplicate session is created.
          </p>
        </div>
      )}
      {run.nextCheckAt && (
        <div className="schedule-banner">
          <Radio size={16} />
          Next check {date(run.nextCheckAt)} · {run.remainingChecks} checks
          remaining
          <button onClick={() => void action("cancel")}>Stop schedule</button>
        </div>
      )}
      <div className="detail-layout">
        <section className="report-panel">
          <div
            className="report-tabs"
            role="tablist"
            aria-label="Research output"
          >
            {[
              ["report", "Report", FileText],
              ["sources", `Sources (${run.sources.length})`, Link2],
              ...(run.workflow === "sales"
                ? [["companies", `Companies (${run.leads.length})`, Building2]]
                : []),
              ["notes", "Notes", BookOpen],
              ["files", "Files", FolderOpen],
            ].map(([key, label, Glyph]) => {
              const G = Glyph as typeof FileText;
              return (
                <button
                  role="tab"
                  aria-selected={tab === key}
                  className={tab === key ? "active" : ""}
                  key={key as string}
                  onClick={() => setTab(key as string)}
                >
                  <G size={15} />
                  {label as string}
                </button>
              );
            })}
          </div>
          <div className="report-content" role="tabpanel">
            {tab === "report" &&
              (run.report ? (
                <>
                  <div className="report-toolbar">
                    <span>
                      {run.purpose === "crm"
                        ? "CRM EXPORT RESULTS"
                        : "RESEARCH BRIEFING"}
                    </span>
                    <button onClick={() => void exportFile("json")}>
                      Export JSON
                      <Download size={14} />
                    </button>
                  </div>
                  <div className="markdown">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ href, children }) => (
                          <a href={href} target="_blank" rel="noreferrer">
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {run.report}
                    </ReactMarkdown>
                  </div>
                </>
              ) : (
                <div className={`working-state ${isActive(run) ? "live" : ""}`}>
                  {isActive(run) ? (
                    <div className="working-scan">
                      <AsciiField />
                      <Mascot
                        profile={director}
                        size={64}
                        state={run.cancelRequested ? "default" : "working"}
                      />
                    </div>
                  ) : (
                    <AlertCircle size={32} />
                  )}
                  <h2>
                    {isActive(run)
                      ? "Looking at the bigger picture."
                      : "No report available yet."}
                  </h2>
                  <p>
                    {isActive(run)
                      ? "Your research director is coordinating the work. Saved activity appears as the API makes it available."
                      : "Review the activity and error details. You can continue a saved session or start new research."}
                  </p>
                  <div className="brief-preview">
                    <span>YOUR BRIEF</span>
                    <p>{run.brief}</p>
                  </div>
                </div>
              ))}
            {tab === "sources" && (
              <div className="source-list">
                <h2>The evidence behind the report</h2>
                <p className="muted">
                  {run.mode === "demo"
                    ? "Demo links illustrate the format and are not researched sources."
                    : "Source links extracted from the report and structured research output. Verify the cited claim against the original."}
                </p>
                {run.sources.map((source, i) => (
                  <a
                    key={source.url + i}
                    className="source-row"
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="source-index">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <b>{source.title}</b>
                      <MiddleTruncate text={displayUrl(source.url)} tail={18} />
                    </div>
                    <ExternalLink size={16} />
                  </a>
                ))}
                {!run.sources.length && (
                  <div className="empty compact">
                    <Link2 size={28} />
                    <p>
                      {isActive(run)
                        ? "Sources will appear with the saved report."
                        : "No source links were returned for this report."}
                    </p>
                  </div>
                )}
              </div>
            )}
            {tab === "companies" && (
              <>
                <div className="companies-top">
                  <div>
                    <h2>Company shortlist</h2>
                    <p>
                      {run.leads.length} records · target {run.targetCount}
                    </p>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => void exportFile("csv")}
                    disabled={!run.leads.length}
                  >
                    <Download size={15} />
                    CSV
                  </button>
                </div>
                {run.leads.length > 0 && (
                  <div className="evidence-panel">
                    <div>
                      <h3>Evidence coverage</h3>
                      <p>
                        Share of the {run.leads.length} saved records carrying
                        each kind of evidence. Low coverage means verify before
                        outreach.
                      </p>
                      <div className="fit-bars">
                        {(["high", "medium", "low", "unknown"] as const).map(
                          (fit) => {
                            const n = run.leads.filter(
                              (l) => l.fit === fit,
                            ).length;
                            return (
                              <div key={fit}>
                                <span>
                                  {fit[0].toUpperCase() + fit.slice(1)} fit
                                </span>
                                <i>
                                  <em
                                    className={`fit-bar ${fit}`}
                                    style={{
                                      width: `${(n / run.leads.length) * 100}%`,
                                    }}
                                  />
                                </i>
                                <b>{n}</b>
                              </div>
                            );
                          },
                        )}
                      </div>
                    </div>
                    <Suspense fallback={<div className="evidence-radar" />}>
                      <EvidenceRadar leads={run.leads} />
                    </Suspense>
                  </div>
                )}
                <div className="lead-list">
                  {run.leads.map((lead, i) => (
                    <article className="lead-card" key={lead.company + i}>
                      <div>
                        <a href={lead.website} target="_blank" rel="noreferrer">
                          <h3>
                            {lead.company}
                            <ArrowUpRight size={15} />
                          </h3>
                        </a>
                        <span className={`fit ${lead.fit}`}>
                          {lead.fit} fit
                        </span>
                      </div>
                      <p className="muted">
                        {lead.industry} · {lead.size}
                      </p>
                      <dl>
                        <dt>Fit evidence</dt>
                        <dd>{lead.evidence}</dd>
                        <dt>Potential need · hypothesis</dt>
                        <dd>{lead.needs}</dd>
                        <dt>Decision maker</dt>
                        <dd>{lead.decisionMaker}</dd>
                      </dl>
                      <div className="lead-sources">
                        {lead.sources.map((s, j) => (
                          <a
                            key={j}
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Link2 size={12} />
                            {s.title}
                          </a>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
                {!run.leads.length && (
                  <div className="empty compact">
                    <Building2 size={28} />
                    <p>
                      No structured company records yet. A partial report may
                      still be available.
                    </p>
                  </div>
                )}
                {run.leads.length > 0 && (
                  <div className="crm-footer">
                    <div>
                      <h3>Ready for your CRM?</h3>
                      <p>
                        Review every company and its evidence before exporting.
                      </p>
                    </div>
                    <button
                      className="primary"
                      disabled={
                        run.mode === "demo" ||
                        !config?.crmReady ||
                        run.status !== "completed"
                      }
                      onClick={() => {
                        setApproved(false);
                        setCrm(true);
                      }}
                    >
                      Review export
                      <ArrowRight size={15} />
                    </button>
                    {(!config?.crmReady || run.mode === "demo") && (
                      <small>
                        {run.mode === "demo"
                          ? "Demo companies cannot be sent to your CRM."
                          : "Configure a CRM MCP in Connections to enable export."}
                      </small>
                    )}
                  </div>
                )}
              </>
            )}
            {tab === "notes" && (
              <div className="notes-view">
                <h2>Your research notes</h2>
                <p className="muted">
                  Personal notes are saved locally. Include them in a follow-up
                  message if you want the agent to use them.
                </p>
                <textarea
                  aria-label="Research notes"
                  rows={14}
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    setNoteDirty(true);
                    setSaved(false);
                  }}
                  placeholder="Questions, interpretations, and things to follow up on…"
                />
                <div>
                  <span>
                    {noteDirty
                      ? "Unsaved changes"
                      : saved
                        ? "Notes saved"
                        : "Saved locally"}
                  </span>
                  <button
                    className="primary"
                    disabled={busy || !noteDirty}
                    onClick={() => void saveNotes()}
                  >
                    <Check size={15} />
                    Save notes
                  </button>
                </div>
              </div>
            )}
            {tab === "files" && (
              <div className="files-view">
                <h2>Files & artifacts</h2>
                <p className="muted">
                  Outputs are collected after research completes. Google files
                  are cached locally so later follow-ups cannot overwrite the
                  saved copies.
                </p>
                {run.attachments.map((f) => (
                  <div className="file-row" key={f.id}>
                    <FileText size={18} />
                    <div>
                      <b>{f.name}</b>
                      <span>Input · {(f.size / 1024).toFixed(1)} KB</span>
                    </div>
                  </div>
                ))}
                {run.artifacts.map((f) => (
                  <div className="file-row" key={f.id}>
                    <FileText size={18} />
                    <div>
                      <b>{f.path.split("/").at(-1)}</b>
                      <MiddleTruncate text={f.path} tail={20} />
                      <span>
                        {run.provider === "google"
                          ? "Cached Google output"
                          : "Published output"}
                      </span>
                    </div>
                    <button
                      className="icon-button"
                      aria-label={`Download ${f.path}`}
                      onClick={() =>
                        void download(
                          `/runs/${run.id}/artifacts/${f.id}`,
                          f.path.split("/").at(-1) ?? "artifact",
                        ).catch((e) => onError(e.message))
                      }
                    >
                      <Download size={17} />
                    </button>
                  </div>
                ))}
                {!run.attachments.length && !run.artifacts.length && (
                  <div className="empty compact">
                    <FolderOpen size={30} />
                    <p>No attached files or published artifacts.</p>
                  </div>
                )}
                <button
                  className="secondary"
                  disabled={!run.report}
                  onClick={() => void exportFile("json")}
                >
                  <Download size={15} />
                  Download research JSON
                </button>
              </div>
            )}
          </div>
          {(!isActive(run) && run.sessionId !== undefined) ||
          (!isActive(run) && run.mode === "demo") ? (
            <form
              className="followup"
              onSubmit={(e) => {
                e.preventDefault();
                if (followup.trim())
                  void action("followup", { message: followup }).then(() =>
                    setFollowup(""),
                  );
              }}
            >
              <label htmlFor="follow-up">Keep the research going</label>
              <div>
                <input
                  id="follow-up"
                  required
                  minLength={5}
                  maxLength={20000}
                  value={followup}
                  onChange={(e) => setFollowup(e.target.value)}
                  placeholder="Ask a follow-up using this session’s saved context…"
                />
                <button
                  className="primary"
                  disabled={
                    busy || followup.trim().length < 5 || run.purpose === "crm"
                  }
                  aria-label="Send follow-up"
                >
                  <ArrowRight size={18} />
                </button>
              </div>
            </form>
          ) : null}
        </section>
        <aside className="activity-panel">
          <div className="activity-heading">
            <h2>Research activity</h2>
            {isActive(run) && (
              <span className="activity-live">
                <span />
                Working
              </span>
            )}
          </div>
          <div className="director-card">
            <span className="director-icon mascot-frame">
              <Mascot
                profile={run.purpose === "crm" ? crmProfile : director}
                size={36}
                state={directorState(run)}
                interactive
              />
            </span>
            <div>
              <b>Research director</b>
              <span>
                {isActive(run)
                  ? "Coordinating the research"
                  : run.status === "completed"
                    ? "Research saved"
                    : "Session overview"}
              </span>
            </div>
          </div>
          {run.agents.length > 0 ? (
            <div className="agent-list">
              <div className="small-label">
                {run.mode === "demo" ? "DEMO SPECIALISTS" : "SPECIALIST AGENTS"}
              </div>
              {run.agents.map((a) => {
                const profile = profileFor(a);
                return (
                  <div key={a.id}>
                    <Mascot
                      profile={profile}
                      size={24}
                      state={agentState(a.status)}
                      paused={a.status === "completed"}
                    />
                    <span>{a.name}</span>
                    {a.status === "completed" ? (
                      <Check size={13} />
                    ) : a.status === "in_progress" || a.status === "running" ? (
                      <Arc size={13} />
                    ) : (
                      <span className="muted agent-status">
                        {a.status.replaceAll("_", " ")}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : run.purpose !== "crm" ? (
            <div className="agent-list planned">
              <div className="small-label">
                {run.provider === "google"
                  ? "RESEARCH PASSES"
                  : "RESEARCH PLAN"}
              </div>
              {playbooks[run.workflow].map((profile) => (
                <div key={profile.id}>
                  <Mascot profile={profile} size={24} paused label="" />
                  <span>{profile.name}</span>
                </div>
              ))}
              <p className="planned-note">
                {run.provider === "google"
                  ? "Planned passes inside one Antigravity session. Google does not report separate specialist activity."
                  : "Specialists appear here when the API reports them."}
              </p>
            </div>
          ) : null}
          <div className="activity-feed">
            <div className="small-label">SAVED ACTIVITY</div>
            {run.activities
              .slice()
              .reverse()
              .slice(0, 30)
              .map((activity) => (
                <div className="activity-item" key={activity.id}>
                  <span className="timeline-dot" />
                  <div>
                    <div>
                      <b>{activity.label}</b>
                      <time>
                        {new Date(activity.at).toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    <p>{activity.text}</p>
                  </div>
                </div>
              ))}
          </div>
          <div className="session-info">
            <div>
              <Clock3 size={14} />
              {run.provider === "google"
                ? "Google Antigravity"
                : "OpenAI Agents API"}
            </div>
            <div>
              <Clock3 size={14} />
              {run.maxMinutes} minute limit
            </div>
            <div>
              <SlidersHorizontal size={14} />
              {run.maxTokens.toLocaleString()} token limit
            </div>
            {run.sessionId && (
              <p>
                Session <code>{run.sessionId}</code>
              </p>
            )}
            <small>
              {run.mode === "demo"
                ? "Demo · no API usage"
                : "Usage is best effort, not a final bill."}
            </small>
          </div>
        </aside>
      </div>
      {crm && (
        <Modal title="Review CRM export" onClose={() => setCrm(false)}>
          <div className="modal-body">
            <p>
              Export {run.leads.length} company records to your configured CRM
              MCP. The agent will match records by website, update existing
              companies, and report the outcome in a separate export session.
            </p>
            <div className="export-preview">
              {run.leads.map((l) => (
                <div key={l.website}>
                  <b>{l.company}</b>
                  <span>{l.website}</span>
                </div>
              ))}
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
              />
              I have reviewed these records and approve exporting them to my
              CRM.
            </label>
          </div>
          <footer className="modal-footer">
            <button className="quiet" onClick={() => setCrm(false)}>
              Cancel
            </button>
            <SlideConfirm
              key={String(approved)}
              label="Slide to export approved records"
              disabled={!approved || busy}
              onConfirm={() =>
                void action("crm", { approved: true }).then(() => setCrm(false))
              }
            />
          </footer>
        </Modal>
      )}
      {schedule && (
        <Modal title="Research schedule" onClose={() => setSchedule(false)}>
          <div className="modal-body">
            <p>
              Continue the same research session at a regular interval. The
              server must stay online. Each live check can incur model, tool,
              and sandbox costs.
            </p>
            <label className="field">
              Hours between checks
              <input
                type="number"
                min={1}
                max={168}
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
              />
            </label>
            <label className="field">
              Remaining checks
              <input
                type="number"
                min={0}
                max={30}
                value={checks}
                onChange={(e) => setChecks(Number(e.target.value))}
              />
            </label>
          </div>
          <footer className="modal-footer">
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void action("schedule", {
                  intervalHours: hours,
                  remainingChecks: checks,
                }).then(() => setSchedule(false))
              }
            >
              Save schedule
              <Check size={15} />
            </button>
          </footer>
        </Modal>
      )}
    </main>
  );
}
