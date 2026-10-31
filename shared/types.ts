export type Workflow = "general" | "market" | "sales" | "monitor";
export type ProviderId = "openai" | "google";
export interface ProviderConfiguration {
  id: ProviderId;
  name: string;
  ready: boolean;
  model: string;
  crmReady: boolean;
  agentName?: string;
  baseModel?: string;
}
export type RunStatus =
  | "draft"
  /** Reading the brief and files to prepare questions. */
  | "planning"
  /** Waiting for the user's answers before research starts. */
  | "awaiting_input"
  | "starting"
  | "running"
  | "requires_action"
  | "completed"
  | "failed"
  | "cancelled"
  /** Stopped early (time, token or provider limit) with a saved partial report. */
  | "partial";
export interface Attachment {
  id: string;
  name: string;
  size: number;
  /** Local disk path (SQLite storage). Hosted storage keeps bytes in the database. */
  path?: string;
}
/** A question asked before research, with suggested answers. */
export interface ClarifyQuestion {
  id: string;
  question: string;
  /** Why the answer changes the research. */
  why?: string;
  options: string[];
  multiple?: boolean;
}
/** A research area the agent proposes for this brief. */
export interface ResearchArea {
  title: string;
  focus: string;
  selected?: boolean;
}
/** What Octo understood from the brief and files, before any research. */
export interface ResearchPlan {
  understanding: string;
  outcome: string;
  areas: ResearchArea[];
  questions: ClarifyQuestion[];
}
export interface ClarifyAnswer {
  questionId: string;
  question: string;
  selected: string[];
  note?: string;
}
/** An unfinished report saved when research stopped early. */
export interface ReportPart {
  turnId: string;
  report: string;
  reason: string;
  at: string;
}
/** How well a cited source backs a claim, checked by fetching the source. */
export type ClaimStatus =
  | "supported"
  | "partial"
  | "not_found"
  | "unreachable"
  | "uncited";
export interface ClaimCheck {
  id: string;
  claim: string;
  /** Words or figures that should appear in the source if it backs the claim. */
  quote?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  status: ClaimStatus;
  /** What the check found: a matching excerpt or why it could not check. */
  note?: string;
  excerpt?: string;
}
/** Octo's own check of the report's citations against the cited pages. */
export interface EvidenceCheck {
  status: "pending" | "running" | "done" | "failed";
  /** Report length when checked, so a stale check can be detected. */
  reportLength: number;
  requestedAt: string;
  finishedAt?: string;
  method?: "model" | "heuristic";
  claims: ClaimCheck[];
  /** 0-100: supported claims count fully, partial ones half. */
  score?: number;
  error?: string;
}
/** A post or comment from a public community, quoted verbatim. */
export interface CommunityItem {
  id: string;
  source: "reddit" | "hackernews";
  /** Subreddit or story title, for context. */
  where: string;
  url: string;
  text: string;
  score?: number;
  at: string;
}
export interface CommunityTheme {
  title: string;
  summary: string;
  sentiment: "negative" | "mixed" | "positive" | "neutral";
  kind: "pain" | "wish" | "praise" | "workaround" | "other";
  /** Items that discuss this theme; quotes come from them verbatim. */
  itemIds: string[];
  quoteIds: string[];
}
/** What real people say about the topic, gathered from public discussions. */
export interface CommunityPulse {
  status: "pending" | "running" | "done" | "failed";
  requestedAt: string;
  finishedAt?: string;
  queries: string[];
  /** Items gathered per source before filtering. */
  scanned: Partial<Record<CommunityItem["source"], number>>;
  items: CommunityItem[];
  themes: CommunityTheme[];
  takeaway?: string;
  method?: "model" | "keywords";
  error?: string;
  /** Feed the findings into the research when it starts. */
  beforeResearch?: boolean;
}
export type SourceKind =
  | "government"
  | "academic"
  | "news"
  | "reference"
  | "company"
  | "forum"
  | "blog"
  | "other";
export const sourceKindLabels: Record<SourceKind, string> = {
  government: "Government & regulator",
  academic: "Research & official data",
  news: "News",
  reference: "Reference",
  company: "Company",
  forum: "Forum & social",
  blog: "Blog or review site",
  other: "Other",
};
/** What Octo knows about a source beyond its link. */
export interface SourceInfo {
  kind: SourceKind;
  /** Publication or last-updated date found on the page. */
  published?: string;
  /** The domain is on the run's blocked list. */
  blocked?: boolean;
  trusted?: boolean;
}
/** The user's rules for which sources the research should rely on. */
export interface SourcePolicy {
  prefer: "balanced" | "primary" | "academic";
  trust: string[];
  block: string[];
  /** Flag sources older than this many months. */
  freshMonths?: number;
}
/** Something the voice assistant asks the app to do; the person confirms it. */
export interface VoiceAction {
  type: "prepare_research";
  title: string;
  brief: string;
  workflow: Workflow;
  /** Absent when the person has not chosen; the research form asks. */
  depth?: import("./depth.js").Depth;
  /** A time limit the person asked for, in minutes. */
  minutes?: number;
}
/** A question answered only from this research. */
export interface QuestionAnswer {
  id: string;
  question: string;
  answer: string;
  coverage: "covered" | "partly" | "not_covered";
  claimIds: string[];
  /** A follow-up research instruction when the research does not answer it. */
  gap?: string;
  at: string;
}
/** An earlier report, kept when research is refreshed or followed up. */
export interface ReportVersion {
  id: string;
  at: string;
  label: string;
  report: string;
  sources: Source[];
  score?: number;
}
/** Earlier workspace research this run builds on, copied at creation. */
export interface PriorResearch {
  runId: string;
  title: string;
  at: string;
  summary: string;
}
export interface Source {
  title: string;
  url: string;
}
export interface Lead {
  company: string;
  website: string;
  industry: string;
  size: string;
  fit: "high" | "medium" | "low" | "unknown";
  evidence: string;
  needs: string;
  decisionMaker: string;
  sources: Source[];
}
export interface Activity {
  id: string;
  type: string;
  label: string;
  text: string;
  at: string;
}
export interface Agent {
  id: string;
  name: string;
  status: string;
}
export interface Artifact {
  id: string;
  path: string;
  turn_id?: string;
}
export interface Run {
  provider?: ProviderId;
  /** Questions and proposed areas prepared before research. */
  plan?: ResearchPlan;
  /** Set when the plan step failed; research can still start without it. */
  planError?: string;
  answers?: ClarifyAnswer[];
  /** Anything else the user added when answering. */
  extraContext?: string;
  /** Unfinished reports from earlier turns, oldest first. */
  reportParts?: ReportPart[];
  /** Why the engine asked the current turn to stop (time or token limit). */
  stopReason?: string;
  /** Requested deliverable; "auto" picks from the brief and workflow. */
  outputFormat?: "auto" | "pdf" | "docx" | "pptx" | "csv" | "md";
  evidence?: EvidenceCheck;
  community?: CommunityPulse;
  sourcePolicy?: SourcePolicy;
  /** Keyed by URL. */
  sourceInfo?: Record<string, SourceInfo>;
  questions?: QuestionAnswer[];
  versions?: ReportVersion[];
  priorResearch?: PriorResearch[];
  agentName?: string;
  baseModel?: string;
  /** The last instruction sent to the research agent, kept so a busy model can be retried on another. */
  lastInputText?: string;
  creationAttempted?: boolean;
  nextPollAt?: string;
  purpose?: "crm";
  id: string;
  title: string;
  workflow: Workflow;
  brief: string;
  icp: string;
  targetCount: number;
  mode: "demo" | "live";
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
  lastTurnId?: string;
  pendingInput?: {
    text: string;
    key: string;
    kind: "followup" | "crm";
    attempted?: boolean;
  };
  error?: string;
  report: string;
  leads: Lead[];
  sources: Source[];
  activities: Activity[];
  agents: Agent[];
  artifacts: Artifact[];
  attachments: Attachment[];
  notes: string;
  /** How far the research goes; older runs have none. */
  depth?: import("./depth.js").Depth;
  maxMinutes: number;
  maxTokens: number;
  startedAt?: string;
  tokenUsage?: number;
  cancelRequested?: boolean;
  intervalHours: number;
  remainingChecks: number;
  nextCheckAt?: string;
  budgetBaseline?: number;
  syncError?: string;
  model?: string;
  crmState?: "pending" | "completed" | "failed";
}
/**
 * OpenAI is billed per use, so live OpenAI work can be gated behind an access word.
 * "open": no gate. "word": unlockable with the server's word. "disabled": gated, no word configured.
 */
export type OpenAIAccess = "open" | "word" | "disabled";
export interface Configuration {
  openaiAccess?: OpenAIAccess;
  /** Where runs are stored and how background work is driven. */
  deployment?: "local" | "vercel";
  storage?: "sqlite" | "postgres";
  uploadLimitMb?: number;
  /** Voice assistant availability and the models behind it. */
  voice?: {
    available: boolean;
    provider?: string;
    live?: string;
    turn?: string;
    tts?: string;
  };
  /** The server runs a Node.js release with the October 2026 security fixes. */
  runtimePatched?: boolean;
  defaultProvider?: ProviderId;
  providers?: ProviderConfiguration[];
  liveReady: boolean;
  model: string;
  crmReady: boolean;
  authRequired: boolean;
  api: string;
}
export const workflowLabels: Record<Workflow, string> = {
  general: "Open research",
  market: "Market intelligence",
  sales: "Sales research",
  monitor: "Ongoing research",
};
