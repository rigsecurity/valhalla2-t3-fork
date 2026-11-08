import type * as NodeSqlite from "node:sqlite";
import { WorkflowProfile, teamPolicy } from "./contracts.ts";

const defaults: WorkflowProfile[] = [
  {
    id: "freestyle",
    name: "Freestyle",
    mode: "freestyle",
    implementer: { provider: "claude", model: "sonnet" },
    skills: [],
    optionalTools: [],
    maxRepairAttempts: 1,
  },
  {
    id: "skills",
    name: "My skills",
    mode: "skills",
    implementer: { provider: "claude", model: "sonnet" },
    skills: [],
    optionalTools: [],
    maxRepairAttempts: 1,
  },
  {
    id: "ticket",
    name: "Ticket to PR",
    mode: "ticket",
    implementer: { provider: "claude", model: "sonnet" },
    reviewer: { provider: "claude", model: "sonnet" },
    skills: [],
    optionalTools: [],
    maxRepairAttempts: 1,
  },
];

export class Profiles {
  readonly policy = teamPolicy;
  private readonly db: NodeSqlite.DatabaseSync;
  private readonly ownerId: string;

  constructor(db: NodeSqlite.DatabaseSync, ownerId = "local") {
    this.db = db;
    this.ownerId = ownerId;
    db.exec(
      "CREATE TABLE IF NOT EXISTS v2_personal_profiles (owner_id TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(owner_id, id)); CREATE TABLE IF NOT EXISTS v2_personal_preferences (owner_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(owner_id, key))",
    );
    const insert = db.prepare(
      "INSERT OR IGNORE INTO v2_personal_profiles (owner_id, id, body) VALUES (?, ?, ?)",
    );
    for (const profile of defaults) insert.run(ownerId, profile.id, JSON.stringify(profile));
  }

  list(): WorkflowProfile[] {
    return this.db
      .prepare("SELECT body FROM v2_personal_profiles WHERE owner_id = ? ORDER BY id")
      .all(this.ownerId)
      .map((row) => WorkflowProfile.parse(JSON.parse(String(row.body))));
  }

  get(id: string): WorkflowProfile {
    const row = this.db
      .prepare("SELECT body FROM v2_personal_profiles WHERE owner_id = ? AND id = ?")
      .get(this.ownerId, id);
    if (!row) throw new Error("Workflow profile was not found.");
    return WorkflowProfile.parse(JSON.parse(String(row.body)));
  }

  save(input: unknown): WorkflowProfile {
    const profile = WorkflowProfile.parse(input);
    this.db
      .prepare(
        "INSERT INTO v2_personal_profiles (owner_id, id, body) VALUES (?, ?, ?) ON CONFLICT(owner_id, id) DO UPDATE SET body=excluded.body",
      )
      .run(this.ownerId, profile.id, JSON.stringify(profile));
    return profile;
  }

  selected(): WorkflowProfile {
    const row = this.db
      .prepare(
        "SELECT value FROM v2_personal_preferences WHERE owner_id = ? AND key = 'selected_profile'",
      )
      .get(this.ownerId);
    return this.get(row ? String(row.value) : "freestyle");
  }

  select(id: string): WorkflowProfile {
    const profile = this.get(id);
    this.db
      .prepare(
        "INSERT INTO v2_personal_preferences (owner_id, key, value) VALUES (?, 'selected_profile', ?) ON CONFLICT(owner_id, key) DO UPDATE SET value=excluded.value",
      )
      .run(this.ownerId, profile.id);
    return profile;
  }
}
