# Security

## Node.js October 2026 security release ("Node2Shell")

On 21 October 2026, Node.js released fixes for ten vulnerabilities across its 22.x, 24.x and 26.x lines. The most serious, CVE-2026-111497, is an out-of-bounds write in the bundled Brotli decoder that can allow remote code execution. The fixed releases are **22.23.4, 24.22.1 and 26.12.1**. The official advisory documents no workaround besides upgrading. See the [Node.js advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).

### Why Octo was exposed

- The evidence check downloads pages from any site a report cites. Node's `fetch()` decompresses Brotli responses automatically, so a malicious page could reach the vulnerable decoder.
- Community voices calls third-party APIs (PullPush, Hacker News, Reddit) the same way.
- Express 5 decompresses request bodies sent with `Content-Encoding: br`, so any client could send one to the API.

### What Octo does now

1. **Runtime pinned.** `package.json` pins the Node.js 24.x line (`"engines": {"node": "24.x"}`), so Vercel builds on its latest 24.x release instead of an older default.
2. **No Brotli for untrusted servers.** Cited pages and community APIs are fetched with `plainFetch` (`server/brotli-guard.ts`). It uses `node:http` directly, so nothing is decompressed automatically. It asks for gzip or deflate only, decodes those itself, and refuses Brotli or unknown encodings before any byte is decompressed.
3. **Gemini, OpenAI and the Neon database client also use `plainFetch`.** The providers receive it from `server/config.ts`, and Neon via `neonConfig.fetchFunction` in `server/vercel.ts`. Octo itself therefore never decodes Brotli, whether or not the runtime is patched. As a backstop, any other `fetch()` asks for gzip or deflate only and rejects Brotli replies (`installFetchGuard`, installed in `server/security.ts` before anything else loads).
4. **Compressed request bodies are refused** with HTTP 415 before Express parses them. Octo's own client never compresses requests.
5. **The runtime is checked.** The server logs a warning at startup on an unpatched Node.js, and `GET /api/config` reports `"runtimePatched"`.

Vercel manages patch versions for its 22.x and 24.x runtimes and announced on 21 October 2026 that it was rolling out the patched releases ([Vercel bulletin](https://vercel.com/kb/bulletin/node-js-security-advisory)). Until `/api/config` shows `"runtimePatched": true`, the safeguards keep attacker-controlled bytes away from the decoder. The runtime upgrade is still the real fix: redeploy after changing Node versions, and confirm that `/api/config` shows `"runtimePatched": true`.

### Supply chain

Self-propagating npm worms (the Shai-Hulud/ChainDrop family) compromised hundreds of packages in 2026, including `keyv`, `cacheable`, `flat-cache`, `file-entry-cache`, `cacheable-request`, `tensorlake` and `@subql/common`. On 23 October 2026, Octo's lockfile contained none of these packages. `npm audit` reports zero vulnerabilities, and `npm audit signatures` verified registry signatures for all 483 packages. Vite was moved to 6.4.4, which fixes a development-server advisory, rather than a release published the same week. To check again:

```sh
npm ci
npm audit
npm audit signatures
```

When running locally behind an HTTP proxy, set `NODE_USE_ENV_PROXY=1` so `plainFetch` (built on `node:http`) uses it.

## Voice assistant

The browser talks to Gemini Live directly over `wss://generativelanguage.googleapis.com`, the only external address added to the Content Security Policy. It authenticates with an ephemeral token from `POST /api/voice/token`, never the API key. Each token:
- allows a single session;
- must start that session within 2 minutes and expires after 30 minutes;
- is locked to Octo's model, voice, instructions and tools.

Token minting and voice turns are rate limited per visitor. The assistant can only open the research form, so a person always confirms before anything runs.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository rather than a public issue.
