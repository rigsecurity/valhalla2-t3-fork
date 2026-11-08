// @effect-diagnostics nodeBuiltinImport:off -- Native SQLite connections must reopen the same temporary file to test persistence.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { describe, expect, it } from "vite-plus/test";
import { Memorywell } from "./service.ts";
import type { MemoryRecord, ProposeInput } from "./schema.ts";

const NOW = "2026-11-08T12:00:00.000Z";
const REPO = "github.com/rigsecurity/backend";
const evidence = {
  kind: "human-review" as const,
  reference: "Reviewed against commit abc123",
  observedAt: "2026-11-08T11:00:00.000Z",
};

function candidate(overrides: Partial<ProposeInput> = {}): ProposeInput {
  return {
    idempotencyKey: "proposal-1",
    scope: REPO,
    topic: "testing/database",
    title: "Database isolation",
    summary: "Use a separate database for tests",
    content: "Create a separate database before testing migrations.",
    tags: ["database", "migrations"],
    ...overrides,
  };
}

function withMemory(run: (well: Memorywell) => void): void {
  const db = new NodeSqlite.DatabaseSync(":memory:");
  try {
    run(new Memorywell(db, () => NOW));
  } finally {
    db.close();
  }
}

function verify(well: Memorywell, record: MemoryRecord, key = record.id): MemoryRecord {
  return well.verify(
    { id: record.id, expectedRevision: record.revision, idempotencyKey: key, evidence },
    "reviewer",
  );
}

function legacy(
  overrides: Record<string, unknown> = {},
  content = "Use a separate database before testing migrations.",
): string {
  const header = {
    title: "Database isolation",
    hook: "Use a separate database for tests",
    kind: "rule",
    status: "active",
    words: ["database"],
    paths: [],
    roles: [],
    sources: ["Q-example/P1"],
    updated: "2026-10-01",
    ...overrides,
  };
  return `---\n${Object.entries(header)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n")}\n---\n${content}\n`;
}

describe("Memorywell", () => {
  it("retrieves only verified knowledge inside repository and role boundaries", () => {
    withMemory((well) => {
      const proposed = well.propose(candidate(), "engineer-a");
      expect(well.retrieve({ scopes: [REPO], query: "database" }).items).toEqual([]);
      const own = verify(well, proposed);
      const common = verify(
        well,
        well.propose(candidate({ scope: "common", idempotencyKey: "common" }), "engineer-a"),
      );
      const foreign = verify(
        well,
        well.propose(
          candidate({ scope: "github.com/rigsecurity/frontend", idempotencyKey: "foreign" }),
          "engineer-a",
        ),
      );
      const restricted = verify(
        well,
        well.propose(
          candidate({ topic: "testing/reviewer", roles: ["reviewer"], idempotencyKey: "roles" }),
          "engineer-a",
        ),
      );
      expect(
        well.retrieve({ scopes: [REPO], query: "database" }).items.map((item) => item.id),
      ).toEqual([own.id, common.id]);
      expect(well.retrieve({ scopes: [REPO], query: foreign.id }).items).toEqual([]);
      expect(well.retrieve({ scopes: [REPO], query: restricted.id }).items).toEqual([]);
      expect(
        well
          .retrieve({ scopes: [REPO], query: restricted.id, role: "reviewer" })
          .items.map((item) => item.id),
      ).toEqual([restricted.id]);
    });
  });

  it("recalls cited agent notes by repository and gives verified knowledge precedence", () => {
    withMemory((well) => {
      const input = {
        ...candidate(),
        reason: "convention" as const,
        sources: ["tests/migrations.test.ts:42"],
      };
      const note = well.capture(input, "agent-a");
      expect(note).toMatchObject({
        status: "captured",
        provenance: { kind: "capture", reason: "convention", sources: input.sources },
      });
      expect(well.capture(input, "agent-a")).toEqual(note);
      expect(well.capture({ ...input, idempotencyKey: "another-agent" }, "agent-b")).toEqual(note);
      expect(well.retrieve({ scopes: [REPO], query: "database" }).items).toEqual([note]);
      expect(well.retrieve({ scopes: ["github.com/acme/other"], query: "database" }).items).toEqual(
        [],
      );
      expect(() => well.capture({ ...input, sources: [] }, "agent-a")).toThrow();
      expect(() => well.capture({ ...input, scope: "common" }, "agent-a")).toThrow();

      const verified = verify(well, well.propose(candidate(), "engineer-a"));
      expect(well.retrieve({ scopes: [REPO], query: "database" }).items).toEqual([verified]);
    });
  });

  it("persists receipts and rejects stale decisions from another connection", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "valhalla2-memory-"));
    const filename = NodePath.join(directory, "memory.sqlite");
    let first: NodeSqlite.DatabaseSync | undefined;
    let second: NodeSqlite.DatabaseSync | undefined;
    try {
      first = new NodeSqlite.DatabaseSync(filename);
      let well = new Memorywell(first, () => NOW);
      const proposal = well.propose(candidate(), "engineer-a");
      first.close();
      first = new NodeSqlite.DatabaseSync(filename);
      well = new Memorywell(first, () => NOW);
      expect(well.propose(candidate(), "engineer-a")).toEqual(proposal);
      expect(() => well.propose(candidate({ content: "A different claim" }), "engineer-a")).toThrow(
        "request key",
      );
      second = new NodeSqlite.DatabaseSync(filename);
      const teammate = new Memorywell(second, () => NOW);
      const verified = verify(well, proposal);
      expect(verify(well, proposal)).toEqual(verified);
      expect(() => verify(teammate, proposal, "teammate-review")).toThrow("changed");
      expect(teammate.list()).toEqual([verified]);
    } finally {
      second?.close();
      first?.close();
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps competing proposals until an explicit atomic replacement", () => {
    withMemory((well) => {
      const previous = verify(well, well.propose(candidate(), "engineer-a"));
      const replacement = well.propose(
        candidate({
          idempotencyKey: "correction",
          content: "Use a transaction rollback for every database test.",
        }),
        "engineer-b",
      );
      expect(() => verify(well, replacement)).toThrow("verified version exists");
      const request = {
        id: previous.id,
        expectedRevision: previous.revision,
        replacementId: replacement.id,
        replacementRevision: replacement.revision,
        idempotencyKey: "replace",
        evidence,
      };
      expect(() => well.supersede({ ...request, replacementRevision: 99 }, "reviewer")).toThrow(
        "changed",
      );
      expect(well.retrieve({ scopes: [REPO], query: "database" }).items[0]?.id).toBe(previous.id);
      const result = well.supersede(request, "reviewer");
      expect(result.previous).toMatchObject({ status: "superseded", supersededBy: replacement.id });
      expect(result.replacement).toMatchObject({
        status: "verified",
        evidence: { verifiedBy: "reviewer" },
      });
      expect(well.supersede(request, "reviewer")).toEqual(result);
      expect(
        well.retrieve({ scopes: [REPO], query: "database" }).items.map((item) => item.id),
      ).toEqual([replacement.id]);
      expect(() =>
        well.verify(
          {
            id: previous.id,
            expectedRevision: result.previous.revision,
            idempotencyKey: "revive",
            evidence,
          },
          "reviewer",
        ),
      ).toThrow("Only a proposed");
    });
  });

  it("refuses cross-repository replacement and future or secret-bearing evidence", () => {
    withMemory((well) => {
      const previous = verify(well, well.propose(candidate(), "engineer-a"));
      const other = well.propose(
        candidate({ scope: "github.com/rigsecurity/frontend", idempotencyKey: "other" }),
        "engineer-b",
      );
      expect(() =>
        well.supersede(
          {
            id: previous.id,
            expectedRevision: previous.revision,
            replacementId: other.id,
            replacementRevision: other.revision,
            idempotencyKey: "cross",
            evidence,
          },
          "reviewer",
        ),
      ).toThrow("same repository");
      expect(() =>
        well.verify(
          {
            id: other.id,
            expectedRevision: 1,
            idempotencyKey: "future",
            evidence: { ...evidence, observedAt: "2027-01-01T00:00:00Z" },
          },
          "reviewer",
        ),
      ).toThrow("future");
      expect(() =>
        well.propose(
          candidate({ idempotencyKey: "secret", content: "-----BEGIN PRIVATE KEY-----" }),
          "engineer-a",
        ),
      ).toThrow("possible credential");
      expect(() =>
        well.propose(candidate({ idempotencyKey: "path", paths: ["../private"] }), "engineer-a"),
      ).toThrow();
      expect(well.list({ status: "verified" })).toEqual([previous]);
    });
  });

  it("imports legacy provenance and aliases without promoting legacy claims", () => {
    withMemory((well) => {
      const input = {
        idempotencyKey: "legacy-snapshot",
        repositories: { backend: REPO },
        files: {
          "backend/testing/database.md": legacy({
            id: "T-abcdefghij",
            was: ["testing/old-database"],
            sources: ["review:stale", "Q-example/P1"],
          }),
          "common/testing/shared.md": legacy(),
          "roles/reviewer.md": legacy({ kind: "playbook" }),
          "retired/testing/database.md": legacy(),
          "catalog/retired.json": JSON.stringify({ retiredAt: "2026-10-01T00:00:00Z" }),
          "unknown/testing/database.md": legacy(),
          "backend/testing/broken.md": "invalid",
          "backend/testing/secret.md": legacy({}, "-----BEGIN PRIVATE KEY-----"),
          "inbox/drafts/proposal.md": legacy(),
          "archive/backend/testing/database.md": legacy(),
        },
      };
      const result = well.importLegacy(input, "importer");
      expect(result.imported).toHaveLength(3);
      expect(result.imported.every((item) => item.status === "proposed")).toBe(true);
      expect(result.imported.find((item) => item.scope === REPO)).toMatchObject({
        aliases: ["backend/testing/database", "T-abcdefghij", "testing/old-database"],
        provenance: {
          kind: "legacy",
          actor: "importer",
          sourceUpdatedAt: "2026-10-01",
          sourceStatus: "active",
          sources: ["review:stale", "Q-example/P1"],
        },
      });
      expect(result.skipped).toBe(7);
      expect(result.issues).toHaveLength(3);
      expect(well.retrieve({ scopes: [REPO], query: "database" }).items).toEqual([]);
      expect(well.importLegacy(input, "importer")).toEqual(result);
      expect(well.list()).toHaveLength(3);
    });
  });

  it("excludes a legacy repository whose retirement marker cannot be read", () => {
    withMemory((well) => {
      const result = well.importLegacy(
        {
          idempotencyKey: "broken-catalog",
          repositories: { backend: REPO },
          files: { "catalog/backend.json": "broken", "backend/testing/database.md": legacy() },
        },
        "importer",
      );
      expect(result.imported).toEqual([]);
      expect(result.issues[0]?.reason).toContain("retirement marker");
      expect(() =>
        well.importLegacy(
          { idempotencyKey: "outside", files: { "../outside.md": legacy() } },
          "importer",
        ),
      ).toThrow();
    });
  });
});
