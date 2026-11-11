import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";

const fields = ["title", "branch", "pullRequests", "linkedPullRequest", "branchPullRequest"];

const indexedText = (sql: SqlClient.SqlClient, row: string) =>
  sql`replace(replace(${sql.literal(
    ["title", "branch"]
      .map((field) => `coalesce(json_extract(${row}.payload_json, '$.${field}'), '')`)
      .concat([
        `${row}.thread_id`,
        ...["linkedPullRequest", "branchPullRequest"].flatMap((field) => [
          `coalesce(json_extract(${row}.payload_json, '$.${field}.url'), '')`,
          `coalesce(json_extract(${row}.payload_json, '$.${field}.repository') || '#' || json_extract(${row}.payload_json, '$.${field}.number'), '')`,
          `coalesce('pr' || json_extract(${row}.payload_json, '$.${field}.number'), '')`,
        ]),
        `coalesce((SELECT group_concat(
            coalesce(json_extract(value, '$.snapshot.title'), '') || ' ' ||
            json_extract(value, '$.url') || ' ' ||
            json_extract(value, '$.repository') || '#' || json_extract(value, '$.number') ||
            ' pr' || json_extract(value, '$.number'), ' ')
          FROM json_each(${row}.payload_json, '$.pullRequests')
          WHERE json_extract(value, '$.source') IS NOT 'stack-dismissed'), '')`,
      ])
      .join(" || ' ' || "),
  )}, '’', ''''), '‘', '''')`;

export const createThreadSearchIndex = Effect.fn("ThreadSearchIndex.create")(function* (
  sql: SqlClient.SqlClient,
) {
  yield* sql`
    CREATE VIRTUAL TABLE orchestration_v2_thread_search USING fts5(
      text, content = '', contentless_delete = 1, tokenize = 'trigram remove_diacritics 1'
    )
  `;
  yield* sql`
    CREATE TRIGGER orchestration_v2_thread_search_insert
    AFTER INSERT ON orchestration_v2_projection_threads
    BEGIN
      INSERT INTO orchestration_v2_thread_search (rowid, text)
      VALUES (new.rowid, ${indexedText(sql, "new")});
    END
  `;
  yield* sql`
    CREATE TRIGGER orchestration_v2_thread_search_update
    AFTER UPDATE OF payload_json ON orchestration_v2_projection_threads
    WHEN ${sql.literal(
      fields
        .map(
          (field) =>
            `json_extract(old.payload_json, '$.${field}') IS NOT json_extract(new.payload_json, '$.${field}')`,
        )
        .join(" OR "),
    )}
    BEGIN
      DELETE FROM orchestration_v2_thread_search WHERE rowid = old.rowid;
      INSERT INTO orchestration_v2_thread_search (rowid, text)
      VALUES (new.rowid, ${indexedText(sql, "new")});
    END
  `;
  yield* sql`
    CREATE TRIGGER orchestration_v2_thread_search_delete
    AFTER DELETE ON orchestration_v2_projection_threads
    BEGIN
      DELETE FROM orchestration_v2_thread_search WHERE rowid = old.rowid;
    END
  `;
  yield* rebuildThreadSearch(sql);
});

export const rebuildThreadSearch = Effect.fn("ThreadSearchIndex.rebuild")(function* (
  sql: SqlClient.SqlClient,
) {
  const index = yield* sql`
    SELECT 1 FROM sqlite_master WHERE name = 'orchestration_v2_thread_search'
  `;
  if (index.length === 0) return;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        INSERT INTO orchestration_v2_thread_search (orchestration_v2_thread_search)
        VALUES ('delete-all')
      `;
      yield* sql`
        INSERT INTO orchestration_v2_thread_search (rowid, text)
        SELECT threads.rowid, ${indexedText(sql, "threads")}
        FROM orchestration_v2_projection_threads AS threads
      `;
    }),
  );
});
