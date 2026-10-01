import { BotAvatar, type BotAvatarType } from "bot-avatars";
import type { Agent, Run, Workflow } from "../shared/types";

export type MascotState = "default" | "working" | "sleeping";
export interface AgentProfile {
  id: string;
  name: string;
  role: string;
  type: BotAvatarType;
  color: string;
  match: RegExp;
}

// One cast for the whole product. Shapes and colours stay fixed per role so a
// specialist is recognisable wherever it appears.
export const director: AgentProfile = {
  id: "director",
  name: "Research director",
  role: "Plans the brief and writes the cited report",
  type: "droid",
  color: "#3d64f2",
  match: /director|lead|orchestr/i,
};
const cast: Record<string, AgentProfile> = {
  market: {
    id: "market",
    name: "Market researcher",
    role: "Market structure, size and segments",
    type: "clover",
    color: "#79aef8",
    match: /market/i,
  },
  competitors: {
    id: "competitors",
    name: "Competitor researcher",
    role: "Company comparison and positioning",
    type: "hexagon",
    color: "#ff9f67",
    match: /compet/i,
  },
  pricing: {
    id: "pricing",
    name: "Pricing researcher",
    role: "Public tariffs and calculation inputs",
    type: "star",
    color: "#f7c948",
    match: /pric/i,
  },
  regulation: {
    id: "regulation",
    name: "Regulation researcher",
    role: "Current rules, dates and jurisdiction",
    type: "drop",
    color: "#3cc6c0",
    match: /regulat|policy|legal/i,
  },
  discovery: {
    id: "discovery",
    name: "Company discovery",
    role: "Finds companies that match the ICP",
    type: "blob",
    color: "#5fcf86",
    match: /discover|prospect|find/i,
  },
  evidence: {
    id: "evidence",
    name: "Company evidence",
    role: "Fit evidence, needs and public contacts",
    type: "cat",
    color: "#f5d36b",
    match: /evidence|fit|contact|decision/i,
  },
  changes: {
    id: "changes",
    name: "Change tracker",
    role: "Compares new evidence with saved findings",
    type: "cloud",
    color: "#9cc8ff",
    match: /change|monitor|watch|track/i,
  },
  reviewer: {
    id: "reviewer",
    name: "Final reviewer",
    role: "Checks claims, sources and calculations",
    type: "pill",
    color: "#6f6cf6",
    match: /review|editor|final/i,
  },
  crm: {
    id: "crm",
    name: "CRM exporter",
    role: "Sends reviewed records through MCP",
    type: "square",
    color: "#7d8db5",
    match: /crm|export/i,
  },
};
export const playbooks: Record<Workflow, AgentProfile[]> = {
  market: [
    cast.market,
    cast.competitors,
    cast.pricing,
    cast.regulation,
    cast.reviewer,
  ],
  sales: [cast.discovery, cast.evidence, cast.reviewer],
  monitor: [cast.market, cast.competitors, cast.changes, cast.reviewer],
};
export const crmProfile = cast.crm;

const generic: AgentProfile = {
  id: "specialist",
  name: "Research specialist",
  role: "Delegated research task",
  type: "circle",
  color: "#a9a4f7",
  match: /.^/,
};
/** Map a reported agent to the cast by name; unknown names keep their own label. */
export function profileFor(agent: Pick<Agent, "name">): AgentProfile {
  const known =
    Object.values(cast).find((p) => p.match.test(agent.name)) ??
    (director.match.test(agent.name) ? director : undefined);
  return known ?? { ...generic, name: agent.name };
}
export const agentState = (status: string): MascotState =>
  ["in_progress", "running", "queued", "starting"].includes(status)
    ? status === "queued"
      ? "default"
      : "working"
    : ["failed", "cancelled", "error", "idle"].includes(status)
      ? "sleeping"
      : "default";
const active = (run: Run) =>
  ["starting", "running", "requires_action"].includes(run.status);
/** The director mirrors the actual run: busy while active, resting when stopped. */
export const directorState = (run: Run): MascotState =>
  active(run) && !run.cancelRequested
    ? "working"
    : run.status === "failed" || run.status === "cancelled" || run.nextCheckAt
      ? "sleeping"
      : "default";

export function Mascot({
  profile,
  size = 32,
  state = "default",
  paused = false,
  interactive = false,
  label,
}: {
  profile: AgentProfile;
  size?: number;
  state?: MascotState;
  paused?: boolean;
  interactive?: boolean;
  label?: string;
}) {
  return (
    <BotAvatar
      className="mascot"
      type={profile.type}
      color={profile.color}
      size={size}
      state={state}
      paused={paused}
      interactive={interactive}
      saturation={1.15}
      theme="light"
      seed={(profile.id.charCodeAt(0) % 10) / 10}
      aria-label={
        label ?? `${profile.name}, ${state === "default" ? "idle" : state}`
      }
      aria-hidden={label === "" ? true : undefined}
    />
  );
}

/** Overlapping mascots, used where a team is summarised. */
export function TeamStack({
  team,
  size = 26,
  lead = true,
}: {
  team: AgentProfile[];
  size?: number;
  lead?: boolean;
}) {
  const members = lead ? [director, ...team] : team;
  return (
    <span className="team-stack" aria-hidden="true">
      {members.map((p) => (
        <span className="team-stack-item" key={p.id}>
          <Mascot profile={p} size={size} paused label="" />
        </span>
      ))}
    </span>
  );
}
