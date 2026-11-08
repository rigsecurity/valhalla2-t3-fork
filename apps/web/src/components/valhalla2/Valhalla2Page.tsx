import { useAtomValue } from "@effect/atom-react";
import type { ValhallaSnapshot } from "@rig/valhalla2/contracts";
import { ValhallaCommandSchema } from "@rig/valhalla2/commands";
import { ValhallaSnapshotSchema } from "@rig/valhalla2/snapshot";
import type { EnvironmentId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import {
  BookOpenIcon,
  ChartNoAxesColumnIcon,
  CheckIcon,
  RefreshCwIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { getValhalla2Snapshot, runValhalla2Command } from "../../state/valhalla2";
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
  const [snapshot, setSnapshot] = useState<ValhallaSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [section, setSection] = useState<(typeof sections)[number]["id"]>("tickets");
  const readSnapshot = useAtomCommand(getValhalla2Snapshot, { reportFailure: false });
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

  async function refresh() {
    setRefreshing(true);
    const result = await readSnapshot({ environmentId, input: {} });
    setRefreshing(false);
    if (result._tag === "Failure") {
      setError(Cause.pretty(result.cause));
      return;
    }
    const parsed = ValhallaSnapshotSchema.safeParse(result.value);
    if (!parsed.success) {
      setError(
        "This environment returned an incompatible workspace. Update the app and server together.",
      );
      return;
    }
    setSnapshot(parsed.data);
    setError(null);
  }

  const load = useEffectEvent(
    (receive: (value: ValhallaSnapshot | null, message: string | null) => void) => {
      void readSnapshot({ environmentId, input: {} }).then((result) => {
        if (result._tag === "Failure") {
          receive(null, Cause.pretty(result.cause));
          return;
        }
        const parsed = ValhallaSnapshotSchema.safeParse(result.value);
        receive(
          parsed.success ? parsed.data : null,
          parsed.success
            ? null
            : "This environment returned an incompatible workspace. Update the app and server together.",
        );
      });
    },
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the selected environment when its workspace opens
  useEffect(() => {
    let active = true;
    load((value, message) => {
      if (active) {
        setSnapshot(value);
        setError(message);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  async function command(value: Record<string, unknown>): Promise<unknown | null> {
    if (busy || !canWrite) return null;
    const parsedCommand = ValhallaCommandSchema.safeParse(value);
    if (!parsedCommand.success) {
      setError("Some fields are missing or invalid. Check the form and try again.");
      return null;
    }
    setBusy(true);
    setError(null);
    const result = await executeCommand({ environmentId, input: { command: parsedCommand.data } });
    if (result._tag === "Failure") {
      setBusy(false);
      setError(Cause.pretty(result.cause));
      return null;
    }
    await refresh();
    setBusy(false);
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
              onClick={() => setSection(id)}
            >
              <Icon />
              {label}
            </Button>
          ))}
        </nav>
        <Button
          variant="ghost"
          size="sm"
          disabled={refreshing || busy}
          onClick={() => void refresh()}
        >
          <RefreshCwIcon />
          {refreshing ? "Refreshing…" : "Refresh"}
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
            : "Reading knowledge, workflows, ticket runs, and measurements."}
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <div className="flex flex-wrap gap-2">
              <Badge variant={snapshot.health.memory === "ready" ? "success" : "warning"}>
                Knowledge {snapshot.health.memory === "ready" ? "ready" : "unavailable"}
              </Badge>
              <Badge variant="outline">
                {snapshot.health.sharedEndpoint ? "Memory endpoint available" : "Local memory only"}
              </Badge>
              <Badge variant={snapshot.health.jiraConfigured ? "success" : "secondary"}>
                Jira {snapshot.health.jiraConfigured ? "configured" : "not configured"}
              </Badge>
            </div>
            <span className="flex items-center gap-1">
              <CheckIcon className="size-3" />
              Knowledge, measurement, and isolated work are required
            </span>
          </div>
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
        <div className="ml-auto w-48">
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
      </header>
      <ScrollArea>
        <WorkspacePageContainer width="expanded">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-primary">RIG ENGINEERING</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                Work. Learn. Improve.
              </h1>
              <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
                Your way of working, with knowledge that carries forward and results you can
                measure.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" render={<Link to="/settings/general" />}>
                Notifications
              </Button>
              <Button variant="outline" size="sm" render={<Link to="/settings/providers" />}>
                Providers
              </Button>
            </div>
          </div>
          {environmentId ? (
            <EnvironmentWorkspace key={environmentId} environmentId={environmentId} />
          ) : (
            <EmptyState title="Connect an environment">
              Connect a Valhalla2 server to start working with your repositories.
            </EmptyState>
          )}
          <p className="text-xs text-muted-foreground">
            Built on T3 Code · Your existing threads, skills, queue, and steering controls stay
            available.
          </p>
        </WorkspacePageContainer>
      </ScrollArea>
    </div>
  );
}
