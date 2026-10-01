# Octo

A TypeScript research workspace supporting **Google Antigravity on Gemini Interactions** and the **OpenAI Agents API**. It can be run locally and adapted into a product later.

## Start locally

Requires Node.js **22.14 or newer** and npm. Node's built-in SQLite is experimental on Node 22; use a current supported Node version when deploying.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. The API runs on port 3001. Without a key, the app works in clearly labelled demo mode; it does **not** research your brief or process attachments.

For Google testing, add `GEMINI_API_KEY` from Google AI Studio to `.env` and restart. Google is the default for new research. Use a free-tier project and check its actual quotas in AI Studio; paid projects follow their billing settings. The app never falls back to OpenAI.

```dotenv
DEFAULT_PROVIDER=google
GEMINI_API_KEY=your_key_here
GEMINI_AGENT=antigravity-preview-09-2026
GEMINI_MODEL=gemini-3.8-flash
```

Choose Google or OpenAI in the research form. Provider, agent, and model settings are pinned to each run. Existing runs without a provider retain OpenAI. Keys stay on the server; never use a `VITE_` variable for credentials. A configured key does not prove access.

OpenAI remains available through `OPENAI_API_KEY` and `OPENAI_MODEL` (default `gpt-6-astra`). Its key needs `api.agents.read`, `api.agents.write`, and `api.responses.write`. Set `DEFAULT_PROVIDER=openai` to select it by default.

Google uses background stored interactions, web search, a hosted sandbox, a best-effort native `max_total_tokens` budget, and chained follow-ups that reuse the environment. It performs specialist research passes; we do not fabricate managed subagent activity. Documents are mounted as sandbox files. Completed outputs are frozen under `data/google-artifacts` so follow-ups cannot overwrite prior downloads. Structured JSON is validated before company records are shown. Polling backs off on HTTP 429. Google has no supported list-by-local-run recovery endpoint: ambiguous create/follow-up submissions are never automatically repeated. Inspect AI Studio before retrying manually. Expired environments or saved interactions can prevent continuation.

This is a preview integration. Tests mock Google responses; a real key is required to verify account access, actual research, document conversion, and CRM tools. See [Google Antigravity documentation](https://ai.google.dev/gemini-api/docs/antigravity-agent) and [environment documentation](https://ai.google.dev/gemini-api/docs/agent-environment).

## Workflows

- **Market intelligence:** market structure, company comparisons, public pricing, regulation, calculations, and an investor briefing.
- **Sales research:** an explicit ICP plus optional documents; a target of 1–100 companies; fit evidence, potential needs, public decision makers, and source links. A run may return fewer verified matches than requested. CSV export neutralizes spreadsheet formulas.
- **Ongoing research:** a saved session, scheduled checks, and comparison against previous findings. Interval and remaining checks are configurable. The server must remain online. After downtime, one overdue check runs; the scheduler does not issue a burst of missed checks.

Each workflow supports a brief, up to five context files (5 MB each), activity, specialist agents, source links, local notes, Markdown/JSON exports, and same-session follow-ups. Supported uploads: PDF, CSV, TXT, Markdown, JSON, XLSX, DOCX. Hosted agents may need to install libraries to read a particular document; conversion success is not guaranteed. Initial files are delivered to `/workspace/inputs`. Outputs written under `/workspace/outputs` become downloadable published artifacts after the turn completes.

User notes are stored locally; they are not automatically added to the remote prompt. Include any notes you want used in your next follow-up.

## A small first live test

1. For Google, use a free-tier project and inspect AI Studio quotas. For OpenAI, add API credit and configure spend controls in your project. A ChatGPT subscription does not supply this app's API billing.
2. Select **Live**, a **1 minute** time limit, a **5,000 token** limit, and a narrow brief such as “Find two Indian EV charging companies and compare their publicly documented business models. Cite their official websites. Identify unknown pricing.”
3. Review the report, source links, artifacts, and project usage before making the task larger.

**There is no promise that $5–$10 completes an arbitrary research job.** The API bills model calls, tools, and hosted sandbox usage. Subagent work contributes usage. The app's time/token controls request cancellation using best-effort accounting; in-flight work and reporting delay can exceed the thresholds. The token limit applies to additional session usage during the current turn, while the displayed usage is cumulative session usage. Missing usage stays unknown, not zero.

The app starts one local research run at a time and enables up to two concurrent remote specialists on OpenAI; Google performs separate research passes. Recurring checks have the same per-turn limits and can each incur charges. Stop a schedule when it is no longer needed.

## CRM MCP

Configure your actual remote HTTPS MCP server in `.env`:

```dotenv
CRM_MCP_URL=https://your-real-crm-mcp.example/mcp
CRM_MCP_TOKEN=your_server_token
CRM_MCP_ALLOWED_TOOLS=your_lookup_tool,your_upsert_company_tool
```

Replace the example URL and tool names with your server's supported configuration. The app checks that configuration is present, not that your CRM credentials work. Only completed **live** company results can be exported. Review the company list and approve the export in the UI. An export creates a **separate, persisted session** that has only the allowed CRM tools; research sessions have no CRM access. The export report contains the actual results. An agent is instructed to deduplicate by website and perform no outreach. Inspect successful and failed rows before repeating an export. Remote side effects cannot be made transactional by this app.

## Durable execution

- SQLite saves local runs, IDs, notes, schedule state, attachments, and follow-up idempotency keys in `data/research.sqlite`.
- The backend uses the documented REST endpoint `/v1/agents/sessions` with `OpenAI-Beta: agents=v1`.
- An initial hosted session enables live web search and managed multi-agent orchestration.
- The worker polls saved sessions, paginated items, root turns, subagents, and artifacts. Streams are not required for recovery. This means activity can lag the API rather than being token-by-token.
- A root **completed** turn makes a report available. An **idle** session or completed subagent does not imply success.
- On follow-ups, a previous root turn cannot complete the new run.
- On a restart or lost create response, the worker searches project sessions for the local run ID. If creation has an uncertain outcome and no saved match is found, it stops for manual inspection rather than creating another paid session.
- Failed turns, malformed structured outputs, unavailable credentials, and required external actions appear explicitly. Required actions are not automatically approved; inspect them in your project or cancel the run.

Hosted sandboxes can expire. The API's saved session and published artifacts have different lifetimes from live sandbox files. Download work you want to keep. This app does not automatically delete remote sessions, artifacts, or uploaded local files; manage retention before operating as a hosted service.

## Build and verify

```sh
npm test
npm run build
npm run test:e2e
```

Backend tests use mock provider responses and temporary databases; they never use your API key or incur API charges. Browser tests exercise demo workflows. Install the Playwright Chromium browser if your system does not already have it (`npx playwright install chromium`). Browser tests create labelled test runs in the local workspace.

To serve the production build:

```sh
npm run build
npm start
```

Production runs at **http://127.0.0.1:3001** and serves both the frontend and API. Set `APP_ORIGIN` to your deployed origin. If binding beyond loopback, `APP_TOKEN` is mandatory; the UI asks for it and stores it in tab session storage. Use HTTPS for remote deployments.

## Product boundaries

This is a **single-workspace, self-hosted starter**, with functioning application workflows and an Agents API adapter. It is not a deployed multi-tenant SaaS. Before offering it as a hosted service, add proper user accounts, per-user authorization and storage isolation, enforced project budgets, billing, retention/deletion controls, a resilient external job queue, tenant-specific CRM credentials, and operational monitoring.

Model output is not guaranteed to be correct. Prompts require dated sources, unknown values, explicit hypotheses, and checked calculations; human review is still necessary. Live OpenAI access, document processing, factual report quality, and CRM tool behavior must be tested using your real account. No real credentials were used during the initial build.

## Official references

- [Agents API overview](https://developers.openai.com/api/docs/guides/agents-api/overview)
- [Quickstart and key permissions](https://developers.openai.com/api/docs/guides/agents-api/quickstart)
- [Saved sessions and follow-ups](https://developers.openai.com/api/docs/guides/agents-api/sessions)
- [Multi-agent orchestration](https://developers.openai.com/api/docs/guides/agents-api/multi-agent)
- [Hosted files and artifacts](https://developers.openai.com/api/docs/guides/agents-api/environments/files)
- [Usage and cost accounting](https://developers.openai.com/api/docs/guides/agents-api/observability)
- [MCP connections](https://developers.openai.com/api/docs/guides/agents-api/tools/mcp)

## Stack

React 19, TypeScript, Vite, Express 5, Node SQLite, Zod, Lucide icons, React Markdown, ECharts, Loading.dev, bot-avatars, Inter (self-hosted), cmdk, Vitest, and Playwright. No external font or image service is required. The workspace uses the original blue-and-white design with animated agent mascots, workflow cards, research table, and custom accessible dropdowns. See [DESIGN.md](DESIGN.md) for the reference study and interaction decisions.
