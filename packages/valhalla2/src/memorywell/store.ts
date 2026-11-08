import * as NodeCrypto from "node:crypto";
import type * as NodeSqlite from "node:sqlite";
import { MemoryRecordSchema, type MemoryRecord } from "./schema.ts";

export class MemorywellError extends Error {
  readonly code: "conflict" | "not-found" | "invalid";

  constructor(code: MemorywellError["code"], message: string) {
    super(message);
    this.name = "MemorywellError";
    this.code = code;
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}

export function fingerprint(value: unknown): string {
  return NodeCrypto.createHash("sha256").update(canonical(value)).digest("hex");
}

export class MemoryStore {
  private readonly db: NodeSqlite.DatabaseSync;

  constructor(db: NodeSqlite.DatabaseSync) {
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS valhalla2_memory (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        topic TEXT NOT NULL,
        status TEXT NOT NULL,
        revision INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        record TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS valhalla2_memory_verified ON valhalla2_memory(scope, topic) WHERE status = 'verified';
      CREATE INDEX IF NOT EXISTS valhalla2_memory_scope ON valhalla2_memory(scope, status);
      CREATE TABLE IF NOT EXISTS valhalla2_memory_receipts (
        actor TEXT NOT NULL,
        operation TEXT NOT NULL,
        key TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        result TEXT NOT NULL,
        PRIMARY KEY(actor, operation, key)
      );
    `);
  }

  all(): MemoryRecord[] {
    return this.db
      .prepare("SELECT record FROM valhalla2_memory ORDER BY rowid DESC")
      .all()
      .map((row) => MemoryRecordSchema.parse(JSON.parse(String(row.record))));
  }

  get(id: string): MemoryRecord {
    const row = this.db.prepare("SELECT record FROM valhalla2_memory WHERE id = ?").get(id);
    if (!row) throw new MemorywellError("not-found", "The memory entry no longer exists");
    return MemoryRecordSchema.parse(JSON.parse(String(row.record)));
  }

  duplicate(scope: string, topic: string, hash: string): MemoryRecord | undefined {
    const row = this.db
      .prepare(
        "SELECT record FROM valhalla2_memory WHERE scope = ? AND topic = ? AND content_hash = ? LIMIT 1",
      )
      .get(scope, topic, hash);
    return row ? MemoryRecordSchema.parse(JSON.parse(String(row.record))) : undefined;
  }

  active(scope: string, topic: string): MemoryRecord | undefined {
    const row = this.db
      .prepare(
        "SELECT record FROM valhalla2_memory WHERE scope = ? AND topic = ? AND status = 'verified'",
      )
      .get(scope, topic);
    return row ? MemoryRecordSchema.parse(JSON.parse(String(row.record))) : undefined;
  }

  insert(record: MemoryRecord): void {
    const entry = MemoryRecordSchema.parse(record);
    this.db
      .prepare(
        "INSERT INTO valhalla2_memory (id, scope, topic, status, revision, content_hash, record) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        entry.id,
        entry.scope,
        entry.topic,
        entry.status,
        entry.revision,
        entry.contentHash,
        JSON.stringify(entry),
      );
  }

  update(record: MemoryRecord, expectedRevision: number): void {
    const entry = MemoryRecordSchema.parse(record);
    const result = this.db
      .prepare(
        "UPDATE valhalla2_memory SET status = ?, revision = ?, record = ? WHERE id = ? AND revision = ?",
      )
      .run(entry.status, entry.revision, JSON.stringify(entry), entry.id, expectedRevision);
    if (Number(result.changes) !== 1)
      throw new MemorywellError("conflict", "The memory entry changed; reload it before deciding");
  }

  once<T>(
    actor: string,
    operation: string,
    key: string,
    input: unknown,
    parse: (value: unknown) => T,
    run: () => T,
  ): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const hash = fingerprint(input);
      const receipt = this.db
        .prepare(
          "SELECT fingerprint, result FROM valhalla2_memory_receipts WHERE actor = ? AND operation = ? AND key = ?",
        )
        .get(actor, operation, key);
      let result: T;
      if (receipt) {
        if (receipt.fingerprint !== hash)
          throw new MemorywellError(
            "conflict",
            "This request key was already used with different content",
          );
        result = parse(JSON.parse(String(receipt.result)));
      } else {
        result = parse(run());
        this.db
          .prepare(
            "INSERT INTO valhalla2_memory_receipts (actor, operation, key, fingerprint, result) VALUES (?, ?, ?, ?, ?)",
          )
          .run(actor, operation, key, hash, JSON.stringify(result));
      }
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
