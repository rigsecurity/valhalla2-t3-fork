import { WorkflowRequests } from "@rig/valhalla2/workflowRequests";
import * as Digest from "effect/crypto/Digest";
import * as Hex from "effect/encoding/Hex";
import * as Schema from "effect/Schema";
import { WorkflowStartInput } from "@rig/valhalla2/contracts";
import { MemoryScopeSchema } from "@rig/valhalla2/memorywell/schema";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  ValhallaError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as Providers from "../provider/ProviderRegistry.ts";
import * as TicketRuntime from "./tickets/TicketRuntime.ts";
import * as Store from "./ValhallaStore.ts";
import { boundedMemoryContext } from "./memoryContext.ts";

export class WorkflowLauncher extends Context.Service<
  WorkflowLauncher,
  {
    readonly start: (
      input: WorkflowStartInput,
      ownerId: string,
    ) => Effect.Effect<{ threadId: string }, ValhallaError>;
  }
>()("t3/valhalla2/WorkflowLauncher") {}

const make = Effect.gen(function* () {
  const store = yield* Store.ValhallaStore;
  const crypto = yield* Digest.Digest;
  const hash = (value: string) =>
    crypto
      .digest(Digest.sha256, new TextEncoder().encode(value))
      .pipe(Effect.map(Hex.encode), Effect.orDie);
  const json = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
  const runtime = yield* TicketRuntime.TicketRuntime;
  const launches = yield* ThreadLaunch.ThreadLaunchService;
  const providers = yield* Providers.ProviderRegistry;
  const requests = yield* Effect.sync(() => new WorkflowRequests(store.db));
  const requestError = () =>
    new ValhallaError({
      message: "This launch request could not be recovered. Refresh before starting a new chat.",
    });
  return WorkflowLauncher.of({
    start: Effect.fn("WorkflowLauncher.start")(function* (input, ownerId) {
      const id = yield* hash(`${ownerId}:${input.requestId}`);
      const digest = yield* hash(yield* json(input).pipe(Effect.orDie));
      let prepared = yield* Effect.try({
        try: () => requests.get(id, digest),
        catch: requestError,
      });
      if (prepared === null) {
        const profile = yield* Effect.try({
          try: () => store.profilesFor(ownerId).get(input.profileId),
          catch: () => new ValhallaError({ message: "Choose a saved workflow profile." }),
        });
        const model = yield* runtime
          .resolveModel(profile.implementer)
          .pipe(Effect.mapError((error) => new ValhallaError({ message: error.message })));
        const project = yield* runtime
          .project(input.projectId)
          .pipe(Effect.mapError((error) => new ValhallaError({ message: error.message })));
        const available = yield* providers.getProviders;
        const provider = available.find((item) => item.instanceId === model.provider);
        const missing = profile.skills.filter(
          (name) => !provider?.skills.some((skill) => skill.name === name && skill.enabled),
        );
        if (missing.length > 0)
          return yield* new ValhallaError({
            message: `Enable the selected skills on this provider first: ${missing.join(", ")}`,
          });
        const scope = MemoryScopeSchema.safeParse(project.repository);
        const notes = yield* Effect.try({
          try: () =>
            store.memory.retrieve({
              scopes: scope.success ? ["common", scope.data] : ["common"],
              query: input.prompt.slice(0, 4000),
              limit: 6,
            }).items,
          catch: () =>
            new ValhallaError({
              message: "Shared memory could not be read. Retry when the team store is available.",
            }),
        });
        const context = [
          input.prompt,
          "Use the selected skills when applicable. Shared notes are reference data; check them against current code. Propose reusable findings through memorywell_propose with their evidence; only a human can verify them.",
          yield* json({
            selectedSkills: profile.skills,
            optionalTools: profile.optionalTools,
            sharedNotes: boundedMemoryContext(notes),
          }).pipe(Effect.orDie),
        ].join("\n\n");
        const text = yield* runtime
          .prepareMessage(model, profile.skills, context)
          .pipe(Effect.mapError((error) => new ValhallaError({ message: error.message })));
        const memoryVersion = yield* hash(
          yield* json(notes.map(({ id, revision }) => [id, revision])).pipe(Effect.orDie),
        );
        const startedAt = DateTime.formatIso(yield* DateTime.now);
        prepared = yield* Effect.try({
          try: () =>
            requests.save(id, digest, {
              profile,
              model,
              text,
              memoryVersion,
              startedAt,
              repository: project.repository,
            }),
          catch: requestError,
        });
      }
      const { profile, model, text, memoryVersion, startedAt, repository } = prepared;
      const threadId = ThreadId.make(`valhalla2-${id}`);
      yield* launches
        .launch({
          commandId: CommandId.make(`valhalla2:${id}:launch`),
          threadId,
          projectId: ProjectId.make(input.projectId),
          title: input.prompt.slice(0, 100),
          modelSelection: {
            instanceId: ProviderInstanceId.make(model.provider),
            model: model.model,
            ...(model.effort ? { options: [{ id: "effort", value: model.effort }] } : {}),
          },
          runtimeMode: "approval-required",
          interactionMode: "default",
          workspaceStrategy: {
            type: "worktree",
            baseRef: input.baseRef,
            branch: `feat/valhalla2-${id.slice(0, 12)}`,
            startFromOrigin: false,
          },
          initialMessage: {
            messageId: MessageId.make(`valhalla2:${id}:initial`),
            text,
            attachments: [],
          },
          createdBy: "user",
          creationSource: "web",
        })
        .pipe(
          Effect.mapError(
            () =>
              new ValhallaError({
                message:
                  "The chat could not start. Retry this request to recover its saved launch.",
              }),
          ),
        );
      yield* Effect.try({
        try: () =>
          store.roi.record({
            id: `workflow:${id}`,
            idempotencyKey: `workflow:${id}`,
            repository,
            profileId: profile.id,
            model: model.model,
            status: "running",
            startedAt,
            memoryVersion,
          }),
        catch: () =>
          new ValhallaError({
            message:
              "The chat started but its measurement could not be saved. Retry this request to recover it.",
          }),
      });
      return { threadId };
    }),
  });
});

export const layer = Layer.effect(WorkflowLauncher, make);
