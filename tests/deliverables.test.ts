import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { createApp } from "../server/app";
import { seedRun } from "../server/demo";
import { renderDeliverable } from "../server/deliverables";
import {
  formatFromBrief,
  formatsFor,
  preferredFormat,
} from "../shared/formats";
import type { Run } from "../shared/types";

const report = `# Briefing

Tariffs range from ₹18 to ₹24 per kWh ([source](https://example.gov)).

| Company | Tariff |
| --- | --- |
| =HYPERLINK("x") | ₹19 |
| Sample Grid | Unknown |
`;
const run = (overrides: Partial<Run> = {}): Run => ({
  ...seedRun(),
  id: "r1",
  title: "EV briefing",
  report,
  leads: [],
  sources: [{ title: "Gov", url: "https://example.gov" }],
  ...overrides,
});

describe("choosing a format", () => {
  it("follows the brief, then the workflow, then falls back to PDF", () => {
    expect(formatFromBrief("Send me a spreadsheet of companies")).toBe("csv");
    expect(formatFromBrief("I need a Word document")).toBe("docx");
    expect(formatFromBrief("Export as PDF please")).toBe("pdf");
    expect(formatFromBrief("Research the market")).toBeUndefined();
    expect(preferredFormat(run({ workflow: "market" }))).toBe("pdf");
    expect(preferredFormat(run({ workflow: "sales" }))).toBe("csv");
    expect(preferredFormat(run({ outputFormat: "docx" }))).toBe("docx");
    expect(
      preferredFormat(
        run({ brief: "Deliver a spreadsheet", workflow: "market" }),
      ),
    ).toBe("csv");
  });
  it("offers CSV only when there are rows", () => {
    expect(formatsFor(run())).toContain("csv");
    expect(formatsFor(run({ report: "# No tables here" }))).not.toContain(
      "csv",
    );
    expect(
      preferredFormat(run({ report: "# No tables", outputFormat: "csv" })),
    ).toBe("pdf");
  });
});

describe("rendering", () => {
  it("produces a real PDF with embedded fonts", async () => {
    const file = await renderDeliverable(run(), "pdf");
    expect(file.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(file.bytes.includes(Buffer.from("FontFile2"))).toBe(true);
  });
  it("produces a Word document", async () => {
    const file = await renderDeliverable(run(), "docx");
    expect(file.bytes.subarray(0, 2).toString()).toBe("PK");
    expect(file.extension).toBe("docx");
  });
  it("exports report tables as CSV with formulas neutralised and UTF-8 kept", async () => {
    const text = (await renderDeliverable(run(), "csv")).bytes.toString("utf8");
    expect(text.startsWith("﻿")).toBe(true);
    expect(text).toContain('"Company","Tariff"');
    expect(text).toContain(`"'=HYPERLINK(""x"")"`);
    expect(text).toContain("₹19");
  });
  it("prefers company records for CSV when they exist", async () => {
    const withLeads = run({
      leads: [
        {
          company: "Example",
          website: "https://example.com",
          industry: "EV",
          size: "10",
          fit: "high",
          evidence: "e",
          needs: "n",
          decisionMaker: "d",
          sources: [],
        },
      ],
    });
    const text = (await renderDeliverable(withLeads, "csv")).bytes.toString();
    expect(text).toContain("company,website");
  });
});

describe("export API", () => {
  let directory: string;
  let store: Store;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "octo-deliver-"));
    store = new Store(directory);
  });
  afterEach(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const server = () =>
    createApp({ store, model: "m", crmReady: false, origin: "http://x" }).app;
  it("downloads the preferred format by default and any listed format on request", async () => {
    await store.save(run({ outputFormat: "docx" }));
    const main = await request(server()).get("/api/runs/r1/export");
    expect(main.status).toBe(200);
    expect(main.headers["content-type"]).toContain("wordprocessingml");
    expect(main.headers["content-disposition"]).toContain('EV-briefing.docx"');
    const pdf = await request(server())
      .get("/api/runs/r1/export?format=pdf")
      .buffer(true)
      .parse((res, cb) => {
        const parts: Buffer[] = [];
        res.on("data", (c: Buffer) => parts.push(c));
        res.on("end", () => cb(null, Buffer.concat(parts)));
      });
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
  });
  it("refuses CSV when the report has no rows", async () => {
    await store.save(run({ report: "# Text only" }));
    const res = await request(server()).get("/api/runs/r1/export?format=csv");
    expect(res.status).toBe(409);
  });
  it("stores the requested deliverable on new runs", async () => {
    const res = await request(server()).post("/api/runs").send({
      title: "Format test",
      workflow: "market",
      brief: "Research the Indian EV charging market with public evidence.",
      mode: "demo",
      outputFormat: "docx",
    });
    expect(res.status).toBe(201);
    expect(res.body.outputFormat).toBe("docx");
  });
});
