import { useAtomValue } from "@effect/atom-react";
import { ValhallaCommandSchema } from "@rig/valhalla2/commands";
import type { EnvironmentId, ValhallaSnapshotSection } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import {
  BookOpenIcon,
  ChartNoAxesColumnIcon,
  RefreshCwIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useState } from "react";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { valhalla2Snapshot, runValhalla2Command } from "../../state/valhalla2";
import { Button } from "../ui/button";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Badge } from "../ui/badge";
import { SidebarTrigger } from "../ui/sidebar";
import { ScrollArea } from "../ui/scroll-area";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { MemoryPanel } from "./MemoryPanel";
import { ResultsPanel } from "./ResultsPanel";
import { TicketsPanel } from "./TicketsPanel";
import { WorkflowsPanel } from "./WorkflowsPanel";
import { StartWorkflow } from "./StartWorkflow";
import { Choice, EmptyState } from "./WorkspaceParts";
import rigMark from "./rig-mark.svg";
import "./valhalla2.css";

const sections = [
  { id: "tickets", label: "Ticket work", icon: PullRequestGlyph.pullRequest },
  { id: "memory", label: "Knowledge", icon: BookOpenIcon },
  { id: "workflows", label: "My workflows", icon: SlidersHorizontalIcon },
  { id: "results", label: "Results", icon: ChartNoAxesColumnIcon },
] as const;

function EnvironmentWorkspace({ environmentId }: { environmentId: EnvironmentId }) {
  const [commandError, setCommandError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState<ValhallaSnapshotSection>("tickets");
  const {
    data: snapshot,
    error: readError,
    isPending,
    refresh,
  } = useEnvironmentQuery(valhalla2Snapshot({ environmentId, input: { section } }));
  const error = commandError ?? readError;
  const executeCommand = useAtomCommand(runValhalla2Command, { reportFailure: false });
  const canWrite = useAtomValue(runValhalla2Command.permissionAtom(environmentId));
  const canPublish = useAtomValue(
    runValhalla2Command.permissionAtom(environmentId, {
      command: { type: "ticket.publish", id: "", approvedHeadSha: "" },
    }),
  );
  const canVerifyMemory = useAtomValue(
    runValhalla2Command.permissionAtom(environmentId, {
      command: { type: "memory.verify", input: {} },
    }),
  );
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && !project.isScratch,
  );

  async function command(value: Record<string, unknown>): Promise<unknown | null> {
    if (busy || !canWrite) return null;
    const parsedCommand = ValhallaCommandSchema.safeParse(value);
    if (!parsedCommand.success) {
      setCommandError("Some fields are missing or invalid. Check the form and try again.");
      return null;
    }
    setBusy(true);
    setCommandError(null);
    const result = await executeCommand({ environmentId, input: { command: parsedCommand.data } });
    setBusy(false);
    if (result._tag === "Failure") {
      setCommandError(formatEnvironmentQueryError(result.cause));
      return null;
    }
    if (parsedCommand.data.type !== "ticket.inspect") refresh();
    return result.value;
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <nav aria-label="Valhalla2 workspace" className="flex flex-wrap gap-1">
          {sections.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant={section === id ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={section === id}
              onClick={() => {
                setCommandError(null);
                setSection(id);
              }}
            >
              <Icon />
              {label}
            </Button>
          ))}
        </nav>
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending || busy}
          onClick={() => {
            setCommandError(null);
            refresh();
          }}
        >
          <RefreshCwIcon />
          {isPending ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      {error && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm font-medium">Workspace needs attention</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
            {error}
          </p>
        </div>
      )}
      {!snapshot ? (
        <EmptyState title={error ? "Workspace unavailable" : "Loading your workspace…"}>
          {error
            ? "Check this environment's connection and refresh to try again."
            : `Opening ${sections.find(({ id }) => id === section)?.label.toLowerCase()}…`}
        </EmptyState>
      ) : (
        <>
          {section === "memory" && snapshot.health.memory !== "ready" && (
            <Badge variant="warning">Shared knowledge is unavailable</Badge>
          )}
          {!canWrite && (
            <p role="status" className="text-sm text-muted-foreground">
              This connection can view the workspace. Editing requires access to run workspace
              commands.
            </p>
          )}
          {section === "tickets" && (
            <TicketsPanel
              snapshot={snapshot}
              environmentId={environmentId}
              projects={projects}
              onCommand={command}
              busy={busy || !canWrite}
              canPublish={canPublish}
            />
          )}
          {section === "memory" && (
            <MemoryPanel
              snapshot={snapshot}
              onCommand={command}
              busy={busy || !canWrite}
              canVerify={canVerifyMemory}
            />
          )}
          {section === "workflows" && (
            <div className="space-y-5">
              <StartWorkflow
                snapshot={snapshot}
                projects={projects}
                environmentId={environmentId}
                onCommand={command}
                busy={busy || !canWrite}
              />
              <WorkflowsPanel snapshot={snapshot} onCommand={command} busy={busy || !canWrite} />
            </div>
          )}
          {section === "results" && (
            <ResultsPanel snapshot={snapshot} onCommand={command} busy={busy || !canWrite} />
          )}
        </>
      )}
    </>
  );
}

export function Valhalla2Page() {
  const { environments } = useEnvironments();
  const primary = usePrimaryEnvironmentId();
  const [selection, setSelection] = useState<string | null>(null);
  const environmentId =
    environments.find((environment) => environment.environmentId === (selection ?? primary))
      ?.environmentId ?? (selection === null ? environments[0]?.environmentId : undefined);
  return (
    <div data-valhalla2-workspace className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-3 border-t-2 border-b border-border border-t-primary px-4">
        <SidebarTrigger />
        <div className="flex shrink-0 items-center gap-2">
          <img src={rigMark} alt="Rig" width={25} height={22} />
          <span className="text-sm font-medium">Valhalla2</span>
        </div>
        {environments.length > 1 && (
          <div className="ml-auto w-48 min-w-0">
            <Choice
              label="Workspace environment"
              value={environmentId ?? ""}
              onChange={setSelection}
              options={environments.map((environment) => ({
                value: environment.environmentId,
                label: environment.label,
              }))}
            />
          </div>
        )}
      </header>
      <ScrollArea>
        <WorkspacePageContainer width="expanded">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                Engineering workspace
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Work from Jira tickets or start with your own workflow.
              </p>
            </div>
            <Button variant="ghost" size="sm" render={<Link to="/settings/appearance" />}>
              Appearance
            </Button>
          </div>
          {environmentId ? (
            <EnvironmentWorkspace key={environmentId} environmentId={environmentId} />
          ) : (
            <EmptyState title="Connect an environment">
              Connect a Valhalla2 server to start working with your repositories.
            </EmptyState>
          )}
        </WorkspacePageContainer>
      </ScrollArea>
    </div>
  );
}
