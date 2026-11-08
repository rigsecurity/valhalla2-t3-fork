import * as NodeSqlite from "node:sqlite";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { Memorywell } from "@rig/valhalla2/memorywell/service";
import { OutcomeLedger } from "@rig/valhalla2/outcomes";
import { Profiles } from "@rig/valhalla2/profiles";
import type { JiraTicket, TicketRun } from "@rig/valhalla2/tickets";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ValhallaStore from "../ValhallaStore.ts";
import * as Jira from "./JiraClient.ts";
import * as Runtime from "./TicketRuntime.ts";
import * as Workflow from "./TicketWorkflow.ts";

const ticket: JiraTicket = {
  key: "RD-123",
  title: "Add health endpoint",
  description: "Return the service status.",
  url: "https://example.atlassian.net/browse/RD-123",
  updatedAt: "2026-11-01T00:00:00.000Z",
  status: "To Do",
};
const input = {
  requestId: "request-1",
  ticketKey: ticket.key,
  projectId: "project-1",
  profileId: "ticket",
  baseRef: "main",
};
const sha = "a".repeat(40);

function fixture(db: NodeSqlite.DatabaseSync) {
  const profilesFor = (ownerId: string) => new Profiles(db, ownerId);
  const profiles = profilesFor("alice");
  profiles.save({
    ...profiles.get("ticket"),
    planner: { provider: "claude", model: "planner-model", effort: "high" },
  });
  const store = ValhallaStore.ValhallaStore.of({
    db,
    profiles,
    profilesFor,
    memory: new Memorywell(db),
    roi: new OutcomeLedger(db),
  });
  const state = {
    threads: new Map<string, Runtime.TicketThreadState>(),
    commands: new Map<string, { runId: string; worktreePath: string }>(),
    delivered: [] as Array<{ stage: TicketRun["stage"]; model: string; prompt: string }>,
    interrupted: [] as string[],
    head: sha,
    lostDelivery: false,
    lostPublication: false,
    publishCalls: 0,
    createdPrs: 0,
    inspections: 0,
  };
  const runtime = Runtime.TicketRuntime.of({
    project: () => Effect.succeed({ repository: "github.com/acme/service" }),
    resolveModel: (model) => Effect.succeed(model),
    prepareMessage: (_model, _skills, text) => Effect.succeed(text),
    deliver: (run, prompt) =>
      Effect.gen(function* () {
        const key = `${run.id}:${run.stage}:${run.repairAttempts}`;
        let receipt = state.commands.get(key);
        if (!receipt) {
          receipt = { runId: `run:${key}`, worktreePath: "/repo/worktree" };
          state.commands.set(key, receipt);
          const threadId = run.stage === "review" ? run.reviewerThreadId! : run.threadId;
          state.threads.set(threadId, {
            ...receipt,
            status: "running",
            needsInput: false,
            hasBackgroundWork: true,
          });
          const route =
            run.stage === "plan"
              ? run.planner!
              : run.stage === "review"
                ? run.reviewer!
                : run.implementer;
          state.delivered.push({ stage: run.stage, model: route.model, prompt });
        }
        if (state.lostDelivery) {
          state.lostDelivery = false;
          return yield* new Runtime.TicketRuntimeError({ reason: "launch" });
        }
        return receipt;
      }),
    read: (id) => Effect.sync(() => state.threads.get(id) ?? null),
    reviewHead: () => Effect.sync(() => state.head),
    interrupt: (_run, id) =>
      Effect.sync(() => {
        state.interrupted.push(id);
        const thread = state.threads.get(id);
        if (thread)
          state.threads.set(id, { ...thread, status: "interrupted", hasBackgroundWork: false });
      }),
    publish: () =>
      Effect.gen(function* () {
        state.publishCalls++;
        if (state.createdPrs === 0) state.createdPrs++;
        if (state.lostPublication) {
          state.lostPublication = false;
          return yield* new Runtime.TicketRuntimeError({ reason: "publish" });
        }
        return "https://github.com/acme/service/pull/1";
      }),
  });
  const layer = Workflow.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeCrypto.layer,
        Layer.succeed(ValhallaStore.ValhallaStore, store),
        Layer.succeed(Runtime.TicketRuntime, runtime),
        Layer.succeed(
          Jira.JiraClient,
          Jira.JiraClient.of({
            configured: true,
            inspect: () =>
              Effect.sync(() => {
                state.inspections++;
                return ticket;
              }),
          }),
        ),
      ),
    ),
  );
  const complete = (id: string) => {
    const thread = state.threads.get(id)!;
    state.threads.set(id, {
      ...thread,
      status: "completed",
      needsInput: false,
      hasBackgroundWork: false,
    });
  };
  return { layer, state, store, profiles, complete };
}

const database = Effect.acquireRelease(
  Effect.sync(() => new NodeSqlite.DatabaseSync(":memory:")),
  (db) => Effect.sync(() => db.close()),
);

it.effect(
  "runs a pinned personal workflow through planning, implementation and an independent review",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const db = yield* database;
        const fixtureRun = fixture(db);
        const recipe = {
          scope: "github.com/acme/service",
          topic: "testing/how-to-verify",
          title: "Testing this repository",
          summary: "Use the isolated verification script.",
          content: "Run ./scripts/check-local in a disposable worktree.",
          reason: "convention" as const,
          sources: ["scripts/check-local"],
          roles: ["implementer", "verifier"],
          idempotencyKey: "verification-recipe",
        };
        const saved = fixtureRun.store.memory.capture(recipe, "tester");
        const unrelated = fixtureRun.store.memory.capture(
          { ...recipe, scope: "github.com/acme/other", idempotencyKey: "other-recipe" },
          "tester",
        );
        yield* Effect.gen(function* () {
          const service = yield* Workflow.TicketWorkflow;
          const started = yield* service.start(input, "alice");
          const again = yield* service.start(input, "alice");
          assert.strictEqual(again.id, started.id);
          assert.strictEqual(fixtureRun.state.inspections, 1);
          assert.deepEqual(yield* service.list("bob"), []);
          assert.isTrue(Exit.isFailure(yield* Effect.exit(service.get({ id: started.id }, "bob"))));
          fixtureRun.profiles.save({
            ...fixtureRun.profiles.get("ticket"),
            implementer: { provider: "codex", model: "new-choice" },
          });
          fixtureRun.complete(started.threadId);
          yield* service.tick;
          const implementing = yield* service.get({ id: started.id }, "alice");
          assert.strictEqual(implementing.stage, "implement");
          assert.strictEqual(fixtureRun.state.delivered[1]!.model, "sonnet");
          assert.notInclude(fixtureRun.state.delivered[0]!.prompt, saved.id);
          assert.include(fixtureRun.state.delivered[1]!.prompt, saved.id);
          fixtureRun.complete(started.threadId);
          yield* service.tick;
          const reviewing = yield* service.get({ id: started.id }, "alice");
          assert.strictEqual(reviewing.stage, "review");
          assert.notEqual(reviewing.reviewerThreadId, reviewing.threadId);
          assert.include(fixtureRun.state.delivered[2]!.prompt, saved.id);
          assert.notInclude(fixtureRun.state.delivered[2]!.prompt, unrelated.id);
          fixtureRun.complete(reviewing.reviewerThreadId!);
          yield* service.tick;
          const ready = yield* service.get({ id: started.id }, "alice");
          assert.strictEqual(ready.status, "ready_to_publish");
          assert.strictEqual(ready.reviewedHeadSha, sha);
          assert.strictEqual(fixtureRun.state.publishCalls, 0);
          assert.strictEqual(fixtureRun.store.roi.summary().accepted, 0);
        }).pipe(Effect.provide(fixtureRun.layer));
      }),
    ),
);

it.effect(
  "recovers an accepted launch after a lost response and process restart without creating another agent",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const db = yield* database;
        const fixtureRun = fixture(db);
        fixtureRun.state.lostDelivery = true;
        const saved = yield* Effect.scoped(
          Effect.gen(function* () {
            const service = yield* Workflow.TicketWorkflow;
            return yield* service.start(input, "alice");
          }).pipe(Effect.provide(fixtureRun.layer)),
        );
        assert.strictEqual(saved.status, "queued");
        yield* Effect.scoped(
          Effect.gen(function* () {
            const service = yield* Workflow.TicketWorkflow;
            yield* service.tick;
            const recovered = yield* service.get({ id: saved.id }, "alice");
            assert.strictEqual(recovered.status, "running");
            assert.strictEqual(fixtureRun.state.commands.size, 1);
            assert.strictEqual(fixtureRun.state.delivered.length, 1);
          }).pipe(Effect.provide(fixtureRun.layer)),
        );
      }),
    ),
);

it.effect(
  "requires the reviewed commit and retries an uncertain publication without duplicate PRs",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const db = yield* database;
        const fixtureRun = fixture(db);
        fixtureRun.profiles.save({
          ...fixtureRun.profiles.get("ticket"),
          planner: undefined,
          reviewer: undefined,
        });
        yield* Effect.gen(function* () {
          const service = yield* Workflow.TicketWorkflow;
          const run = yield* service.start(input, "alice");
          fixtureRun.complete(run.threadId);
          yield* service.tick;
          assert.isTrue(
            Exit.isFailure(
              yield* Effect.exit(
                service.publish({ id: run.id, approvedHeadSha: "b".repeat(40) }, "alice"),
              ),
            ),
          );
          fixtureRun.state.head = "c".repeat(40);
          assert.isTrue(
            Exit.isFailure(
              yield* Effect.exit(service.publish({ id: run.id, approvedHeadSha: sha }, "alice")),
            ),
          );
          assert.strictEqual(fixtureRun.state.publishCalls, 0);
          fixtureRun.state.head = sha;
          fixtureRun.state.lostPublication = true;
          assert.isTrue(
            Exit.isFailure(
              yield* Effect.exit(service.publish({ id: run.id, approvedHeadSha: sha }, "alice")),
            ),
          );
          const published = yield* service.publish({ id: run.id, approvedHeadSha: sha }, "alice");
          assert.strictEqual(published.status, "published");
          assert.strictEqual(fixtureRun.state.createdPrs, 1);
          yield* service.publish({ id: run.id, approvedHeadSha: sha }, "alice");
          assert.strictEqual(fixtureRun.state.publishCalls, 2);
          assert.strictEqual(fixtureRun.store.roi.summary().accepted, 0);
        }).pipe(Effect.provide(fixtureRun.layer));
      }),
    ),
);

it.effect("bounds repair attempts and stops automatic progression on human takeover", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const db = yield* database;
      const fixtureRun = fixture(db);
      fixtureRun.profiles.save({
        ...fixtureRun.profiles.get("ticket"),
        planner: undefined,
        maxRepairAttempts: 1,
      });
      yield* Effect.gen(function* () {
        const service = yield* Workflow.TicketWorkflow;
        const run = yield* service.start(input, "alice");
        const initial = fixtureRun.state.threads.get(run.threadId)!;
        fixtureRun.state.threads.set(run.threadId, {
          ...initial,
          status: "failed",
          hasBackgroundWork: false,
        });
        yield* service.tick;
        const retried = yield* service.retry({ id: run.id }, "alice");
        assert.strictEqual(retried.repairAttempts, 1);
        const second = fixtureRun.state.threads.get(run.threadId)!;
        fixtureRun.state.threads.set(run.threadId, {
          ...second,
          status: "failed",
          hasBackgroundWork: false,
        });
        yield* service.tick;
        assert.isTrue(Exit.isFailure(yield* Effect.exit(service.retry({ id: run.id }, "alice"))));
        fixtureRun.state.threads.set(run.threadId, {
          ...second,
          status: "running",
          hasBackgroundWork: true,
        });
        yield* service.takeOver({ id: run.id }, "alice");
        assert.deepEqual(fixtureRun.state.interrupted, [run.threadId]);
        const delivered = fixtureRun.state.delivered.length;
        fixtureRun.complete(run.threadId);
        yield* service.tick;
        assert.strictEqual(fixtureRun.state.delivered.length, delivered);
        assert.strictEqual((yield* service.get({ id: run.id }, "alice")).status, "taken_over");
      }).pipe(Effect.provide(fixtureRun.layer));
    }),
  ),
);
