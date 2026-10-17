import type { Run, SourceInfo, SourcePolicy } from "../shared/types.js";
import { classifySource, hostOf, matchesDomain } from "../shared/sources.js";

export { classifySource, hostOf };

/*
 * Not all sources are equal. AI search often cites affiliate blogs and SEO pages
 * as if they were primary evidence. Octo labels every source by kind, reads the
 * date the page was published when it checks evidence, and applies the run's
 * source policy (trusted and blocked domains), so the source mix is visible.
 */

export { sourceKindLabels as kindLabels } from "../shared/types.js";

/** Label every source in the run, keeping dates already found. */
export function describeSources(run: Run): Record<string, SourceInfo> {
  const policy = run.sourcePolicy;
  const info: Record<string, SourceInfo> = {};
  for (const source of run.sources) {
    const host = hostOf(source.url);
    info[source.url] = {
      ...run.sourceInfo?.[source.url],
      kind: classifySource(source.url, source.title),
      blocked: policy?.block.some((d) => matchesDomain(host, d)) || undefined,
      trusted: policy?.trust.some((d) => matchesDomain(host, d)) || undefined,
    };
  }
  return info;
}

/** Instructions for the agent from the user's source policy. */
export function policyInstructions(policy?: SourcePolicy) {
  if (!policy) return "";
  const parts: string[] = [];
  if (policy.prefer === "primary")
    parts.push(
      "Rely on primary sources: government and regulator documents, company filings and official statements, original datasets. Use news and secondary sources only to find primary ones, and label any claim that rests on a secondary source.",
    );
  if (policy.prefer === "academic")
    parts.push(
      "Prefer peer-reviewed research, preprints from recognised repositories, and official statistics. Say when a claim rests only on non-academic sources.",
    );
  if (policy.trust.length)
    parts.push(
      `Sources the user trusts and wants checked first: ${policy.trust.join(", ")}.`,
    );
  if (policy.block.length)
    parts.push(`Do not use or cite these domains: ${policy.block.join(", ")}.`);
  if (policy.freshMonths)
    parts.push(
      `Prefer evidence from the last ${policy.freshMonths} months; mark older figures with their date.`,
    );
  return parts.length ? `Source policy from the user: ${parts.join(" ")}` : "";
}

/** The publication or modification date a page declares, if any. */
export function publishedDate(html: string): string | undefined {
  const patterns = [
    /<meta[^>]+(?:property|name|itemprop)=["'](?:article:published_time|og:published_time|datePublished|date|dc\.date|dcterms\.date|citation_publication_date|citation_date|pubdate|publish-date)["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["'](?:article:published_time|datePublished|citation_publication_date)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /<meta[^>]+(?:property|name)=["'](?:article:modified_time|og:updated_time|last-modified|dateModified)["'][^>]*content=["']([^"']+)["']/i,
    /"dateModified"\s*:\s*"([^"]+)"/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const raw = html.match(pattern)?.[1];
    if (!raw) continue;
    const value = raw.replace(/\//g, "-");
    const time = Date.parse(value);
    if (
      Number.isFinite(time) &&
      time > Date.parse("1990-01-01") &&
      time < Date.now() + 86400000
    )
      return new Date(time).toISOString().slice(0, 10);
  }
  return undefined;
}

export { monthsOld } from "../shared/sources.js";
