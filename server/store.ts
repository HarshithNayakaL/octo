import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Run, Attachment } from "../shared/types.js";
import { directoryCache, type BlobCache } from "./files.js";
export { directoryCache, type BlobCache } from "./files.js";

export interface UploadMeta {
  id: string;
  name: string;
  size: number;
}
export interface RunStore {
  readonly kind: "sqlite" | "postgres";
  list(): Promise<Run[]>;
  get(id: string): Promise<Run | undefined>;
  save(run: Run): Promise<Run>;
  /** Remove a run and its lease. Remote sessions and shared uploads are untouched. */
  delete(id: string): Promise<void>;
  /**
   * Take an exclusive, expiring lease on a run. Only one worker in any instance
   * may advance a run at a time; this is what prevents duplicate paid sessions.
   */
  claim(id: string, leaseMs: number): Promise<boolean>;
  /** End a lease. `holdMs` keeps it closed briefly to space out provider polling. */
  release(id: string, holdMs?: number): Promise<void>;
  saveUpload(meta: UploadMeta, bytes: Buffer): Promise<Attachment>;
  getUpload(id: string): Promise<Attachment | undefined>;
  readUpload(file: Attachment): Promise<Buffer>;
  blobs(namespace: string): BlobCache;
  /** Count one use of a metric (for example a model's requests) on a given day. */
  bumpUsage(day: string, metric: string): Promise<void>;
  /** All counters for a day. */
  readUsage(day: string): Promise<Record<string, number>>;
  /** Small shared settings, such as quota limits Google reported. */
  setValue(key: string, value: string): Promise<void>;
  readValues(prefix: string): Promise<Record<string, string>>;
  close(): Promise<void>;
}

/** Local single-server storage in DATA_DIR/research.sqlite. */
export class Store implements RunStore {
  readonly kind = "sqlite" as const;
  readonly db: DatabaseSync;
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(resolve(directory, "research.sqlite"));
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS leases (id TEXT PRIMARY KEY, until_ms INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, metric TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (day, metric)); CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    );
  }
  async list(): Promise<Run[]> {
    return (
      this.db.prepare("SELECT body FROM runs").all() as { body: string }[]
    )
      .map((x) => JSON.parse(x.body) as Run)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string): Promise<Run | undefined> {
    const row = this.db.prepare("SELECT body FROM runs WHERE id=?").get(id) as
      | { body: string }
      | undefined;
    return row && JSON.parse(row.body);
  }
  async save(run: Run) {
    run.updatedAt = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO runs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(run.id, JSON.stringify(run));
    return run;
  }
  async delete(id: string) {
    this.db.prepare("DELETE FROM runs WHERE id=?").run(id);
    this.db.prepare("DELETE FROM leases WHERE id=?").run(id);
  }
  async claim(id: string, leaseMs: number) {
    const now = Date.now();
    return Boolean(
      this.db
        .prepare(
          "INSERT INTO leases VALUES (?,?) ON CONFLICT(id) DO UPDATE SET until_ms=excluded.until_ms WHERE leases.until_ms <= ? RETURNING id",
        )
        .get(id, now + leaseMs, now),
    );
  }
  async release(id: string, holdMs = 0) {
    this.db
      .prepare("UPDATE leases SET until_ms=? WHERE id=?")
      .run(Date.now() + holdMs, id);
  }
  async saveUpload(meta: UploadMeta, bytes: Buffer) {
    const directory = resolve(this.directory, "uploads");
    mkdirSync(directory, { recursive: true });
    const path = resolve(directory, meta.id + "-" + meta.name);
    await writeFile(path, bytes, { flag: "wx" });
    const file: Attachment = { ...meta, path };
    this.db
      .prepare("INSERT INTO uploads VALUES (?,?)")
      .run(file.id, JSON.stringify(file));
    return file;
  }
  async getUpload(id: string): Promise<Attachment | undefined> {
    const row = this.db
      .prepare("SELECT body FROM uploads WHERE id=?")
      .get(id) as { body: string } | undefined;
    return row && JSON.parse(row.body);
  }
  async readUpload(file: Attachment) {
    if (!file.path) throw new Error(`Attachment ${file.name} is unavailable.`);
    return readFile(file.path);
  }
  blobs(namespace: string) {
    return directoryCache(resolve(this.directory, namespace));
  }
  async bumpUsage(day: string, metric: string) {
    this.db
      .prepare(
        "INSERT INTO usage VALUES (?,?,1) ON CONFLICT(day, metric) DO UPDATE SET count=count+1",
      )
      .run(day, metric);
  }
  async readUsage(day: string) {
    const rows = this.db
      .prepare("SELECT metric, count FROM usage WHERE day=?")
      .all(day) as { metric: string; count: number }[];
    return Object.fromEntries(rows.map((r) => [r.metric, Number(r.count)]));
  }
  async setValue(key: string, value: string) {
    this.db
      .prepare(
        "INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
  }
  async readValues(prefix: string) {
    const rows = this.db
      .prepare("SELECT key, value FROM kv WHERE substr(key, 1, ?) = ?")
      .all(prefix.length, prefix) as { key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
  async close() {
    this.db.close();
  }
}
