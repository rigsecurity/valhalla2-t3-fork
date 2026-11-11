import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { createThreadSearchIndex } from "../../orchestration-v2/threadSearchIndex.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const index = yield* sql`
    SELECT 1 FROM sqlite_master WHERE name = 'orchestration_v2_message_search'
  `;
  if (index.length > 0) yield* createThreadSearchIndex(sql);
});
