export type Workflow = "market" | "sales" | "monitor";
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
  | "starting"
  | "running"
  | "requires_action"
  | "completed"
  | "failed"
  | "cancelled";
export interface Attachment {
  id: string;
  name: string;
  size: number;
  /** Local disk path (SQLite storage). Hosted storage keeps bytes in the database. */
  path?: string;
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
  /** Requested deliverable; "auto" picks from the brief and workflow. */
  outputFormat?: "auto" | "pdf" | "docx" | "csv" | "md";
  agentName?: string;
  baseModel?: string;
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
  defaultProvider?: ProviderId;
  providers?: ProviderConfiguration[];
  liveReady: boolean;
  model: string;
  crmReady: boolean;
  authRequired: boolean;
  api: string;
}
export const workflowLabels: Record<Workflow, string> = {
  market: "Market intelligence",
  sales: "Sales research",
  monitor: "Ongoing research",
};
