import { z } from "zod";

export const MemoryScopeSchema = z
  .string()
  .regex(/^(?:common|[a-z0-9.-]+(?:\/[a-zA-Z0-9_.-]+){2,})$/)
  .max(300)
  .refine((scope) => scope.split("/").every((part) => part !== "." && part !== ".."));
const Key = z.string().trim().min(1).max(200);
const RelativePath = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (value) => !value.startsWith("/") && !value.includes("\\") && !value.split("/").includes(".."),
    "Use a repository-relative path",
  );
const Actor = z.string().trim().min(1).max(200);
const DateTime = z.iso.datetime({ offset: true });
const CaptureReason = z.enum(["research", "convention", "pitfall"]);
const Content = {
  scope: MemoryScopeSchema,
  topic: z
    .string()
    .regex(/^[a-z0-9][a-z0-9/-]{0,159}$/)
    .refine((value) => !value.includes("//") && !value.endsWith("/")),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(400),
  content: z.string().trim().min(1).max(12_000),
  tags: z.array(z.string().trim().min(1).max(80)).max(32).default([]),
  paths: z.array(RelativePath).max(32).default([]),
  roles: z
    .array(z.string().regex(/^[a-z][a-z0-9-]{0,59}$/))
    .max(32)
    .default([]),
};

export const EvidenceSchema = z.strictObject({
  kind: z.enum(["test", "merged-pr", "human-review"]),
  reference: z.string().trim().min(5).max(2000),
  observedAt: DateTime,
});

export const MemoryRecordSchema = z.strictObject({
  ...Content,
  schemaVersion: z.literal(1),
  id: z.string().regex(/^MW-[a-f0-9]{32}$/),
  status: z.enum(["captured", "proposed", "verified", "superseded"]),
  revision: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  aliases: z.array(z.string().min(1).max(200)).max(32),
  createdAt: DateTime,
  updatedAt: DateTime,
  provenance: z.strictObject({
    actor: Actor,
    kind: z.enum(["capture", "proposal", "legacy"]),
    reason: CaptureReason.optional(),
    sources: z.array(z.string().min(1).max(1000)).max(32),
    sourcePath: RelativePath.optional(),
    sourceUpdatedAt: z.string().max(100).optional(),
    sourceStatus: z.string().max(40).optional(),
  }),
  evidence: EvidenceSchema.extend({ verifiedBy: Actor }).optional(),
  supersededBy: z
    .string()
    .regex(/^MW-[a-f0-9]{32}$/)
    .optional(),
});

export const ProposeInputSchema = z.strictObject({
  ...Content,
  idempotencyKey: Key,
  sources: z.array(z.string().min(1).max(1000)).max(32).default([]),
});

export const CaptureInputSchema = ProposeInputSchema.extend({
  scope: MemoryScopeSchema.refine((scope) => scope !== "common"),
  content: Content.content.max(1600),
  reason: CaptureReason,
  sources: z.array(z.string().trim().min(3).max(500)).min(1).max(4),
});

export const VerifyInputSchema = z.strictObject({
  id: MemoryRecordSchema.shape.id,
  expectedRevision: z.number().int().positive(),
  idempotencyKey: Key,
  evidence: EvidenceSchema,
});

export const SupersedeInputSchema = VerifyInputSchema.extend({
  replacementId: MemoryRecordSchema.shape.id,
  replacementRevision: z.number().int().positive(),
});

export const RetrieveInputSchema = z.strictObject({
  scopes: z.array(MemoryScopeSchema).min(1).max(32),
  query: z.string().trim().min(1).max(4000),
  paths: z.array(RelativePath).max(32).default([]),
  role: z.string().max(60).optional(),
  limit: z.number().int().min(1).max(20).default(8),
});

export const ListInputSchema = z.strictObject({
  scope: MemoryScopeSchema.optional(),
  status: MemoryRecordSchema.shape.status.optional(),
  limit: z.number().int().min(1).max(1000).default(100),
});

export const ImportLegacyInputSchema = z.strictObject({
  idempotencyKey: Key,
  files: z
    .record(RelativePath, z.string().max(20_000))
    .refine(
      (files) =>
        Object.keys(files).length <= 5000 &&
        Object.values(files).reduce((sum, text) => sum + text.length, 0) <= 20_000_000,
      "The import exceeds its size limit",
    ),
  repositories: z
    .record(
      z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/),
      MemoryScopeSchema.refine((scope) => scope !== "common"),
    )
    .default({}),
});

export const ImportLegacyResultSchema = z.strictObject({
  imported: z.array(MemoryRecordSchema),
  skipped: z.number().int().nonnegative(),
  issues: z.array(z.strictObject({ path: z.string(), reason: z.string() })),
});

export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;
export type CaptureInput = z.input<typeof CaptureInputSchema>;
export type ProposeInput = z.input<typeof ProposeInputSchema>;
export type VerifyInput = z.input<typeof VerifyInputSchema>;
export type SupersedeInput = z.input<typeof SupersedeInputSchema>;
export type RetrieveInput = z.input<typeof RetrieveInputSchema>;
export type ListInput = z.input<typeof ListInputSchema>;
export type ImportLegacyInput = z.input<typeof ImportLegacyInputSchema>;
export type ImportLegacyResult = z.infer<typeof ImportLegacyResultSchema>;

export function memoryActor(value: string): string {
  return Actor.parse(value);
}
