import { createRequire } from "node:module";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type { List, PhrasingContent, Root, RootContent, Table } from "mdast";
import { classifySource } from "../shared/sources.js";
import {
  sourceKindLabels,
  workflowLabels,
  type ClaimStatus,
  type Run,
} from "../shared/types.js";

// pptxgenjs's ES build has no "type": "module", so some loaders (Vercel's
// among them) parse it as CommonJS and crash at startup. Load the CommonJS
// build explicitly, and only when a deck is requested, so a problem here can
// never take down the rest of the API.
type PptxCtor = typeof import("pptxgenjs").default;
const requireCjs = createRequire(import.meta.url);
function loadPptx(): PptxCtor {
  const mod = requireCjs("pptxgenjs") as PptxCtor | { default: PptxCtor };
  return "default" in mod ? mod.default : mod;
}
type Slide = ReturnType<InstanceType<PptxCtor>["addSlide"]>;

/*
 * A presentation built from the report, with no model call: the same report
 * always gives the same deck. Slides carry short bullets (the first sentence
 * of each paragraph or list item); the full text goes into speaker notes, so
 * nothing in the report is lost.
 */

export interface Bullet {
  text: string;
  level: 0 | 1;
  bold?: boolean;
  /** The whole paragraph or item, for card and summary layouts. */
  full?: string;
}
export interface DeckSection {
  title: string;
  bullets: Bullet[];
  notes: string[];
  tables: string[][][];
}

const MAX_BULLET = 170;
const BULLETS_PER_SLIDE = 6;
const TABLE_ROWS = 8;
const TABLE_COLS = 6;

const parse = (markdown: string): Root =>
  fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

function text(nodes: PhrasingContent[] | RootContent[]): string {
  let out = "";
  for (const node of nodes as any[]) {
    if (node.type === "text" || node.type === "inlineCode") out += node.value;
    else if (node.type === "break") out += " ";
    else if (node.type === "image") out += node.alt ?? "";
    else if (node.children) out += text(node.children);
  }
  return out.replace(/\s+/g, " ").trim();
}

const sentenceEnd = /[.!?](?=\s+[A-Z0-9("“[]|$)/g;

/** Whole sentences from the start, up to `max` characters; cut at a word only if one sentence is too long. */
export function sentences(value: string, max: number) {
  if (value.length <= max) return value;
  let end = 0;
  for (const m of value.matchAll(sentenceEnd)) {
    if (m.index! + 1 > max) break;
    end = m.index! + 1;
  }
  if (end) return value.slice(0, end);
  const cut = value.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : cut.length)}…`;
}

/**
 * The first sentence, shortened for a slide. Decimals like 18.4 do not end a
 * sentence, and a very short lead such as "Market structure." keeps the
 * sentence that explains it.
 */
export function firstSentence(value: string, max = MAX_BULLET) {
  const ends = [...value.matchAll(sentenceEnd)].map((m) => m.index! + 1);
  // A label-like first "sentence" (under 25 characters) keeps the next one.
  const end =
    ends[0] !== undefined && ends[0] < 25 ? (ends[1] ?? ends[0]) : ends[0];
  const sentence = (end ? value.slice(0, end) : value).trim();
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : cut.length)}…`;
}

const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

function tableRows(table: Table) {
  return table.children
    .slice(0, TABLE_ROWS + 1)
    .map((row) =>
      row.children
        .slice(0, TABLE_COLS)
        .map((cell) => clip(text(cell.children), 90)),
    );
}

function listBullets(list: List, level: 0 | 1, section: DeckSection) {
  for (const item of list.children) {
    const own = item.children.filter((c) => c.type !== "list");
    const full = text(own as RootContent[]);
    if (full) {
      section.bullets.push({ text: firstSentence(full), level, full });
      section.notes.push(`${level ? "  - " : "- "}${full}`);
    }
    for (const child of item.children)
      if (child.type === "list") listBullets(child, 1, section);
  }
}

/** "1. Governance" → "Governance": the deck numbers sections itself. */
export const cleanHeading = (heading: string) =>
  heading.replace(/^\s*(\d+(\.\d+)*[.)]|[IVX]+\.)\s+/, "").trim() || heading;

/**
 * Split "Label: detail" into a card title and body, when the label is short
 * enough to be a title.
 */
export function splitLead(value: string) {
  const match = value.match(/^([^:.!?]{3,60}):\s+(.+)$/);
  return match
    ? { lead: match[1].trim(), body: match[2].trim() }
    : { lead: undefined, body: value };
}

/**
 * Bullets in slide-sized pages. A page never ends on a label that introduces
 * what follows (a bold sub-heading or a line ending in a colon).
 */
export function paginate(bullets: Bullet[], size = BULLETS_PER_SLIDE) {
  const pages: Bullet[][] = [];
  let rest = bullets;
  while (rest.length) {
    let take = Math.min(size, rest.length);
    while (
      take > 1 &&
      take < rest.length &&
      (rest[take - 1].bold || rest[take - 1].text.trim().endsWith(":"))
    )
      take--;
    pages.push(rest.slice(0, take));
    rest = rest.slice(take);
  }
  return pages;
}

/** The report as slide-sized sections, in order. */
export function deckOutline(report: string, title: string): DeckSection[] {
  const sections: DeckSection[] = [];
  const open = (heading: string) => {
    const section = {
      title: cleanHeading(heading),
      bullets: [],
      notes: [],
      tables: [],
    };
    sections.push(section);
    return section;
  };
  let current: DeckSection | undefined;
  for (const node of parse(report).children) {
    if (node.type === "heading" && node.depth <= 2) {
      const heading = text(node.children);
      // The report's own title repeats the deck title.
      if (node.depth === 1 && heading.toLowerCase() === title.toLowerCase())
        continue;
      current = open(heading);
      continue;
    }
    current ??= open("Overview");
    if (node.type === "heading") {
      const heading = text(node.children);
      current.bullets.push({
        text: clip(heading, MAX_BULLET),
        level: 0,
        bold: true,
      });
      current.notes.push(heading);
    } else if (node.type === "paragraph" || node.type === "blockquote") {
      const full = text(node.children as RootContent[]);
      if (!full) continue;
      current.bullets.push({ text: firstSentence(full), level: 0, full });
      current.notes.push(full);
    } else if (node.type === "list") listBullets(node, 0, current);
    else if (node.type === "table") current.tables.push(tableRows(node));
  }
  return sections.filter((s) => s.bullets.length || s.tables.length);
}

const summaryPattern =
  /executive|summary|key findings|bottom line|tl;?dr|at a glance/i;

// Octo's palette, as PowerPoint hex (no #).
const C = {
  navy: "0A1F5C",
  blue: "002FA7",
  ink: "141A2E",
  body: "2B3245",
  muted: "596070",
  rule: "E3E7F0",
  wash: "F3F6FE",
  white: "FFFFFF",
};
const statusColour: Record<ClaimStatus, string> = {
  supported: "1F9D5C",
  partial: "D99A1E",
  not_found: "D64535",
  unreachable: "AEB5C2",
  uncited: "8B6FD6",
};
const statusLabel: Record<ClaimStatus, string> = {
  supported: "Supported",
  partial: "Partly supported",
  not_found: "Not found in source",
  unreachable: "Could not check",
  uncited: "No source cited",
};
const FONT = "Calibri";

const host = (url?: string) => {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const dateLabel = () =>
  new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date());
const chunk = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, i * size + size),
  );

/** A finished, presentable .pptx of the research. */
export async function toPptx(run: Run): Promise<Buffer> {
  const PptxGenJS = loadPptx();
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  pptx.title = run.title;
  pptx.subject = "Research report";
  pptx.company = "Octo";
  const demo = run.mode === "demo";
  const footer = `${clip(run.title, 70)}${demo ? "  ·  Illustrative demo output" : ""}`;
  pptx.defineSlideMaster({
    title: "OCTO",
    background: { color: C.white },
    objects: [
      { rect: { x: 0, y: 0, w: 13.333, h: 0.08, fill: { color: C.blue } } },
      {
        line: {
          x: 0.6,
          y: 6.95,
          w: 12.13,
          h: 0,
          line: { color: C.rule, width: 0.75 },
        },
      },
      {
        text: {
          text: footer,
          options: {
            x: 0.6,
            y: 7.0,
            w: 10,
            h: 0.3,
            fontFace: FONT,
            fontSize: 9,
            color: C.muted,
          },
        },
      },
    ],
    slideNumber: {
      x: 12.3,
      y: 7.0,
      w: 0.5,
      h: 0.3,
      fontFace: FONT,
      fontSize: 9,
      color: C.muted,
      align: "right",
    },
  });

  const heading = (slide: Slide, title: string, kicker?: string) => {
    if (kicker)
      slide.addText(kicker.toUpperCase(), {
        x: 0.6,
        y: 0.35,
        w: 12,
        h: 0.3,
        fontFace: FONT,
        fontSize: 10,
        bold: true,
        color: C.blue,
        charSpacing: 2,
      });
    slide.addText(title, {
      x: 0.6,
      y: kicker ? 0.62 : 0.45,
      w: 12.1,
      h: 0.8,
      fontFace: FONT,
      fontSize: 28,
      bold: true,
      color: C.ink,
      valign: "top",
      fit: "shrink",
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.6,
      y: kicker ? 1.42 : 1.25,
      w: 0.6,
      h: 0.05,
      fill: { color: C.blue },
      line: { color: C.blue },
    });
  };
  const bulletSlide = (
    title: string,
    bullets: Bullet[],
    kicker: string,
    notes: string,
  ) => {
    const slide = pptx.addSlide({ masterName: "OCTO" });
    heading(slide, title, kicker);
    slide.addText(
      bullets.map((b) => ({
        text: b.text,
        options: {
          bullet: b.bold ? false : { indent: 18 },
          indentLevel: b.level,
          bold: b.bold,
          fontSize: b.level ? 15 : 18,
          color: b.bold ? C.ink : C.body,
          paraSpaceAfter: 10,
          breakLine: true,
        },
      })),
      {
        x: 0.6,
        y: 1.75,
        w: 12.1,
        h: 5.0,
        fontFace: FONT,
        valign: "top",
        lineSpacingMultiple: 1.1,
        fit: "shrink",
      },
    );
    if (notes) slide.addNotes(notes);
    return slide;
  };
  const tableSlide = (title: string, kicker: string, rows: string[][]) => {
    const slide = pptx.addSlide({ masterName: "OCTO" });
    heading(slide, title, kicker);
    const [head, ...body] = rows;
    slide.addTable(
      [
        head.map((cell) => ({
          text: cell,
          options: { bold: true, color: C.white, fill: { color: C.navy } },
        })),
        ...body.map((row, i) =>
          row.map((cell) => ({
            text: cell,
            options: {
              color: C.body,
              fill: { color: i % 2 ? C.wash : C.white },
            },
          })),
        ),
      ],
      {
        x: 0.6,
        y: 1.75,
        w: 12.1,
        fontFace: FONT,
        fontSize: 12,
        valign: "middle",
        border: { type: "solid", pt: 0.5, color: C.rule },
        margin: 0.08,
        autoPage: false,
      },
    );
    return slide;
  };

  const cardSlide = (
    title: string,
    kicker: string,
    points: Bullet[],
    notes: string,
  ) => {
    const slide = pptx.addSlide({ masterName: "OCTO" });
    heading(slide, title, kicker);
    const gap = 0.25;
    const w = (12.1 - gap * (points.length - 1)) / points.length;
    points.forEach((point, i) => {
      const x = 0.6 + i * (w + gap);
      const { lead, body } = splitLead(point.full ?? point.text);
      slide.addShape(pptx.ShapeType.rect, {
        x,
        y: 1.85,
        w,
        h: 4.75,
        fill: { color: C.wash },
        line: { color: C.rule },
      });
      slide.addShape(pptx.ShapeType.rect, {
        x,
        y: 1.85,
        w,
        h: 0.07,
        fill: { color: C.blue },
        line: { color: C.blue },
      });
      slide.addText(String(i + 1).padStart(2, "0"), {
        x: x + 0.25,
        y: 2.05,
        w: 1,
        h: 0.4,
        fontFace: FONT,
        fontSize: 14,
        bold: true,
        color: C.blue,
      });
      slide.addText(
        [
          ...(lead
            ? [
                {
                  text: lead,
                  options: {
                    bold: true,
                    fontSize: 17,
                    color: C.ink,
                    breakLine: true,
                    paraSpaceAfter: 8,
                  },
                },
              ]
            : []),
          {
            text: sentences(body, points.length > 3 ? 260 : 400),
            options: { fontSize: 14, color: C.body },
          },
        ],
        {
          x: x + 0.25,
          y: 2.5,
          w: w - 0.5,
          h: 3.9,
          fontFace: FONT,
          valign: "top",
          lineSpacingMultiple: 1.12,
          fit: "shrink",
        },
      );
    });
    if (notes) slide.addNotes(notes);
  };

  // 1. Title
  const cover = pptx.addSlide();
  cover.background = { color: C.navy };
  cover.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.25,
    h: 7.5,
    fill: { color: C.blue },
    line: { color: C.blue },
  });
  cover.addText(
    `${workflowLabels[run.workflow]} · Research report`.toUpperCase(),
    {
      x: 0.9,
      y: 1.4,
      w: 11,
      h: 0.4,
      fontFace: FONT,
      fontSize: 12,
      bold: true,
      color: "9FB3FF",
      charSpacing: 3,
    },
  );
  cover.addText(run.title, {
    x: 0.9,
    y: 1.9,
    w: 11.5,
    h: 1.9,
    fontFace: FONT,
    fontSize: 44,
    bold: true,
    color: C.white,
    valign: "top",
    fit: "shrink",
  });
  cover.addText(firstSentence(run.brief.replace(/\s+/g, " "), 240), {
    x: 0.9,
    y: 3.95,
    w: 10.5,
    h: 1.0,
    fontFace: FONT,
    fontSize: 16,
    color: "D6DCF0",
    valign: "top",
    fit: "shrink",
  });
  const meta = [
    dateLabel(),
    demo
      ? "Illustrative demo output, not researched"
      : run.provider === "openai"
        ? "OpenAI Agents API"
        : `Google Antigravity · ${run.baseModel ?? "Gemini"}`,
    run.evidence?.status === "done" && run.evidence.score !== undefined
      ? `Evidence score ${run.evidence.score}/100`
      : undefined,
  ].filter(Boolean);
  cover.addText(meta.join("   ·   "), {
    x: 0.9,
    y: 6.2,
    w: 11.5,
    h: 0.4,
    fontFace: FONT,
    fontSize: 12,
    color: "9FB3FF",
  });
  cover.addText("Prepared with Octo", {
    x: 0.9,
    y: 6.6,
    w: 6,
    h: 0.35,
    fontFace: FONT,
    fontSize: 10,
    color: "7F8DB8",
  });

  const sections = deckOutline(run.report, run.title);
  const summaryIndex = sections.findIndex((s) => summaryPattern.test(s.title));
  const summary = sections[summaryIndex >= 0 ? summaryIndex : 0];

  // 2. Executive summary: with few points, show them in full.
  if (summary?.bullets.length) {
    const points = summary.bullets.filter((b) => !b.bold);
    if (points.length <= 3) {
      const slide = pptx.addSlide({ masterName: "OCTO" });
      heading(slide, "Executive summary", "Summary");
      slide.addText(
        points.flatMap((b, i) => {
          const full = sentences(b.full ?? b.text, i ? 360 : 620);
          const lead = firstSentence(full, 400);
          const rest = full.slice(lead.length).trim();
          return [
            {
              text: lead + (rest ? " " : ""),
              options: { fontSize: i ? 16 : 20, bold: true, color: C.ink },
            },
            {
              text: rest,
              options: {
                fontSize: i ? 16 : 18,
                color: C.body,
                breakLine: true,
                paraSpaceAfter: 16,
              },
            },
          ];
        }),
        {
          x: 0.6,
          y: 1.8,
          w: 11.4,
          h: 4.9,
          fontFace: FONT,
          valign: "top",
          lineSpacingMultiple: 1.15,
          fit: "shrink",
        },
      );
      slide.addNotes(summary.notes.join("\n"));
    } else
      bulletSlide(
        "Executive summary",
        points.slice(0, 5),
        "Summary",
        summary.notes.join("\n"),
      );
  }

  // Contents
  // Sections that get their own slides; a short summary is already shown.
  const body = sections.filter(
    (section) =>
      !(
        section === summary &&
        summaryIndex >= 0 &&
        !section.tables.length &&
        section.bullets.length <= 5
      ),
  );
  if (body.length >= 3) {
    const slide = pptx.addSlide({ masterName: "OCTO" });
    heading(slide, "Contents");
    const half = Math.ceil(body.length / 2);
    [body.slice(0, half), body.slice(half)].forEach((column, c) =>
      slide.addText(
        column.map((section, i) => ({
          text: `${String(c * half + i + 1).padStart(2, "0")}   ${clip(section.title, 60)}`,
          options: { breakLine: true, paraSpaceAfter: 14 },
        })),
        {
          x: 0.6 + c * 6.15,
          y: 1.8,
          w: 5.95,
          h: 4.8,
          fontFace: FONT,
          fontSize: 18,
          color: C.ink,
          valign: "top",
        },
      ),
    );
  }

  // 3. Evidence at a glance
  const evidence = run.evidence;
  if (evidence?.status === "done" && evidence.claims.length) {
    const slide = pptx.addSlide({ masterName: "OCTO" });
    heading(slide, "How well the sources back this report", "Evidence check");
    slide.addText(String(evidence.score ?? "–"), {
      x: 0.6,
      y: 1.8,
      w: 2.6,
      h: 1.4,
      fontFace: FONT,
      fontSize: 72,
      bold: true,
      color: C.ink,
    });
    slide.addText("/ 100 evidence score", {
      x: 0.65,
      y: 3.1,
      w: 3,
      h: 0.4,
      fontFace: FONT,
      fontSize: 13,
      color: C.muted,
    });
    const order: ClaimStatus[] = [
      "supported",
      "partial",
      "unreachable",
      "not_found",
      "uncited",
    ];
    const total = evidence.claims.length;
    let x = 3.6;
    const width = 9.1;
    for (const status of order) {
      const n = evidence.claims.filter((c) => c.status === status).length;
      if (!n) continue;
      const w = (n / total) * width;
      slide.addShape(pptx.ShapeType.rect, {
        x,
        y: 2.05,
        w: Math.max(w - 0.03, 0.05),
        h: 0.5,
        fill: { color: statusColour[status] },
        line: { color: statusColour[status] },
      });
      x += w;
    }
    slide.addText(
      order
        .map(
          (s) =>
            [s, evidence.claims.filter((c) => c.status === s).length] as const,
        )
        .filter(([, n]) => n)
        .map(([s, n]) => ({
          text: `■ ${n} ${statusLabel[s].toLowerCase()}    `,
          options: {
            color: statusColour[s] === "AEB5C2" ? C.muted : statusColour[s],
          },
        })),
      {
        x: 3.6,
        y: 2.7,
        w: 9.1,
        h: 0.5,
        fontFace: FONT,
        fontSize: 13,
        bold: true,
      },
    );
    const flagged = evidence.claims
      .filter((c) => c.status === "not_found" || c.status === "uncited")
      .slice(0, 4);
    slide.addText(
      [
        {
          text: flagged.length
            ? "To review before relying on this report"
            : "No claims were found to contradict or lack their sources.",
          options: {
            bold: true,
            color: C.ink,
            fontSize: 15,
            breakLine: true,
            paraSpaceAfter: 6,
          },
        },
        ...flagged.map((c) => ({
          text: `${statusLabel[c.status]}: ${firstSentence(c.claim, 150)}`,
          options: {
            bullet: { indent: 16 },
            color: C.body,
            fontSize: 13,
            breakLine: true,
            paraSpaceAfter: 4,
          },
        })),
      ],
      {
        x: 0.6,
        y: 3.75,
        w: 12.1,
        h: 2.4,
        fontFace: FONT,
        valign: "top",
        fit: "shrink",
      },
    );
    slide.addText(
      `Octo opened each cited page and compared the figures and wording each claim depends on. This is an automatic first pass${demo ? " (statuses are illustrative in this demo)" : ""}; pages that could not be opened are left out of the score.`,
      {
        x: 0.6,
        y: 6.3,
        w: 12.1,
        h: 0.5,
        fontFace: FONT,
        fontSize: 10.5,
        color: C.muted,
        italic: true,
      },
    );
  }

  // 4. The report, section by section
  body.forEach((section, index) => {
    const kicker = `Section ${index + 1} of ${body.length}`;
    const top = section.bullets.filter((b) => b.level === 0 && !b.bold);
    // A single point reads as a statement, not a lonely bullet.
    if (
      top.length === 1 &&
      section.bullets.length === 1 &&
      !section.tables.length
    ) {
      const slide = pptx.addSlide({ masterName: "OCTO" });
      heading(slide, section.title, kicker);
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.6,
        y: 2.2,
        w: 0.08,
        h: 2.6,
        fill: { color: C.blue },
        line: { color: C.blue },
      });
      slide.addText(sentences(top[0].full ?? top[0].text, 420), {
        x: 1.0,
        y: 2.1,
        w: 10.8,
        h: 2.8,
        fontFace: FONT,
        fontSize: 26,
        color: C.ink,
        valign: "middle",
        lineSpacingMultiple: 1.15,
        fit: "shrink",
      });
      slide.addNotes(section.notes.join("\n"));
    }
    // Two to four points read better as cards than as a short list.
    else if (
      top.length >= 2 &&
      top.length <= 4 &&
      top.length === section.bullets.length
    )
      cardSlide(section.title, kicker, top, section.notes.join("\n"));
    else
      paginate(section.bullets).forEach((bullets, page) =>
        bulletSlide(
          page ? `${clip(section.title, 55)} (cont.)` : section.title,
          bullets,
          kicker,
          page ? "" : section.notes.join("\n"),
        ),
      );
    section.tables.forEach((rows, t) => {
      if (rows.length > 1)
        tableSlide(
          section.tables.length > 1
            ? `${section.title} · table ${t + 1}`
            : section.title,
          kicker,
          rows,
        );
    });
  });

  // 5. Checked claims
  if (evidence?.status === "done" && evidence.claims.length) {
    const rank: Record<ClaimStatus, number> = {
      not_found: 0,
      uncited: 1,
      partial: 2,
      unreachable: 3,
      supported: 4,
    };
    const claims = [...evidence.claims].sort(
      (a, b) => rank[a.status] - rank[b.status],
    );
    chunk(claims, TABLE_ROWS)
      .slice(0, 3)
      .forEach((page, i) => {
        const slide = pptx.addSlide({ masterName: "OCTO" });
        heading(
          slide,
          i ? "Checked claims (continued)" : "Checked claims",
          "Evidence check",
        );
        slide.addTable(
          [
            ["Claim", "Result", "Source"].map((h) => ({
              text: h,
              options: { bold: true, color: C.white, fill: { color: C.navy } },
            })),
            ...page.map((c, r) => [
              {
                text: firstSentence(c.claim, 150),
                options: {
                  color: C.body,
                  fill: { color: r % 2 ? C.wash : C.white },
                },
              },
              {
                text: statusLabel[c.status],
                options: {
                  bold: true,
                  color:
                    statusColour[c.status] === "AEB5C2"
                      ? C.muted
                      : statusColour[c.status],
                  fill: { color: r % 2 ? C.wash : C.white },
                },
              },
              {
                text: host(c.sourceUrl) || "—",
                options: {
                  color: C.blue,
                  fill: { color: r % 2 ? C.wash : C.white },
                  ...(c.sourceUrl ? { hyperlink: { url: c.sourceUrl } } : {}),
                },
              },
            ]),
          ],
          {
            x: 0.6,
            y: 1.75,
            w: 12.1,
            colW: [7.6, 2.2, 2.3],
            fontFace: FONT,
            fontSize: 12,
            valign: "middle",
            border: { type: "solid", pt: 0.5, color: C.rule },
            margin: 0.08,
          },
        );
      });
  }

  // 6. What people say
  const pulse = run.community;
  if (pulse?.status === "done" && pulse.themes.length) {
    const slide = pptx.addSlide({ masterName: "OCTO" });
    heading(slide, "What people say", "Community voices");
    const themes = pulse.themes.slice(0, 4);
    themes.forEach((theme, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const quote = pulse.items.find((item) =>
        theme.quoteIds.includes(item.id),
      );
      const x = 0.6 + col * 6.15;
      const y = 1.8 + row * 2.45;
      slide.addShape(pptx.ShapeType.rect, {
        x,
        y,
        w: 5.95,
        h: 2.25,
        fill: { color: C.wash },
        line: { color: C.rule },
      });
      slide.addText(
        [
          {
            text: theme.title,
            options: {
              bold: true,
              color: C.ink,
              fontSize: 15,
              breakLine: true,
              paraSpaceAfter: 4,
            },
          },
          {
            text: firstSentence(theme.summary, 140),
            options: {
              color: C.body,
              fontSize: 12,
              breakLine: true,
              paraSpaceAfter: 6,
            },
          },
          ...(quote
            ? [
                {
                  text: `“${firstSentence(quote.text, 150)}”`,
                  options: {
                    italic: true,
                    color: C.body,
                    fontSize: 12,
                    breakLine: true,
                  },
                },
                {
                  text: `${quote.source === "reddit" ? "Reddit" : "Hacker News"} · ${clip(quote.where, 40)}`,
                  options: {
                    color: C.blue,
                    fontSize: 10,
                    hyperlink: { url: quote.url },
                  },
                },
              ]
            : []),
        ],
        {
          x: x + 0.2,
          y: y + 0.15,
          w: 5.55,
          h: 1.95,
          fontFace: FONT,
          valign: "top",
          fit: "shrink",
        },
      );
    });
    if (pulse.takeaway) slide.addNotes(pulse.takeaway);
  }

  // 7. Company records
  if (run.leads.length)
    chunk(run.leads, TABLE_ROWS)
      .slice(0, 4)
      .forEach((page, i) =>
        tableSlide(
          i ? "Company records (continued)" : "Company records",
          "Companies",
          [
            ["Company", "Industry", "Size", "Fit", "Decision maker"],
            ...page.map((l) => [
              l.company,
              clip(l.industry, 40),
              clip(l.size, 30),
              l.fit,
              clip(l.decisionMaker, 50),
            ]),
          ],
        ),
      );

  // 8. Sources
  if (run.sources.length)
    chunk(run.sources, 14)
      .slice(0, 3)
      .forEach((page, i) => {
        const slide = pptx.addSlide({ masterName: "OCTO" });
        heading(slide, i ? "Sources (continued)" : "Sources", "References");
        const columns = chunk(page, 7);
        columns.forEach((column, c) =>
          slide.addText(
            column.flatMap((s) => {
              const kind =
                run.sourceInfo?.[s.url]?.kind ?? classifySource(s.url, s.title);
              return [
                {
                  text: clip(s.title || host(s.url), 70),
                  options: {
                    bold: true,
                    color: C.blue,
                    fontSize: 12,
                    hyperlink: { url: s.url },
                    breakLine: true,
                  },
                },
                {
                  text: `${sourceKindLabels[kind]} · ${host(s.url)}`,
                  options: {
                    color: C.muted,
                    fontSize: 10,
                    breakLine: true,
                    paraSpaceAfter: 8,
                  },
                },
              ];
            }),
            {
              x: 0.6 + c * 6.15,
              y: 1.75,
              w: 5.95,
              h: 5.0,
              fontFace: FONT,
              valign: "top",
              fit: "shrink",
            },
          ),
        );
      });

  // 9. Method
  const method = pptx.addSlide({ masterName: "OCTO" });
  heading(method, "How this research was done", "Method");
  method.addText(
    [
      `Brief: ${firstSentence(run.brief.replace(/\s+/g, " "), 220)}`,
      demo
        ? "This is illustrative demo output: no live research or API calls were made."
        : `Researched by ${run.provider === "openai" ? "the OpenAI Agents API" : `Google Antigravity on ${run.baseModel ?? "Gemini"}`}, with one specialist per agreed research area.`,
      evidence?.status === "done"
        ? `Octo checked ${evidence.claims.length} claims against their cited pages; ${evidence.claims.filter((c) => c.status === "supported").length} were supported.`
        : "The citations in this report have not been checked by Octo yet.",
      `${run.sources.length} sources${pulse?.status === "done" ? `, plus ${pulse.items.length} public discussion posts` : ""}.`,
      "Verify flagged claims before acting on them. Full text for each section is in the speaker notes.",
    ].map((t) => ({
      text: t,
      options: { bullet: { indent: 18 }, breakLine: true, paraSpaceAfter: 10 },
    })),
    {
      x: 0.6,
      y: 1.75,
      w: 12.1,
      h: 4.8,
      fontFace: FONT,
      fontSize: 16,
      color: C.body,
      valign: "top",
    },
  );

  const data = await pptx.write({ outputType: "nodebuffer" });
  return data as Buffer;
}
