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
