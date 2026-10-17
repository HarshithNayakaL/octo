import type { SourceKind } from "./types.js";

/* Classify sources from their address alone, on the server and in the browser. */
const news = new Set(
  "reuters.com apnews.com bbc.co.uk bbc.com ft.com wsj.com nytimes.com washingtonpost.com theguardian.com bloomberg.com economist.com cnbc.com cnn.com npr.org forbes.com businessinsider.com techcrunch.com theverge.com wired.com arstechnica.com axios.com politico.com aljazeera.com thehindu.com hindustantimes.com indianexpress.com livemint.com economictimes.indiatimes.com timesofindia.indiatimes.com business-standard.com moneycontrol.com ndtv.com scroll.in theprint.in folha.uol.com.br valor.globo.com g1.globo.com estadao.com.br lemonde.fr spiegel.de nikkei.com asia.nikkei.com scmp.com straitstimes.com abc.net.au cbc.ca fortune.com theatlantic.com niemanlab.org cjr.org restofworld.org".split(
    " ",
  ),
);
const academic =
  /(^|\.)(doi\.org|arxiv\.org|biorxiv\.org|medrxiv\.org|ssrn\.com|nber\.org|pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov|nature\.com|science\.org|sciencedirect\.com|springer\.com|link\.springer\.com|wiley\.com|onlinelibrary\.wiley\.com|tandfonline\.com|jstor\.org|ieee\.org|ieeexplore\.ieee\.org|acm\.org|dl\.acm\.org|aclanthology\.org|openreview\.net|plos\.org|frontiersin\.org|mdpi\.com|cell\.com|thelancet\.com|bmj\.com|nejm\.org|jamanetwork\.com|semanticscholar\.org|researchgate\.net|scholar\.google\.com|imf\.org|worldbank\.org|oecd\.org|bis\.org)$/;
const government =
  /(\.gov|\.gov\.[a-z]{2}|\.gob\.[a-z]{2}|\.gouv\.[a-z]{2}|\.go\.[a-z]{2}|\.mil|\.int|\.nic\.in|europa\.eu|un\.org|who\.int|rbi\.org\.in|sebi\.gov\.in|npci\.org\.in|bcb\.gov\.br|federalreserve\.gov|ecb\.europa\.eu|bankofengland\.co\.uk|legislation\.gov\.uk|eur-lex\.europa\.eu)$/;
const reference = /(^|\.)(wikipedia\.org|britannica\.com|investopedia\.com)$/;
const forum =
  /(^|\.)(reddit\.com|quora\.com|stackexchange\.com|stackoverflow\.com|news\.ycombinator\.com|ycombinator\.com|discord\.com|x\.com|twitter\.com|facebook\.com|linkedin\.com|youtube\.com|tiktok\.com)$/;
const blog =
  /(^|\.)(medium\.com|substack\.com|blogspot\.com|wordpress\.com|hashnode\.dev|dev\.to|tumblr\.com|wix\.com|weebly\.com|ghost\.io|beehiiv\.com)$/;

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};
export const matchesDomain = (host: string, domain: string) => {
  const d = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  return Boolean(d) && (host === d || host.endsWith("." + d));
};

/** Classify a source from its address alone; no request is made. */
export function classifySource(url: string, title = ""): SourceKind {
  const host = hostOf(url);
  if (!host) return "other";
  if (government.test(host)) return "government";
  if (academic.test(host) || /\.(edu|ac\.[a-z]{2}|edu\.[a-z]{2})$/.test(host))
    return "academic";
  if (news.has(host) || [...news].some((n) => host.endsWith("." + n)))
    return "news";
  if (reference.test(host)) return "reference";
  if (forum.test(host)) return "forum";
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (
    blog.test(host) ||
    /\/(blog|blogs|posts?)\//.test(path) ||
    /\b(best|top \d+|vs\.?|review|alternatives)\b/i.test(
      `${title} ${path.replace(/[-_/]/g, " ")}`,
    )
  )
    return "blog";
  if (
    /\/(investors?|investor-relations|ir|press|newsroom|media|about|pricing|docs|documentation|annual-report|sustainability)(\/|$)/.test(
      path,
    )
  )
    return "company";
  return "other";
}

/** Months since a date, rounded down. */
export const monthsOld = (date: string, now = Date.now()) =>
  Math.floor((now - Date.parse(date)) / (30.44 * 86400000));
