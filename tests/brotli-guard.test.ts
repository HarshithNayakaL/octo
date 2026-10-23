import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import express from "express";
import request from "supertest";
import {
  BrotliRefusedError,
  installFetchGuard,
  isPatchedNode,
  plainFetch,
  refuseCompressedRequests,
} from "../server/brotli-guard";
import { fetchSource } from "../server/evidence";

const page =
  "<html><body><p>Pix settled 63.8 billion transactions.</p></body></html>";
let base = "";
const seen: Record<string, string | undefined> = {};
const server = http.createServer((req, res) => {
  seen[req.url!] = req.headers["accept-encoding"];
  if (req.url === "/br") {
    res.writeHead(200, {
      "content-type": "text/html",
      "content-encoding": "br",
    });
    res.end(brotliCompressSync(page));
  } else if (req.url === "/gzip") {
    res.writeHead(200, {
      "content-type": "text/html",
      "content-encoding": "gzip",
    });
    res.end(gzipSync(page));
  } else if (req.url === "/deflate") {
    res.writeHead(200, {
      "content-type": "text/html",
      "content-encoding": "deflate",
    });
    res.end(deflateSync(page));
  } else if (req.url === "/odd") {
    res.writeHead(200, { "content-encoding": "zstd" });
    res.end("x");
  } else if (req.url === "/moved") {
    res.writeHead(302, { location: "/plain" });
    res.end();
  } else if (req.url === "/post") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ method: req.method, body }));
    });
  } else {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(page);
  }
});
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("Node2Shell (CVE-2026-111497) safeguards", () => {
  it("knows which runtimes carry the October 2026 fixes", () => {
    expect(isPatchedNode("22.22.0")).toBe(false);
    expect(isPatchedNode("22.23.3")).toBe(false);
    expect(isPatchedNode("22.23.4")).toBe(true);
    expect(isPatchedNode("22.24.0")).toBe(true);
    expect(isPatchedNode("v24.22.0")).toBe(false);
    expect(isPatchedNode("24.22.1")).toBe(true);
    expect(isPatchedNode("26.12.0")).toBe(false);
    expect(isPatchedNode("26.12.1")).toBe(true);
    expect(isPatchedNode("20.19.0")).toBe(false);
    expect(isPatchedNode("27.0.0")).toBe(true);
  });
  it("refuses Brotli responses from untrusted servers and never advertises Brotli", async () => {
    await expect(plainFetch(`${base}/br`)).rejects.toBeInstanceOf(
      BrotliRefusedError,
    );
    expect(seen["/br"]).toBe("gzip, deflate");
  });
  it("still reads plain, gzip and deflate pages and follows redirects", async () => {
    for (const path of ["/plain", "/gzip", "/deflate", "/moved"]) {
      const res = await plainFetch(`${base}${path}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(page);
      expect(res.headers.get("content-encoding")).toBeNull();
    }
    const manual = await plainFetch(`${base}/moved`, { redirect: "manual" });
    expect(manual.status).toBe(302);
    expect(manual.headers.get("location")).toBe("/plain");
    await expect(plainFetch(`${base}/odd`)).rejects.toThrow(
      /Unsupported content encoding/,
    );
    const posted = await plainFetch(`${base}/post`, {
      method: "POST",
      body: new URLSearchParams({ grant_type: "client_credentials" }),
    });
    expect(await posted.json()).toEqual({
      method: "POST",
      body: "grant_type=client_credentials",
    });
  });
  it("is what the evidence check uses for cited pages", async () => {
    const local = { lookup: async () => [{ address: "93.184.216.34" }] };
    // The address check blocks loopback, so route through a fake public address.
    const viaLocal: typeof fetch = (input, init) =>
      plainFetch(String(input).replace("https://pages.example", base), init);
    expect(
      (
        await fetchSource("https://pages.example/gzip", {
          ...local,
          request: viaLocal,
        })
      ).text,
    ).toContain("63.8 billion");
    await expect(
      fetchSource("https://pages.example/br", { ...local, request: viaLocal }),
    ).rejects.toBeInstanceOf(BrotliRefusedError);
  });
  it("refuses compressed request bodies before Express parses them", async () => {
    const app = express();
    app.use(refuseCompressedRequests);
    app.use(express.json());
    app.post("/x", (req, res) => res.json(req.body));
    const br = await request(app)
      .post("/x")
      .set("content-type", "application/json")
      .set("content-encoding", "br")
      .send(brotliCompressSync(JSON.stringify({ a: 1 })));
    expect(br.status).toBe(415);
    expect(br.body.error).toContain("Brotli");
    const gz = await request(app)
      .post("/x")
      .set("content-type", "application/json")
      .set("content-encoding", "gzip")
      .send(gzipSync(JSON.stringify({ a: 1 })));
    expect(gz.status).toBe(415);
    const plain = await request(app).post("/x").send({ a: 1 });
    expect(plain.body).toEqual({ a: 1 });
  });
  it("makes every fetch() ask for gzip or deflate only and refuse Brotli replies", async () => {
    const calls: Headers[] = [];
    const target = {
      fetch: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(new Headers(init?.headers));
        return new Response("x", { headers: { "content-encoding": "br" } });
      }),
    } as unknown as typeof globalThis;
    installFetchGuard(target);
    await expect(
      target.fetch("https://api.example", {
        headers: { "accept-encoding": "br" },
      }),
    ).rejects.toBeInstanceOf(BrotliRefusedError);
    expect(calls[0].get("accept-encoding")).toBe("gzip, deflate");
  });
});
