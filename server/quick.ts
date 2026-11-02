/**
 * Quick answers for small questions ("who won the 2025 F1 title?"): one short
 * agent pass with web search instead of a full research run.
 */
export interface QuickAnswer {
  answer: string;
  sources: { title: string; url: string }[];
  model: string;
}

/** Instructions for a quick, spoken answer with its sources on separate lines. */
export function quickPrompt(question: string) {
  const today = new Date().toISOString().slice(0, 10);
  return `Today is ${today}. Search the web and answer this question quickly: one short research pass, no report, no files. Reply in one to three short sentences that sound natural spoken aloud, in the same language as the question. No Markdown, lists or URLs in the answer. Answer only what was asked, plainly. For something current (a price, a standing, the latest news) say how recent it is; never comment on whether an answer can change. If sources disagree or you cannot find it, say so instead of guessing.
After the answer, list up to three sources you used, one per line, exactly as: SOURCE: <page title> | <https URL>
Question: ${question.slice(0, 500)}`;
}

/** Split an agent reply into the spoken answer and its SOURCE lines. */
export function parseQuick(
  text: string,
  model: string,
  extra: { title?: string; url?: string }[] = [],
): QuickAnswer | undefined {
  const sources: QuickAnswer["sources"] = [];
  const seen = new Set<string>();
  const add = (title: string | undefined, url: string | undefined) => {
    if (!url || !/^https:\/\//.test(url) || seen.has(url)) return;
    seen.add(url);
    let host = url;
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return;
    }
    sources.push({ title: (title?.trim() || host).slice(0, 120), url });
  };
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(
      /^\s*[-*]?\s*SOURCE:\s*(.*?)\s*\|\s*(https:\/\/\S+)\s*$/i,
    );
    if (m) add(m[1], m[2]);
    else lines.push(line);
  }
  for (const s of extra) add(s.title, s.url);
  const answer = lines
    .join("\n")
    .replace(/\[(.*?)\]\((https?:\/\/[^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_#`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!answer) return undefined;
  return { answer: answer.slice(0, 1500), sources: sources.slice(0, 5), model };
}
