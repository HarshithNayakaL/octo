import type { Run } from "./types.js";

/** Files Octo can produce from a finished run. */
export type DeliverableFormat = "pdf" | "docx" | "csv" | "md" | "json";
export type OutputChoice = "auto" | Exclude<DeliverableFormat, "json">;

export const formatLabels: Record<DeliverableFormat, string> = {
  pdf: "PDF",
  docx: "Word (.docx)",
  csv: "CSV",
  md: "Markdown",
  json: "JSON",
};
export const choiceLabels: Record<OutputChoice, string> = {
  auto: "Best for the task",
  pdf: "PDF document",
  docx: "Word document (.docx)",
  csv: "CSV spreadsheet",
  md: "Markdown",
};

const hasTable = (markdown: string) => /^\s*\|.+\|\s*$/m.test(markdown);

/** CSV needs rows: company records, or at least one table in the report. */
export function formatsFor(
  run: Pick<Run, "report" | "leads">,
): DeliverableFormat[] {
  const csv = run.leads.length > 0 || hasTable(run.report);
  return ["pdf", "docx", ...(csv ? (["csv"] as const) : []), "md", "json"];
}

/** A format named in the brief, e.g. "send it as a spreadsheet". */
export function formatFromBrief(brief: string): DeliverableFormat | undefined {
  const text = brief.toLowerCase();
  if (/\b(csv|spreadsheet|excel|xlsx|google sheets?)\b/.test(text))
    return "csv";
  if (/\b(docx?|word document|ms word|google docs?)\b/.test(text))
    return "docx";
  if (/\bpdf\b/.test(text)) return "pdf";
  if (/\bmarkdown\b/.test(text)) return "md";
  return undefined;
}

/** The format the run's main download button produces. */
export function preferredFormat(
  run: Pick<Run, "outputFormat" | "brief" | "workflow" | "report" | "leads">,
): DeliverableFormat {
  const available = formatsFor(run);
  const wanted =
    run.outputFormat && run.outputFormat !== "auto"
      ? run.outputFormat
      : (formatFromBrief(run.brief) ??
        (run.workflow === "sales" ? "csv" : "pdf"));
  return available.includes(wanted) ? wanted : "pdf";
}
