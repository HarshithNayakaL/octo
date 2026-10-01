import { z } from "zod";
import type { Lead, Source } from "../shared/types.js";
import type { ApiObject } from "./provider.js";

export const safeUrl = z
  .string()
  .url()
  .refine((value) => {
    const u = new URL(value);
    return (
      ["https:", "http:"].includes(u.protocol) && !u.username && !u.password
    );
  }, "Only public web links are accepted");
export const sourceSchema = z.object({
  title: z.string().max(500),
  url: safeUrl,
});
export const leadSchema = z.object({
  company: z.string().min(1).max(500),
  website: safeUrl,
  industry: z.string().max(1000),
  size: z.string().max(500),
  fit: z.enum(["high", "medium", "low", "unknown"]),
  evidence: z.string().max(10000),
  needs: z.string().max(10000),
  decisionMaker: z.string().max(1000),
  sources: z.array(sourceSchema).max(100),
});
export const resultSchema = z.object({
  report: z.string().min(1).max(2_000_000),
  sources: z.array(sourceSchema).max(2000),
  leads: z.array(leadSchema).max(100),
});
export function itemText(item: ApiObject): string {
  if (typeof item.text === "string") return item.text;
  if (Array.isArray(item.content))
    return item.content
      .filter(
        (x: any) => x.type === "output_text" && typeof x.text === "string",
      )
      .map((x: any) => x.text)
      .join("\n");
  return "";
}
export function finalReport(items: ApiObject[]): string {
  return (
    items
      .filter(
        (i) =>
          i.type === "message" &&
          i.role === "assistant" &&
          (i.phase === "final_answer" || i.channel === "final"),
      )
      .map(itemText)
      .filter(Boolean)
      .at(-1) ??
    items
      .filter((i) => i.type === "message" && i.role === "assistant")
      .map(itemText)
      .filter(Boolean)
      .at(-1) ??
    ""
  );
}
export function sourcesFromReport(report: string): Source[] {
  const sources = new Map<string, Source>();
  for (const match of report.matchAll(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
  )) {
    if (safeUrl.safeParse(match[2]).success)
      sources.set(match[2], { title: match[1], url: match[2] });
  }
  return [...sources.values()];
}
export function toCsv(leads: Lead[]): string {
  const cell = (value: string) =>
    '"' +
    (/^[\s]*[=+@\-\t\r]/.test(value) ? "'" + value : value).replaceAll(
      '"',
      '""',
    ) +
    '"';
  return [
    "company,website,industry,size,fit,evidence,potential_needs,decision_maker,sources",
    ...leads.map((l) =>
      [
        l.company,
        l.website,
        l.industry,
        l.size,
        l.fit,
        l.evidence,
        l.needs,
        l.decisionMaker,
        l.sources.map((s) => s.url).join(" | "),
      ]
        .map(cell)
        .join(","),
    ),
  ].join("\r\n");
}
