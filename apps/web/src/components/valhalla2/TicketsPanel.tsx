import { randomUUID } from "../../lib/utils";
import type { ValhallaSnapshot } from "@rig/valhalla2/contracts";
import { JiraTicketSchema, type JiraTicket, type TicketRun } from "@rig/valhalla2/tickets";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { Link } from "@tanstack/react-router";
import { ArrowUpRightIcon, PlayIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Choice, EmptyState, Field, Panel, type WorkspaceCommand } from "./WorkspaceParts";

const statusLabel: Record<TicketRun["status"], string> = {
  queued: "Queued",
  running: "Working",
  needs_input: "Needs your input",
  ready_to_publish: "Ready for review",
  publishing: "Publishing",
  published: "Pull request opened",
  failed: "Needs attention",
  taken_over: "You took over",
  cancelled: "Cancelled",
};

function TicketRunCard({
  run,
  profileName,
  environmentId,
  onCommand,
  busy,
  canPublish,
}: {
  run: TicketRun;
  profileName: string;
  environmentId: EnvironmentId;
  onCommand: WorkspaceCommand;
  busy: boolean;
  canPublish: boolean;
}) {
  const [confirmPublish, setConfirmPublish] = useState(false);
  const canStop = !["published", "publishing", "cancelled", "taken_over"].includes(run.status);
  return (
    <article className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {run.ticket.key} · {run.stage}
          </p>
          <h3 className="mt-1 text-sm font-medium">{run.ticket.title}</h3>
        </div>
        <Badge
          variant={
            run.status === "published"
              ? "success"
              : run.status === "failed" || run.status === "needs_input"
                ? "warning"
                : "secondary"
          }
        >
          {statusLabel[run.status]}
        </Badge>
      </div>
      <p className="mt-3 break-words text-xs text-muted-foreground">
        {run.branch} · {profileName} · {run.repairAttempts}/{run.maxRepairAttempts} repair attempts
      </p>
      {run.error && (
        <p className="mt-3 rounded-md bg-destructive/8 p-3 text-xs text-destructive-foreground">
          {run.error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          render={
            <Link
              to="/$environmentId/$threadId"
              params={{ environmentId, threadId: run.threadId as ThreadId }}
            />
          }
        >
          Open work
          <ArrowUpRightIcon />
        </Button>
        {run.reviewerThreadId && (
          <Button
            variant="ghost"
            size="sm"
            render={
              <Link
                to="/$environmentId/$threadId"
                params={{ environmentId, threadId: run.reviewerThreadId as ThreadId }}
              />
            }
          >
            Open review
          </Button>
        )}
        {run.status !== "published" &&
          run.status !== "cancelled" &&
          run.status !== "taken_over" && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void onCommand({ type: "ticket.refresh", id: run.id })}
            >
              <RefreshCwIcon />
              Check progress
            </Button>
          )}
        {run.prUrl && (
          <Button
            variant="outline"
            size="sm"
            render={<a href={run.prUrl} target="_blank" rel="noreferrer" />}
          >
            Open pull request
            <ArrowUpRightIcon />
          </Button>
        )}
        {run.status === "ready_to_publish" && run.reviewedHeadSha && (
          <Button size="sm" disabled={busy || !canPublish} onClick={() => setConfirmPublish(true)}>
            Review publication
          </Button>
        )}
        {(run.status === "failed" || run.status === "ready_to_publish") &&
          run.repairAttempts < run.maxRepairAttempts && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void onCommand({ type: "ticket.retry", id: run.id })}
            >
              Request repair
            </Button>
          )}
        {canStop && (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || !canPublish}
              onClick={() => void onCommand({ type: "ticket.takeOver", id: run.id })}
            >
              Take over
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void onCommand({ type: "ticket.cancel", id: run.id })}
            >
              Stop run
            </Button>
          </>
        )}
      </div>
      {confirmPublish && run.status === "ready_to_publish" && run.reviewedHeadSha && (
        <div className="mt-4 space-y-3 rounded-lg border border-border bg-muted/30 p-4">
          <p className="text-sm font-medium">Publish the reviewed changes?</p>
          <p className="text-xs text-muted-foreground">
            Check the work and review threads first. This publishes the branch and opens a pull
            request for this exact revision.
          </p>
          <p className="break-all font-mono text-xs">{run.reviewedHeadSha}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                const result = await onCommand({
                  type: "ticket.publish",
                  id: run.id,
                  approvedHeadSha: run.reviewedHeadSha,
                });
                if (result !== null) setConfirmPublish(false);
              }}
            >
              Publish pull request
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmPublish(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

export function TicketsPanel({
  snapshot,
  environmentId,
  projects,
  onCommand,
  busy,
  canPublish,
}: {
  snapshot: ValhallaSnapshot;
  environmentId: EnvironmentId;
  projects: ReadonlyArray<EnvironmentProject>;
  onCommand: WorkspaceCommand;
  busy: boolean;
  canPublish: boolean;
}) {
  const [ticketKey, setTicketKey] = useState("");
  const [ticket, setTicket] = useState<JiraTicket | null>(null);
  const [projectId, setProjectId] = useState("");
  const [profileId, setProfileId] = useState(snapshot.selectedProfileId);
  const [baseRef, setBaseRef] = useState("main");
  const [requestId, setRequestId] = useState(() => randomUUID());
  const [inspectError, setInspectError] = useState<string | null>(null);
  const selectedProject = projects.find((project) => project.id === projectId) ?? projects[0];
  const selectedProfile =
    snapshot.profiles.find((profile) => profile.id === profileId) ??
    snapshot.profiles.find((profile) => profile.id === snapshot.selectedProfileId);
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <Panel
        title="Start from a Jira ticket"
        description="Read the request, choose a repository, and let your workflow take it forward."
      >
        {!snapshot.health.jiraConfigured && (
          <div className="mb-5 rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            Jira is not configured on this environment. Ask your administrator to configure the Jira
            connection, then refresh.
          </div>
        )}
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setInspectError(null);
            const result = await onCommand({
              type: "ticket.inspect",
              ticketKey: ticketKey.trim().toUpperCase(),
            });
            if (result === null) return;
            const parsed = JiraTicketSchema.safeParse(result);
            if (!parsed.success) {
              setInspectError(
                "The server returned a ticket that could not be read. Refresh and try again.",
              );
              return;
            }
            setTicket(parsed.data);
            setRequestId(randomUUID());
          }}
        >
          <Field label="Ticket key">
            <Input
              required
              value={ticketKey}
              onChange={(event) => {
                setTicketKey(event.target.value);
                setTicket(null);
              }}
              placeholder="RD-1234"
            />
          </Field>
          <Button
            type="submit"
            variant="outline"
            disabled={busy || !snapshot.health.jiraConfigured || !ticketKey.trim()}
          >
            Read ticket
          </Button>
        </form>
        {inspectError && (
          <p role="alert" className="mt-3 text-sm text-destructive-foreground">
            {inspectError}
          </p>
        )}
        {ticket && (
          <div className="mt-6 space-y-4 border-t border-border pt-5">
            <div>
              <a
                className="text-xs text-primary hover:underline"
                href={ticket.url}
                target="_blank"
                rel="noreferrer"
              >
                {ticket.key}
                <ArrowUpRightIcon className="ml-1 inline size-3" />
              </a>
              <h3 className="mt-2 font-semibold">{ticket.title}</h3>
              <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground">
                {ticket.description || "No description provided."}
              </p>
            </div>
            <Field label="Repository">
              <Choice
                label="Repository"
                value={selectedProject?.id ?? ""}
                onChange={(value) => {
                  setProjectId(value);
                  setRequestId(randomUUID());
                }}
                options={projects.map((project) => ({ value: project.id, label: project.title }))}
              />
            </Field>
            <Field label="Workflow">
              <Choice
                label="Ticket workflow"
                value={selectedProfile?.id ?? ""}
                onChange={(value) => {
                  setProfileId(value);
                  setRequestId(randomUUID());
                }}
                options={snapshot.profiles.map((profile) => ({
                  value: profile.id,
                  label: profile.name,
                }))}
              />
            </Field>
            <Field label="Base branch">
              <Input
                required
                value={baseRef}
                onChange={(event) => {
                  setBaseRef(event.target.value);
                  setRequestId(randomUUID());
                }}
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              Work starts in an isolated worktree. You can open the thread, answer questions, and
              take over at any point. Publishing remains a separate action.
            </p>
            <Button
              disabled={busy || !selectedProject || !selectedProfile || !baseRef.trim()}
              onClick={async () => {
                if (!selectedProject || !selectedProfile) return;
                const result = await onCommand({
                  type: "ticket.start",
                  input: {
                    requestId,
                    ticketKey: ticket.key,
                    projectId: selectedProject.id,
                    profileId: selectedProfile.id,
                    baseRef: baseRef.trim(),
                  },
                });
                if (result !== null) {
                  setTicket(null);
                  setTicketKey("");
                  setRequestId(randomUUID());
                }
              }}
            >
              <PlayIcon />
              Start work
            </Button>
            {!selectedProject && (
              <p className="text-xs text-muted-foreground">
                Add a repository from the sidebar before starting work.
              </p>
            )}
          </div>
        )}
      </Panel>
      <Panel
        title="Ticket work"
        description="Follow the agent's work and review the evidence before publishing."
      >
        {snapshot.runs.length === 0 ? (
          <EmptyState title="No ticket runs yet">
            Start with a small, well-described ticket. Your work, questions, and review will appear
            here.
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {snapshot.runs.map((run) => (
              <TicketRunCard
                key={run.id}
                run={run}
                profileName={
                  snapshot.profiles.find(({ id }) => id === run.profileId)?.name ?? run.profileId
                }
                environmentId={environmentId}
                onCommand={onCommand}
                busy={busy}
                canPublish={canPublish}
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
