import type * as NodeSqlite from "node:sqlite";
import { TicketRunSchema, type TicketRun } from "@rig/valhalla2/tickets";
import { z } from "zod";

const Stored = z.object({ payload: z.string() });

export class TicketRepository {
  private readonly db: NodeSqlite.DatabaseSync;

  constructor(db: NodeSqlite.DatabaseSync) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS valhalla2_ticket_runs (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, request_id TEXT NOT NULL,
      status TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(owner_id, request_id)
    )`);
  }

  get(id: string, ownerId: string): TicketRun | null {
    const row = this.db
      .prepare("SELECT payload FROM valhalla2_ticket_runs WHERE id = ? AND owner_id = ?")
      .get(id, ownerId);
    return row ? TicketRunSchema.parse(JSON.parse(Stored.parse(row).payload)) : null;
  }

  find(requestId: string, ownerId: string): TicketRun | null {
    const row = this.db
      .prepare("SELECT payload FROM valhalla2_ticket_runs WHERE request_id = ? AND owner_id = ?")
      .get(requestId, ownerId);
    return row ? TicketRunSchema.parse(JSON.parse(Stored.parse(row).payload)) : null;
  }

  list(ownerId?: string): TicketRun[] {
    const rows =
      ownerId === undefined
        ? this.db.prepare("SELECT payload FROM valhalla2_ticket_runs ORDER BY rowid DESC").all()
        : this.db
            .prepare(
              "SELECT payload FROM valhalla2_ticket_runs WHERE owner_id = ? ORDER BY rowid DESC",
            )
            .all(ownerId);
    return rows.map((row) => TicketRunSchema.parse(JSON.parse(Stored.parse(row).payload)));
  }

  save(input: TicketRun): TicketRun {
    const run = TicketRunSchema.parse(input);
    this.db
      .prepare(`INSERT INTO valhalla2_ticket_runs (id, owner_id, request_id, status, payload)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, payload=excluded.payload`)
      .run(run.id, run.ownerId, run.requestId, run.status, JSON.stringify(run));
    return run;
  }
}
