import { parseDocument } from "yaml";
import { z } from "zod";
import { ProposeInputSchema, type ImportLegacyInput, type MemoryRecord } from "./schema.ts";

const Header = z.object({
  id: z.string().max(200).optional(),
  title: z.string().min(1),
  hook: z.string().min(1),
  kind: z.enum(["rule", "solution", "gotcha", "playbook"]).optional(),
  status: z.enum(["active", "proposed"]),
  words: z.array(z.string()).default([]),
  paths: z.array(z.string()).default([]),
  roles: z.array(z.string()).default([]),
  sources: z.array(z.string()).default([]),
  updated: z.string().max(100).optional(),
  was: z.array(z.string()).default([]),
});

export function legacyCandidates(input: ImportLegacyInput, actor: string) {
  const retired = new Set<string>();
  const issues: Array<{ path: string; reason: string }> = [];
  for (const [path, text] of Object.entries(input.files)) {
    const scope = /^catalog\/([a-z0-9-]+)\.json$/.exec(path)?.[1];
    if (!scope) continue;
    try {
      const marker = z
        .strictObject({ retiredAt: z.iso.datetime().nullable() })
        .parse(JSON.parse(text));
      if (marker.retiredAt) retired.add(scope);
    } catch {
      retired.add(scope);
      issues.push({
        path,
        reason: "The retirement marker is invalid; this repository was excluded",
      });
    }
  }
  const candidates: Array<{
    input: z.infer<typeof ProposeInputSchema>;
    aliases: string[];
    provenance: MemoryRecord["provenance"];
  }> = [];
  let skipped = 0;
  for (const [path, text] of Object.entries(input.files).sort(([a], [b]) => a.localeCompare(b))) {
    const match = /^([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)\.md$/.exec(
      path,
    );
    const role = /^roles\/([a-z0-9][a-z0-9-]*)\.md$/.exec(path)?.[1];
    const legacyScope = role ? "common" : match?.[1];
    if (
      !legacyScope ||
      retired.has(legacyScope) ||
      ["archive", "board", "inbox", "catalog", "releases"].includes(legacyScope) ||
      match?.[2] === "atlas"
    ) {
      skipped++;
      continue;
    }
    const scope = legacyScope === "common" ? "common" : input.repositories?.[legacyScope];
    if (!scope) {
      issues.push({
        path,
        reason: "Map this repository to its full host/owner/repo before importing",
      });
      skipped++;
      continue;
    }
    try {
      const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
      if (!front) throw new Error("Missing front matter");
      const document = parseDocument(front[1]!, { uniqueKeys: true });
      if (document.errors.length) throw new Error("Invalid front matter");
      const header = Header.parse(document.toJS({ maxAliasCount: 20 }));
      const oldId = path.slice(0, -3);
      const candidate = ProposeInputSchema.parse({
        idempotencyKey: oldId,
        scope,
        topic: role ? `roles/${role}` : `${match![2]}/${match![3]}`,
        title: header.title,
        summary: header.hook,
        content: front[2],
        tags: header.words,
        paths: header.paths,
        roles: role ? [role] : header.roles,
        sources: header.sources,
      });
      candidates.push({
        input: candidate,
        aliases: [...new Set([oldId, ...(header.id ? [header.id] : []), ...header.was])].slice(
          0,
          32,
        ),
        provenance: {
          actor,
          kind: "legacy",
          sources: header.sources,
          sourcePath: path,
          sourceStatus: header.status,
          ...(header.updated ? { sourceUpdatedAt: header.updated } : {}),
        },
      });
    } catch {
      issues.push({ path, reason: "This topic has invalid or unsupported fields" });
      skipped++;
    }
  }
  return { candidates, skipped, issues };
}
