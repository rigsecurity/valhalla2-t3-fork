import { randomUUID } from "../../lib/utils";
import { WorkflowStartResult, type ValhallaSnapshot } from "@rig/valhalla2/contracts";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Choice, Field, Panel, type WorkspaceCommand } from "./WorkspaceParts";

export function StartWorkflow({
  snapshot,
  projects,
  environmentId,
  onCommand,
  busy,
}: {
  snapshot: ValhallaSnapshot;
  projects: ReadonlyArray<EnvironmentProject>;
  environmentId: EnvironmentId;
  onCommand: WorkspaceCommand;
  busy: boolean;
}) {
  const [prompt, setPrompt] = useState("");
  const [projectId, setProjectId] = useState("");
  const [baseRef, setBaseRef] = useState("main");
  const [requestId, setRequestId] = useState(() => randomUUID());
  const [threadId, setThreadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const profile = snapshot.profiles.find((item) => item.id === snapshot.selectedProfileId);
  const project = projects.find((item) => item.id === projectId) ?? projects[0];
  return (
    <Panel
      title="Start a chat your way"
      description={
        profile
          ? `Use ${profile.name} with shared knowledge and an isolated worktree.`
          : "Choose a workflow to start."
      }
    >
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!profile || !project) return;
          setError(null);
          const result = await onCommand({
            type: "workflow.start",
            input: {
              requestId: `${requestId}:${profile.id}`,
              projectId: project.id,
              profileId: profile.id,
              baseRef: baseRef.trim(),
              prompt: prompt.trim(),
            },
          });
          if (result === null) return;
          const parsed = WorkflowStartResult.safeParse(result);
          if (!parsed.success) {
            setError(
              "The chat started but its link could not be read. Check the sidebar before starting again.",
            );
            return;
          }
          setThreadId(parsed.data.threadId);
          setRequestId(randomUUID());
          setPrompt("");
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Repository">
            <Choice
              label="Chat repository"
              value={project?.id ?? ""}
              options={projects.map((item) => ({ value: item.id, label: item.title }))}
              onChange={(value) => {
                setProjectId(value);
                setRequestId(randomUUID());
              }}
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
        </div>
        <Field label="What would you like to work on?">
          <Textarea
            required
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
              setRequestId(randomUUID());
            }}
            placeholder="Describe the work, or start with a question."
          />
        </Field>
        {profile && (profile.planner || profile.reviewer) && (
          <p className="text-xs text-muted-foreground">
            This chat uses your implementation model and skills. Separate planning and review stages
            run through Ticket work.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            disabled={busy || !profile || !project || !prompt.trim() || !baseRef.trim()}
          >
            Start chat
          </Button>
          {threadId && (
            <Button
              variant="outline"
              render={
                <Link
                  to="/$environmentId/$threadId"
                  params={{ environmentId, threadId: threadId as ThreadId }}
                />
              }
            >
              Open started chat
            </Button>
          )}
        </div>
        {!project && (
          <p className="text-xs text-muted-foreground">
            Add a repository from the sidebar to start a chat.
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive-foreground">
            {error}
          </p>
        )}
      </form>
    </Panel>
  );
}
