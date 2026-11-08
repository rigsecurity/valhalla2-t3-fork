import { randomUUID } from "../../lib/utils";
import type { ValhallaSnapshot } from "@rig/valhalla2/contracts";
import { useState } from "react";
import { SearchIcon, BookOpenIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Choice, EmptyState, Field, Panel, type WorkspaceCommand } from "./WorkspaceParts";

type MemoryRecord = ValhallaSnapshot["memory"][number];

function VerifyMemory({
  record,
  onCommand,
  busy,
}: {
  record: MemoryRecord;
  onCommand: WorkspaceCommand;
  busy: boolean;
}) {
  const [reference, setReference] = useState("");
  const [kind, setKind] = useState("human-review");
  return (
    <form
      className="mt-4 space-y-3 border-t border-border pt-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await onCommand({
          type: "memory.verify",
          input: {
            id: record.id,
            expectedRevision: record.revision,
            idempotencyKey: randomUUID(),
            evidence: { kind, reference: reference.trim(), observedAt: new Date().toISOString() },
          },
        });
        if (result !== null) setReference("");
      }}
    >
      <p className="text-xs text-muted-foreground">
        Verify only after checking the supporting evidence. Proposed knowledge is kept separate from
        verified knowledge.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Evidence type">
          <Choice
            label="Evidence type"
            value={kind}
            onChange={setKind}
            options={[
              { value: "human-review", label: "Human review" },
              { value: "test", label: "Test result" },
              { value: "merged-pr", label: "Merged pull request" },
            ]}
          />
        </Field>
        <Field label="Evidence reference">
          <Input
            required
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="Reviewed document, test report, or merged PR URL"
          />
        </Field>
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={busy || !reference.trim()}>
        Verify knowledge
      </Button>
    </form>
  );
}

export function MemoryPanel({
  snapshot,
  onCommand,
  busy,
  canVerify,
}: {
  snapshot: ValhallaSnapshot;
  onCommand: WorkspaceCommand;
  busy: boolean;
  canVerify: boolean;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("common");
  const [topic, setTopic] = useState("");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [source, setSource] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const visible = snapshot.memory.filter((record) =>
    [record.title, record.summary, record.scope, record.topic, ...record.tags]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <Panel
        title="Shared knowledge"
        description="Find the decisions and lessons your next session can use."
      >
        <div className="mb-4 flex items-center gap-2">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <Input
            aria-label="Search knowledge"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by repository, topic, or title"
          />
        </div>
        {visible.length === 0 ? (
          <EmptyState title={query ? "No matching knowledge" : "A fresh well"}>
            {query
              ? "Try a repository name, topic, or different search."
              : "Propose a lesson with its source. Verify it when there is evidence to support it."}
          </EmptyState>
        ) : (
          <div className="divide-y divide-border">
            {visible.map((record) => (
              <article key={record.id} className="py-4 first:pt-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-medium text-sm">{record.title}</h3>
                    <p className="mt-1 break-words text-xs text-muted-foreground">
                      {record.scope} / {record.topic}
                    </p>
                  </div>
                  <Badge
                    variant={
                      record.status === "verified"
                        ? "success"
                        : record.status === "superseded"
                          ? "secondary"
                          : "warning"
                    }
                  >
                    {record.status}
                  </Badge>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{record.summary}</p>
                <div className="mt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpanded(expanded === record.id ? null : record.id)}
                  >
                    <BookOpenIcon />
                    {expanded === record.id ? "Close details" : "Read evidence"}
                  </Button>
                </div>
                {expanded === record.id && (
                  <div className="mt-3 space-y-3">
                    <p className="whitespace-pre-wrap break-words text-sm">{record.content}</p>
                    <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                      <p>Source: {record.provenance.sources.join(", ") || "No source recorded"}</p>
                      <p className="mt-1">
                        Revision {record.revision} ·{" "}
                        {new Date(record.updatedAt).toLocaleDateString()}
                      </p>
                      {record.evidence && (
                        <p className="mt-1 break-words">
                          Verified by {record.evidence.verifiedBy}: {record.evidence.reference}
                        </p>
                      )}
                    </div>
                    {record.status === "proposed" && (
                      <VerifyMemory
                        record={record}
                        onCommand={onCommand}
                        busy={busy || !canVerify}
                      />
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </Panel>
      <Panel
        title="Add a lesson"
        description="Keep it useful, scoped, and traceable to what happened."
      >
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await onCommand({
              type: "memory.propose",
              input: {
                idempotencyKey: randomUUID(),
                scope: scope.trim(),
                topic: topic.trim(),
                title: title.trim(),
                summary: summary.trim(),
                content: content.trim(),
                sources: source.trim() ? [source.trim()] : [],
              },
            });
            if (result !== null) {
              setTitle("");
              setSummary("");
              setContent("");
              setSource("");
            }
          }}
        >
          <Field
            label="Repository or common scope"
            hint="Use common, or a full repository identity such as github.com/rigsecurity/api."
          >
            <Input required value={scope} onChange={(event) => setScope(event.target.value)} />
          </Field>
          <Field label="Topic">
            <Input
              required
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="testing/integration"
            />
          </Field>
          <Field label="Title">
            <Input
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="A specific lesson worth keeping"
            />
          </Field>
          <Field label="Short summary">
            <Input required value={summary} onChange={(event) => setSummary(event.target.value)} />
          </Field>
          <Field label="What should the next engineer know?">
            <Textarea
              required
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </Field>
          <Field label="Source">
            <Input
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="PR, ticket, document, or test report"
            />
          </Field>
          <Button type="submit" disabled={busy || snapshot.health.memory !== "ready"}>
            Propose knowledge
          </Button>
        </form>
      </Panel>
    </div>
  );
}
