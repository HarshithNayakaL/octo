import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { Store } from "../server/store";
import { createApp } from "../server/app";
import { ProviderError, type Provider } from "../server/provider";
import {
  assertPublicUrl,
  checkEvidence,
  fetchSourceText,
  heuristicClaims,
  matchClaim,
  normaliseModelClaims,
} from "../server/evidence";
import { extractiveAnswer } from "../server/ask";
import { initialInput, refreshInput } from "../server/prompts";
import { strictSchema } from "../server/structured";
import { seedRun } from "../server/demo";
import type { Run } from "../shared/types";

let directory: string;
let store: Store;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "octo-diff-"));
  store = new Store(directory);
});
afterEach(async () => {
  await store.close();
  rmSync(directory, { recursive: true, force: true });
});

const publicLookup = async () => [{ address: "93.184.216.34" }];
const html = (
  body: string,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
const report = `# Payments

## Findings

UPI processed 18.4 billion transactions in March 2025 ([NPCI statistics](https://www.npci.org.in/stats)).
Pix reached 6,000 participating institutions in 2024 [1].
Merchant fees on Pix average 0.22% of the transaction value.
This sentence is short.

## Sources

1. [BCB Pix statistics](https://www.bcb.gov.br/pix)
`;

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    recover: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue({ id: "sess" }),
    snapshot: vi.fn(),
    message: vi.fn().mockResolvedValue({ id: "sess-2" }),
    cancel: vi.fn().mockResolvedValue(undefined),
    artifact: vi.fn(),
    exportCrm: vi.fn(),
    ...overrides,
  };
}
function server(google: Provider = provider(), request?: typeof fetch) {
  return createApp({
    store,
    providers: { google },
    defaultProvider: "google",
    providerConfigurations: [
      {
        id: "google",
        name: "Google",
        ready: true,
        model: "g",
        crmReady: false,
      },
    ],
    model: "m",
    crmReady: false,
    origin: "http://x",
    background: (w) => void w.catch(() => undefined),
    engine: { evidence: { request, lookup: publicLookup } },
  });
}
const liveRun = (fields: Partial<Run> = {}): Run => ({
  ...seedRun(),
  id: "r",
  provider: "google",
  mode: "live",
  status: "completed",
  sessionId: "sess",
  report,
  ...fields,
});

describe("evidence check", () => {
  it("finds linked, numbered and uncited claims in a report", () => {
    const claims = heuristicClaims(report);
    expect(claims).toHaveLength(3);
    expect(claims[0]).toMatchObject({
      sourceUrl: "https://www.npci.org.in/stats",
      sourceTitle: "NPCI statistics",
    });
    expect(claims[0].claim).toContain("18.4 billion");
    expect(claims[1].sourceUrl).toBe("https://www.bcb.gov.br/pix");
    expect(claims[1].claim).not.toContain("[1]");
    expect(claims[2].sourceUrl).toBeUndefined();
  });
  it("matches figures and wording against the cited page", () => {
    const page =
      "In March 2025, UPI recorded 18.4 billion transactions worth ₹24.77 lakh crore.";
    expect(
      matchClaim(
        "UPI processed 18.4 billion transactions in March 2025",
        undefined,
        page,
      ).status,
    ).toBe("supported");
    expect(
      matchClaim("x", "recorded 18.4 billion transactions", page).excerpt,
    ).toContain("18.4 billion");
    expect(
      matchClaim(
        "UPI processed 19.2 billion transactions in March 2025",
        undefined,
        page,
      ).status,
    ).toBe("partial");
    expect(
      matchClaim("Pix charges 0.22% on merchant payments", undefined, page)
        .status,
    ).toBe("not_found");
    expect(
      matchClaim(
        "Pix reached 6,000 institutions",
        undefined,
        "Pix has 6000 participating institutions",
      ).status,
    ).toBe("supported");
  });
  it("refuses private, local and metadata addresses", async () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://10.0.0.5/x",
      "http://169.254.169.254/latest/meta-data",
      "http://[::ffff:127.0.0.1]/",
      "http://[::1]/",
      "file:///etc/passwd",
      "https://user:pw@example.com/",
      "https://example.com:8080/",
    ])
      await expect(assertPublicUrl(url, publicLookup)).rejects.toThrow();
    await expect(
      assertPublicUrl("https://intranet.example/", async () => [
        { address: "192.168.1.4" },
      ]),
    ).rejects.toThrow(/private or local/);
    await expect(
      assertPublicUrl("https://www.rbi.org.in/x", publicLookup),
    ).resolves.toBeInstanceOf(URL);
  });
  it("re-checks redirects and reads HTML and PDF pages as text", async () => {
    const pdf = await new Promise<Buffer>((done) => {
      const doc = new PDFDocument();
      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => done(Buffer.concat(chunks)));
      doc.text("Pix settled 63.8 billion transactions in 2024.");
      doc.end();
    });
    const fetcher = vi.fn(async (url: URL | RequestInfo) => {
      const u = String(url);
      if (u.endsWith("/moved"))
        return new Response(null, {
          status: 302,
          headers: { location: "/page" },
        });
      if (u.endsWith("/page"))
        return html(
          "<html><script>var x=1</script><p>Hello &amp; welcome</p></html>",
        );
      if (u.endsWith("/evil"))
        return new Response(null, {
          status: 301,
          headers: { location: "http://169.254.169.254/" },
        });
      return new Response(new Uint8Array(pdf), {
        headers: { "content-type": "application/pdf" },
      });
    }) as unknown as typeof fetch;
    const options = { request: fetcher, lookup: publicLookup };
    expect(await fetchSourceText("https://a.example/moved", options)).toBe(
      "Hello & welcome",
    );
    await expect(
      fetchSourceText("https://a.example/evil", options),
    ).rejects.toThrow(/private or local/);
    expect(
      await fetchSourceText("https://a.example/report.pdf", options),
    ).toContain("63.8 billion");
  });
  it("keeps only URLs the report cites when a model extracts claims", () => {
    const claims = normaliseModelClaims(
      {
        claims: [
          {
            claim: "UPI processed 18.4 billion transactions",
            quote: "18.4 billion",
            sourceUrl: "https://www.npci.org.in/stats",
          },
          {
            claim: "Pix reached 6,000 institutions in 2024",
            quote: "6,000",
            sourceUrl: "https://www.bcb.gov.br/pix",
          },
          {
            claim: "A made-up source says something",
            quote: "x",
            sourceUrl: "http://169.254.169.254/",
          },
        ],
      },
      report,
    );
    expect(claims.map((c) => c.sourceUrl)).toEqual([
      "https://www.npci.org.in/stats",
      "https://www.bcb.gov.br/pix",
      undefined,
    ]);
  });
  it("checks each cited page once and scores the report", async () => {
    const fetcher = vi.fn(async (url: URL | RequestInfo) =>
      String(url).includes("npci")
        ? html("<p>UPI processed 18.4 billion transactions in March 2025.</p>")
        : html("Not here", 404),
    ) as unknown as typeof fetch;
    const result = await checkEvidence(liveRun(), provider(), {
      request: fetcher,
      lookup: publicLookup,
    });
    expect(result.method).toBe("heuristic");
    expect(result.claims.map((c) => c.status)).toEqual([
      "supported",
      "unreachable",
      "uncited",
    ]);
    expect(result.claims[1].note).toContain("404");
    // Unreachable pages are not counted against the report.
    expect(result.score).toBe(50);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("closes every object for OpenAI strict schemas", () => {
    const strict = strictSchema({
      type: "object",
      properties: {
        a: {
          type: "array",
          items: { type: "object", properties: { b: { type: "string" } } },
        },
      },
    }) as any;
    expect(strict.additionalProperties).toBe(false);
    expect(strict.properties.a.items).toMatchObject({
      additionalProperties: false,
      required: ["b"],
    });
  });
});

describe("evidence, versions and refresh through the engine", () => {
  it("checks evidence after a demo report and keeps the earlier report as a version", async () => {
    const { app, engine } = server();
    const created = await request(app).post("/api/runs").send({
      title: "Demo evidence",
      workflow: "general",
      brief: "How are EV charging operators priced in India?",
      mode: "demo",
      clarify: false,
    });
    const id = created.body.id;
    const age = async () => {
      const run = (await store.get(id))!;
      run.startedAt = new Date(Date.now() - 10_000).toISOString();
      await store.save(run);
    };
    await engine.process(id);
    await age();
    await engine.process(id);
    let run = (await store.get(id))!;
    expect(run.status).toBe("completed");
    expect(run.evidence?.status).toBe("pending");
    await engine.process(id);
    run = (await store.get(id))!;
    expect(run.evidence?.status).toBe("done");
    expect(run.evidence!.claims.length).toBe(5);
    expect(run.evidence!.claims.at(-1)!.status).toBe("uncited");
    expect(run.activities.some((a) => a.label === "Evidence checked")).toBe(
      true,
    );

    const refreshed = await request(app)
      .post(`/api/runs/${id}/refresh`)
      .send({});
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.pendingInput.text).toContain("What changed");
    run = (await store.get(id))!;
    run.report = "An earlier report";
    run.updatedAt = "2026-01-01T00:00:00.000Z";
    await store.save(run);
    await age();
    await engine.process(id);
    run = (await store.get(id))!;
    expect(run.status).toBe("completed");
    expect(run.versions).toHaveLength(1);
    expect(run.versions![0]).toMatchObject({
      report: "An earlier report",
      label: "First report",
    });
  });
  it("saves evidence onto the latest copy of the run", async () => {
    const fetcher = vi.fn(async () => {
      const run = (await store.get("r"))!;
      run.notes = "Written during the check";
      await store.save(run);
      return html("UPI processed 18.4 billion transactions in March 2025");
    }) as unknown as typeof fetch;
    const { engine } = server(provider(), fetcher);
    await store.save(
      liveRun({
        evidence: {
          status: "pending",
          requestedAt: new Date().toISOString(),
          reportLength: report.length,
          claims: [],
        },
      }),
    );
    await engine.process("r");
    const run = (await store.get("r"))!;
    expect(run.evidence?.status).toBe("done");
    expect(run.notes).toBe("Written during the check");
  });
  it("re-checks evidence on request and only for finished reports", async () => {
    const { app } = server();
    await store.save(liveRun());
    const res = await request(app).post("/api/runs/r/evidence").send({});
    expect(res.status).toBe(200);
    expect(res.body.evidence.status).toBe("pending");
    await store.save(liveRun({ id: "busy", status: "running" }));
    expect((await request(app).post("/api/runs/busy/evidence")).status).toBe(
      409,
    );
  });
  it("refreshes only completed research", async () => {
    const { app } = server();
    await store.save(liveRun({ status: "partial" }));
    expect(
      (await request(app).post("/api/runs/r/refresh").send({})).status,
    ).toBe(409);
    expect(refreshInput(liveRun(), "Focus on 2026")).toContain("Focus on 2026");
  });
});

describe("ask this research", () => {
  it("answers from the report with checked claims and flags gaps", async () => {
    const structured = vi.fn().mockResolvedValue({
      answer: "UPI processed 18.4 billion transactions [c1].",
      coverage: "partly",
      claimIds: ["c1", "c99"],
      gap: "Find Pix monthly volumes for March 2025.",
    });
    const { app } = server(provider({ structured }));
    await store.save(
      liveRun({
        evidence: {
          status: "done",
          requestedAt: new Date().toISOString(),
          reportLength: 1,
          claims: [
            {
              id: "c1",
              claim: "UPI processed 18.4 billion",
              status: "supported",
            },
          ],
        },
      }),
    );
    const res = await request(app)
      .post("/api/runs/r/ask")
      .send({ question: "Which system is bigger by monthly volume?" });
    expect(res.status).toBe(200);
    const qa = res.body.questions[0];
    expect(qa).toMatchObject({ coverage: "partly", claimIds: ["c1"] });
    expect(qa.gap).toContain("Pix monthly volumes");
    const prompt = structured.mock.calls[0][1] as string;
    expect(prompt).toContain("Use ONLY the report");
    expect(prompt).toContain("[c1] (supported)");
  });
  it("reports a rate limit without saving an answer", async () => {
    const structured = vi
      .fn()
      .mockRejectedValue(new ProviderError("quota", 429, 60000));
    const { app } = server(provider({ structured }));
    await store.save(liveRun());
    const res = await request(app)
      .post("/api/runs/r/ask")
      .send({ question: "Anything?" });
    expect(res.status).toBe(429);
    expect((await store.get("r"))!.questions).toBeUndefined();
  });
  it("quotes matching passages without a model in demo runs", () => {
    const answer = extractiveAnswer(
      {
        ...seedRun(),
        report:
          "Intro paragraph that is long enough to count here.\n\nPix merchant fees average 0.22% of the value of each transaction.",
      },
      "What are Pix merchant fees?",
    );
    expect(answer.answer).toContain("0.22%");
    expect(answer.coverage).toBe("covered");
  });
});

describe("building on earlier research", () => {
  it("copies chosen earlier reports into the new run and its task", async () => {
    const { app } = server();
    await store.save(
      liveRun({
        id: "11111111-1111-4111-8111-111111111111",
        title: "UPI vs Pix",
      }),
    );
    const res = await request(app)
      .post("/api/runs")
      .send({
        title: "Pix in 2027",
        workflow: "general",
        brief: "What changes are coming to Pix in 2027?",
        mode: "demo",
        buildOn: ["11111111-1111-4111-8111-111111111111"],
      });
    expect(res.status).toBe(201);
    expect(res.body.priorResearch[0]).toMatchObject({ title: "UPI vs Pix" });
    expect(initialInput(res.body)).toContain(
      "Earlier research in this workspace",
    );
    expect(initialInput(res.body)).toContain("18.4 billion");

    const list = await request(app).get("/api/runs");
    const row = list.body.find((r: Run) => r.id === res.body.id);
    expect(row.priorResearch).toBeUndefined();
  });
  it("refuses to build on research without a report", async () => {
    const { app } = server();
    await store.save(
      liveRun({ id: "22222222-2222-4222-8222-222222222222", report: "" }),
    );
    const res = await request(app)
      .post("/api/runs")
      .send({
        title: "Follow on",
        workflow: "general",
        brief: "A follow-on question that is long enough.",
        mode: "demo",
        buildOn: ["22222222-2222-4222-8222-222222222222"],
      });
    expect(res.status).toBe(400);
  });
});

describe("evidence in downloads", () => {
  it("adds the evidence check to Markdown and JSON exports", async () => {
    const { renderDeliverable } = await import("../server/deliverables");
    const run = liveRun({
      evidence: {
        status: "done",
        requestedAt: new Date().toISOString(),
        reportLength: report.length,
        score: 50,
        claims: [
          {
            id: "c1",
            claim: "UPI | processed 18.4 billion",
            status: "supported",
            sourceUrl: "https://www.npci.org.in/stats",
            sourceTitle: "NPCI",
          },
          { id: "c2", claim: "Pix fees average 0.22%", status: "uncited" },
        ],
      },
    });
    const md = (await renderDeliverable(run, "md")).bytes.toString("utf8");
    expect(md).toContain("## Evidence check");
    expect(md).toContain("evidence score 50/100");
    expect(md).toContain(
      "| c1 | UPI \\| processed 18.4 billion | Supported | [NPCI](https://www.npci.org.in/stats) |",
    );
    expect(md).toContain(
      "| c2 | Pix fees average 0.22% | No source cited | — |",
    );
    const json = JSON.parse(
      (await renderDeliverable(run, "json")).bytes.toString("utf8"),
    );
    expect(json.evidence.score).toBe(50);
  });
});

describe("claim extraction from real report shapes", () => {
  it("inherits a bullet's citation, maps numbers to sources and splits tables", () => {
    const text = `* **Pix:** Pix processed **64 billion transactions** in 2024 [2]. It reached 160 million users and 15 million businesses.
* NPCI proposed a 30% volume cap, deferred to December 31, 2026.

| Metric | UPI | Pix |
|---|---|---|
| **Merchant MDR** | 0% on bank accounts [3] | 0.22%–0.50% [2] |
`;
    const sources = [
      { title: "BCB stats", url: "https://www.bcb.gov.br/a" },
      { title: "SPI 2024", url: "https://www.bcb.gov.br/spi.pdf" },
      { title: "NPCI", url: "https://www.npci.org.in/s" },
    ];
    const claims = heuristicClaims(text, 20, sources);
    const by = (t: string) => claims.find((c) => c.claim.includes(t))!;
    expect(by("64 billion").sourceUrl).toBe("https://www.bcb.gov.br/spi.pdf");
    expect(by("160 million").sourceUrl).toBe("https://www.bcb.gov.br/spi.pdf");
    expect(by("30% volume cap").sourceUrl).toBeUndefined();
    expect(by("Merchant MDR (UPI)").sourceUrl).toBe(
      "https://www.npci.org.in/s",
    );
    expect(by("Merchant MDR (Pix)").claim).toContain("0.22%");
  });
});
