import type { ModelRoute } from "@rig/valhalla2/contracts";
import type { TicketRun } from "@rig/valhalla2/tickets";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ModelSelection,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as GitWorkflow from "../../git/GitWorkflowService.ts";
import * as ThreadLaunch from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import * as Projects from "../../project/ProjectService.ts";
import * as Providers from "../../provider/ProviderRegistry.ts";
import * as Git from "../../vcs/GitVcsDriver.ts";
import { skillMessage } from "./skillMessage.ts";

export class TicketRuntimeError extends Schema.TaggedError<TicketRuntimeError>()(
  "ValhallaTicketRuntimeError",
  {
    reason: Schema.Literals([
      "project",
      "provider",
      "skills",
      "manual_skills",
      "launch",
      "read",
      "interrupt",
      "uncommitted",
      "changed",
      "publish",
    ]),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "project":
        return "Choose an available T3 project.";
      case "provider":
        return "The selected agent or model is not available. Check the workflow profile and T3 provider settings.";
      case "skills":
        return "Enable the profile's selected skills on its implementation provider before starting the ticket.";
      case "manual_skills":
        return "Claude can directly invoke one manual-only skill per message. Select one in this workflow profile.";
      case "launch":
        return "The agent could not start. Its saved task can be retried.";
      case "read":
        return "The agent's current state could not be read.";
      case "interrupt":
        return "The agent could not be stopped. Open its chat to take control.";
      case "uncommitted":
        return "Commit the changes and review them before publishing.";
      case "changed":
        return "The branch changed after review. Review its new commit before publishing.";
      case "publish":
        return "The pull request could not be published. Check the T3 chat and retry.";
    }
  }
}

export interface TicketThreadState {
  status: string;
  runId: string | null;
  worktreePath: string | null;
  needsInput: boolean;
  hasBackgroundWork: boolean;
}

export class TicketRuntime extends Context.Service<
  TicketRuntime,
  {
    readonly project: (
      projectId: string,
    ) => Effect.Effect<{ repository: string }, TicketRuntimeError>;
    readonly resolveModel: (
      model: ModelRoute,
      skills?: readonly string[],
    ) => Effect.Effect<ModelRoute, TicketRuntimeError>;
    readonly prepareMessage: (
      model: ModelRoute,
      skills: readonly string[],
      text: string,
    ) => Effect.Effect<string, TicketRuntimeError>;
    readonly deliver: (
      run: TicketRun,
      prompt: string,
    ) => Effect.Effect<{ runId: string | null; worktreePath: string | null }, TicketRuntimeError>;
    readonly read: (
      threadId: string,
    ) => Effect.Effect<TicketThreadState | null, TicketRuntimeError>;
    readonly head: (worktreePath: string) => Effect.Effect<string, TicketRuntimeError>;
    readonly interrupt: (
      run: TicketRun,
      threadId: string,
    ) => Effect.Effect<void, TicketRuntimeError>;
    readonly publish: (run: TicketRun) => Effect.Effect<string, TicketRuntimeError>;
  }
>()("t3/valhalla2/tickets/TicketRuntime") {}

const selection = (model: ModelRoute): ModelSelection => ({
  instanceId: ProviderInstanceId.make(model.provider),
  model: model.model,
  ...(model.effort === undefined ? {} : { options: [{ id: "effort", value: model.effort }] }),
});

const make = Effect.gen(function* () {
  const launches = yield* ThreadLaunch.ThreadLaunchService;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projects = yield* Projects.ProjectService;
  const providers = yield* Providers.ProviderRegistry;
  const git = yield* Git.GitVcsDriver;
  const workflow = yield* GitWorkflow.GitWorkflowService;

  const prepareMessage = Effect.fn("TicketRuntime.prepareMessage")(function* (
    model: ModelRoute,
    skills: readonly string[],
    text: string,
  ) {
    if (skills.length === 0) return text;
    const available = yield* providers.getProviders;
    const provider = available.find((item) => item.instanceId === model.provider);
    const prepared = skillMessage(provider, skills, text);
    if ("reason" in prepared) return yield* new TicketRuntimeError(prepared);
    return prepared.text;
  });

  const head = Effect.fn("TicketRuntime.head")(function* (worktreePath: string) {
    const status = yield* workflow
      .localStatus({ cwd: worktreePath })
      .pipe(Effect.mapError(() => new TicketRuntimeError({ reason: "read" })));
    if (status.hasWorkingTreeChanges)
      return yield* new TicketRuntimeError({ reason: "uncommitted" });
    const commit = yield* git
      .resolveCommit({ cwd: worktreePath, revision: "HEAD" })
      .pipe(Effect.mapError(() => new TicketRuntimeError({ reason: "read" })));
    return commit.commitSha;
  });

  const read = Effect.fn("TicketRuntime.read")(function* (threadId: string) {
    const shell = yield* threads
      .getThreadShell(ThreadId.make(threadId))
      .pipe(Effect.mapError(() => new TicketRuntimeError({ reason: "read" })));
    return shell === null
      ? null
      : {
          status: shell.status,
          runId: shell.latestRunId,
          worktreePath: shell.worktreePath,
          needsInput: shell.pendingRuntimeRequest !== null,
          hasBackgroundWork:
            (shell.pendingBackgroundTasks?.length ?? 0) > 0 || shell.activeRunId !== null,
        };
  });

  return TicketRuntime.of({
    project: Effect.fn("TicketRuntime.project")(function* (projectId) {
      const project = yield* projects
        .getShell(ProjectId.make(projectId))
        .pipe(Effect.mapError(() => new TicketRuntimeError({ reason: "project" })));
      if (Option.isNone(project)) return yield* new TicketRuntimeError({ reason: "project" });
      return {
        repository:
          project.value.repositoryIdentity?.origin?.canonicalKey ??
          project.value.repositoryIdentity?.canonicalKey ??
          project.value.workspaceRoot,
      };
    }),
    resolveModel: Effect.fn("TicketRuntime.resolveModel")(function* (model, skills = []) {
      const available = yield* providers.getProviders;
      const driver = model.provider === "claude" ? "claudeAgent" : model.provider;
      const provider =
        available.find((item) => item.instanceId === model.provider) ??
        available.find((item) => item.driver === driver && item.enabled && item.installed);
      if (!provider?.enabled || !provider.installed)
        return yield* new TicketRuntimeError({ reason: "provider" });
      const selected = provider.models.find(
        (item) => item.slug === model.model || item.aliases?.includes(model.model),
      );
      const resolved = {
        ...model,
        provider: provider.instanceId,
        model: selected?.slug ?? model.model,
      };
      yield* prepareMessage(resolved, skills, "");
      return resolved;
    }),
    prepareMessage,
    deliver: Effect.fn("TicketRuntime.deliver")(function* (run, prompt) {
      const model =
        run.stage === "plan"
          ? run.planner
          : run.stage === "review"
            ? run.reviewer
            : run.implementer;
      if (model === null) return yield* new TicketRuntimeError({ reason: "provider" });
      const text =
        run.stage === "implement" ? yield* prepareMessage(model, run.skills, prompt) : prompt;
      const threadId = ThreadId.make(run.stage === "review" ? run.reviewerThreadId! : run.threadId);
      const suffix = `${run.stage}:${run.repairAttempts}`;
      const commandId = CommandId.make(`valhalla2:${run.id}:${suffix}`);
      const messageId = MessageId.make(`valhalla2:${run.id}:${suffix}`);
      const existing =
        run.stage === "implement" && (run.planner !== null || run.repairAttempts > 0)
          ? yield* threads
              .getThreadShell(threadId)
              .pipe(Effect.mapError(() => new TicketRuntimeError({ reason: "read" })))
          : null;
      if (existing !== null) {
        const sent = yield* threads
          .sendToThread({
            projectId: ProjectId.make(run.projectId),
            commandId,
            threadId,
            messageId,
            text,
            attachments: [],
            modelSelection: selection(model),
            mode: "auto",
            createdBy: "system",
            creationSource: "server",
          })
          .pipe(Effect.mapError(() => new TicketRuntimeError({ reason: "launch" })));
        return { runId: sent.run.id, worktreePath: run.worktreePath };
      }
      if (run.stage === "review" && run.worktreePath === null)
        return yield* new TicketRuntimeError({ reason: "launch" });
      const launched = yield* launches
        .launch({
          commandId,
          threadId,
          projectId: ProjectId.make(run.projectId),
          title:
            `${run.ticket.key}: ${run.stage === "review" ? "Review · " : ""}${run.ticket.title}`.slice(
              0,
              200,
            ),
          modelSelection: selection(model),
          runtimeMode: "approval-required",
          interactionMode: "default",
          workspaceStrategy:
            run.stage === "review"
              ? { type: "existing_worktree", worktreePath: run.worktreePath!, branch: run.branch }
              : {
                  type: "worktree",
                  baseRef: run.baseRef,
                  branch: run.branch,
                  startFromOrigin: false,
                },
          initialMessage: { messageId, text, attachments: [] },
          createdBy: "system",
          creationSource: "server",
        })
        .pipe(Effect.mapError(() => new TicketRuntimeError({ reason: "launch" })));
      const latest = launched.projection.runs.toSorted((a, b) => b.ordinal - a.ordinal)[0];
      return { runId: latest?.id ?? null, worktreePath: launched.projection.thread.worktreePath };
    }),
    read,
    head,
    interrupt: Effect.fn("TicketRuntime.interrupt")(function* (run, threadId) {
      yield* threads
        .interruptThread({
          projectId: ProjectId.make(run.projectId),
          threadId: ThreadId.make(threadId),
          commandId: CommandId.make(`valhalla2:${run.id}:stop:${threadId}:${run.repairAttempts}`),
          reason: "The engineer took control of this task.",
        })
        .pipe(Effect.mapError(() => new TicketRuntimeError({ reason: "interrupt" })));
    }),
    publish: Effect.fn("TicketRuntime.publish")(function* (run) {
      if (run.worktreePath === null || run.reviewedHeadSha === null)
        return yield* new TicketRuntimeError({ reason: "publish" });
      const current = yield* head(run.worktreePath);
      if (current !== run.reviewedHeadSha)
        return yield* new TicketRuntimeError({ reason: "changed" });
      for (const threadId of [run.threadId, run.reviewerThreadId].filter((id) => id !== null)) {
        const state = yield* read(threadId);
        if (state?.hasBackgroundWork || state?.needsInput)
          return yield* new TicketRuntimeError({ reason: "changed" });
      }
      const result = yield* workflow
        .runStackedAction({
          actionId: `valhalla2:${run.id}:publish:${run.reviewedHeadSha}`,
          cwd: run.worktreePath,
          action: "create_pr",
          threadId: ThreadId.make(run.threadId),
          projectId: ProjectId.make(run.projectId),
        })
        .pipe(Effect.mapError(() => new TicketRuntimeError({ reason: "publish" })));
      if (!result.pr.url) return yield* new TicketRuntimeError({ reason: "publish" });
      return result.pr.url;
    }),
  });
});

export const layer = Layer.effect(TicketRuntime, make);
