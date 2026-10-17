import { BotAvatar, type BotAvatarType } from "bot-avatars";
import { useTheme } from "./theme";
import type { Agent, Run } from "../shared/types";

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
export const reviewer = cast.reviewer;

/*
 * Research areas are planned per brief, so specialists are not fixed. Each
 * planned area gets its own named specialist; the shape and colour come from
 * this pool in order, so an area keeps the same mascot everywhere in a run.
 */
const areaPool: Array<Pick<AgentProfile, "type" | "color">> = [
  { type: "clover", color: "#79aef8" },
  { type: "hexagon", color: "#ff9f67" },
  { type: "drop", color: "#3cc6c0" },
  { type: "star", color: "#f7c948" },
  { type: "blob", color: "#5fcf86" },
  { type: "cat", color: "#f5d36b" },
  { type: "cloud", color: "#9cc8ff" },
  { type: "pebble", color: "#f2a58e" },
];
export function areaProfile(title: string, index: number): AgentProfile {
  const look = areaPool[index % areaPool.length];
  return {
    id: `area-${index}-${title}`,
    name: title,
    role: "Researches this area of your brief",
    ...look,
    match: /.^/,
  };
}
/** The team for a run: director, one specialist per agreed area, final reviewer. */
export function teamFor(run: Pick<Run, "plan">): AgentProfile[] | undefined {
  const areas = (run.plan?.areas ?? []).filter((a) => a.selected !== false);
  if (!areas.length) return undefined;
  return [...areas.map((a, i) => areaProfile(a.title, i)), reviewer];
}
export const crmProfile = cast.crm;

const generic: AgentProfile = {
  id: "specialist",
  name: "Research specialist",
  role: "Delegated research task",
  type: "circle",
  color: "#a9a4f7",
  match: /.^/,
};
const planAreas = (run?: Pick<Run, "plan">) =>
  (run?.plan?.areas ?? []).filter((a) => a.selected !== false);
/** A planned area whose title matches this name exactly, with its mascot. */
function areaByName(name: string, run?: Pick<Run, "plan">) {
  const key = name.trim().toLowerCase();
  const index = planAreas(run).findIndex((a) => a.title.toLowerCase() === key);
  return index >= 0
    ? areaProfile(planAreas(run)[index].title, index)
    : undefined;
}
/** Map a reported agent to a planned area or the cast by name; unknown names keep their own label. */
export function profileFor(
  agent: Pick<Agent, "name">,
  run?: Pick<Run, "plan">,
): AgentProfile {
  const area = areaByName(agent.name, run);
  if (area) return area;
  const known =
    Object.values(cast).find((p) => p.match.test(agent.name)) ??
    (director.match.test(agent.name) ? director : undefined);
  return known ?? { ...generic, name: agent.name };
}
/** The agent an activity entry was written by, matched by exact name only. */
export function authorOf(
  label: string,
  run?: Pick<Run, "plan">,
): AgentProfile | undefined {
  const area = areaByName(label, run);
  if (area) return area;
  const name = label.trim().toLowerCase();
  return [director, ...Object.values(cast)].find(
    (p) => p.name.toLowerCase() === name,
  );
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
  const { resolved } = useTheme();
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
      theme={resolved}
      seed={(profile.id.charCodeAt(0) % 10) / 10}
      aria-label={
        label ?? `${profile.name}, ${state === "default" ? "idle" : state}`
      }
      aria-hidden={label === "" ? true : undefined}
    />
  );
}
