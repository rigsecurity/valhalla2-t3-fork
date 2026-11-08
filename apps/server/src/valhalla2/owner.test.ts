import { assert, it } from "@effect/vitest";
import { ownerIdForSession } from "./owner.ts";

it("keeps ownership stable when a trusted session is replaced", () => {
  assert.strictEqual(
    ownerIdForSession({ sessionId: "old", proofKeyThumbprint: "trusted-key" }),
    ownerIdForSession({ sessionId: "new", proofKeyThumbprint: "trusted-key" }),
  );
});

it("isolates trusted keys and falls back to the legacy session identity", () => {
  assert.notStrictEqual(
    ownerIdForSession({ sessionId: "one", proofKeyThumbprint: "key-one" }),
    ownerIdForSession({ sessionId: "two", proofKeyThumbprint: "key-two" }),
  );
  assert.strictEqual(ownerIdForSession({ sessionId: "legacy" }), "session:legacy");
});
