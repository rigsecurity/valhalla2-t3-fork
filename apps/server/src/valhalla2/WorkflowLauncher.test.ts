import * as NodeSqlite from "node:sqlite";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { Memorywell } from "@rig/valhalla2/memorywell/service";
import { OutcomeLedger } from "@rig/valhalla2/outcomes";
import { Profiles } from "@rig/valhalla2/profiles";
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as Providers from "../provider/ProviderRegistry.ts";
import * as Store from "./ValhallaStore.ts";
import * as Workflow from "./WorkflowLauncher.ts";
import * as Runtime from "./tickets/TicketRuntime.ts";

const input = {
  requestId: "request-1",
  projectId: "project-1",
  profileId: "freestyle",
  baseRef: "main",
  prompt: "Fix database isolation",
};

const database = Effect.acquireRelease(
  Effect.sync(() => new NodeSqlite.DatabaseSync(":memory:")),
  (db) => Effect.sync(() => db.close()),
);

function fixture(db: NodeSqlite.DatabaseSync) {
  const profilesFor = (ownerId: string) => new Profiles(db, ownerId);
  const profiles = profilesFor("alice");
  const store = Store.ValhallaStore.of({
    db,
    profiles,
    profilesFor,
    memory: new Memorywell(db),
    roi: new OutcomeLedger(db),
  });
  const state = {
    requests: [] as ThreadLaunch.ThreadLaunchInput[],
    accepted: new Set<string>(),
    loseResponse: false,
    projectAvailable: true,
    beforeAccept: Effect.void,
  };
  const layer = Workflow.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeCrypto.layer,
        Layer.succeed(Store.ValhallaStore, store),
        Layer.mock(Providers.ProviderRegistry)({ getProviders: Effect.succeed([]) }),
        Layer.mock(Runtime.TicketRuntime)({
          resolveModel: (model) => Effect.succeed(model),
          prepareMessage: (_model, _skills, text) => Effect.succeed(text),
          project: () =>
            state.projectAvailable
              ? Effect.succeed({ repository: "github.com/acme/service" })
              : Effect.fail(new Runtime.TicketRuntimeError({ reason: "project" })),
        }),
        Layer.mock(ThreadLaunch.ThreadLaunchService)({
          launch: (request) =>
            Effect.gen(function* () {
              state.requests.push(request);
              yield* state.beforeAccept;
              const resumed = state.accepted.has(request.commandId);
              state.accepted.add(request.commandId);
              if (state.loseResponse) {
                state.loseResponse = false;
                return yield* new ThreadLaunch.ThreadLaunchError({
                  commandId: request.commandId,
                  projectId: request.projectId,
                  operation: "dispatch-message",
                  cause: new Error("Response lost after accepting the command"),
                });
              }
              return {
                threadId: request.threadId!,
                projection: {} as OrchestrationV2ThreadProjection,
                resumed,
              };
            }),
        }),
      ),
    ),
  );
  return { store, profiles, state, layer };
}

function verifiedNote(memory: Memorywell, suffix: string) {
  const proposed = memory.propose(
    {
      idempotencyKey: `proposal-${suffix}`,
      scope: "github.com/acme/service",
      topic: `testing/database-${suffix}`,
      title: `Database isolation ${suffix}`,
      summary: `Database isolation lesson ${suffix}`,
      content: `Use a separate database for isolation ${suffix}.`,
    },
    "alice",
  );
  return memory.verify(
    {
      id: proposed.id,
      expectedRevision: proposed.revision,
      idempotencyKey: `verify-${suffix}`,
      evidence: {
        kind: "human-review",
        reference: "Reviewed test result",
        observedAt: "2026-11-08T12:00:00.000Z",
      },
    },
    "reviewer",
  );
}

it.effect(
  "recovers a lost launch response with its original profile and memory after restart",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const db = yield* database;
        const { store, profiles, state, layer } = fixture(db);
        const originalNote = verifiedNote(store.memory, "original");
        state.loseResponse = true;
        const lost = yield* Effect.gen(function* () {
          const launcher = yield* Workflow.WorkflowLauncher;
          return yield* Effect.exit(launcher.start(input, "alice"));
        }).pipe(Effect.provide(layer));
        assert.isTrue(Exit.isFailure(lost));
        assert.strictEqual(store.roi.list().length, 0);
        assert.strictEqual(state.accepted.size, 1);
        profiles.save({
          ...profiles.get(input.profileId),
          implementer: { provider: "codex", model: "changed-model" },
        });
        const laterNote = verifiedNote(store.memory, "later");

        yield* Effect.gen(function* () {
          const launcher = yield* Workflow.WorkflowLauncher;
          const recovered = yield* launcher.start(input, "alice");
          assert.deepEqual(yield* launcher.start(input, "alice"), recovered);
          assert.strictEqual(state.accepted.size, 1);
          assert.deepEqual(state.requests[1], state.requests[0]);
          assert.include(state.requests[1]!.initialMessage!.text, originalNote.id);
          assert.notInclude(state.requests[1]!.initialMessage!.text, laterNote.id);
          const outcomes = store.roi.list();
          assert.strictEqual(outcomes.length, 1);
          assert.strictEqual(outcomes[0]!.model, "sonnet");
          assert.strictEqual(outcomes[0]!.status, "running");
          assert.match(outcomes[0]!.memoryVersion!, /^[a-f0-9]{64}$/);
          assert.strictEqual(store.roi.summary().accepted, 0);
        }).pipe(Effect.provide(layer));
      }),
    ),
);

it.effect("rejects changed input on a used request and isolates requests by engineer", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const db = yield* database;
      const { state, store, layer } = fixture(db);
      yield* Effect.gen(function* () {
        const launcher = yield* Workflow.WorkflowLauncher;
        const alice = yield* launcher.start(input, "alice");
        const changed = yield* Effect.exit(
          launcher.start({ ...input, prompt: "A different task" }, "alice"),
        );
        assert.isTrue(Exit.isFailure(changed));
        assert.strictEqual(state.accepted.size, 1);
        const bob = yield* launcher.start(input, "bob");
        assert.notEqual(bob.threadId, alice.threadId);
        assert.strictEqual(state.accepted.size, 2);
        assert.strictEqual(store.roi.list().length, 2);
      }).pipe(Effect.provide(layer));
    }),
  ),
);

it.effect("waits for launch acceptance before recording a running outcome", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const db = yield* database;
      const { state, store, layer } = fixture(db);
      const reachedLaunch = yield* Deferred.make<void>();
      const releaseLaunch = yield* Deferred.make<void>();
      state.beforeAccept = Deferred.succeed(reachedLaunch, undefined).pipe(
        Effect.andThen(Deferred.await(releaseLaunch)),
      );
      yield* Effect.gen(function* () {
        const launcher = yield* Workflow.WorkflowLauncher;
        const running = yield* launcher.start(input, "alice").pipe(Effect.forkChild);
        yield* Deferred.await(reachedLaunch);
        assert.strictEqual(store.roi.list().length, 0);
        assert.strictEqual(state.accepted.size, 0);
        yield* Deferred.succeed(releaseLaunch, undefined);
        yield* Fiber.join(running);
        assert.strictEqual(store.roi.summary().running, 1);
        assert.strictEqual(store.roi.summary().accepted, 0);
      }).pipe(Effect.provide(layer));
    }),
  ),
);

it.effect("keeps unavailable projects and missing skills from starting unmeasured work", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const db = yield* database;
      const { state, profiles, store, layer } = fixture(db);
      yield* Effect.gen(function* () {
        const launcher = yield* Workflow.WorkflowLauncher;
        state.projectAvailable = false;
        assert.isTrue(Exit.isFailure(yield* Effect.exit(launcher.start(input, "alice"))));
        state.projectAvailable = true;
        profiles.save({ ...profiles.get(input.profileId), skills: ["review"] });
        assert.isTrue(Exit.isFailure(yield* Effect.exit(launcher.start(input, "alice"))));
        assert.strictEqual(state.requests.length, 0);
        assert.strictEqual(store.roi.list().length, 0);
        profiles.save({ ...profiles.get(input.profileId), skills: [] });
        yield* launcher.start(input, "alice");
        assert.strictEqual(state.accepted.size, 1);
      }).pipe(Effect.provide(layer));
    }),
  ),
);
