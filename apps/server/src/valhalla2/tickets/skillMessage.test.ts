import { assert, it } from "@effect/vitest";
import type { ServerProviderSkill } from "@t3tools/contracts";
import { planClaudeSkillDispatch } from "../../provider/Drivers/ClaudeSkillDispatch.ts";
import { skillMessage } from "./skillMessage.ts";

it("uses T3's native Claude skill dispatch and keeps the one manual-only skill as the expanded command", () => {
  const skills = [
    {
      name: "review",
      path: "/repo/.claude/skills/review/SKILL.md",
      enabled: true,
      userInvocationOnly: true,
    },
    { name: "tests", path: "/repo/.claude/skills/tests/SKILL.md", enabled: true },
  ] as ServerProviderSkill[];
  const prepared = skillMessage(
    { driver: "claudeAgent", skills },
    ["review", "tests"],
    "Check the change.",
  );
  assert.property(prepared, "text");
  if (!("text" in prepared)) return;
  const dispatch = planClaudeSkillDispatch(
    prepared.text,
    new Map(skills.map((skill) => [skill.name, skill])),
  );
  assert.strictEqual(dispatch?.commandText, "/review\n\nCheck the change.");
  assert.include(dispatch?.leadingText, "/tests");
  assert.deepEqual(
    skillMessage(
      {
        driver: "claudeAgent",
        skills: skills.map((skill) => ({ ...skill, userInvocationOnly: true })),
      },
      ["review", "tests"],
      "Check.",
    ),
    { reason: "manual_skills" },
  );
  assert.deepEqual(
    skillMessage(
      { driver: "claudeAgent", skills: skills.map((skill) => ({ ...skill, enabled: false })) },
      ["review"],
      "Check.",
    ),
    { reason: "skills" },
  );
});
