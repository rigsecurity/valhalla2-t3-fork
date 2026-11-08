import { assert, it } from "@effect/vitest";
import { boundedMemoryContext } from "./memoryContext.ts";

it("bounds injected memory and marks shortened notes", () => {
  const notes = Array.from({ length: 6 }, (_, index) => ({
    id: `note-${index}`,
    revision: 1,
    title: `Note ${index}`,
    content: "Useful detail. ".repeat(1000),
    status: "captured" as const,
    provenance: { actor: "agent", kind: "capture" as const, sources: ["tests/smoke.test.ts:12"] },
  }));
  const result = boundedMemoryContext(notes, 600);
  assert.isAtMost(new TextEncoder().encode(JSON.stringify(result)).byteLength, 600);
  assert.include(JSON.stringify(result), "Note shortened to fit the launch context.");
  assert.deepInclude(result[0], {
    status: "captured",
    sources: ["tests/smoke.test.ts:12"],
  });
});
