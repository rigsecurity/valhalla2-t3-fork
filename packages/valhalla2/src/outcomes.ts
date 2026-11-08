// @effect-diagnostics globalDate:off -- This synchronous SQLite domain also runs outside the server's Effect runtime.
import * as NodeCrypto from "node:crypto";
import type * as NodeSqlite from "node:sqlite";
import { OutcomeEntry, OutcomeInput, type OutcomeSummary } from "./contracts.ts";

function measuredMinutes(entry: OutcomeEntry) {
  return entry.humanMinutes == null ? null : entry.humanMinutes + (entry.reworkMinutes ?? 0);
}

function sumKnown(values: Array<number | null | undefined>) {
  const known = values.filter((value): value is number => value != null);
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0);
}

export function summarizeOutcomes(entries: OutcomeEntry[]): OutcomeSummary {
  const accepted = entries.filter((entry) => entry.status === "accepted");
  const failed = entries.filter((entry) => entry.status === "failed").length;
  const abandoned = entries.filter((entry) => entry.status === "abandoned").length;
  const settled = accepted.length + failed + abandoned;
  const measured = accepted.filter(
    (entry) => measuredMinutes(entry) != null && entry.baselineMinutes != null,
  );
  const dates = [
    ...new Set(
      entries.filter((entry) => entry.completedAt).map((entry) => entry.completedAt!.slice(0, 10)),
    ),
  ].sort();
  return {
    started: entries.length,
    accepted: accepted.length,
    failed,
    abandoned,
    running: entries.filter((entry) => entry.status === "running").length,
    acceptanceRate: settled === 0 ? null : accepted.length / settled,
    measuredAccepted: measured.length,
    humanMinutes: sumKnown(measured.map(measuredMinutes)),
    baselineMinutes: sumKnown(measured.map((entry) => entry.baselineMinutes)),
    savedMinutes: sumKnown(
      measured.map((entry) => entry.baselineMinutes! - measuredMinutes(entry)!),
    ),
    actualCostUsd: sumKnown(entries.map((entry) => entry.actualCostUsd)),
    estimatedCostUsd: sumKnown(entries.map((entry) => entry.estimatedCostUsd)),
    maintenanceCostUsd: sumKnown(entries.map((entry) => entry.maintenanceCostUsd)),
    costSamples: entries.filter((entry) => entry.actualCostUsd != null).length,
    estimatedCostSamples: entries.filter((entry) => entry.estimatedCostUsd != null).length,
    defects: sumKnown(entries.map((entry) => entry.defects)),
    trend: dates.map((date) => {
      const day = entries.filter((entry) => entry.completedAt?.startsWith(date));
      const dayMeasured = measured.filter((entry) => entry.completedAt?.startsWith(date));
      return {
        date,
        accepted: day.filter((entry) => entry.status === "accepted").length,
        failed: day.filter((entry) => entry.status === "failed").length,
        abandoned: day.filter((entry) => entry.status === "abandoned").length,
        measured: dayMeasured.length,
        humanMinutes: sumKnown(dayMeasured.map(measuredMinutes)),
        savedMinutes: sumKnown(
          dayMeasured.map((entry) => entry.baselineMinutes! - measuredMinutes(entry)!),
        ),
      };
    }),
  };
}

export class OutcomeLedger {
  private readonly db: NodeSqlite.DatabaseSync;

  constructor(db: NodeSqlite.DatabaseSync) {
    this.db = db;
    db.exec(
      "CREATE TABLE IF NOT EXISTS v2_outcomes (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS v2_outcome_receipts (key TEXT PRIMARY KEY, digest TEXT NOT NULL, body TEXT NOT NULL)",
    );
  }

  record(value: unknown): OutcomeEntry {
    const input = OutcomeInput.parse(value);
    const digest = NodeCrypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const receipt = this.db
        .prepare("SELECT digest, body FROM v2_outcome_receipts WHERE key = ?")
        .get(input.idempotencyKey);
      if (receipt) {
        if (receipt.digest !== digest)
          throw new Error("This measurement key was already used for different data.");
        const replay = OutcomeEntry.parse(JSON.parse(String(receipt.body)));
        this.db.exec("COMMIT");
        return replay;
      }
      const id = input.id ?? NodeCrypto.randomUUID();
      const previous = this.db.prepare("SELECT body FROM v2_outcomes WHERE id = ?").get(id);
      const entry = OutcomeEntry.parse({
        ...(previous ? OutcomeEntry.parse(JSON.parse(String(previous.body))) : {}),
        ...input,
        ...(input.status === "running" ? { completedAt: input.completedAt } : {}),
        id,
        updatedAt: new Date().toISOString(),
      });
      const body = JSON.stringify(entry);
      this.db
        .prepare(
          "INSERT INTO v2_outcomes (id, body) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
        )
        .run(id, body);
      this.db
        .prepare("INSERT INTO v2_outcome_receipts (key, digest, body) VALUES (?, ?, ?)")
        .run(input.idempotencyKey, digest, body);
      this.db.exec("COMMIT");
      return entry;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  list(): OutcomeEntry[] {
    return this.db
      .prepare("SELECT body FROM v2_outcomes ORDER BY json_extract(body, '$.startedAt') DESC")
      .all()
      .map((row) => OutcomeEntry.parse(JSON.parse(String(row.body))));
  }

  summary(): OutcomeSummary {
    return summarizeOutcomes(this.list());
  }
}
