# Validation record

Verified on 30 September 2026, without real API or CRM credentials.

## Passed

- Production build: TypeScript frontend/backend checks and Vite bundling.
- 24 automated backend tests using temporary SQLite databases and mock OpenAI responses.
- Dependency audit: zero known vulnerabilities after updating the test runner.
- Production serving smoke check: frontend and `/api/config` return HTTP 200 from the built server.
- Browser verification in the Codex in-app browser: market, sales, and ongoing demo runs complete; reports and saved activity appear.
- Notes remain after browser reload.
- Sales demo has two clearly labelled fictional companies and source entries; CRM export is disabled.
- Ongoing demo schedules a bounded follow-up and the schedule can be stopped.
- Desktop layout checked at 1440 pixels; mobile research detail checked at 390 pixels with no document-level horizontal overflow.
- Modal focus remains stable during background polling after correcting a focus-reset issue found during verification.
- Backend export tests verify response content and download headers; CSV tests verify escaping and formula neutralization.

## Not yet verified

- A real paid OpenAI session, model access, actual web search, specialist execution, document conversion, research correctness, API usage accounting, or remote artifact retrieval. These require the local API key.
- A real CRM MCP connection and its side effects. These require the actual endpoint, credentials, and tool names.
- Browser download completion in the in-app browser. Its download-event check timed out; the authenticated export endpoint is covered by backend tests. Download behavior should be checked in the target user's browser.
- The committed Playwright suite was authored, but was not run as a separate browser automation process during this session. UI checks were performed through the provided browser tool instead.
- Hosted multi-tenant operation, real-world API failure combinations, or exact spend limits. The README documents the work required before a public SaaS launch.

No API credits were consumed by the verification. Demo test runs remain in the local workspace and the test schedule was stopped. Screenshots are in `.cache/screenshots` and ignored by Git.

## UI redesign verification

The revised interface was inspected in Chrome after a broad Inspo reference study. Verified: suggested briefs carry into configuration; sales configuration preserves the chosen workflow and requires an ICP; a new mobile sales demo completes and exposes two illustrative records; demo CRM export remains disabled; grid/list switching, text filtering, and command-menu search with Enter navigation work. Mobile sizing was checked at 390 px after chart resizing, with no persistent document-level horizontal overflow.

ECharts, Loading.dev, and cmdk are installed. Charts use saved run timestamps and mode flags. Chart code is loaded separately; the final build splits the main UI, chart rendering, and chart implementation into separate chunks. The existing 24 backend tests remain passing.

Download completion could not be confirmed through the browser tool's download observer, which timed out. Local unauthenticated downloads now use native HTTP attachment links after a HEAD preflight; token-protected downloads retain authenticated fetches. Export responses remain covered by the backend tests.

## Editorial direction and controls

The subsequent visual pass uses self-hosted Fraunces and Epilogue fonts, sand surfaces, and a moss navigation rail. Native select menus were replaced with Radix Select for time, token, run mode, schedule interval, and workflow filters. Chrome verification confirmed time-limit selection and Escape dismissal without closing the parent research dialog. No paid research session was started during this UI work.

## Google provider integration (October 1, 2026)

The original blue-and-white overview is restored; later visual experiments are not imported. Google Antigravity on Gemini Interactions is now the default provider for new runs. Existing provider-less sessions retain OpenAI. Both providers remain selectable and credentials are server-side.

All 34 backend tests pass, including 10 Google-specific tests with mocked responses: background creation, pinned settings, mounted binary documents, raw REST output extraction, immutable cached files, path rejection, chained follow-ups, partial budget-limited reports, quota backoff, secret redaction, uncertain submission protection, and isolated CRM tool allowlists. No API usage was incurred. Google live research, actual account access, hosted file conversion, and CRM operations remain unverified until a Google key is supplied locally.

Chrome showed Google Antigravity selected by default in the research dialog and demo mode selected with no key configured. Further dropdown verification was interrupted by browser timeouts. Google REST MCP allowlists follow the official tool-name array documentation; the preview SDK currently declares a different type for that field.

## Octo UI refinement (October 1, 2026)

Verified in headless Chromium against the dev server, without API keys:

- Overview, research dialog, running and completed run detail, companies, and sources screens captured at 1440 px and 390 px; no document-level horizontal overflow at 390 px.
- Committed Playwright suite: 4 of 4 passed (market and sales demo flows, desktop and mobile) using the pre-installed Chromium. The suite now runs with one worker because the app allows one active run at a time; parallel workers previously collided on that rule.
- Slide-to-confirm completes by pointer drag and by keyboard (Enter), and stays inert while disabled. CRM export itself remains unverified because no CRM MCP is configured; demo records cannot be exported.
- 36 backend tests and the production build pass.

Not verified: live Google or OpenAI runs (so live OpenAI specialist mascot states have only been exercised with demo data), real CRM export, and Safari/Firefox rendering of the canvas mascots.

## Serverless readiness for Vercel (October 1, 2026)

No deployment was made. Verified locally:

- `vercel build` (Vercel CLI, local project settings, no account) completes. Output: the Vite build on the CDN, one Node.js 24 function `api/index.js` with `maxDuration` 300, the API rewrite, SPA fallback, and a daily cron at `/api/cron/tick`.
- The traced function bundle runs on its own (outside the repository's `node_modules`) and serves `/api/config`.
- The compiled entry reports a missing `DATABASE_URL` or `APP_TOKEN` with HTTP 503 and rejects unauthenticated cron calls.
- 49 backend tests pass, including 13 serverless tests. The Postgres store is exercised against PGlite (Postgres compiled to WebAssembly): persistence across store instances, uploads and file blobs, lease exclusivity, expiry and polling gaps, two simulated instances creating exactly one remote session (also on SQLite), request-driven progress through `background()`, cron authentication, same-host HTTPS origins behind the proxy, upload and response size limits, and Google attachments and output caching through Postgres. A deliberately broken lease makes the duplicate-session test fail.
- Local mode is unchanged: the browser suite passes 4 of 4 against the SQLite server.

Not verified: a real Vercel deployment, Neon connectivity and latency, `waitUntil` lifetime on the platform, cron delivery, and live Google research.

## Downloads and minimal Vercel setup (October 7, 2026)

- PDF, Word, CSV, Markdown and JSON are generated by Octo from the report. A sample report was rendered and inspected: the PDF (rasterised with pdftoppm) embeds Inter, prints ₹, tables, nested lists, quotes, links and page footers, and keeps headings with the following text. The Word file was validated with python-docx (title, heading and list styles, table with ₹). LibreOffice in the container could not convert any file, including plain text, so it was not used.
- In Chromium, a sales demo downloads CSV by default and PDF and Word from the menu; a market demo downloads PDF and Word in the committed e2e suite (4 of 4 passed).
- `vercel build` succeeds. The fonts are traced into the function bundle, and that bundle renders PDF, Word and CSV on its own. The daily cron was removed; `APP_TOKEN` is optional on Vercel.
- 65 backend tests pass, including 9 deliverable tests.

## First Vercel deployment (October 8, 2026)

https://octo-agents.vercel.app was deployed from `main` by the user. The first build could not find the database because the Neon integration had created its variables under a different prefix; Octo now accepts the connection string under any `*_URL` name (covered by a test). After the automatic redeploy, the live API reported `storage: postgres`, Google and OpenAI keys present, OpenAI locked behind the access word, a 4 MB upload limit, and no access token. The seeded sample run was read back from Neon, confirming database writes.

Not yet verified on the live site: a demo or live research run, downloads, or the OpenAI unlock flow.

## Questions before research, open research, partial reports, delete and dark mode (17 October 2026)

Local checks:

- 83 backend tests pass: 16 new tests cover plan parsing and normalisation, the answers route, partial reports, continuation and delete. Postgres paths run on PGlite.
- Production build, the Playwright suite (4/4: create → questions → answers → report → delete, PDF and Word downloads) and `vercel build` pass. The PDF fonts are traced into the function.
- Dark mode was checked in the browser on the overview, configuration, questions and report screens, including the system → dark → light toggle cycle. There is no horizontal overflow at 390 px.

Live Gemini test on https://octo-agents.vercel.app (Postgres on Neon, Google provider):

- **Brief:** compare India's UPI with Brazil's Pix (Open research, 20 minutes, 300k token limit).
- **Planning:** took 17 s. It produced a brief-specific understanding and outcome, four areas (governance, adoption, user fees, merchant MDR) and three option questions. It did not use a fixed market template.
- **Research:** after the answers were posted, the run completed in about 3 minutes with 43 saved activities and 7 primary sources (BCB, NPCI, RBI, PIB). The report follows the agreed areas and includes the requested comparison table.
- **Downloads:** the live PDF (3 pages), DOCX and Markdown exports returned HTTP 200 with valid files.
- **Token reporting:** the provider reported 398,802 tokens against the 300,000 limit. Gemini's token budget is advisory and appears to count cached and tool tokens, so treat the limit as approximate.

Not yet verified live: the partial-report and continue path. The test run completed, so no part was saved. That path is covered by the backend tests only. OpenAI planning was not run live, because OpenAI is locked behind the access word.

## Evidence check, Ask, versions and building on earlier research (17 October 2026)

Local checks:

- 101 backend tests pass. 18 new tests cover:
  - claim extraction from links, numbered citations, bullets and tables;
  - figure and term matching;
  - refusal of private, loopback, metadata and IPv4-mapped addresses, including after redirects;
  - reading HTML and PDF pages;
  - model claims with uncited URLs dropped;
  - scoring and concurrent saves;
  - the evidence, ask and refresh routes;
  - versions after a refresh;
  - building on earlier reports;
  - the evidence table in exports.
- 6/6 Playwright tests pass, desktop and mobile. A new test covers the evidence strip and tab, an Ask answer marked "Not in this research", "Research this" filling the follow-up box, and Refresh producing version 2 with a line diff.
- Screens were checked in Chromium at 1440 px (light and dark) and 390 px. There is no horizontal overflow.

Live on https://octo-agents.vercel.app (Gemini), on the earlier UPI vs Pix run:

- **Check again:** completed in 21 s. The model picked 20 claims and the score was 36. Results: 3 supported, 2 partly supported, 1 not found, 5 with no source cited, and 9 that could not be checked.
- **Pages that could not be checked:** NPCI and parts of the BCB site are JavaScript-only pages, so they return almost no text without a browser. PIB returned HTTP 403. Octo labels these "Could not check" and leaves them out of the score instead of failing the claims.
- **First Ask question:** answered in 17 s. It cited the supported Pix claim and warned that the UPI figure's source could not be checked.
- **Second Ask question** (about Argentina, which the report does not cover): returned "Not in this research" with a follow-up research instruction.
- **Markdown download:** now includes the evidence table.

Not yet verified live: Refresh research and Build on earlier research with a real research turn, because each costs a full research run. Both are covered by the backend and browser tests in demo mode. The evidence check does not render JavaScript pages.

## Community voices, source quality, source policy and Challenge (17 October 2026)

User research: 3,314 Reddit and Hacker News posts and comments, plus published studies, are summarised in `docs/research-findings.md`.

Local checks:

- 115 backend tests pass. 14 new tests cover:
  - collection and filtering of community posts, including removed and off-topic posts;
  - model themes limited to collected post ids, with quotes drawn only from each theme's own posts;
  - grouping by keywords without a model, and keyword searches made from the brief;
  - community voices gathered on request and before research, with research waiting for them;
  - Reddit's official API with app-only sign-in, and the hint shown when the archive refuses a request;
  - source classification, publication dates, trusted and blocked domains;
  - source policy validation at creation;
  - balanced-evidence instructions;
  - the Challenge route.
- 6/6 Playwright tests pass. The Voices tab, source mix and policy form were checked in Chromium at desktop and mobile widths, with no horizontal overflow.

Live on https://octo-agents.vercel.app (Gemini), on the UPI vs Pix run:

- **Gather voices:** completed in 37 s. Gemini wrote five searches, and 26 relevant Hacker News posts out of 81 scanned were grouped into six themes with verbatim, linked quotes. Its takeaway said the posts were one-sided and thin on official fee data.
- **Reddit:** the PullPush archive returned HTTP 403 from Vercel, although it works from a local machine. Octo showed the failure and kept the Hacker News results. Reddit's official API path (`REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`) was added for this and is covered by tests, but has not been run with real Reddit keys.
- **Source labels:** after the evidence check, all seven sources were labelled Government & regulator. None of those pages declared a publication date in their metadata.

Not yet verified live: Challenge this report and a source policy on a real research turn. Each costs a full research run; both are covered by tests in demo mode.

## Node.js October 2026 security release (23 October 2026)

- **Advisory:** CVE-2026-111497 (Brotli out-of-bounds write, "Node2Shell") plus nine other CVEs. Fixed in Node.js 22.23.4, 24.22.1 and 26.12.1.
- **Tests:** 6 new tests use a local HTTP server that sends Brotli, gzip and deflate responses and redirects. They show that:
  - `plainFetch` refuses Brotli and never advertises it;
  - gzip, deflate and redirects still work;
  - the evidence check refuses a Brotli page;
  - compressed request bodies get HTTP 415;
  - the global fetch guard strips Brotli from Accept-Encoding;
  - the runtime version check is correct.
- **Results:** 121 backend tests pass and the build succeeds.
- **Built server, on this container's Node.js 22.22.0 (unpatched):**
  - the startup warning appeared;
  - a Brotli-compressed POST to `/api/runs` returned 415;
  - `/api/config` reported `"runtimePatched": false`;
  - real pages (rbi.org.in, Hacker News API) still loaded through `plainFetch`.
- **Supply chain:** no compromised packages from the 2026 npm worm waves are in the lockfile. `npm audit` reports 0 vulnerabilities after moving Vite to 6.4.4, and `npm audit signatures` verified 483 packages.
- **Live on Vercel (23 October 2026, with team access):**
  - The project runs Node.js `24.x`. Its runtime logs show **Node.js 24.21.0**, which is unpatched; the fix is 24.22.1. Vercel's bulletin says it is rolling out patched runtimes, with no completion date yet.
  - On that runtime:
    - A Brotli-compressed POST is blocked by Vercel's firewall (415).
    - A gzip-compressed POST is refused by Octo (415).
    - Gemini calls (an Ask question) and Neon database queries work through `plainFetch`, so no response is decoded by Node's Brotli decoder.
    - No runtime errors appeared in the last 24 hours.
- **Follow-up check (24 October 2026, 14:00 UTC):** `/api/config` still reports `"runtimePatched": false`, and the runtime logs show Node.js 24.21.0. Vercel's bulletin still says the patched runtimes are rolling out, so there was no redeploy. Octo's Brotli safeguards remain in place.
- **Final scheduled check (26 October 2026, 14:07 UTC):** still `"runtimePatched": false`, with Node.js 24.21.0 in the runtime logs. Vercel's bulletin still says the rollout is in progress, so there was no redeploy. Octo's Brotli safeguards remain the protection until Vercel ships 24.22.1.

## Voice assistant (31 October 2026)

- **Automated tests:** 8 new backend tests cover:
  - Live token minting: single use, setup locked, key never returned;
  - an audio turn with Gemini TTS;
  - the TTS rate-limit fallback;
  - unsupported audio formats;
  - an unconfigured key;
  - per-visitor limits;
  - action parsing;
  - audio helpers.

  A new Playwright test checks that the mic button is visible and opens the panel. Results: 130 backend tests and 8 Playwright runs (desktop and mobile) pass, and the build succeeds.
- **Live on https://octo-agents.vercel.app (Gemini free tier):**
  - **Typed question → `gemini-3.5-flash-lite` + `gemini-3.8-flash-lite-tts`:** a full research brief (Market intelligence) and 8.2 s of 24 kHz speech, in 6.0 s end to end.
  - **Spoken question (Opus/WebM) → push-to-talk endpoint:** exact transcript, an answer and speech in 5.3 s.
  - **Gemini Live (`gemini-3.8-live`) over WebSocket with a server-minted token:** token in 0.5 s, session ready in 1.4 s, exact input transcript, spoken answer with a transcript, and **first reply audio 0.87 s after the end of speech**.
  - **Real Chromium on the live site, with the question as a fake microphone:**
    - A spoken question got a spoken answer in Live mode.
    - A spoken "set up new research on the electric scooter market in India for an investor" opened the research form 10 s later, with title, brief and Market intelligence filled in, and nothing started.
    - With Live blocked, Octo switched to push-to-talk, stopped recording at the pause, transcribed and answered aloud (4.6 s from the end of recording to speech).
- **Not tested:** a real person on a real microphone and speakers (echo cancellation relies on the browser), and Safari. Both are worth checking in the first manual test.
