import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type {
  Root,
  RootContent,
  PhrasingContent,
  List,
  Table as MdTable,
} from "mdast";
import type { Run } from "../shared/types.js";
import { workflowLabels } from "../shared/types.js";
import type { DeliverableFormat } from "../shared/formats.js";
import { csvCell, toCsv } from "./results.js";

/** One run of inline text with its styling. */
interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  link?: string;
  code?: boolean;
}
export interface Deliverable {
  bytes: Buffer;
  contentType: string;
  extension: string;
}

const parse = (markdown: string): Root =>
  fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

const safeLink = (url: string) => (/^https?:\/\//i.test(url) ? url : undefined);

function spans(
  nodes: PhrasingContent[],
  style: Omit<Span, "text"> = {},
): Span[] {
  const out: Span[] = [];
  for (const node of nodes) {
    if (node.type === "text") out.push({ ...style, text: node.value });
    else if (node.type === "strong")
      out.push(...spans(node.children, { ...style, bold: true }));
    else if (node.type === "emphasis")
      out.push(...spans(node.children, { ...style, italic: true }));
    else if (node.type === "delete") out.push(...spans(node.children, style));
    else if (node.type === "link")
      out.push(...spans(node.children, { ...style, link: safeLink(node.url) }));
    else if (node.type === "inlineCode")
      out.push({ ...style, code: true, text: node.value });
    else if (node.type === "break") out.push({ ...style, text: "\n" });
    else if (node.type === "image")
      out.push({ ...style, text: node.alt ? `[${node.alt}]` : "" });
    else if ("children" in node)
      out.push(...spans(node.children as PhrasingContent[], style));
    else if ("value" in node) out.push({ ...style, text: String(node.value) });
  }
  return out.filter((s) => s.text);
}
const plain = (nodes: PhrasingContent[]) =>
  spans(nodes)
    .map((s) => s.text)
    .join("")
    .trim();
const tableRows = (table: MdTable) =>
  table.children.map((row) => row.children.map((cell) => plain(cell.children)));

const dateLabel = () =>
  new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date());
const providerLabel = (run: Run) =>
  run.mode === "demo"
    ? "Demo · illustrative output, not researched"
    : run.provider === "google"
      ? "Google Antigravity"
      : "OpenAI Agents API";

/** Extra sections so the file stands alone: company records and the source list. */
function appendix(run: Run): string {
  const parts: string[] = [];
  if (run.leads.length) {
    parts.push("## Company records");
    for (const lead of run.leads)
      parts.push(
        [
          `### ${lead.company}`,
          `[${lead.website}](${lead.website}) · ${lead.industry} · ${lead.size} · **${lead.fit} fit**`,
          `**Fit evidence:** ${lead.evidence}`,
          `**Potential need (hypothesis):** ${lead.needs}`,
          `**Decision maker:** ${lead.decisionMaker}`,
          ...(lead.sources.length
            ? [lead.sources.map((s) => `- [${s.title}](${s.url})`).join("\n")]
            : []),
        ].join("\n\n"),
      );
  }
  if (run.sources.length)
    parts.push(
      "## Sources\n\n" +
        run.sources
          .map((s, i) => `${i + 1}. [${s.title}](${s.url})`)
          .join("\n"),
    );
  return parts.join("\n\n");
}
const fullMarkdown = (run: Run) =>
  [run.report.trim(), appendix(run)].filter(Boolean).join("\n\n");

/* ---------- PDF ---------- */

/*
 * Literal URLs let Vercel's file tracer bundle the fonts with the function.
 * Source runs from server/ (../assets); the compiled build from dist-server/server (../../assets).
 */
const fontFiles = {
  body: [
    new URL("../../assets/fonts/Inter-Regular.ttf", import.meta.url),
    new URL("../assets/fonts/Inter-Regular.ttf", import.meta.url),
  ],
  bold: [
    new URL("../../assets/fonts/Inter-SemiBold.ttf", import.meta.url),
    new URL("../assets/fonts/Inter-SemiBold.ttf", import.meta.url),
  ],
  italic: [
    new URL("../../assets/fonts/Inter-Italic.ttf", import.meta.url),
    new URL("../assets/fonts/Inter-Italic.ttf", import.meta.url),
  ],
};
function fontPath(name: keyof typeof fontFiles) {
  const found = fontFiles[name]
    .map((url) => fileURLToPath(url))
    .find((path) => existsSync(path));
  if (!found) throw new Error("PDF fonts are missing from this deployment.");
  return found;
}
const INK = "#1f2430";
const MUTED = "#6f7686";
const BLUE = "#002fa7";
const LINE = "#d9e0f2";

async function toPdf(run: Run): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 60, bottom: 64, left: 60, right: 60 },
    bufferPages: true,
    info: { Title: run.title, Creator: "Octo" },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((ok) => doc.on("end", () => ok()));
  doc.registerFont("body", fontPath("body"));
  doc.registerFont("bold", fontPath("bold"));
  doc.registerFont("italic", fontPath("italic"));
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  const write = (items: Span[], size: number, indent = 0, gap = 6) => {
    if (!items.length) return;
    doc.x = left + indent;
    items.forEach((s, i) => {
      doc
        .font(s.bold ? "bold" : s.italic ? "italic" : "body")
        .fontSize(size)
        .fillColor(s.link ? BLUE : s.code ? "#3f4656" : INK)
        .text(s.text, {
          width: width - indent,
          continued: i < items.length - 1,
          link: s.link ?? null,
          underline: Boolean(s.link),
          lineGap: 2.5,
        });
    });
    doc.moveDown(gap / size);
    doc.x = left;
  };

  const table = (node: MdTable, indent: number) => {
    const rows = tableRows(node);
    const columns = Math.max(...rows.map((r) => r.length));
    const colWidth = (width - indent) / columns;
    const pad = 5;
    doc.moveDown(0.2);
    rows.forEach((cells, r) => {
      doc.font(r === 0 ? "bold" : "body").fontSize(8.5);
      const height =
        Math.max(
          ...cells.map((c) =>
            doc.heightOfString(c || " ", { width: colWidth - pad * 2 }),
          ),
        ) +
        pad * 2;
      if (doc.y + height > bottom()) doc.addPage();
      const y = doc.y;
      for (let c = 0; c < columns; c++) {
        const x = left + indent + c * colWidth;
        if (r === 0) doc.rect(x, y, colWidth, height).fill("#eef2fc");
        doc.rect(x, y, colWidth, height).lineWidth(0.6).stroke(LINE);
        doc
          .fillColor(INK)
          .font(r === 0 ? "bold" : "body")
          .fontSize(8.5)
          .text(cells[c] ?? "", x + pad, y + pad, {
            width: colWidth - pad * 2,
          });
      }
      doc.y = y + height;
    });
    doc.x = left;
    doc.moveDown(0.8);
  };

  const list = (node: List, depth: number) => {
    node.children.forEach((item, i) => {
      const marker = node.ordered ? `${(node.start ?? 1) + i}. ` : "•  ";
      let first = true;
      for (const child of item.children) {
        if (child.type === "paragraph") {
          write(
            [...(first ? [{ text: marker }] : []), ...spans(child.children)],
            10.5,
            14 + depth * 16,
            3,
          );
          first = false;
        } else block(child, depth + 1);
      }
    });
    doc.moveDown(0.3);
  };

  const block = (node: RootContent, depth = 0) => {
    if (doc.y > bottom() - 40) doc.addPage();
    switch (node.type) {
      case "heading": {
        const size = node.depth === 1 ? 18 : node.depth === 2 ? 14.5 : 12;
        // Keep a heading with at least a few lines of what follows it.
        if (doc.y > bottom() - 90) doc.addPage();
        doc.moveDown(node.depth <= 2 ? 0.6 : 0.3);
        write(
          spans(node.children).map((s) => ({ ...s, bold: true })),
          size,
          0,
          5,
        );
        break;
      }
      case "paragraph":
        write(spans(node.children), 10.5, depth * 16, 7);
        break;
      case "list":
        list(node, depth);
        break;
      case "table":
        table(node, depth * 16);
        break;
      case "blockquote": {
        const top = doc.y;
        for (const child of node.children) block(child, depth + 1);
        doc
          .moveTo(left + depth * 16 + 4, top)
          .lineTo(left + depth * 16 + 4, doc.y - 6)
          .lineWidth(2)
          .stroke(LINE);
        break;
      }
      case "code":
        write([{ text: node.value, code: true }], 9, depth * 16 + 8, 7);
        break;
      case "thematicBreak":
        doc
          .moveTo(left, doc.y + 4)
          .lineTo(left + width, doc.y + 4)
          .lineWidth(0.6)
          .stroke(LINE);
        doc.moveDown(1);
        break;
      default:
        if ("children" in node)
          for (const child of node.children as RootContent[])
            block(child, depth);
    }
  };

  doc.font("bold").fontSize(9).fillColor(BLUE).text("OCTO RESEARCH", left);
  doc.moveDown(0.4);
  doc.font("bold").fontSize(21).fillColor(INK).text(run.title, { width });
  doc
    .moveDown(0.3)
    .font("body")
    .fontSize(9.5)
    .fillColor(MUTED)
    .text(
      `${workflowLabels[run.workflow]} · ${providerLabel(run)} · ${dateLabel()}`,
      { width },
    );
  doc.moveDown(1.2);
  for (const node of parse(fullMarkdown(run)).children) block(node);

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const margin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font("body")
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        `${run.title} · page ${i + 1} of ${range.count}`,
        left,
        doc.page.height - 38,
        { width, align: "center", lineBreak: false },
      );
    doc.page.margins.bottom = margin;
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

/* ---------- Word ---------- */

async function toDocx(run: Run): Promise<Buffer> {
  let ordered = 0;
  const runs = (items: Span[], extra: { bold?: boolean } = {}) =>
    items.map((s) => {
      const text = new TextRun({
        text: s.text,
        bold: s.bold || extra.bold,
        italics: s.italic,
        font: s.code ? "Consolas" : undefined,
        style: s.link ? "Hyperlink" : undefined,
      });
      return s.link
        ? new ExternalHyperlink({ link: s.link, children: [text] })
        : text;
    });
  const blocks = (node: RootContent, depth = 0): (Paragraph | Table)[] => {
    switch (node.type) {
      case "heading":
        return [
          new Paragraph({
            heading: [
              HeadingLevel.HEADING_1,
              HeadingLevel.HEADING_2,
              HeadingLevel.HEADING_3,
              HeadingLevel.HEADING_4,
            ][Math.min(node.depth, 4) - 1],
            children: runs(spans(node.children)),
          }),
        ];
      case "paragraph":
        return [
          new Paragraph({
            children: runs(spans(node.children)),
            indent: depth ? { left: depth * 360 } : undefined,
            spacing: { after: 140 },
          }),
        ];
      case "list": {
        const instance = node.ordered ? ++ordered : 0;
        return node.children.flatMap((item) =>
          item.children.flatMap((child, i) =>
            child.type === "paragraph" && i === 0
              ? [
                  new Paragraph({
                    children: runs(spans(child.children)),
                    ...(node.ordered
                      ? {
                          numbering: {
                            reference: "ordered",
                            level: Math.min(depth, 2),
                            instance,
                          },
                        }
                      : { bullet: { level: Math.min(depth, 2) } }),
                  }),
                ]
              : blocks(child, depth + 1),
          ),
        );
      }
      case "table": {
        const rows = tableRows(node);
        const columns = Math.max(...rows.map((r) => r.length));
        return [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: rows.map(
              (cells, r) =>
                new TableRow({
                  tableHeader: r === 0,
                  children: Array.from({ length: columns }, (_, c) => {
                    return new TableCell({
                      shading:
                        r === 0
                          ? {
                              type: ShadingType.CLEAR,
                              fill: "EEF2FC",
                              color: "auto",
                            }
                          : undefined,
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: cells[c] ?? "",
                              bold: r === 0,
                            }),
                          ],
                        }),
                      ],
                    });
                  }),
                }),
            ),
          }),
          new Paragraph({ children: [] }),
        ];
      }
      case "blockquote":
        return node.children.flatMap((child) => blocks(child, depth + 1));
      case "code":
        return node.value.split("\n").map(
          (line) =>
            new Paragraph({
              children: [
                new TextRun({ text: line, font: "Consolas", size: 18 }),
              ],
            }),
        );
      case "thematicBreak":
        return [
          new Paragraph({
            children: [],
            border: {
              bottom: {
                style: BorderStyle.SINGLE,
                size: 6,
                color: "D9E0F2",
                space: 4,
              },
            },
          }),
        ];
      default:
        return "children" in node
          ? (node.children as RootContent[]).flatMap((c) => blocks(c, depth))
          : [];
    }
  };
  const doc = new Document({
    creator: "Octo",
    title: run.title,
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 21 } },
      },
    },
    numbering: {
      config: [
        {
          reference: "ordered",
          levels: [0, 1, 2].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: {
              paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } },
            },
          })),
        },
      ],
    },
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: "OCTO RESEARCH",
                bold: true,
                color: "002FA7",
                size: 18,
              }),
            ],
          }),
          new Paragraph({
            heading: HeadingLevel.TITLE,
            children: [new TextRun(run.title)],
          }),
          new Paragraph({
            spacing: { after: 240 },
            children: [
              new TextRun({
                text: `${workflowLabels[run.workflow]} · ${providerLabel(run)} · ${dateLabel()}`,
                color: "6F7686",
                size: 18,
              }),
            ],
          }),
          ...parse(fullMarkdown(run)).children.flatMap((n) => blocks(n)),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/* ---------- CSV ---------- */

/** Company records when present, otherwise every table in the report. */
function toCsvFile(run: Run): string {
  if (run.leads.length) return toCsv(run.leads);
  const tables = parse(run.report).children.filter(
    (n): n is MdTable => n.type === "table",
  );
  if (!tables.length)
    throw new Error("This report has no rows to export as CSV.");
  return tables
    .map((t) =>
      tableRows(t)
        .map((cells) => cells.map(csvCell).join(","))
        .join("\r\n"),
    )
    .join("\r\n\r\n");
}

export async function renderDeliverable(
  run: Run,
  format: DeliverableFormat,
): Promise<Deliverable> {
  switch (format) {
    case "pdf":
      return {
        bytes: await toPdf(run),
        contentType: "application/pdf",
        extension: "pdf",
      };
    case "docx":
      return {
        bytes: await toDocx(run),
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        extension: "docx",
      };
    case "csv":
      // A byte-order mark lets Excel open UTF-8 (₹, accents) correctly.
      return {
        bytes: Buffer.from("﻿" + toCsvFile(run), "utf8"),
        contentType: "text/csv; charset=utf-8",
        extension: "csv",
      };
    case "md":
      return {
        bytes: Buffer.from(run.report, "utf8"),
        contentType: "text/markdown; charset=utf-8",
        extension: "md",
      };
    case "json":
      return {
        bytes: Buffer.from(
          JSON.stringify(
            {
              title: run.title,
              mode: run.mode,
              brief: run.brief,
              report: run.report,
              sources: run.sources,
              leads: run.leads,
              notes: run.notes,
            },
            null,
            2,
          ),
          "utf8",
        ),
        contentType: "application/json; charset=utf-8",
        extension: "json",
      };
  }
}
