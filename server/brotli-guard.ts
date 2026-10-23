import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { createGunzip, createInflate } from "node:zlib";
import type { RequestHandler } from "express";

/*
 * Safeguards for the Node.js October 2026 security release, "Node2Shell"
 * (CVE-2026-111497): an out-of-bounds write in Node's bundled Brotli decoder
 * that can allow remote code execution. Node's fetch() decompresses Brotli
 * responses automatically and Express 5 decompresses Brotli request bodies, so
 * any page Octo checks or any client could reach the decoder. The only fix is
 * a patched runtime (22.23.4, 24.22.1, 26.12.1 or later); until every runtime
 * is confirmed patched, Octo never feeds attacker-controlled bytes to it:
 *
 * - Untrusted pages and community APIs are fetched with `plainFetch`, which
 *   uses node:http directly. It never decodes Brotli; a Brotli response is
 *   refused before any byte is decompressed.
 * - Every other fetch() advertises only gzip and deflate.
 * - Requests with a compressed body are refused before Express parses them.
 */

/** First patched release per Node.js line. */
export const patchedNode: Record<number, string> = {
  22: "22.23.4",
  24: "24.22.1",
  26: "26.12.1",
};

const parts = (version: string) =>
  version
    .replace(/^v/, "")
    .split(".")
    .map((n) => Number.parseInt(n, 10) || 0);

/** Whether this Node.js version includes the October 2026 security fixes. */
export function isPatchedNode(version = process.versions.node) {
  const [major, minor, patch] = parts(version);
  const fixed = patchedNode[major];
  // Lines newer than 26 shipped after the fix; older or odd lines are unsupported.
  if (!fixed) return major > 26;
  const [, fixedMinor, fixedPatch] = parts(fixed);
  return minor > fixedMinor || (minor === fixedMinor && patch >= fixedPatch);
}

export class BrotliRefusedError extends Error {
  constructor(where: string) {
    super(
      `Refused a Brotli-compressed ${where} (safeguard for Node.js CVE-2026-111497).`,
    );
    this.name = "BrotliRefusedError";
  }
}

const encodings = (value: string | null | undefined) =>
  (value ?? "")
    .toLowerCase()
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e && e !== "identity");

const SAFE_ACCEPT_ENCODING = "gzip, deflate";

function headerRecord(init?: HeadersInit) {
  const headers = new Headers(init);
  headers.set("accept-encoding", SAFE_ACCEPT_ENCODING);
  return Object.fromEntries(headers.entries());
}

/**
 * A fetch() replacement for untrusted servers. It uses node:http, so nothing is
 * decompressed automatically: gzip and deflate are decoded here, and Brotli or
 * any unknown encoding is refused with the connection closed unread.
 */
export const plainFetch: typeof fetch = async (input, init = {}) => {
  let url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  const method = (init.method ?? "GET").toUpperCase();
  const follow = (init.redirect ?? "follow") === "follow";
  const body =
    typeof init.body === "string" || init.body instanceof URLSearchParams
      ? String(init.body)
      : undefined;
  if (init.body && body === undefined)
    throw new TypeError("plainFetch only sends text bodies.");
  for (let hop = 0; hop <= 5; hop++) {
    const response = await new Promise<http.IncomingMessage>((done, fail) => {
      if (!["http:", "https:"].includes(url.protocol))
        return fail(new TypeError(`Unsupported protocol ${url.protocol}`));
      const request = (url.protocol === "https:" ? https : http).request(
        url,
        {
          method,
          headers: {
            ...headerRecord(init.headers),
            ...(body !== undefined
              ? { "content-length": String(Buffer.byteLength(body)) }
              : {}),
          },
          signal: init.signal ?? undefined,
        },
        done,
      );
      request.on("error", fail);
      request.end(body);
    });
    const status = response.statusCode ?? 0;
    const location = response.headers.location;
    if (follow && status >= 300 && status < 400 && location) {
      response.resume();
      url = new URL(location, url);
      continue;
    }
    const coding = encodings(response.headers["content-encoding"]);
    if (coding.includes("br")) {
      response.destroy();
      throw new BrotliRefusedError("response");
    }
    if (
      coding.length > 1 ||
      (coding[0] && !["gzip", "x-gzip", "deflate"].includes(coding[0]))
    ) {
      response.destroy();
      throw new Error(`Unsupported content encoding "${coding.join(", ")}".`);
    }
    const decoded = coding[0]
      ? response.pipe(
          coding[0] === "deflate" ? createInflate() : createGunzip(),
        )
      : response;
    if (coding[0]) response.on("error", (err) => decoded.destroy(err));
    const headers = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      if (value === undefined) continue;
      if (coding[0] && ["content-encoding", "content-length"].includes(name))
        continue;
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    const empty = method === "HEAD" || [101, 204, 205, 304].includes(status);
    if (empty) decoded.resume();
    return new Response(
      empty ? null : (Readable.toWeb(decoded as Readable) as ReadableStream),
      {
        status: status < 200 || status > 599 ? 502 : status,
        statusText: response.statusMessage,
        headers,
      },
    );
  }
  throw new Error("Too many redirects.");
};

let installed = false;
/**
 * Make every fetch() ask for gzip or deflate only and refuse Brotli replies.
 * Servers that honour Accept-Encoding then never send Brotli. This is defence
 * in depth for trusted APIs; untrusted servers go through plainFetch.
 */
export function installFetchGuard(target: typeof globalThis = globalThis) {
  if (installed || typeof target.fetch !== "function") return;
  installed = true;
  const original = target.fetch.bind(target);
  target.fetch = async (input, init) => {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    headers.set("accept-encoding", SAFE_ACCEPT_ENCODING);
    const response = await original(input, { ...init, headers });
    if (encodings(response.headers.get("content-encoding")).includes("br")) {
      await response.body?.cancel().catch(() => undefined);
      throw new BrotliRefusedError("response");
    }
    return response;
  };
}

/** Refuse compressed request bodies; Octo's own client never sends them. */
export const refuseCompressedRequests: RequestHandler = (req, res, next) => {
  const coding = encodings(req.headers["content-encoding"]);
  if (coding.length) {
    res.status(415).json({
      error: coding.includes("br")
        ? "Brotli-compressed requests are not accepted."
        : "Compressed request bodies are not accepted.",
    });
    return;
  }
  next();
};

/** Log once at startup when the runtime still lacks the October 2026 fixes. */
export function warnIfUnpatched(version = process.versions.node) {
  if (isPatchedNode(version)) return;
  const major = parts(version)[0];
  console.warn(
    `Node.js ${version} lacks the October 2026 security fixes (CVE-2026-111497 and others). ` +
      `Upgrade to ${patchedNode[major] ?? "a supported release line (22, 24 or 26)"} or later. ` +
      "Octo's Brotli safeguards are active in the meantime.",
  );
}
