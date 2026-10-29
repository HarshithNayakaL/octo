# Octo

A TypeScript research workspace built around the **OpenAI Agents API**: a research director delegates to specialist agents, works in a hosted sandbox with live web search, and returns cited reports and structured company records. **Google Antigravity (Gemini Interactions)** is supported as an alternative provider, useful for testing on a Google free-tier project. Octo runs locally and can be deployed to Vercel.

**Case study:** [harshith-nayaka-l-portfolio.vercel.app/work/octo](https://harshith-nayaka-l-portfolio.vercel.app/work/octo): the problem, the architecture and the engineering decisions behind Octo.

## Why Octo instead of a chat assistant

A chat assistant can research a question. Octo is built around what happens around the research: aiming it, checking it, and keeping it useful.

| | Chat assistant | Octo |
|---|---|---|
| Before research | Starts searching immediately | Says what it understood, proposes areas for this brief, and asks questions with options before spending a search |
| Citations | Shows links; you check them | **Evidence check:** opens every cited page and PDF itself and marks each claim Supported, Partly supported, Not found, No source cited or Could not check, with an evidence score |
| Real experience | Rarely reads Reddit; some assistants can't | **Community voices:** themes from public Reddit and Hacker News discussions with verbatim, linked quotes, optionally given to the agent |
| Source quality | SEO pages and blogs cited as evidence | Every source labelled by kind and date, blogs and review sites flagged, and a **source policy**: primary first, trusted and blocked domains |
| Contested questions | Often one-sided | Balanced by default; **Challenge this report** searches for counter-evidence and records a verdict for each challenge |
| Follow-up questions | Answered from the model's memory | **Ask this research:** answered only from the report and its checked claims; unanswered questions become one-click follow-up research |
| Over time | A one-off answer | **Refresh** any report, or schedule checks; every version is kept with a line-by-line **what changed** view |
| Across projects | Starts from zero | **Build on earlier research:** new runs can reuse related reports from your workspace and re-check what changed |
| Long work | Stops when it stops | Runs up to 3 hours; a run cut off by a limit keeps its partial report and continues into one report |
| Output | Text in a chat | PDF, Word, CSV, Markdown or JSON files, including the evidence check |

The user research behind these choices (3,314 Reddit and Hacker News posts plus published studies) is in [docs/research-findings.md](docs/research-findings.md).

## Start locally

Requires Node.js **24.22.1 or newer** on the 24.x line (22.23.4+ also works) and npm. Node's built-in SQLite is experimental on Node 22; use a current supported Node version when deploying.

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

### OpenAI access word

OpenAI is billed for every live run, so it is locked by default. In the research form it appears grayed out with an explanation; entering the access word unlocks it for that browser tab.

```dotenv
OPENAI_UNLOCK_WORD=choose-a-word
```

- The word is checked on the server. It is never sent to the browser bundle or stored in the browser; a successful unlock returns a signed token kept in tab session storage.
- Without the token the API refuses live OpenAI runs, follow-ups on OpenAI runs (including runs from before provider selection), and CRM exports through OpenAI. Google runs and demo runs are unaffected.
- If `OPENAI_UNLOCK_WORD` is empty, OpenAI cannot be unlocked at all. Changing the word invalidates earlier unlocks.
- Five wrong attempts lock the form for 10 minutes (per server instance).
- Scheduled checks on an OpenAI run that was started while unlocked continue to run; stop the schedule to stop their usage.

## How a research run works

1. **Brief.** Choose a workflow, describe what you need, and attach up to five files.
2. **Questions first** (on by default). Before any research, Octo reads the brief and files and shows what it understood, the outcome it thinks you want, the research areas this topic needs, and two to five questions. Each question has suggested answers plus a box for your own detail, and there is a final "anything else" field. Turn areas off, answer what matters, or skip the questions. Google uses Gemini structured output for this step; OpenAI uses a strict JSON schema; demo runs show labelled example questions without calling a model. If the step fails, you can still start the research.
3. **Research.** One specialist covers each area you kept (Google runs them as passes in one session). Areas are planned per brief, never a fixed template. Your answers, notes and the agreed outcome go into the agent's instructions.
4. **Report.** A cited report, source list, company records where relevant, and downloads in your chosen format.
5. **Evidence check.** Octo checks the report's citations itself (below) and shows an evidence score.
6. **Ask, refresh, build on.** Ask questions answered only from the report, refresh it later to see what changed, ask follow-ups in the same session, or start related research that builds on it. If a run stopped early, continue it (below).

### Evidence check

After every report (and on **Check again**), Octo:

1. Lists up to 20 material claims. Live runs ask the run's model (Gemini structured output or an OpenAI strict schema) for each claim, the words or figure the source should contain, and the URL the report cites for it. Only URLs the report or its source list actually cite are accepted. If that call fails, Octo falls back to reading the report itself: sentences and table cells with figures or citations, with a bullet's citation applying to every sentence in it, and numbered citations such as `[3]` mapped to the source list.
2. Fetches each cited page once (up to 15 pages, 4 at a time, 12 seconds each, 5 MB cap). HTML is reduced to text and PDFs are read with `unpdf`. Only public addresses on standard ports are fetched; private, loopback, link-local and metadata addresses are refused, including after redirects.
3. Compares figures (ignoring thousands separators) and key terms with the page and marks the claim **Supported**, **Partly supported**, **Not found in source**, **No source cited** or **Could not check** (blocked, failed, or a page with almost no readable text, which usually means it needs JavaScript or a sign-in).
4. Scores the report from 0 to 100: supported claims count fully, partly supported ones half. Pages Octo could not check are left out of the score.

This is an automatic first pass that flags what to review; it is not proof. The check runs outside the research session, costs one small model call on live runs, and is included as a table in PDF, Word, Markdown and JSON downloads. Demo runs show labelled illustrative statuses and fetch nothing.

### Ask this research

The **Ask** tab answers questions using only the report, its checked claims and your notes, never new searches or the model's own memory. Each answer says whether the research covers the question (answered, partly, or not in this research), cites the checked claims it used (click one to see it in Evidence), and, when the research falls short, proposes a follow-up instruction you can send with **Research this**. Live runs use one small structured model call per question (up to 30 per run); demo runs quote the matching report passages without a model.

### Versions and refresh

Whenever a follow-up, continuation, scheduled check or **Refresh research** replaces a report, the old one is kept (up to 10 versions). The **Versions** tab compares the current report with any earlier version line by line, and lists added and dropped sources and the change in evidence score. **Refresh research** asks the agent to look for evidence published since the report, re-check its figures, and return one updated report ending with a "What changed" section.

### Community voices

People add "reddit" to their searches because forums hold first-hand experience. Some AI assistants can't read Reddit at all. With **Include what real people say** (in the research form or the question step), or **Gather voices** on any finished run, Octo:

1. Turns the brief into 3–6 keyword searches with a small model call (falling back to keywords from the brief).
2. Searches Hacker News through its official Algolia API, and Reddit over the last two years. With `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET`, it uses Reddit's official API (read-only, app-only sign-in): it searches posts and reads the top comments of the six strongest threads. Without them, it uses the public [PullPush](https://pullpush.io) archive. The archive works from a laptop but often refuses cloud servers such as Vercel (HTTP 403). The Voices tab then says so, and Hacker News results still appear. To get the keys, create a "script" app at [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) and follow [Reddit's API terms](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki).
3. Keeps posts that match a search (up to 150) and asks the model to group them into 3–8 themes: pain points, unmet needs, what works, and workarounds. Each theme lists the posts that discuss it.
4. Shows each theme with its post count, a summary, and 1–3 quotes. Quotes are always the posts' own words with a link; only ids the model returns from the collected posts are accepted. Without a model, posts are grouped by keywords.

When requested before research, the run waits for the voices, and a summary with quotes and links goes to the research agent as anecdotal evidence. With questions first, the search runs while you answer. Results appear in the **Voices** tab and in PDF, Word and JSON downloads. The archive can lag, and vocal users are not a representative sample; the tab says so.

### Source quality and source policy

The **Sources** tab shows the source mix (government and regulator, research and official data, news, reference, company, forum and social, blog or review site) and tags every source with its kind. The evidence check also reads each page's publication date from its metadata and flags sources older than two years (or your own limit). Classification uses the address only, so it is a guide, not a verdict.

Under **Source policy** in the research form, choose **Balanced**, **Primary** (regulators, filings, official data) or **Research** (papers and statistics), and list domains to trust first or never use. The policy goes into the agent's instructions, and sources from blocked domains are marked. Every run is also told to prefer primary sources over blogs and SEO pages, date its sources, present the main positions on contested questions, and say when sources conflict.

### Challenge this report

**Challenge this report** (in the report toolbar) asks the agent to act as a sceptical reviewer. It searches for the strongest counter-evidence, newer data and dissenting views; checks for outdated, secondary or SEO sources; and flags conclusions that rest on one source. It then returns a revised report with a "Challenges and counter-evidence" section that gives each challenge a verdict: stands, weakened, or overturned. The earlier report is kept as a version, so the Versions tab shows what the challenge changed. It is a full research turn and is billed like one.

### Build on earlier research

When a new brief overlaps earlier reports in your workspace, the research form suggests them under **Build on earlier research**. Each one you select (up to three) is copied into the new run (up to 12,000 characters of its report). It is given to the question step and to the agent, which is told to reuse what is established, re-check figures that may have changed, and say where new findings confirm, update or contradict it.

## Workflows

- **Open research:** any question. The report is structured around the areas and outcome you agreed.
- **Market intelligence:** a decision-ready market briefing; the areas (competitors, pricing, regulation, demand, or anything else) are chosen for the brief.
- **Sales research:** an explicit ICP plus optional documents; a target of 1–100 companies; fit evidence, potential needs, public decision makers, and source links. A run may return fewer verified matches than requested. CSV export neutralizes spreadsheet formulas.
- **Ongoing research:** a saved session, scheduled checks, and comparison against previous findings. Interval and remaining checks are configurable. After downtime, one overdue check runs; the scheduler does not issue a burst of missed checks.

Each workflow supports a brief, up to five context files (5 MB each, 4 MB on Vercel), activity, specialist agents, source links, notes, exports, and same-session follow-ups. Supported uploads: PDF, CSV, TXT, Markdown, JSON, XLSX, DOCX. PDFs and text files are also read during the question step; other formats are read by the agent in its sandbox. Initial files are delivered to `/workspace/inputs`. Outputs written under `/workspace/outputs` become downloadable after the turn completes.

User notes are stored in the workspace; they are not automatically added to the remote prompt. Include any notes you want used in your next follow-up.

### Limits, partial reports and continuing

- Time limits go up to 3 hours and token limits up to 2M. Google runs default to 2 hours and 1M tokens, the most Octo requests; your Google project's own free-tier quotas still apply. OpenAI runs default to 10 minutes and 50k tokens because they are billed.
- If a run stops early (time or token limit, Google's budget, a provider error, or you pressing Stop), whatever the agent had written is saved as a **partial report** and the run is marked Partial. It can be downloaded like any report.
- **Continue research** sends the partial report back with an instruction to finish the unfinished areas and return one complete report that merges the earlier findings with the new ones. You can add guidance for the continuation. Google continues the same session when its environment is still available and otherwise starts a fresh interaction carrying the task and the partial report. Earlier partial reports are kept with the run.
- The agent is also told to wrap up with the best complete report it can when it nears its limits.

### Managing runs

- **Delete** a run from its page or from the research table. Live research must be stopped first so no remote work keeps running. Deleting removes Octo's record (report, notes, activity); sessions in your Google or OpenAI project are not deleted.
- **Dark mode:** the theme button in the top bar cycles System → Dark → Light; the choice is remembered in this browser. The dark stylesheet is generated from the light theme by `npm run theme:dark` (`scripts/build-dark-theme.mjs`); rerun it after changing colours.

## Downloads

Every finished run can be downloaded as **PDF**, **Word (.docx)**, **CSV**, **Markdown** or **JSON**. Choose the main format under **Deliverable** in the research form; **Best for the task** uses the format your brief asks for ("send it as a spreadsheet"), otherwise CSV for company lists and PDF for briefings. The run's download button uses that format, and the menu beside it offers the rest.

- Octo renders these files itself from the agent's Markdown report, so downloads work without extra agent usage. PDFs embed the Inter font (OFL, `assets/fonts`), so characters such as ₹ print correctly.
- Documents include the report, company records (sales), the evidence check, community voices, and the source list with each source's kind and date. JSON also includes your Ask answers.
- CSV contains company records when present, otherwise every table in the report; it is offered only when there are rows. Spreadsheet formulas are neutralised and the file opens as UTF-8 in Excel.
- Files the agent writes itself (for example `/workspace/outputs/leads.csv`) are listed under **Files from the agent**.

## A small first live test

1. For OpenAI, add API credit and configure spend controls in your project. A ChatGPT subscription does not supply this app's API billing. To test without spending credit first, use Google on a free-tier project and inspect its AI Studio quotas.
2. Select **Live** and a narrow brief such as “Compare India's UPI and Brazil's Pix: adoption, fees and governance, with official sources.” For OpenAI, lower the time and token limits for a first test.
3. Review the report, source links, artifacts, and project usage before making the task larger.

**There is no promise that $5–$10 completes an arbitrary research job.** The API bills model calls, tools, and hosted sandbox usage. Subagent work contributes usage. The app's time/token controls request cancellation using best-effort accounting; in-flight work and reporting delay can exceed the thresholds. The token limit applies to additional session usage during the current turn, while the displayed usage is cumulative session usage. Missing usage stays unknown, not zero.

The app runs one research run at a time (a run waiting for your answers does not block others) and enables up to two concurrent remote specialists on OpenAI; Google performs separate research passes. Recurring checks have the same per-turn limits and can each incur charges. Stop a schedule when it is no longer needed.

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

Live deployment: **https://octo-agents.vercel.app** (Google Gemini by default, OpenAI behind the unlock word).

`vercel.json` builds the Vite frontend to the CDN and serves the Express API as one Vercel Function (`api/index.js`, compiled from `server/vercel.ts`). Local development is unchanged.

**Setup**

1. Import the repository in Vercel. Framework and build settings come from `vercel.json`.
2. **Storage → Create Database → Neon** (free plan) and connect it to the project for Production. The integration adds the connection string automatically; you do not type it. Any variable prefix works (`DATABASE_URL`, `STORAGE_URL`, `POSTGRES_URL`, …): Octo uses the first `*_URL` variable holding a `postgres://` connection string, preferring the pooled one. Serverless functions keep no disk between requests, so runs, reports and notes are stored here. Tables are created on first use.
3. Add your API keys under **Settings → Environment Variables** (Production):

| Variable             | When                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`     | Always (default provider, free tier)                                                            |
| `OPENAI_API_KEY`     | Only if OpenAI should be available                                                              |
| `OPENAI_UNLOCK_WORD` | Only with an OpenAI key: the word that unlocks OpenAI in the UI. Without it OpenAI stays locked |
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | Optional: Reddit in Community voices on Vercel (see below). Without them, Hacker News still works |

4. Deploy. Changing variables later requires a redeploy.

Defaults cover everything else: Google is the default provider, `antigravity-preview-09-2026` / `gemini-3.8-flash` for Google and `gpt-6-astra` for OpenAI. Override with `DEFAULT_PROVIDER`, `GEMINI_AGENT`, `GEMINI_MODEL` or `OPENAI_MODEL` if needed.

**Optional hardening.** Without `APP_TOKEN`, anyone with the URL can open the workspace, read saved research, and start Google runs on your key's free-tier quota (OpenAI stays protected by the unlock word). Set `APP_TOKEN` to require an access token. `CRON_SECRET` enables `/api/cron/tick`, a backstop you can call from any scheduler.

**How work progresses.** There is no background worker on serverless. A run advances in short steps whenever the workspace is open (the UI refreshes every few seconds), kept alive with `waitUntil`. Close the tab and the run pauses until someone opens the app again. Scheduled ongoing-research checks run the same way. A database lease ensures only one function instance advances a run at a time, so concurrent requests never create a duplicate paid session.

**Limits on Vercel.** Request and response bodies are capped at 4.5 MB: uploads are limited to 4 MB per file and Google output files are cached up to 4 MB. Each step must finish within the 300-second function limit.

## Security

Octo runs on Node.js 24.x (`.nvmrc`, `package.json` engines). After the Node.js October 2026 security release (CVE-2026-111497, "Node2Shell"), Octo refuses Brotli-compressed responses from untrusted pages and APIs, and Brotli-compressed request bodies. It also reports whether its runtime is patched at `GET /api/config` (`runtimePatched`). Details, supply-chain checks and how to report a vulnerability are in [SECURITY.md](SECURITY.md).

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
