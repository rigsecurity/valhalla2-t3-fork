import { expect, it } from "@effect/vitest";
import { Memorywell } from "@rig/valhalla2/memorywell/service";
import { OutcomeLedger } from "@rig/valhalla2/outcomes";
import { Profiles } from "@rig/valhalla2/profiles";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type Project,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as NodeSqlite from "node:sqlite";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import * as Projects from "../project/ProjectService.ts";
import * as Enrichment from "../project/ProjectEnrichmentService.ts";
import * as ValhallaStore from "../valhalla2/ValhallaStore.ts";
import * as MemoryService from "./MemorywellMcpService.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";
import { liveThreadShell } from "./McpToolAccess.testkit.ts";

const projectId = ProjectId.make("project:memory");
const threadId = ThreadId.make("thread:memory");
const repository = "github.com/acme/app";
const now = "2026-11-08T12:00:00.000Z";
const identity = {
  canonicalKey: repository,
  locator: {
    source: "git-remote" as const,
    remoteName: "origin",
    remoteUrl: "git@github.com:acme/app.git",
  },
};
const project: Project = {
  id: projectId,
  title: "App",
  workspaceRoot: "/home/user/app",
  repositoryIdentity: identity,
  defaultModelSelection: null,
  scripts: [],
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};
const scope: McpInvocationScope = {
  environmentId: EnvironmentId.make("environment:memory"),
  requestNamespace: "provider:memory",
  thread: {
    threadId,
    providerSessionId: "provider:memory",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
};
const input = {
  idempotencyKey: "database-1",
  topic: "testing/database",
  title: "Test database",
  summary: "Give tests a database of their own",
  content: "Start a separate database before testing migrations.",
};

const setup = Effect.fn("MemorywellMcpService.test.setup")(function* () {
  const db = yield* Effect.acquireRelease(
    Effect.sync(() => new NodeSqlite.DatabaseSync(":memory:")),
    (connection) => Effect.sync(() => connection.close()),
  );
  const memory = new Memorywell(db, () => now);
  const caller = yield* Ref.make({ ...liveThreadShell(threadId), projectId });
  const dependencies = Layer.mergeAll(
    Layer.succeed(ValhallaStore.ValhallaStore, {
      db,
      memory,
      profiles: new Profiles(db),
      profilesFor: (ownerId) => new Profiles(db, ownerId),
      roi: new OutcomeLedger(db),
    }),
    Layer.mock(Projects.ProjectService)({
      getById: (id) => Effect.succeed(id === projectId ? Option.some(project) : Option.none()),
    }),
    Layer.mock(Enrichment.ProjectEnrichmentService)({
      readRepositoryIdentity: () => Effect.succeed(identity),
    }),
    Layer.mock(Threads.ThreadManagementService)({ getThreadShell: () => Ref.get(caller) }),
  );
  return {
    memory,
    caller,
    dependencies,
    layer: MemoryService.layer.pipe(Layer.provide(dependencies)),
  };
});

it.effect(
  "shares verified project knowledge with external clients without allowing promotion or scope changes",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup();
      const proposed = fixture.memory.propose({ ...input, scope: repository }, "engineer");
      fixture.memory.verify(
        {
          id: proposed.id,
          expectedRevision: 1,
          idempotencyKey: "review",
          evidence: {
            kind: "human-review",
            reference: "Checked the migration tests",
            observedAt: now,
          },
        },
        "reviewer",
      );
      const other = fixture.memory.propose(
        { ...input, idempotencyKey: "private", scope: "github.com/acme/private" },
        "engineer",
      );
      fixture.memory.verify(
        {
          id: other.id,
          expectedRevision: 1,
          idempotencyKey: "private-review",
          evidence: {
            kind: "human-review",
            reference: "Checked the migration tests",
            observedAt: now,
          },
        },
        "reviewer",
      );
      yield* Effect.gen(function* () {
        const service = yield* MemoryService.MemorywellMcpService;
        const external: McpInvocationScope = {
          ...scope,
          thread: undefined,
          client: { sessionId: "native-claude", label: "Claude Code", access: "read-only" },
        };
        expect(
          (yield* service.retrieve(external, { projectId, query: "database" })).items.map(
            (item) => item.id,
          ),
        ).toEqual([proposed.id]);
        expect((yield* Effect.flip(service.retrieve(external, { query: "database" }))).code).toBe(
          "target_required",
        );
        expect((yield* Effect.flip(service.propose(external, { ...input, projectId }))).code).toBe(
          "capability_denied",
        );
        expect(
          (yield* Effect.flip(
            service.retrieve(scope, {
              projectId: ProjectId.make("project:private"),
              query: "database",
            }),
          )).code,
        ).toBe("capability_denied");
        expect((yield* service.retrieve(scope, { query: other.id })).items).toEqual([]);
        expect(
          (yield* Effect.flip(
            service.retrieve({ ...scope, capabilities: new Set() }, { query: "database" }),
          )).code,
        ).toBe("capability_denied");
        const saved = yield* service.propose(scope, {
          ...input,
          idempotencyKey: "fresh",
          topic: "testing/cleanup",
        });
        expect(saved.status).toBe("proposed");
        expect(fixture.memory.list({ status: "proposed" })[0]?.provenance.actor).toBe(
          `thread:${threadId}`,
        );
      }).pipe(Effect.provide(fixture.layer));
    }),
);

it.effect("rechecks the owning thread after repository resolution before saving a proposal", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    const resolving = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const dependencies = Layer.mergeAll(
      fixture.dependencies,
      Layer.mock(Projects.ProjectService)({
        getById: () => Effect.succeedSome({ ...project, repositoryIdentity: null }),
      }),
      Layer.mock(Enrichment.ProjectEnrichmentService)({
        readRepositoryIdentity: () =>
          Deferred.succeed(resolving, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.as(identity),
          ),
      }),
    );
    yield* Effect.gen(function* () {
      const service = yield* MemoryService.MemorywellMcpService;
      const pending = yield* service.propose(scope, input).pipe(Effect.flip, Effect.forkChild);
      yield* Deferred.await(resolving);
      yield* Ref.update(fixture.caller, (caller) => ({ ...caller, activeRunId: null }));
      yield* Deferred.succeed(release, undefined);
      expect((yield* Fiber.join(pending)).code).toBe("parent_not_active");
      expect(fixture.memory.list()).toEqual([]);
    }).pipe(Effect.provide(MemoryService.layer.pipe(Layer.provide(dependencies))));
  }),
);
