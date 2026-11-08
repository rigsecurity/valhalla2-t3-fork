import { MemoryScopeSchema } from "@rig/valhalla2/memorywell/schema";
import { OrchestratorMcpFailure, ProjectId, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as Projects from "../project/ProjectService.ts";
import * as ProjectEnrichment from "../project/ProjectEnrichmentService.ts";
import * as ValhallaStore from "../valhalla2/ValhallaStore.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";
import { isLiveCallerShell, unavailable } from "./threadAccess.ts";

const Text = (maximum: number) => TrimmedNonEmptyString.check(Schema.isMaxLength(maximum));
const Paths = Schema.Array(Text(500)).check(Schema.isMaxLength(32));

export const MemoryRetrieveInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  query: Text(4000),
  paths: Schema.optional(Paths),
  role: Schema.optional(Text(60)),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 }))),
});

export const MemoryProposeInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  idempotencyKey: Text(160),
  topic: Text(160),
  title: Text(160),
  summary: Text(400),
  content: Text(3000),
  tags: Schema.optional(Schema.Array(Text(80)).check(Schema.isMaxLength(32))),
  paths: Schema.optional(Paths),
  sources: Schema.optional(Schema.Array(Text(1000)).check(Schema.isMaxLength(30))),
});

export const MemoryRetrieveResult = Schema.Struct({
  scope: Schema.String,
  items: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      topic: Schema.String,
      scope: Schema.String,
      title: Schema.String,
      summary: Schema.String,
      content: Schema.String,
      revision: Schema.Int,
      truncated: Schema.Boolean,
    }),
  ),
});

export const MemoryProposeResult = Schema.Struct({
  id: Schema.String,
  scope: Schema.String,
  status: Schema.String,
  revision: Schema.Int,
  message: Schema.String,
});

export class MemorywellMcpService extends Context.Service<
  MemorywellMcpService,
  {
    readonly retrieve: (
      scope: McpInvocationScope,
      input: typeof MemoryRetrieveInput.Type,
    ) => Effect.Effect<typeof MemoryRetrieveResult.Type, OrchestratorMcpFailure>;
    readonly propose: (
      scope: McpInvocationScope,
      input: typeof MemoryProposeInput.Type,
    ) => Effect.Effect<typeof MemoryProposeResult.Type, OrchestratorMcpFailure>;
  }
>()("t3/mcp/MemorywellMcpService") {}

const make = Effect.gen(function* () {
  const store = yield* ValhallaStore.ValhallaStore;
  const projects = yield* Projects.ProjectService;
  const enrichment = yield* ProjectEnrichment.ProjectEnrichmentService;
  const threads = yield* ThreadManagement.ThreadManagementService;

  const projectScope = Effect.fn("MemorywellMcpService.projectScope")(function* (
    scope: McpInvocationScope,
    projectId: ProjectId | undefined,
    writing: boolean,
  ) {
    if (
      !scope.capabilities.has("orchestration") ||
      (scope.thread === undefined && scope.client === undefined) ||
      (writing && scope.client?.access === "read-only")
    ) {
      return yield* new OrchestratorMcpFailure({
        code: "capability_denied",
        message: "This credential cannot perform this memory operation.",
      });
    }
    let target = projectId;
    if (scope.thread !== undefined) {
      const caller = yield* threads
        .getThreadShell(scope.thread.threadId)
        .pipe(Effect.mapError(unavailable));
      if (caller === null || caller.deletedAt !== null)
        return yield* new OrchestratorMcpFailure({
          code: "thread_not_found",
          message: "The calling thread was not found.",
        });
      if (projectId !== undefined && projectId !== caller.projectId)
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "An agent can use shared memory only for its own project.",
        });
      if (writing && !isLiveCallerShell(caller, scope.thread.providerInstanceId))
        return yield* new OrchestratorMcpFailure({
          code: "parent_not_active",
          message: "The calling provider no longer owns an active thread run.",
        });
      target = caller.projectId;
    }
    if (target === undefined)
      return yield* new OrchestratorMcpFailure({
        code: "target_required",
        message: "Pass projectId from t3_project_list when using memory outside a T3 thread.",
      });
    const project = yield* projects.getById(target).pipe(Effect.mapError(unavailable));
    if (Option.isNone(project) || project.value.deletedAt !== null)
      return yield* new OrchestratorMcpFailure({
        code: "invalid_request",
        message: "The project was not found.",
      });
    const identity =
      project.value.repositoryIdentity ??
      (yield* enrichment.readRepositoryIdentity(project.value.workspaceRoot));
    const repository = MemoryScopeSchema.safeParse(identity?.canonicalKey);
    if (!repository.success || repository.data === "common")
      return yield* new OrchestratorMcpFailure({
        code: "invalid_request",
        message: "This project needs a recognized Git remote before it can use shared memory.",
      });
    return { repository: repository.data, projectId: target };
  });

  const retrieve = Effect.fn("MemorywellMcpService.retrieve")(function* (
    scope: McpInvocationScope,
    input: typeof MemoryRetrieveInput.Type,
  ) {
    const { repository } = yield* projectScope(scope, input.projectId, false);
    const result = yield* Effect.try({
      try: () =>
        store.memory.retrieve({
          scopes: [repository],
          query: input.query,
          paths: [...(input.paths ?? [])],
          ...(input.role === undefined ? {} : { role: input.role }),
          limit: input.limit ?? 4,
        }),
      catch: () =>
        new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "The memory search contains invalid fields.",
        }),
    });
    let remaining = 12_000;
    const items = result.items.map((record) => {
      const content = record.content.slice(0, Math.max(0, remaining));
      remaining -= content.length;
      return {
        id: record.id,
        topic: record.topic,
        scope: record.scope,
        title: record.title,
        summary: record.summary,
        content,
        revision: record.revision,
        truncated: content.length < record.content.length,
      };
    });
    return { scope: repository, items };
  });

  const propose = Effect.fn("MemorywellMcpService.propose")(function* (
    scope: McpInvocationScope,
    input: typeof MemoryProposeInput.Type,
  ) {
    const { repository, projectId } = yield* projectScope(scope, input.projectId, true);
    if (scope.thread !== undefined) {
      const caller = yield* threads
        .getThreadShell(scope.thread.threadId)
        .pipe(Effect.mapError(unavailable));
      if (
        !isLiveCallerShell(caller, scope.thread.providerInstanceId) ||
        caller?.projectId !== projectId
      )
        return yield* new OrchestratorMcpFailure({
          code: "parent_not_active",
          message: "The calling provider no longer owns an active thread run.",
        });
    }
    const actor = scope.thread
      ? `thread:${scope.thread.threadId}`
      : `client:${scope.client!.sessionId}`;
    const record = yield* Effect.try({
      try: () =>
        store.memory.propose(
          {
            idempotencyKey: input.idempotencyKey,
            scope: repository,
            topic: input.topic,
            title: input.title,
            summary: input.summary,
            content: input.content,
            tags: [...(input.tags ?? [])],
            paths: [...(input.paths ?? [])],
            sources: [...(input.sources ?? []), actor],
          },
          actor,
        ),
      catch: () =>
        new OrchestratorMcpFailure({
          code: "invalid_request",
          message:
            "The memory proposal has invalid fields, contains a possible credential, or reuses a request key with different content.",
        }),
    });
    return {
      id: record.id,
      scope: record.scope,
      status: record.status,
      revision: record.revision,
      message:
        record.status === "proposed"
          ? "Saved as a proposal. It reaches other agents only after a person verifies it in Memorywell."
          : "This knowledge is already recorded; its verification state was not changed.",
    };
  });

  return MemorywellMcpService.of({ retrieve, propose });
});

export const layer = Layer.effect(MemorywellMcpService, make);
