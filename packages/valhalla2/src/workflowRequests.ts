import type * as NodeSqlite from "node:sqlite";
import { z } from "zod";
import { ModelRoute, WorkflowProfile } from "./contracts.ts";

export const PreparedWorkflow = z.object({
  profile: WorkflowProfile,
  model: ModelRoute,
  repository: z.string(),
  text: z.string(),
  memoryVersion: z.string(),
  startedAt: z.iso.datetime(),
});
export type PreparedWorkflow = z.infer<typeof PreparedWorkflow>;

export class WorkflowRequests {
  private readonly db: NodeSqlite.DatabaseSync;
  constructor(db: NodeSqlite.DatabaseSync) {
    this.db = db;
    db.exec(
      "CREATE TABLE IF NOT EXISTS v2_prepared_workflows (id TEXT PRIMARY KEY, digest TEXT NOT NULL, body TEXT NOT NULL)",
    );
  }

  get(id: string, digest: string): PreparedWorkflow | null {
    const row = this.db
      .prepare("SELECT digest, body FROM v2_prepared_workflows WHERE id = ?")
      .get(id);
    if (!row) return null;
    if (row.digest !== digest)
      throw new Error("This launch request was already used with different inputs.");
    return PreparedWorkflow.parse(JSON.parse(String(row.body)));
  }

  save(id: string, digest: string, value: PreparedWorkflow): PreparedWorkflow {
    const body = JSON.stringify(PreparedWorkflow.parse(value));
    this.db
      .prepare("INSERT OR IGNORE INTO v2_prepared_workflows (id, digest, body) VALUES (?, ?, ?)")
      .run(id, digest, body);
    return this.get(id, digest)!;
  }
}
