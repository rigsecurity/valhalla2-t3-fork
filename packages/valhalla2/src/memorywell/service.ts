// @effect-diagnostics globalDate:off -- This synchronous library also runs outside Effect; callers can inject its clock.
import type * as NodeSqlite from "node:sqlite";
import { z } from "zod";
import { legacyCandidates } from "./legacy.ts";
import {
  CaptureInputSchema,
  ImportLegacyInputSchema,
  ImportLegacyResultSchema,
  ListInputSchema,
  MemoryRecordSchema,
  ProposeInputSchema,
  RetrieveInputSchema,
  SupersedeInputSchema,
  VerifyInputSchema,
  memoryActor,
  type CaptureInput,
  type ImportLegacyInput,
  type ListInput,
  type MemoryRecord,
  type ProposeInput,
  type RetrieveInput,
  type SupersedeInput,
  type VerifyInput,
} from "./schema.ts";
import { fingerprint, MemoryStore, MemorywellError } from "./store.ts";

export { MemorywellError } from "./store.ts";

const Superseded = z.strictObject({
  previous: MemoryRecordSchema,
  replacement: MemoryRecordSchema,
});

function assertSafe(value: unknown): void {
  const text = JSON.stringify(value);
  if (
    /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\b(?:ghp_|github_pat_|sk-ant-|sk-proj-)[A-Za-z0-9_-]{16,}|\bAKIA[A-Z0-9]{16}\b|\bBearer\s+[A-Za-z0-9._-]{20,}/.test(
      text,
    )
  ) {
    throw new MemorywellError(
      "invalid",
      "The memory contains a possible credential; remove it before sharing",
    );
  }
}

function expected(record: MemoryRecord, revision: number): void {
  if (record.revision !== revision)
    throw new MemorywellError("conflict", "The memory entry changed; reload it before deciding");
}

function terms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 1),
  );
}

function overlap(words: Set<string>, text: string): number {
  return [...terms(text)].filter((word) => words.has(word)).length;
}

function score(
  record: MemoryRecord,
  query: z.infer<typeof RetrieveInputSchema>,
  words: Set<string>,
): number {
  if (
    query.query === record.id ||
    record.aliases.includes(query.query) ||
    query.query === record.topic
  )
    return 1000;
  const pathHits = query.paths.filter((path) =>
    record.paths.some((cue) => {
      const prefix = cue.split(/[*?[{]/)[0]?.replace(/\/$/, "");
      return (
        !!prefix &&
        (path === prefix ||
          path.startsWith(`${prefix}/`) ||
          (path.startsWith(prefix) && cue.includes("*")))
      );
    }),
  ).length;
  const relevant =
    overlap(words, record.title) * 4 +
    overlap(words, record.tags.join(" ")) * 4 +
    overlap(words, record.summary) * 2 +
    overlap(words, record.content) +
    pathHits * 8;
  return relevant > 0 ? relevant + (record.scope === "common" ? 0 : 2) : 0;
}

export class Memorywell {
  private readonly store: MemoryStore;
  private readonly now: () => string;

  constructor(db: NodeSqlite.DatabaseSync, now: () => string = () => new Date().toISOString()) {
    this.store = new MemoryStore(db);
    this.now = now;
  }

  list(input: ListInput = {}): MemoryRecord[] {
    const query = ListInputSchema.parse(input);
    return this.store.list(query.limit, query.scope, query.status);
  }

  verificationRecipe(scope: string, role: "implementer" | "reviewer"): MemoryRecord | undefined {
    const entries = this.store.recall([scope], "testing/how-to-verify");
    const verified = entries.find((record) => record.status === "verified");
    return (verified ? [verified] : entries)
      .filter(
        ({ roles }) =>
          roles.length === 0 ||
          roles.includes(role) ||
          (role === "reviewer" && roles.includes("verifier")),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))[0];
  }

  retrieve(input: RetrieveInput): { items: MemoryRecord[] } {
    const query = RetrieveInputSchema.parse(input);
    const scopes = new Set([...query.scopes, "common"]);
    const candidates = this.store.recall([...scopes]);
    const topicKey = (record: MemoryRecord) => `${record.scope}:${record.topic}`;
    const verified = new Set(
      candidates.filter((record) => record.status === "verified").map(topicKey),
    );
    const words = terms(query.query);
    const hits = candidates
      .filter((record) => record.status === "verified" || !verified.has(topicKey(record)))
      .filter(
        (record) => !record.roles.length || (!!query.role && record.roles.includes(query.role)),
      )
      .map((record) => ({ record, score: score(record, query, words) }))
      .filter((hit) => hit.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          Number(b.record.status === "verified") - Number(a.record.status === "verified") ||
          b.record.updatedAt.localeCompare(a.record.updatedAt) ||
          a.record.id.localeCompare(b.record.id),
      );
    const items: MemoryRecord[] = [];
    const seen = new Set<string>();
    for (const { record } of hits) {
      if (seen.has(topicKey(record))) continue;
      seen.add(topicKey(record));
      items.push(record);
      if (items.length === query.limit) break;
    }
    return { items };
  }

  capture(input: CaptureInput, actor: string): MemoryRecord {
    const candidate = CaptureInputSchema.parse(input);
    const author = memoryActor(actor);
    assertSafe(candidate);
    const { reason, ...note } = candidate;
    return this.store.once(
      author,
      "capture",
      note.idempotencyKey,
      candidate,
      MemoryRecordSchema.parse,
      () => this.create(note, { actor: author, kind: "capture", reason, sources: note.sources }),
    );
  }

  propose(input: ProposeInput, actor: string): MemoryRecord {
    const candidate = ProposeInputSchema.parse(input);
    const author = memoryActor(actor);
    assertSafe(candidate);
    return this.store.once(
      author,
      "propose",
      candidate.idempotencyKey,
      candidate,
      MemoryRecordSchema.parse,
      () => this.create(candidate, { actor: author, kind: "proposal", sources: candidate.sources }),
    );
  }

  verify(input: VerifyInput, actor: string): MemoryRecord {
    const request = VerifyInputSchema.parse(input);
    const verifier = memoryActor(actor);
    assertSafe(request.evidence);
    return this.store.once(
      verifier,
      "verify",
      request.idempotencyKey,
      request,
      MemoryRecordSchema.parse,
      () => {
        const record = this.store.get(request.id);
        expected(record, request.expectedRevision);
        if (record.status !== "proposed" && record.status !== "captured")
          throw new MemorywellError(
            "conflict",
            "Only a proposed or agent-captured note can be verified",
          );
        if (this.store.active(record.scope, record.topic))
          throw new MemorywellError(
            "conflict",
            "A verified version exists; supersede it explicitly",
          );
        const verified = this.verified(record, request.evidence, verifier);
        this.store.update(verified, request.expectedRevision);
        return verified;
      },
    );
  }

  supersede(input: SupersedeInput, actor: string) {
    const request = SupersedeInputSchema.parse(input);
    const verifier = memoryActor(actor);
    assertSafe(request.evidence);
    return this.store.once(
      verifier,
      "supersede",
      request.idempotencyKey,
      request,
      Superseded.parse,
      () => {
        const old = this.store.get(request.id);
        const proposed = this.store.get(request.replacementId);
        expected(old, request.expectedRevision);
        expected(proposed, request.replacementRevision);
        if (
          old.status !== "verified" ||
          (proposed.status !== "proposed" && proposed.status !== "captured") ||
          old.scope !== proposed.scope ||
          old.topic !== proposed.topic
        ) {
          throw new MemorywellError(
            "conflict",
            "Replace a verified memory with a proposal for the same repository and topic",
          );
        }
        const previous: MemoryRecord = {
          ...old,
          revision: old.revision + 1,
          status: "superseded",
          supersededBy: proposed.id,
          updatedAt: this.now(),
        };
        const replacement = this.verified(proposed, request.evidence, verifier);
        this.store.update(previous, old.revision);
        this.store.update(replacement, proposed.revision);
        return { previous, replacement };
      },
    );
  }

  importLegacy(input: ImportLegacyInput, actor: string) {
    const request = ImportLegacyInputSchema.parse(input);
    const importer = memoryActor(actor);
    return this.store.once(
      importer,
      "import",
      request.idempotencyKey,
      request,
      ImportLegacyResultSchema.parse,
      () => {
        const { candidates, skipped, issues } = legacyCandidates(request, importer);
        const imported: MemoryRecord[] = [];
        let rejected = 0;
        for (const candidate of candidates) {
          try {
            assertSafe(candidate);
          } catch {
            issues.push({
              path: candidate.provenance.sourcePath ?? "",
              reason: "This topic contains a possible credential and was excluded",
            });
            rejected++;
            continue;
          }
          imported.push(this.create(candidate.input, candidate.provenance, candidate.aliases));
        }
        return { imported, skipped: skipped + rejected, issues };
      },
    );
  }

  private create(
    candidate: z.infer<typeof ProposeInputSchema>,
    provenance: MemoryRecord["provenance"],
    aliases: string[] = [],
  ): MemoryRecord {
    const { idempotencyKey: _key, sources: _sources, ...content } = candidate;
    const captured = provenance.kind === "capture";
    const hash = fingerprint(captured ? { ...content, captured } : content);
    const existing = this.store.duplicate(candidate.scope, candidate.topic, hash);
    if (existing) return existing;
    const at = this.now();
    const record = MemoryRecordSchema.parse({
      ...content,
      schemaVersion: 1,
      id: `MW-${hash.slice(0, 32)}`,
      contentHash: hash,
      aliases,
      status: captured ? "captured" : "proposed",
      revision: 1,
      createdAt: at,
      updatedAt: at,
      provenance,
    });
    this.store.insert(record);
    return record;
  }

  private verified(
    record: MemoryRecord,
    evidence: VerifyInput["evidence"],
    actor: string,
  ): MemoryRecord {
    if (Date.parse(evidence.observedAt) > Date.parse(this.now()))
      throw new MemorywellError("invalid", "Verification evidence cannot be dated in the future");
    return {
      ...record,
      status: "verified",
      revision: record.revision + 1,
      updatedAt: this.now(),
      evidence: { ...evidence, verifiedBy: actor },
    };
  }
}
