import type { Run, Attachment } from "../shared/types.js";
import type { BlobCache } from "./files.js";
import type { RunStore, UploadMeta } from "./store.js";

/** Minimal parameterised query function, satisfied by Neon's HTTP driver and PGlite. */
export type Query = (
  text: string,
  params?: unknown[],
) => Promise<Record<string, any>[]>;

const schema = [
  "CREATE TABLE IF NOT EXISTS octo_runs (id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS octo_uploads (id TEXT PRIMARY KEY, body TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS octo_blobs (key TEXT PRIMARY KEY, data TEXT NOT NULL, size INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS octo_leases (id TEXT PRIMARY KEY, until_ms BIGINT NOT NULL)",
];

/**
 * Durable storage for serverless deployments. Every instance shares it, so
 * leases here (not process memory) decide who may advance a run.
 * Files are stored base64-encoded; serverless payload limits keep them small.
 */
export class PostgresStore implements RunStore {
  readonly kind = "postgres" as const;
  private ready?: Promise<void>;
  constructor(private sql: Query) {}
  private async q(text: string, params: unknown[] = []) {
    this.ready ??= (async () => {
      for (const statement of schema) await this.sql(statement);
    })();
    try {
      await this.ready;
    } catch (error) {
      this.ready = undefined;
      throw error;
    }
    return this.sql(text, params);
  }
  async list(): Promise<Run[]> {
    const rows = await this.q(
      "SELECT body FROM octo_runs ORDER BY created_at DESC",
    );
    return rows.map((row) => JSON.parse(row.body));
  }
  async get(id: string): Promise<Run | undefined> {
    const [row] = await this.q("SELECT body FROM octo_runs WHERE id=$1", [id]);
    return row && JSON.parse(row.body);
  }
  async save(run: Run) {
    run.updatedAt = new Date().toISOString();
    await this.q(
      "INSERT INTO octo_runs (id, body, created_at) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET body=EXCLUDED.body",
      [run.id, JSON.stringify(run), run.createdAt],
    );
    return run;
  }
  async claim(id: string, leaseMs: number) {
    const now = Date.now();
    const rows = await this.q(
      "INSERT INTO octo_leases (id, until_ms) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET until_ms=EXCLUDED.until_ms WHERE octo_leases.until_ms <= $3 RETURNING id",
      [id, now + leaseMs, now],
    );
    return rows.length > 0;
  }
  async release(id: string, holdMs = 0) {
    await this.q("UPDATE octo_leases SET until_ms=$2 WHERE id=$1", [
      id,
      Date.now() + holdMs,
    ]);
  }
  async saveUpload(meta: UploadMeta, bytes: Buffer) {
    await this.blobs("uploads").put(meta.id, bytes);
    const file: Attachment = { ...meta };
    await this.q("INSERT INTO octo_uploads (id, body) VALUES ($1,$2)", [
      file.id,
      JSON.stringify(file),
    ]);
    return file;
  }
  async getUpload(id: string): Promise<Attachment | undefined> {
    const [row] = await this.q("SELECT body FROM octo_uploads WHERE id=$1", [
      id,
    ]);
    return row && JSON.parse(row.body);
  }
  readUpload(file: Attachment) {
    return this.blobs("uploads").get(file.id);
  }
  blobs(namespace: string): BlobCache {
    const key = (k: string) => `${namespace}/${k}`;
    return {
      has: async (k) =>
        (await this.q("SELECT 1 FROM octo_blobs WHERE key=$1", [key(k)]))
          .length > 0,
      get: async (k) => {
        const [row] = await this.q("SELECT data FROM octo_blobs WHERE key=$1", [
          key(k),
        ]);
        if (!row) throw new Error("Stored file not found");
        return Buffer.from(row.data, "base64");
      },
      put: async (k, bytes) => {
        await this.q(
          "INSERT INTO octo_blobs (key, data, size) VALUES ($1,$2,$3) ON CONFLICT (key) DO NOTHING",
          [key(k), bytes.toString("base64"), bytes.byteLength],
        );
      },
    };
  }
  async close() {}
}
