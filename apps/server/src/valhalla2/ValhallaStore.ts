import * as NodeSqlite from "node:sqlite";
import { Memorywell } from "@rig/valhalla2/memorywell/service";
import { OutcomeLedger } from "@rig/valhalla2/outcomes";
import { Profiles } from "@rig/valhalla2/profiles";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../config.ts";

export class ValhallaStoreOpenError extends Schema.TaggedError<ValhallaStoreOpenError>()(
  "ValhallaStoreOpenError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "The Valhalla workspace store could not be opened.";
  }
}

export class ValhallaStore extends Context.Service<
  ValhallaStore,
  {
    readonly db: NodeSqlite.DatabaseSync;
    readonly memory: Memorywell;
    readonly profiles: Profiles;
    readonly profilesFor: (ownerId: string) => Profiles;
    readonly roi: OutcomeLedger;
  }
>()("t3/valhalla2/ValhallaStore") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const path = yield* Path.Path;
  const db = yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        const connection = new NodeSqlite.DatabaseSync(
          path.join(config.stateDir, "valhalla2.sqlite"),
        );
        connection.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000");
        const check = connection.prepare("PRAGMA quick_check").get();
        if (check?.quick_check !== "ok") {
          connection.close();
          throw new Error("SQLite integrity check failed");
        }
        return connection;
      },
      catch: (cause) => new ValhallaStoreOpenError({ cause }),
    }),
    (connection) => Effect.sync(() => connection.close()),
  );
  return ValhallaStore.of({
    db,
    memory: new Memorywell(db),
    profiles: new Profiles(db),
    profilesFor: (ownerId) => new Profiles(db, ownerId),
    roi: new OutcomeLedger(db),
  });
});

export const layer = Layer.effect(ValhallaStore, make);
