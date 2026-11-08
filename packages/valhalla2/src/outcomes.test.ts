import * as NodeSqlite from "node:sqlite";
import { describe, expect, it } from "vite-plus/test";
import { OutcomeLedger } from "./outcomes.ts";

const sample = {
  idempotencyKey: "one",
  repository: "github.com/acme/api",
  profileId: "freestyle",
  model: "claude/sonnet",
  startedAt: "2026-11-08T08:00:00.000Z",
};

describe("outcome measurements", () => {
  it("includes failed costs and rework, keeps unknowns missing and allows negative savings", () => {
    using db = new NodeSqlite.DatabaseSync(":memory:");
    const store = new OutcomeLedger(db);
    expect(store.summary()).toMatchObject({
      acceptanceRate: null,
      actualCostUsd: null,
      savedMinutes: null,
    });
    store.record({
      ...sample,
      status: "accepted",
      completedAt: "2026-11-08T09:00:00.000Z",
      baselineMinutes: 30,
      humanMinutes: 35,
      reworkMinutes: 10,
      actualCostUsd: 2,
    });
    store.record({
      ...sample,
      idempotencyKey: "two",
      status: "failed",
      completedAt: "2026-11-08T09:00:00.000Z",
      actualCostUsd: 4,
    });
    store.record({ ...sample, idempotencyKey: "three", status: "abandoned", estimatedCostUsd: 8 });
    store.record({ ...sample, idempotencyKey: "four", status: "running" });
    expect(store.summary()).toMatchObject({
      started: 4,
      accepted: 1,
      failed: 1,
      abandoned: 1,
      running: 1,
      acceptanceRate: 1 / 3,
      measuredAccepted: 1,
      humanMinutes: 45,
      savedMinutes: -15,
      actualCostUsd: 6,
      estimatedCostUsd: 8,
      costSamples: 2,
    });
    expect(store.summary().trend).toEqual([
      {
        date: "2026-11-08",
        accepted: 1,
        failed: 1,
        abandoned: 0,
        measured: 1,
        humanMinutes: 45,
        savedMinutes: -15,
      },
    ]);
  });

  it("replays immutable receipts, rejects conflicting retries and clears completion on resumed work", () => {
    using db = new NodeSqlite.DatabaseSync(":memory:");
    const store = new OutcomeLedger(db);
    const failed = {
      ...sample,
      id: "run",
      status: "failed",
      completedAt: "2026-11-08T09:00:00.000Z",
      actualCostUsd: 4,
    };
    const first = store.record(failed);
    expect(store.record(failed)).toEqual(first);
    expect(() => store.record({ ...failed, actualCostUsd: 5 })).toThrow("already used");
    const resumed = store.record({
      ...sample,
      id: "run",
      idempotencyKey: "retry",
      status: "running",
    });
    expect(resumed.completedAt).toBeUndefined();
    expect(resumed.actualCostUsd).toBe(4);
    expect(store.list()).toHaveLength(1);
    expect(store.record(failed)).toEqual(first);
    expect(() =>
      store.record({
        ...sample,
        idempotencyKey: "bad",
        status: "accepted",
        completedAt: "2026-11-07T09:00:00.000Z",
      }),
    ).toThrow();
  });
});
