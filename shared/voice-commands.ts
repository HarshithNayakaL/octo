import type { Depth } from "./depth.js";
import type { Workflow } from "./types.js";

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

export interface VoiceCommand {
  name: CommandName;
  title?: string;
  brief?: string;
  workflow?: Workflow;
  depth?: Depth;
  /** A time limit the person asked for, in minutes (1-180). */
  minutes?: number;
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
    page: oneOf(
      typeof args.page === "string" ? args.page.toLowerCase() : args.page,
      commandPages,
    ),
    format: oneOf(
      typeof args.format === "string" ? args.format.toLowerCase() : args.format,
      commandFormats,
    ),
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
      required: ["title", "brief", "workflow", "depth"],
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
];
