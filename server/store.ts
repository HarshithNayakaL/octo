import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Run, Attachment } from "../shared/types.js";

export class Store {
  readonly db: DatabaseSync;
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(resolve(directory, "research.sqlite"));
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, body TEXT NOT NULL);",
    );
  }
  list(): Run[] {
    return (
      this.db.prepare("SELECT body FROM runs").all() as { body: string }[]
    )
      .map((x) => JSON.parse(x.body))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  get(id: string): Run | undefined {
    const row = this.db.prepare("SELECT body FROM runs WHERE id=?").get(id) as
      | { body: string }
      | undefined;
    return row && JSON.parse(row.body);
  }
  save(run: Run) {
    run.updatedAt = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO runs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(run.id, JSON.stringify(run));
    return run;
  }
  upload(file: Attachment) {
    this.db
      .prepare("INSERT INTO uploads VALUES (?,?)")
      .run(file.id, JSON.stringify(file));
  }
  getUpload(id: string): Attachment | undefined {
    const row = this.db
      .prepare("SELECT body FROM uploads WHERE id=?")
      .get(id) as { body: string } | undefined;
    return row && JSON.parse(row.body);
  }
  close() {
    this.db.close();
  }
}
