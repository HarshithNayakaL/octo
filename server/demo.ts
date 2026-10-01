import type { Run, Lead } from "../shared/types.js";

const sampleLeads: Lead[] = [
  {
    company: "Example Fleet Systems",
    website: "https://example.com/fleet",
    industry: "Fleet software",
    size: "Example: 50–200",
    fit: "high",
    evidence:
      "Illustrative evidence: a public engineering job listing describes a growing data platform.",
    needs:
      "Hypothesis: improving data integration could reduce reporting overhead.",
    decisionMaker: "Unknown — verify before outreach",
    sources: [
      {
        title: "Illustrative source (not researched)",
        url: "https://example.com/fleet",
      },
    ],
  },
  {
    company: "Example Energy Labs",
    website: "https://example.com/energy",
    industry: "Energy technology",
    size: "Unknown",
    fit: "medium",
    evidence:
      "Illustrative evidence: the company fits the target industry; company size is unverified.",
    needs:
      "Hypothesis: operational analytics may be relevant. Validate in discovery.",
    decisionMaker: "Unknown — verify before outreach",
    sources: [
      {
        title: "Illustrative source (not researched)",
        url: "https://example.com/energy",
      },
    ],
  },
];
export function demoResult(run: Run) {
  const introduction = `> **Demo output.** This is an illustrative workflow, not live research. No API calls were made. The company records and findings below are examples.\n\n`;
  if (run.workflow === "sales")
    return {
      report:
        introduction +
        `# Sales research shortlist\n\n## Your ideal customer profile\n\n${run.icp}\n\n## Example output\n\nThis demonstration returns two fictional records rather than pretending to have researched ${run.targetCount} companies.\n\n| Company | Fit | Evidence quality | Potential need |\n|---|---|---|---|\n| Example Fleet Systems | High | Illustrative job signal | Data integration |\n| Example Energy Labs | Medium | Industry match only | Operational analytics |\n\n## Review before export\n\nVerify every company, source, size, and fit assessment in a live run. Potential needs are hypotheses. Decision makers remain unknown when there is no public evidence.\n\n## Research brief\n\n${run.brief}`,
      leads: sampleLeads,
      sources: sampleLeads.flatMap((l) => l.sources),
    };
  return {
    report:
      introduction +
      `# ${run.title}\n\n## Executive briefing\n\nThis sample shows how your research will be organized. A live session will investigate the brief, preserve research notes, compare evidence, and produce a cited report.\n\n## Research question\n\n${run.brief}\n\n## Research plan\n\n1. **Market structure.** Define the geography, time horizon, customer segments, and market boundaries.\n2. **Competitors.** Compare products, business models, coverage, partnerships, and publicly documented traction.\n3. **Pricing.** Record public tariffs with currency, unit, location, and observation date. Keep unpublished prices unknown.\n4. **Regulation.** Inspect government documents and identify effective dates and applicability.\n5. **Final review.** Reconcile conflicting evidence, check calculations, and separate facts from estimates.\n\n## Evidence standard\n\n| Claim | Required evidence | Treatment of missing data |\n|---|---|---|\n| Market size | Dated primary data and explicit scope | Report as unknown |\n| Company coverage | Company disclosure or verified location data | State verification gap |\n| Unit economics | Published inputs and calculation method | Label scenario, not fact |\n| Regulatory requirement | Current government document | Verify jurisdiction and date |\n\n## Questions for an investor\n\n- What is the utilization needed for break-even?\n- Which revenue comes from hardware, energy, software, or services?\n- How do land, electricity, maintenance, and financing affect unit economics?\n- Which claims are independently corroborated?\n\n## Calculation method\n\nAnnual gross contribution = charging sessions per day × kWh per session × contribution per kWh × operating days. A live report must source each input and show sensitivity; this example supplies no invented figures.\n\n## Next steps\n\n${run.workflow === "monitor" ? "Follow-up checks compare new evidence against this session’s saved context. The scheduler runs while the server is online." : "Start a live run to collect evidence and answer these questions."}`,
    leads: [],
    sources: [],
  };
}
export function seedRun(): Run {
  const now = new Date().toISOString();
  const run: Run = {
    id: "sample-briefing",
    title: "Indian EV charging market",
    workflow: "market",
    brief:
      "Research the Indian EV charging market and prepare an investor briefing. Compare business models, public pricing, regulation, and investment risks.",
    icp: "",
    targetCount: 10,
    mode: "demo",
    status: "completed",
    createdAt: now,
    updatedAt: now,
    report: "",
    leads: [],
    sources: [],
    activities: [],
    agents: [
      { id: "sample-market", name: "Market researcher", status: "completed" },
      {
        id: "sample-competitor",
        name: "Competitor researcher",
        status: "completed",
      },
      { id: "sample-pricing", name: "Pricing researcher", status: "completed" },
      {
        id: "sample-regulation",
        name: "Regulation researcher",
        status: "completed",
      },
    ],
    artifacts: [],
    attachments: [],
    notes: "Sample workspace. Add your own notes here; they are saved locally.",
    maxMinutes: 5,
    maxTokens: 20000,
    intervalHours: 24,
    remainingChecks: 0,
  };
  Object.assign(run, demoResult(run));
  run.activities = [
    {
      id: "sample-1",
      type: "demo",
      label: "Sample briefing prepared",
      text: "Explore the report layout. This sample has not searched the web.",
      at: now,
    },
  ];
  return run;
}
