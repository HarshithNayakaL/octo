# Octo

A TypeScript research workspace built around the **OpenAI Agents API**: a research director delegates to specialist agents, works in a hosted sandbox with live web search, and returns cited reports and structured company records. **Google Antigravity (Gemini Interactions)** is supported as an alternative provider, useful for testing on a Google free-tier project. Octo runs locally and can be deployed to Vercel.

## Start locally

Requires Node.js **22.14 or newer** and npm. Node's built-in SQLite is experimental on Node 22; use a current supported Node version when deploying.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. The API runs on port 3001. Without a key, the app works in clearly labelled demo mode; it does **not** research your brief or process attachments.

## OpenAI Agents API (primary)

Add your key to `.env` and restart:

```dotenv
DEFAULT_PROVIDER=openai
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-6-astra
```

The key needs `api.agents.read`, `api.agents.write`, and `api.responses.write`. OpenAI runs use durable saved sessions, managed multi-agent orchestration (up to two concurrent specialists), live web search, hosted sandbox files, published artifacts, and idempotent follow-ups. API usage is billed to your OpenAI project; a ChatGPT subscription does not cover it. See [Durable execution](#durable-execution) for how sessions are recovered.

## Google Antigravity (alternative provider)

Google can be selected per run in the research form, or made the default with `DEFAULT_PROVIDER=google`. The example `.env` uses Google so the workspace can be tested on a free-tier project before spending OpenAI credit; check your actual quotas in AI Studio.

```dotenv
DEFAULT_PROVIDER=google
GEMINI_API_KEY=your_key_here
GEMINI_AGENT=antigravity-preview-09-2026
GEMINI_MODEL=gemini-3.8-flash
```

Google uses background stored interactions, web search, a hosted sandbox, a best-effort native `max_total_tokens` budget, and chained follow-ups that reuse the environment. It performs specialist research passes inside one interaction; Octo does not show separate specialist activity for Google because the API does not report it. Documents are mounted as sandbox files. Completed outputs are frozen locally (or in Postgres on Vercel) so follow-ups cannot overwrite prior downloads. Polling backs off on HTTP 429. Google has no supported list-by-local-run recovery endpoint, so ambiguous create/follow-up submissions are never automatically repeated; inspect AI Studio before retrying manually. Expired environments or saved interactions can prevent continuation. This is a preview integration: tests mock Google responses. See the [Google Antigravity documentation](https://ai.google.dev/gemini-api/docs/antigravity-agent) and [environment documentation](https://ai.google.dev/gemini-api/docs/agent-environment).

## Choosing a provider

- Each run is pinned to the provider, agent, and model it started with. Runs created before provider selection existed stay on OpenAI.
- **There is no automatic switching.** If the selected provider is unavailable or rejects a request, the run reports the error; it is never retried on the other provider.
- Keys stay on the server. Never use a `VITE_` variable for credentials. A configured key does not prove access; the first live request does.
- Structured JSON from either provider is validated before company records are shown.

## Workflows

- **Market intelligence:** market structure, company comparisons, public pricing, regulation, calculations, and an investor briefing.
- **Sales research:** an explicit ICP plus optional documents; a target of 1–100 companies; fit evidence, potential needs, public decision makers, and source links. A run may return fewer verified matches than requested. CSV export neutralizes spreadsheet formulas.
- **Ongoing research:** a saved session, scheduled checks, and comparison against previous findings. Interval and remaining checks are configurable. The server must remain online. After downtime, one overdue check runs; the scheduler does not issue a burst of missed checks.

Each workflow supports a brief, up to five context files (5 MB each), activity, specialist agents, source links, local notes, Markdown/JSON exports, and same-session follow-ups. Supported uploads: PDF, CSV, TXT, Markdown, JSON, XLSX, DOCX. Hosted agents may need to install libraries to read a particular document; conversion success is not guaranteed. Initial files are delivered to `/workspace/inputs`. Outputs written under `/workspace/outputs` become downloadable published artifacts after the turn completes.

User notes are stored locally; they are not automatically added to the remote prompt. Include any notes you want used in your next follow-up.

## A small first live test

1. For OpenAI, add API credit and configure spend controls in your project. A ChatGPT subscription does not supply this app's API billing. To test without spending credit first, use Google on a free-tier project and inspect its AI Studio quotas.
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

## Deploy to Vercel

The repository is ready for Vercel: `vercel.json` builds the Vite frontend to the CDN and serves the Express API as one Vercel Function (`api/index.js`, compiled from `server/vercel.ts`). Run locally exactly as before; Vercel mode only applies to the deployed function.

**How it works without a server process.** Serverless functions stop between requests, so there is no background worker. Each run advances in short, leased steps:

- While the workspace is open, the UI's regular refresh triggers the next step, kept alive after the response with `waitUntil`. A run therefore progresses while someone has the app open.
- `/api/cron/tick` is a scheduled backstop. On the **Hobby plan Vercel allows cron at most once per day**, so scheduled ongoing-research checks run when someone opens the workspace or at the daily tick. On Pro, change the schedule in `vercel.json` (for example `*/5 * * * *`).
- A database lease ensures only one function instance advances a run at a time, so concurrent requests can never create a duplicate paid session. Steps on one run are spaced at least 4 seconds apart.

**Setup**

1. Import the repository in Vercel (framework detected from `vercel.json`).
2. Add a Postgres database from the Vercel Marketplace (Neon). It provides `DATABASE_URL`; tables are created automatically on first use.
3. Add environment variables (Production):

| Variable                        | Value                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`                | Your OpenAI key with Agents API access (mark Sensitive)                                                           |
| `GEMINI_API_KEY`                | Optional alternative provider: your Google AI Studio key (mark Sensitive)                                         |
| `APP_TOKEN`                     | A long random string, e.g. `openssl rand -hex 32` (mark Sensitive). Required: the API refuses to serve without it |
| `CRON_SECRET`                   | Optional random string; enables the scheduled backstop (Vercel sends it automatically)                            |
| `DEFAULT_PROVIDER`              | `openai`, or `google` while testing on a Google free tier                                                         |
| `OPENAI_MODEL`                  | `gpt-6-astra`                                                                                                     |
| `GEMINI_AGENT` / `GEMINI_MODEL` | `antigravity-preview-09-2026` / `gemini-3.8-flash` (only with `GEMINI_API_KEY`)                                   |
| `APP_ORIGIN`                    | Optional; your production URL. Same-host requests are always accepted                                             |

4. Deploy. Without `DATABASE_URL` or `APP_TOKEN`, the API returns a clear setup message instead of data.

**Limits on Vercel.** Function request and response bodies are capped at 4.5 MB, so uploads are limited to 4 MB per file and Google output files are cached only up to 4 MB (larger outputs stay in your Google project). Files are stored in Postgres. Each step must finish within the 300-second function limit. The per-minute write rate limit is per function instance.

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

Alternative provider:

- [Google Antigravity agent](https://ai.google.dev/gemini-api/docs/antigravity-agent)
- [Antigravity environments](https://ai.google.dev/gemini-api/docs/agent-environment)

## Stack

React 19, TypeScript, Vite, Express 5, Node SQLite, Zod, Lucide icons, React Markdown, ECharts, Loading.dev, bot-avatars, Inter (self-hosted), cmdk, Vitest, and Playwright. No external font or image service is required. The workspace uses the original blue-and-white design with animated agent mascots, workflow cards, research table, and custom accessible dropdowns. See [DESIGN.md](DESIGN.md) for the reference study and interaction decisions.
