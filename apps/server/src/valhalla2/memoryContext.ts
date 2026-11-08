import type { MemoryRecord } from "@rig/valhalla2/memorywell/schema";

const TRUNCATED = "\n[Note shortened to fit the launch context.]";
type Note = Pick<MemoryRecord, "id" | "revision" | "title" | "content" | "status" | "provenance">;

export function boundedMemoryContext(notes: readonly Note[], maxBytes = 4_000) {
  const selected = notes
    .slice(0, 6)
    .map(({ id, revision, title, content, status, provenance }) => ({
      id,
      revision,
      title,
      content,
      status,
      sources: provenance.sources.slice(0, 4).map((source) => source.slice(0, 500)),
    }));
  const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  while (selected.length > 0 && byteLength(selected) > maxBytes) {
    const last = selected.at(-1)!;
    const overBy = byteLength(selected) - maxBytes;
    if (last.content.length > TRUNCATED.length + 1) {
      const keep = Math.max(0, last.content.length - overBy - TRUNCATED.length);
      last.content = `${last.content.slice(0, keep)}${TRUNCATED}`;
    } else {
      selected.pop();
    }
  }
  return selected;
}
