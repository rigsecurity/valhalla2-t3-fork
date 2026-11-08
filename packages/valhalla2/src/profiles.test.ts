import * as NodeSqlite from "node:sqlite";
import { expect, it } from "vite-plus/test";
import { Profiles } from "./profiles.ts";

it("keeps profiles personal and requires team modules regardless of personal mode", () => {
  const db = new NodeSqlite.DatabaseSync(":memory:");
  try {
    const alex = new Profiles(db, "alex");
    const sam = new Profiles(db, "sam");
    const profile = {
      ...alex.get("freestyle"),
      id: "custom",
      name: "Plan then build",
      planner: { provider: "claude", model: "opus" },
      implementer: { provider: "codex", model: "chosen-model" },
      skills: ["testing"],
    };
    alex.save(profile);
    alex.select("custom");
    expect(new Profiles(db, "alex").selected()).toEqual(profile);
    expect(sam.selected().id).toBe("freestyle");
    expect(() => sam.get("custom")).toThrow();
    expect(() => alex.save({ ...profile, memoryRequired: false })).toThrow();
    expect(sam.policy).toEqual({
      memoryRequired: true,
      measurementRequired: true,
      isolatedWorktrees: true,
    });
  } finally {
    db.close();
  }
});
