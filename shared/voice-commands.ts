import type { Depth } from "./depth.js";
import type { ProviderId, Workflow } from "./types.js";
import type { OutputChoice } from "./formats.js";

/**
 * Things the voice assistant can do in Octo. The model calls them as tools;
 * the browser runs them through the same API the buttons use, so they follow
 * the same rules (one active run, OpenAI lock, validation).
 */
export const commandNames = [
  "start_research",
  "submit_research_form",
  "start_from_plan",
  "cancel_research",
  "continue_research",
  "follow_up",
  "open_research",
  "go_to",
  "download_report",
  "check_evidence",
  "ask_research",
  "refresh_research",
  "challenge_report",
  "gather_voices",
  "schedule_checks",
  "save_note",
  "set_theme",
] as const;
export type CommandName = (typeof commandNames)[number];

export const commandPages = [
  "all research",
  "reports",
  "ongoing research",
  "connections",
  "settings",
  "help",
] as const;
export const commandFormats = [
  "pdf",
  "docx",
  "pptx",
  "csv",
  "md",
  "json",
] as const;

export const commandDeliverables = [
  "auto",
  "pdf",
  "docx",
  "pptx",
  "csv",
  "md",
] as const satisfies readonly OutputChoice[];
export const commandThemes = ["light", "dark", "system"] as const;

export interface VoiceCommand {
  name: CommandName;
  title?: string;
  brief?: string;
  workflow?: Workflow;
  depth?: Depth;
  /** A time limit the person asked for, in minutes (1-180). */
  minutes?: number;
  /** A token budget the person asked for (10,000-2,000,000). */
  tokens?: number;
  deliverable?: (typeof commandDeliverables)[number];
  provider?: ProviderId;
  /** Let Octo ask its planning questions before researching. */
  askQuestions?: boolean;
  /** Gather Reddit and Hacker News discussions first. */
  community?: boolean;
  question?: string;
  everyHours?: number;
  checks?: number;
  theme?: (typeof commandThemes)[number];
  note?: string;
  message?: string;
  page?: (typeof commandPages)[number];
  format?: (typeof commandFormats)[number];
}

const workflows: Workflow[] = ["general", "market", "sales", "monitor"];
const depthValues: Depth[] = ["quick", "standard", "deep"];

/** A spoken time limit in whole minutes (1-180), or undefined. */
export function parseMinutes(value: unknown) {
  const minutes = Math.round(Number(value));
  return Number.isFinite(minutes) && minutes >= 1
    ? Math.min(180, minutes)
    : undefined;
}

/** A spoken token budget, kept within what the server accepts. */
export function parseTokens(value: unknown) {
  const tokens = Math.round(Number(value));
  return Number.isFinite(tokens) && tokens > 0
    ? Math.min(2_000_000, Math.max(10_000, tokens))
    : undefined;
}
const bool = (value: unknown) =>
  typeof value === "boolean" ? value : value === "true" ? true : undefined;
const int = (value: unknown, min: number, max: number) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= min ? Math.min(max, n) : undefined;
};
const lower = (value: unknown) =>
  typeof value === "string" ? value.toLowerCase().trim() : value;

const text = (value: unknown, max: number) =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : undefined;
const oneOf = <T extends string>(value: unknown, list: readonly T[]) =>
  list.includes(value as T) ? (value as T) : undefined;

/** Clean a tool call from the model into a command, or undefined if it is not one. */
export function parseCommand(
  name: unknown,
  args: Record<string, unknown> = {},
): VoiceCommand | undefined {
  const command = oneOf(name, commandNames);
  if (!command) return undefined;
  return {
    name: command,
    title: text(args.title, 140),
    brief: text(args.brief, 4000),
    workflow: oneOf(args.workflow, workflows),
    depth: oneOf(args.depth, depthValues),
    minutes: parseMinutes(args.minutes),
    note: text(args.note, 2000),
    message: text(args.message, 4000),
    tokens: parseTokens(args.tokens),
    deliverable: oneOf(lower(args.deliverable), commandDeliverables),
    provider: oneOf(lower(args.provider), ["google", "openai"] as const),
    askQuestions: bool(args.ask_questions),
    community: bool(args.community),
    question: text(args.question, 1000),
    everyHours: int(args.every_hours, 1, 168),
    checks: int(args.checks, 0, 30),
    page: oneOf(lower(args.page), commandPages),
    format: oneOf(lower(args.format), commandFormats),
    theme: oneOf(lower(args.theme), commandThemes),
  };
}

/** Depth implied by a time limit, when the person gave a time but no depth. */
export const depthForMinutes = (minutes: number): Depth =>
  minutes <= 5 ? "quick" : minutes <= 20 ? "standard" : "deep";

const minutesParam = {
  type: "integer",
  description:
    "Only when the person names a time, such as 'in 3 minutes': that time in minutes (1-180). Research is stopped at this limit and the report written by then is kept.",
};
const research = {
  title: { type: "string", description: "Short title, at most 80 characters." },
  brief: {
    type: "string",
    description:
      "The research question with scope, geography, timeframe and the outcome the person wants, in 2-5 sentences.",
  },
  workflow: {
    type: "string",
    enum: workflows,
    description:
      "general for most questions, market for market briefings, sales for finding companies, monitor for tracking a topic over time.",
  },
  depth: {
    type: "string",
    enum: depthValues,
    description:
      "quick (a direct answer, about 5 minutes), standard (about 20 minutes) or deep (every area, up to an hour).",
  },
  minutes: minutesParam,
  tokens: {
    type: "integer",
    description:
      "Only when the person names a token budget, such as 'under 50k tokens': the number of tokens (10000-2000000).",
  },
  deliverable: {
    type: "string",
    enum: commandDeliverables,
    description:
      "The form they want: pdf report, docx (Word), pptx (PowerPoint deck), csv (spreadsheet), md, or auto to pick from the request.",
  },
  provider: {
    type: "string",
    enum: ["google", "openai"],
    description: "Only if the person asks for a specific provider.",
  },
  ask_questions: {
    type: "boolean",
    description:
      "true only if the person wants Octo to ask its planning questions before researching.",
  },
  community: {
    type: "boolean",
    description:
      "true if they want what real people say on Reddit and Hacker News included.",
  },
};

/** Gemini function declarations for the commands. */
export const commandTools = [
  {
    name: "start_research",
    description:
      "Start new research right away, without the form. Use when the person asks you to start, run or go ahead with research. It begins immediately and opens on screen.",
    parameters: {
      type: "object",
      properties: research,
      required: ["title", "brief", "workflow"],
    },
  },
  {
    name: "submit_research_form",
    description:
      "Press Continue on the research form that is open on screen, starting that research. Use after prepare_research when the person says to go ahead.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "start_from_plan",
    description:
      "For research waiting for answers to its plan questions: start it. Put the person's answers or extra instructions in note, or leave note empty to start without answering.",
    parameters: {
      type: "object",
      properties: {
        note: {
          type: "string",
          description: "The person's answers or instructions in their words.",
        },
      },
    },
  },
  {
    name: "cancel_research",
    description:
      "Stop the research that is running or waiting. Confirm with the person before calling.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "continue_research",
    description:
      "Continue research that stopped early with a partial report, optionally with an instruction in note.",
    parameters: {
      type: "object",
      properties: { note: { type: "string" } },
    },
  },
  {
    name: "follow_up",
    description:
      "Send a follow-up request on the open research, for example 'add a section on pricing'. The agent revises the report.",
    parameters: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    },
  },
  {
    name: "open_research",
    description:
      "Open a piece of research by its title (a close match is fine).",
    parameters: {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
    },
  },
  {
    name: "go_to",
    description: "Open a page of Octo.",
    parameters: {
      type: "object",
      properties: { page: { type: "string", enum: commandPages } },
      required: ["page"],
    },
  },
  {
    name: "download_report",
    description:
      "Download the open research's report: pdf, docx (Word), pptx (PowerPoint), csv, md or json.",
    parameters: {
      type: "object",
      properties: { format: { type: "string", enum: commandFormats } },
      required: ["format"],
    },
  },
  {
    name: "check_evidence",
    description: "Re-run Octo's citation check on the open research's report.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "ask_research",
    description:
      "Answer a question only from the open research's report and sources, with a note on how well the report covers it.",
    parameters: {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
    },
  },
  {
    name: "refresh_research",
    description:
      "Bring the open finished report up to date with newer information; the old report is kept as a version.",
    parameters: {
      type: "object",
      properties: { note: { type: "string" } },
    },
  },
  {
    name: "challenge_report",
    description:
      "Have the agent look for weak claims, gaps and counter-evidence in the open report and revise it.",
    parameters: {
      type: "object",
      properties: { note: { type: "string" } },
    },
  },
  {
    name: "gather_voices",
    description:
      "Collect what people say about the open research's topic on Reddit and Hacker News.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "schedule_checks",
    description:
      "For ongoing research only: repeat it on a schedule to catch changes: every_hours between checks and how many checks (0 stops them).",
    parameters: {
      type: "object",
      properties: {
        every_hours: { type: "integer", description: "1, 6, 24 or 168." },
        checks: { type: "integer", description: "0-30." },
      },
      required: ["every_hours", "checks"],
    },
  },
  {
    name: "save_note",
    description: "Add a line to the open research's notes.",
    parameters: {
      type: "object",
      properties: { note: { type: "string" } },
      required: ["note"],
    },
  },
  {
    name: "set_theme",
    description: "Switch Octo to light mode, dark mode, or follow the system.",
    parameters: {
      type: "object",
      properties: { theme: { type: "string", enum: commandThemes } },
      required: ["theme"],
    },
  },
];
