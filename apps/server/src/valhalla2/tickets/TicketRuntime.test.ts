import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ServerConfig from "../../config.ts";
import * as Git from "../../vcs/GitVcsDriver.ts";
import { resolveReviewHead } from "./TicketRuntime.ts";

const layerTest = Git.layer.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "valhalla2-review-test-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

it.effect("requires a clean ticket branch with a committed change from its base", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cwd = yield* fs.makeTempDirectoryScoped();
    const git = yield* Git.GitVcsDriver;
    const run = (...args: string[]) =>
      git.execute({
        operation: "TicketRuntime.test",
        cwd,
        args,
        env: {
          GIT_AUTHOR_NAME: "Valhalla Test",
          GIT_AUTHOR_EMAIL: "test@example.invalid",
          GIT_COMMITTER_NAME: "Valhalla Test",
          GIT_COMMITTER_EMAIL: "test@example.invalid",
        },
      });
    const file = path.join(cwd, "service.txt");
    const review = resolveReviewHead({ worktreePath: cwd, baseRef: "main", branch: "ticket" });
    yield* run("init", "-b", "main");
    yield* fs.writeFileString(file, "original\n");
    yield* run("add", "service.txt");
    yield* run("commit", "-m", "Base");
    yield* run("switch", "-c", "ticket");
    assert.strictEqual((yield* Effect.flip(review)).reason, "no_changes");
    yield* run("commit", "--allow-empty", "-m", "No changes");
    assert.strictEqual((yield* Effect.flip(review)).reason, "no_changes");
    yield* fs.writeFileString(file, "changed\n");
    assert.strictEqual((yield* Effect.flip(review)).reason, "uncommitted");
    yield* run("add", "service.txt");
    yield* run("commit", "-m", "Change service");
    const { commitSha } = yield* git.resolveCommit({ cwd, revision: "HEAD" });
    assert.strictEqual(yield* review, commitSha);
    yield* run("switch", "main");
    assert.strictEqual((yield* Effect.flip(review)).reason, "wrong_branch");
  }).pipe(Effect.provide(layerTest)),
);
