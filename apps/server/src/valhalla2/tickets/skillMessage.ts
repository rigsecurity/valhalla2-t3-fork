import type { ServerProviderSkill } from "@t3tools/contracts";

export function skillMessage(
  provider: { driver: string; skills: readonly ServerProviderSkill[] } | undefined,
  names: readonly string[],
  text: string,
): { text: string } | { reason: "skills" | "manual_skills" } {
  if (names.length === 0) return { text };
  const selected = [...new Set(names)].map((name) =>
    provider?.skills.find(
      (skill) => skill.name === name && skill.enabled && skill.userInvocable !== false,
    ),
  );
  if (selected.some((skill) => !skill || !/^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/.test(skill.name)))
    return { reason: "skills" };
  const found = selected.filter((skill) => skill !== undefined);
  if (
    provider?.driver === "claudeAgent" &&
    found.filter((skill) => skill.userInvocationOnly).length > 1
  )
    return { reason: "manual_skills" };
  const mentions = found
    .toSorted(
      (left, right) =>
        Number(left.userInvocationOnly === true) - Number(right.userInvocationOnly === true),
    )
    .map((skill) => `$${skill.name}`)
    .join(" ");
  return { text: `${mentions}\n\n${text}` };
}
