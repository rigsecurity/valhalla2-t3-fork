import {
  IsoDateTime,
  MessageId,
  OrchestrationThreadSearchSource,
  OrchestrationV2AppThreadJson,
  OrchestrationV2ThreadOpens,
  ThreadLinkedPullRequest,
  ThreadPullRequestLink,
  type OrchestrationSearchThreadsInput,
  type OrchestrationSearchThreadsResult,
  type OrchestrationV2SearchThreadsInput,
  type OrchestrationV2SearchThreadsResult,
  type OrchestrationV2ThreadShellSnapshot,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import {
  messageSearchTokens,
  foldSearchQuery,
  rankMessageMatches,
  rankSearchItems,
  messageMatcher,
  fuzzyMessageMatcher,
  fuzzySearchSeeds,
  scoreSearchTerms,
  scoreThreadSearch,
  type ThreadSearchSubject,
} from "@t3tools/shared/paletteSearch";
import { threadSearchPullRequests } from "@t3tools/shared/threadPullRequests";
import { indexedMessageCondition, nonPlaceholderMessageCondition } from "./messageSearchIndex.ts";
import { loadOlderSettledThreadsPage } from "./ShellStream.ts";

// When the user last wrote in the thread aliased `threads`, as the clients
// rank recency; agent notices in the user role do not count.
const latestUserMessageAt = (sql: SqlClient.SqlClient) => sql`(
  SELECT messages.updated_at
  FROM orchestration_v2_projection_messages AS messages
  WHERE messages.thread_id = threads.thread_id
    AND messages.role = 'user'
    AND COALESCE(json_extract(messages.payload_json, '$.createdBy'), 'user') = 'user'
  ORDER BY messages.updated_at DESC, messages.message_id DESC
  LIMIT 1
)`;

export class ThreadSearchError extends Schema.TaggedError<ThreadSearchError>()(
  "ThreadSearchError",
  {
    operation: Schema.Literals(["query", "decode"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Thread search ${this.operation} failed.`;
  }
}

// Token lists bind as JSON arrays, so any number of them is one parameter.
const TokenList = Schema.fromJsonString(Schema.Array(Schema.String));
type ThreadSearchInput = OrchestrationSearchThreadsInput &
  Pick<OrchestrationV2SearchThreadsInput, "includeArchived" | "fuzzy">;
const SearchRequest = Schema.Struct({
  /** The FTS5 query, or null to scan messages instead. */
  match: Schema.NullOr(Schema.String),
  /** Tokens every hit must contain, checked on the text. */
  substrings: TokenList,
  projectId: Schema.NullOr(ProjectId),
  /** Threads the caller already lists, left out before the hit limit. */
  excludedThreadIds: TokenList,
  includeArchived: Schema.optionalKey(Schema.Boolean),
  candidateLimit: Schema.optionalKey(Schema.Int),
  hitLimit: Schema.optionalKey(Schema.Int),
  textLimit: Schema.optionalKey(Schema.Int),
});
const SearchRow = Schema.Struct({
  messageRowid: Schema.Number,
  messageId: MessageId,
  threadId: ThreadId,
  projectId: ProjectId,
  source: OrchestrationThreadSearchSource,
  text: Schema.String,
  messageCreatedAt: Schema.NullOr(IsoDateTime),
});

const ThreadOpensRow = Schema.Struct({
  threadId: ThreadId,
  opens: Schema.NullOr(Schema.String),
  latestUserMessageAt: Schema.NullOr(IsoDateTime),
});
const decodeThreadOpens = Schema.decodeUnknownOption(
  Schema.fromJsonString(OrchestrationV2ThreadOpens),
);

const SNIPPET_LENGTH = 240;
// The newest hits read per query. A common word stops here instead of reading
// every message, so time stays flat as history grows.
const MESSAGE_HIT_LIMIT = 2000;
// How many of the newest index hits the filters may pass over to fill that
// limit: a rare short word or hidden threads would otherwise read every hit.
const MESSAGE_CANDIDATE_LIMIT = 10_000;
// Without the index, how many of the newest messages a search scans.
const MESSAGE_SCAN_LIMIT = 20_000;

/**
 * The SQL inputs for a message search, or null when the query has no token
 * long enough to search. Tokens of three or more characters go to the
 * trigram index as quoted phrases; shorter ones, and every token when the
 * index cannot serve the query, are checked as substrings of the hits.
 */
function buildMessageSearch(
  query: string,
  hasIndex: boolean,
): Pick<typeof SearchRequest.Type, "match" | "substrings"> | null {
  const { long, short } = messageSearchTokens(query);
  if (long.length === 0) return null;
  // Two-character CJK words are too short for trigrams.
  const indexed = hasIndex && long.every((token) => Array.from(token).length >= 3);
  return {
    match: indexed ? long.map((token) => `"${token.replaceAll('"', '""')}"`).join(" ") : null,
    substrings: indexed ? short : [...long, ...short],
  };
}

const MARKDOWN_LINK = /!?\[([^\]\n]*)\]\(([^)\s]*)\)/g;
const quoteSearchToken = (token: string) => `"${token.replaceAll('"', '""')}"`;
const fuzzyIndexTokens = (tokens: ReadonlyArray<string>, includeFragments = true) =>
  tokens
    .map(
      (word) => `(${fuzzySearchSeeds(word, includeFragments).map(quoteSearchToken).join(" OR ")})`,
    )
    .join(" AND ");
const fuzzyIndexQuery = (query: string, includeFragments: boolean) => {
  const { long } = messageSearchTokens(query);
  if (long.length === 0 || long.length > 8 || long.some((word) => Array.from(word).length < 3)) {
    return null;
  }
  return long.some((word) => fuzzySearchSeeds(word, includeFragments).length > 1)
    ? fuzzyIndexTokens(long, includeFragments)
    : null;
};

// Result rows show one line, so the match must sit near the start to be seen.
const SNIPPET_LEAD = 24;

const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * Up to 240 characters starting a few words before the match at `matchStart`,
 * whitespace collapsed, with ellipses where the text was cut. The client finds
 * the highlights again in the result.
 */
export function buildSearchSnippet(text: string, matchStart: number): string {
  let start = Math.max(0, matchStart - SNIPPET_LEAD);
  const wordStart = text.slice(start, matchStart).search(/\s/);
  if (start > 0 && wordStart !== -1) start += wordStart + 1;
  // Cut between characters, not inside an emoji's surrogate pair.
  if (isLowSurrogate(text.charCodeAt(start))) start++;
  // Collapsing whitespace shortens the text, so read more of it.
  const rawEnd = Math.min(text.length, start + SNIPPET_LENGTH * 2);
  // Emphasis and code marks do not show in a thread either.
  const shown = text
    .slice(start, rawEnd)
    .replace(/\*\*|`+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  let end = Math.min(shown.length, SNIPPET_LENGTH - 2);
  if (isLowSurrogate(shown.charCodeAt(end))) end--;
  const cut = end < shown.length || rawEnd < text.length;
  return `${start > 0 ? "…" : ""}${shown.slice(0, end)}${cut ? "…" : ""}`;
}

// Filter hidden subagents and side chats before the hit limit so visible matches aren't lost.
// Word starts and ranking follow the title rules in JS.
// Without FTS5 trigrams, or for two-character CJK words, scan the same eligible messages.
// The scan folds ASCII case only, so accent variants and non-ASCII case variants may not match.
export const messageHitsQuery = (
  sql: SqlClient.SqlClient,
  {
    match,
    substrings,
    projectId,
    excludedThreadIds,
    includeArchived = false,
    candidateLimit = MESSAGE_CANDIDATE_LIMIT,
    hitLimit = MESSAGE_HIT_LIMIT,
    textLimit,
  }: typeof SearchRequest.Encoded,
) => sql`
    WITH eligible AS (
      SELECT threads.thread_id, threads.project_id
      FROM orchestration_v2_projection_threads AS threads
      INNER JOIN projection_projects AS projects
        ON projects.project_id = threads.project_id
      WHERE threads.deleted_at IS NULL
        AND (${includeArchived ? 1 : 0} = 1 OR threads.archived_at IS NULL)
        AND projects.deleted_at IS NULL
        AND (${projectId} IS NULL OR threads.project_id = ${projectId})
        AND threads.thread_id NOT IN (SELECT value FROM json_each(${excludedThreadIds}))
        AND json_extract(threads.payload_json, '$.lineage.relationshipToParent')
          IS NOT 'subagent'
        AND json_extract(threads.payload_json, '$.lineage.sideChat') IS NOT 1
    )
    ${
      match === null
        ? sql`
          SELECT
            messages.rowid AS "messageRowid",
            messages.message_id AS "messageId",
            messages.thread_id AS "threadId",
            eligible.project_id AS "projectId",
            messages.role AS source,
            ${textLimit === undefined ? sql`json_extract(messages.payload_json, '$.text')` : sql`substr(json_extract(messages.payload_json, '$.text'), 1, ${textLimit})`} AS text,
            messages.created_at AS "messageCreatedAt"
          FROM orchestration_v2_projection_messages AS messages
          INNER JOIN eligible ON eligible.thread_id = messages.thread_id
          WHERE ${indexedMessageCondition(sql)}
            -- A scan reads every message it passes, so it stops at the newest ones.
            AND messages.rowid > (
              SELECT coalesce(max(rowid), 0) FROM orchestration_v2_projection_messages
            ) - ${MESSAGE_SCAN_LIMIT}
        `
        : sql`
          SELECT
            orchestration_v2_message_search.rowid AS "messageRowid",
            messages.message_id AS "messageId",
            messages.thread_id AS "threadId",
            eligible.project_id AS "projectId",
            messages.role AS source,
            ${textLimit === undefined ? sql`json_extract(messages.payload_json, '$.text')` : sql`substr(json_extract(messages.payload_json, '$.text'), 1, ${textLimit})`} AS text,
            messages.created_at AS "messageCreatedAt"
          FROM orchestration_v2_message_search
          INNER JOIN orchestration_v2_projection_messages AS messages
            ON messages.rowid = orchestration_v2_message_search.rowid
          INNER JOIN eligible ON eligible.thread_id = messages.thread_id
          WHERE orchestration_v2_message_search MATCH ${match}
            AND orchestration_v2_message_search.rowid >= coalesce((
              SELECT orchestration_v2_message_search.rowid FROM orchestration_v2_message_search
              WHERE orchestration_v2_message_search MATCH ${match}
              ORDER BY orchestration_v2_message_search.rowid DESC
              LIMIT 1 OFFSET ${candidateLimit - 1}
            ), 0)
            AND ${nonPlaceholderMessageCondition(sql)}
        `
    }
      -- Answers to an agent's question show inside its question card, where
      -- neither find nor a jump can reach them.
      AND messages.message_id NOT LIKE 'async-answer:%'
      AND NOT EXISTS (
        SELECT 1 FROM json_each(${substrings}) AS token
        WHERE instr(lower(json_extract(messages.payload_json, '$.text')), token.value) = 0
      )
    -- The index's own rowid, so FTS5 returns hits newest first and stops at
    -- the limit; ordering by the messages table's rowid sorts every hit.
    ORDER BY "messageRowid" DESC
    LIMIT ${hitLimit}
  `;

const TitleCandidateRow = Schema.Struct({
  thread: Schema.fromJsonString(OrchestrationV2AppThreadJson),
  projectTitle: Schema.String,
  latestUserMessageAt: Schema.NullOr(IsoDateTime),
});

export interface ThreadSearchHit {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly source: "title" | OrchestrationThreadSearchSource;
  readonly snippet?: string;
  readonly messageCreatedAt?: string | null;
}

export class ThreadSearch extends Context.Service<
  ThreadSearch,
  {
    /** Message text matches, for clients that rank their own thread list. */
    readonly search: (
      input: ThreadSearchInput,
    ) => Effect.Effect<OrchestrationSearchThreadsResult, ThreadSearchError>;
    /**
     * Title, branch, pull request, and project matches ranked as the command
     * palette ranks them, then message matches for the remaining threads.
     */
    readonly searchThreads: (
      input: ThreadSearchInput & { readonly projectId?: ProjectId | undefined },
    ) => Effect.Effect<{ readonly matches: ReadonlyArray<ThreadSearchHit> }, ThreadSearchError>;
    /**
     * The settled threads before `before` that clients omitting older settled threads should
     * receive for a query: the best title, branch, pull request and project matches, ranked as
     * the palette ranks them, then the older ones among `messageThreadIds`, in their order.
     */
    readonly searchOlderSettled: (input: {
      readonly query: string;
      readonly before: string;
      readonly projectIds?: ReadonlyArray<ProjectId> | undefined;
      /** The caller's name for this environment, which its palette also matches. */
      readonly environmentLabel?: string | undefined;
      readonly messageThreadIds: ReadonlyArray<ThreadId>;
    }) => Effect.Effect<ReadonlyArray<ThreadId>, ThreadSearchError>;
    readonly searchAll: (input: {
      readonly query: string;
      readonly projectIds?: ReadonlyArray<ProjectId> | undefined;
      readonly environmentLabel?: string | undefined;
      readonly messageThreadIds: ReadonlyArray<ThreadId>;
    }) => Effect.Effect<ReadonlyArray<ThreadId>, ThreadSearchError>;
  }
>()("t3/orchestration-v2/ThreadSearch") {}

// Rows a client gets per search: enough for the shown results without sending every match.
const OLDER_SETTLED_TITLE_ROWS = 15;
const OLDER_SETTLED_MESSAGE_ROWS = 5;

// Only the fields the palette scorer reads, so an interactive search does not decode payloads.
const MetadataCandidateRow = Schema.Struct({
  id: ThreadId,
  title: Schema.String,
  branch: Schema.NullOr(Schema.String),
  pullRequests: Schema.NullOr(Schema.fromJsonString(Schema.Array(ThreadPullRequestLink))),
  linkedPullRequest: Schema.NullOr(Schema.fromJsonString(ThreadLinkedPullRequest)),
  branchPullRequest: Schema.NullOr(Schema.fromJsonString(ThreadLinkedPullRequest)),
  opens: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  projectTitle: Schema.String,
  latestUserMessageAt: Schema.NullOr(IsoDateTime),
});

/** @public */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const searchRows = SqlSchema.findAll({
    Request: SearchRequest,
    Result: SearchRow,
    execute: (request) => messageHitsQuery(sql, request),
  });

  const threadOpens = SqlSchema.findAll({
    Request: Schema.Struct({ threadIds: TokenList }),
    Result: ThreadOpensRow,
    execute: ({ threadIds }) => sql`
      SELECT
        threads.thread_id AS "threadId",
        json_extract(threads.payload_json, '$.opens') AS opens,
        ${latestUserMessageAt(sql)} AS "latestUserMessageAt"
      FROM orchestration_v2_projection_threads AS threads
      WHERE threads.thread_id IN (SELECT value FROM json_each(${threadIds}))
    `,
  });

  const titleCandidates = SqlSchema.findAll({
    Request: Schema.Struct({
      projectId: Schema.NullOr(ProjectId),
      includeArchived: Schema.Boolean,
    }),
    Result: TitleCandidateRow,
    execute: ({ projectId, includeArchived }) => sql`
      SELECT
        threads.payload_json AS thread,
        projects.title AS "projectTitle",
        ${latestUserMessageAt(sql)} AS "latestUserMessageAt"
      FROM orchestration_v2_projection_threads AS threads
      INNER JOIN projection_projects AS projects
        ON projects.project_id = threads.project_id
      WHERE threads.deleted_at IS NULL
        AND (${includeArchived ? 1 : 0} = 1 OR threads.archived_at IS NULL)
        AND projects.deleted_at IS NULL
        AND json_extract(threads.payload_json, '$.lineage.relationshipToParent')
          IS NOT 'subagent'
        AND json_extract(threads.payload_json, '$.lineage.sideChat') IS NOT 1
        AND (${projectId} IS NULL OR threads.project_id = ${projectId})
    `,
  });

  const metadataCandidates = SqlSchema.findAll({
    Request: Schema.Struct({
      before: Schema.NullOr(Schema.String),
      projectIds: Schema.NullOr(TokenList),
      threadIds: Schema.optionalKey(TokenList),
      includeArchived: Schema.optionalKey(Schema.Boolean),
    }),
    Result: MetadataCandidateRow,
    execute: ({ before, projectIds, threadIds, includeArchived = false }) => sql`
      SELECT
        threads.thread_id AS id,
        json_extract(threads.payload_json, '$.title') AS title,
        json_extract(threads.payload_json, '$.branch') AS branch,
        json_extract(threads.payload_json, '$.pullRequests') AS "pullRequests",
        json_extract(threads.payload_json, '$.linkedPullRequest') AS "linkedPullRequest",
        json_extract(threads.payload_json, '$.branchPullRequest') AS "branchPullRequest",
        json_extract(threads.payload_json, '$.opens') AS opens,
        json_extract(threads.payload_json, '$.createdAt') AS "createdAt",
        projects.title AS "projectTitle",
        ${latestUserMessageAt(sql)} AS "latestUserMessageAt"
      FROM orchestration_v2_projection_threads AS threads
      INNER JOIN projection_projects AS projects
        ON projects.project_id = threads.project_id
      WHERE threads.deleted_at IS NULL
        AND (${includeArchived ? 1 : 0} = 1 OR threads.archived_at IS NULL)
        AND projects.deleted_at IS NULL
        AND json_extract(threads.payload_json, '$.lineage.relationshipToParent')
          IS NOT 'subagent'
        AND json_extract(threads.payload_json, '$.lineage.sideChat') IS NOT 1
        ${
          before === null
            ? sql``
            : sql`
          AND json_extract(threads.payload_json, '$.settledOverride') = 'settled'
          AND json_extract(threads.payload_json, '$.settledAt') < ${before}
        `
        }
        AND (${projectIds} IS NULL
          OR threads.project_id IN (SELECT value FROM json_each(${projectIds})))
        ${threadIds === undefined ? sql`` : sql`AND threads.thread_id IN (SELECT value FROM json_each(${threadIds}))`}
    `,
  });

  const olderSettledIds = SqlSchema.findAll({
    Request: Schema.Struct({
      before: Schema.String,
      threadIds: TokenList,
      projectIds: Schema.NullOr(TokenList),
    }),
    Result: Schema.Struct({ id: ThreadId }),
    execute: ({ before, threadIds, projectIds }) => sql`
      SELECT threads.thread_id AS id
      FROM orchestration_v2_projection_threads AS threads
      WHERE threads.thread_id IN (SELECT value FROM json_each(${threadIds}))
        AND threads.deleted_at IS NULL
        AND json_extract(threads.payload_json, '$.archivedAt') IS NULL
        AND json_extract(threads.payload_json, '$.lineage.relationshipToParent')
          IS NOT 'subagent'
        AND json_extract(threads.payload_json, '$.lineage.sideChat') IS NOT 1
        AND json_extract(threads.payload_json, '$.settledOverride') = 'settled'
        AND json_extract(threads.payload_json, '$.settledAt') < ${before}
        AND (${projectIds} IS NULL
          OR threads.project_id IN (SELECT value FROM json_each(${projectIds})))
    `,
  });

  const read = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    sql.withTransaction(effect).pipe(
      NodeSqliteClient.readOnly,
      Effect.mapError(
        (cause) =>
          new ThreadSearchError({
            operation: Schema.isSchemaError(cause) ? "decode" : "query",
            cause,
          }),
      ),
    );

  // A project scope applies before ranking, so other projects' stronger hits
  // cannot use up the limit.
  const searchMessages = Effect.fn("ThreadSearch.search")(function* (
    input: ThreadSearchInput & {
      readonly projectId: ProjectId | null;
      /** Threads the caller already lists, which must not use up the limit. */
      readonly excludedThreadIds?: ReadonlySet<ThreadId>;
      /** Off for an agent's search, which has no use for the user's picks. */
      readonly picks?: boolean;
    },
  ) {
    // One message per thread: the best word match, then what the user wrote,
    // since that is what they remember asking, then the newest by when it was
    // written. Row order is not age: imported histories arrive in one batch.
    // Text relevance (bm25) would cost a pass over every hit in history.
    type Hit = {
      readonly row: typeof SearchRow.Type;
      /** The message as it reads, links as their text. */
      readonly text: string;
      readonly quality: number;
      readonly offset: number;
      readonly matchedQuery?: string;
    };
    const newer = (left: Hit, right: Hit) =>
      (right.row.messageCreatedAt ?? "").localeCompare(left.row.messageCreatedAt ?? "");
    const compareHits = (left: Hit, right: Hit) =>
      right.quality - left.quality ||
      Number(left.row.source !== "user") - Number(right.row.source !== "user") ||
      newer(left, right);
    const { rows, hasIndex } = yield* read(
      Effect.gen(function* () {
        const index = yield* sql`
          SELECT 1 FROM sqlite_master WHERE name = 'orchestration_v2_message_search'
        `;
        const messageSearch = buildMessageSearch(input.query, index.length > 0);
        return {
          hasIndex: index.length > 0,
          rows:
            messageSearch === null
              ? []
              : yield* searchRows({
                  ...messageSearch,
                  projectId: input.projectId,
                  includeArchived: input.includeArchived ?? false,
                  excludedThreadIds: [...(input.excludedThreadIds ?? [])],
                }),
        };
      }),
    );
    const best = new Map<ThreadId, Hit>();
    // Matching messages per thread at its best quality: a thread that keeps
    // using the word ranks above a passing mention, and weaker hits ("Trust"
    // for "rust") never add to a whole word's count.
    const hitCounts = new Map<ThreadId, number>();
    const hitCount = (threadId: ThreadId) => hitCounts.get(threadId) ?? 1;
    const addRows = (rows: ReadonlyArray<typeof SearchRow.Type>, fuzzy: boolean) => {
      const matchMessage = fuzzy ? fuzzyMessageMatcher(input.query) : messageMatcher(input.query);
      for (const row of rows) {
        let text = row.text.replace(MARKDOWN_LINK, "$1");
        let match = matchMessage(text);
        let linkLabel: string | undefined;
        if (match === null) {
          text = row.text.replace(MARKDOWN_LINK, "$1 ($2)");
          match = matchMessage(text);
          if (match !== null) {
            linkLabel = Array.from(row.text.matchAll(MARKDOWN_LINK))
              .find((link) => matchMessage(link[2]!) !== null)?.[1]
              ?.trim()
              .slice(0, 200);
          }
        }
        if (match === null) continue;
        const hit: Hit = { row, text, ...match, ...(linkLabel ? { matchedQuery: linkLabel } : {}) };
        const current = best.get(row.threadId);
        if (current === undefined || hit.quality > current.quality) {
          hitCounts.set(row.threadId, 1);
        } else if (hit.quality === current.quality) {
          hitCounts.set(row.threadId, hitCount(row.threadId) + 1);
        }
        if (current === undefined || compareHits(hit, current) < 0) best.set(row.threadId, hit);
      }
    };
    addRows(rows, false);
    for (const includeFragments of [false, true]) {
      if (input.fuzzy !== true || !hasIndex || best.size >= 10) break;
      const fuzzyQuery = fuzzyIndexQuery(input.query, includeFragments);
      if (fuzzyQuery === null) continue;
      const candidates = yield* read(
        searchRows({
          match: fuzzyQuery,
          substrings: messageSearchTokens(input.query).short,
          projectId: input.projectId,
          excludedThreadIds: [...(input.excludedThreadIds ?? []), ...best.keys()],
          includeArchived: input.includeArchived ?? false,
          candidateLimit: 1024,
          hitLimit: 128,
          textLimit: 16384,
        }),
      );
      addRows(candidates, true);
    }
    // Ranked as clients rank them, with picks and use, before the limit cuts:
    // a thread picked for this query must come back even when it only
    // matches in a few old messages.
    const opens = best.size === 0 ? [] : yield* read(threadOpens({ threadIds: [...best.keys()] }));
    const subjectById = new Map(
      opens.map((row) => [
        row.threadId,
        {
          title: "",
          activityAt: row.latestUserMessageAt === null ? null : Date.parse(row.latestUserMessageAt),
          opens: Option.getOrNull(decodeThreadOpens(row.opens)),
        },
      ]),
    );
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    const ranked = rankMessageMatches(
      [...best.values()].map((hit) => ({
        ...hit,
        hits: hitCount(hit.row.threadId),
        messageCreatedAt: hit.row.messageCreatedAt,
      })),
      (hit) => subjectById.get(hit.row.threadId),
      foldSearchQuery(input.query),
      now,
      { picks: input.picks ?? true },
    );
    return {
      matches: ranked
        .slice(0, input.limit ?? 50)
        .map(({ row, text, quality, offset, matchedQuery }) => ({
          hits: hitCount(row.threadId),
          threadId: row.threadId,
          messageId: row.messageId,
          projectId: row.projectId,
          source: row.source,
          snippet: buildSearchSnippet(text, offset),
          messageCreatedAt: row.messageCreatedAt,
          quality,
          ...(matchedQuery === undefined ? {} : { matchedQuery }),
        })),
    };
  });

  const search: ThreadSearch["Service"]["search"] = (input) =>
    searchMessages({ ...input, projectId: null });

  const searchThreads: ThreadSearch["Service"]["searchThreads"] = Effect.fn(
    "ThreadSearch.searchThreads",
  )(function* (input) {
    const limit = input.limit ?? 50;
    const normalizedQuery = foldSearchQuery(input.query);
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    // Agents call this rarely, and a project has hundreds of threads, not
    // millions, so ranking every active thread in memory stays cheap.
    const candidates = yield* read(
      titleCandidates({
        projectId: input.projectId ?? null,
        includeArchived: input.includeArchived ?? false,
      }),
    );
    const subjectById = new Map(
      candidates.map((row): [ThreadId, ThreadSearchSubject] => [
        row.thread.id,
        {
          id: row.thread.id,
          title: row.thread.title,
          branch: row.thread.branch,
          projectTitle: row.projectTitle,
          pullRequests: threadSearchPullRequests(row.thread),
          // Like the clients: what the user last wrote, else when the thread began.
          activityAt: Date.parse(
            row.latestUserMessageAt ?? DateTime.formatIso(row.thread.createdAt),
          ),
          opens: row.thread.opens ?? null,
        },
      ]),
    );
    const titleHits: ThreadSearchHit[] = rankSearchItems(candidates, (row, options) =>
      // An agent's search has no use for the user's palette picks.
      scoreThreadSearch(normalizedQuery, subjectById.get(row.thread.id)!, now, {
        ...options,
        picks: false,
      }),
    )
      .slice(0, limit)
      .map(({ item }) => ({
        threadId: item.thread.id,
        projectId: item.thread.projectId,
        title: item.thread.title,
        source: "title",
      }));
    const shown = new Set(titleHits.map((hit) => hit.threadId));
    const { matches } = yield* searchMessages({
      query: input.query,
      limit: 50,
      projectId: input.projectId ?? null,
      excludedThreadIds: shown,
      picks: false,
      includeArchived: input.includeArchived ?? false,
      fuzzy: input.fuzzy ?? false,
    });
    const messageHits = matches
      .filter((match) => subjectById.has(match.threadId))
      .map(({ quality: _quality, hits: _hits, messageId: _messageId, ...match }) => ({
        ...match,
        title: subjectById.get(match.threadId)!.title,
      }));
    // Titles come first, but a fifth of the slots stay for message matches,
    // as the palette keeps its "In messages" section.
    const messageSlots = Math.min(messageHits.length, Math.floor(limit / 5));
    return {
      matches: [...titleHits.slice(0, limit - messageSlots), ...messageHits].slice(0, limit),
    };
  });

  const searchOlderSettled: ThreadSearch["Service"]["searchOlderSettled"] = Effect.fn(
    "ThreadSearch.searchOlderSettled",
  )(function* ({ query, before, projectIds, environmentLabel, messageThreadIds }) {
    const normalizedQuery = foldSearchQuery(query);
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    const candidates = yield* read(metadataCandidates({ before, projectIds: projectIds ?? null }));
    const subjectOf = (row: typeof MetadataCandidateRow.Type): ThreadSearchSubject => ({
      id: row.id,
      title: row.title,
      branch: row.branch,
      projectTitle: row.projectTitle,
      environmentLabel: environmentLabel ?? null,
      pullRequests: threadSearchPullRequests({
        pullRequests: row.pullRequests ?? undefined,
        linkedPullRequest: row.linkedPullRequest,
        branchPullRequest: row.branchPullRequest,
      }),
      // Like the clients: what the user last wrote, else when the thread began.
      activityAt: Date.parse(row.latestUserMessageAt ?? row.createdAt),
      opens: Option.getOrNull(decodeThreadOpens(row.opens)),
    });
    // Picks on, as in the command palette: a thread picked for this query must make the cut.
    const titleIds = rankSearchItems(candidates, (row, options) =>
      scoreThreadSearch(normalizedQuery, subjectOf(row), now, { ...options, picks: true }),
    )
      .slice(0, OLDER_SETTLED_TITLE_ROWS)
      .map(({ item }) => item.id);
    const shown = new Set(titleIds);
    const messageCandidates = [...new Set(messageThreadIds)].filter((id) => !shown.has(id));
    const older =
      messageCandidates.length === 0
        ? new Set<ThreadId>()
        : new Set(
            (yield* read(
              olderSettledIds({
                before,
                threadIds: messageCandidates,
                projectIds: projectIds ?? null,
              }),
            )).map((row) => row.id),
          );
    return [
      ...titleIds,
      ...messageCandidates.filter((id) => older.has(id)).slice(0, OLDER_SETTLED_MESSAGE_ROWS),
    ];
  });

  const searchAll: ThreadSearch["Service"]["searchAll"] = Effect.fn("ThreadSearch.searchAll")(
    function* ({ query, projectIds, environmentLabel, messageThreadIds }) {
      const normalizedQuery = foldSearchQuery(query);
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      const { long } = messageSearchTokens(query);
      const prNumber = /(?:^|#|\/pull\/|\/merge_requests\/)(\d+)$/.exec(query.trim())?.[1];
      const tokens = prNumber
        ? [`pr${prNumber}`]
        : long.filter((word) => Array.from(word).length >= 3).slice(0, 8);
      const index = yield* read(sql`
        SELECT 1 FROM sqlite_master WHERE name = 'orchestration_v2_thread_search'
      `);
      const indexedIds = (match: string | null, limit: number) =>
        read(sql<{ id: string }>`
        SELECT thread_id AS id FROM orchestration_v2_projection_threads
        WHERE rowid IN (${
          match === null || index.length === 0
            ? sql`SELECT rowid FROM orchestration_v2_projection_threads ORDER BY rowid DESC LIMIT ${limit}`
            : sql`SELECT rowid FROM orchestration_v2_thread_search
                  WHERE orchestration_v2_thread_search MATCH ${match}
                  ORDER BY rowid DESC LIMIT ${limit}`
        })
      `);
      const ids = new Set<ThreadId>(
        (yield* indexedIds(
          tokens.length > 0 ? tokens.map(quoteSearchToken).join(" AND ") : null,
          1000,
        )).map((row) => ThreadId.make(row.id)),
      );
      const projects = yield* read(sql<{ id: string; title: string }>`
        SELECT project_id AS id, title FROM projection_projects WHERE deleted_at IS NULL
      `);
      const contextTokens = tokens.filter(
        (token) =>
          scoreSearchTerms(foldSearchQuery(token), [
            environmentLabel ?? "",
            ...projects.map((project) => project.title),
          ]) === null,
      );
      if (contextTokens.length > 0 && contextTokens.length < tokens.length) {
        const rows = yield* indexedIds(contextTokens.map(quoteSearchToken).join(" AND "), 256);
        for (const row of rows) ids.add(ThreadId.make(row.id));
      }
      const matchingProjects = projects
        .filter(
          (project) =>
            scoreSearchTerms(normalizedQuery, [project.title, environmentLabel ?? ""]) !== null &&
            (projectIds === undefined || projectIds.includes(ProjectId.make(project.id))),
        )
        .slice(0, 4);
      for (const project of matchingProjects) {
        const rows = yield* read(sql<{ id: string }>`
          SELECT thread_id AS id FROM orchestration_v2_projection_threads
          WHERE project_id = ${project.id} AND deleted_at IS NULL
          ORDER BY updated_at DESC LIMIT 250
        `);
        for (const row of rows) ids.add(ThreadId.make(row.id));
      }
      const candidatesFor = (threadIds: ReadonlyArray<ThreadId>) =>
        read(
          metadataCandidates({
            before: null,
            projectIds: projectIds ?? null,
            threadIds,
            includeArchived: true,
          }),
        );
      const rank = (rows: ReadonlyArray<typeof MetadataCandidateRow.Type>) =>
        rankSearchItems(rows, (row, options) =>
          scoreThreadSearch(
            normalizedQuery,
            {
              id: row.id,
              title: row.title,
              branch: row.branch,
              projectTitle: row.projectTitle,
              environmentLabel: environmentLabel ?? null,
              pullRequests: threadSearchPullRequests({
                pullRequests: row.pullRequests ?? undefined,
                linkedPullRequest: row.linkedPullRequest,
                branchPullRequest: row.branchPullRequest,
              }),
              activityAt: Date.parse(row.latestUserMessageAt ?? row.createdAt),
              opens: Option.getOrNull(decodeThreadOpens(row.opens)),
            },
            now,
            options,
          ),
        );
      const candidates = [...(yield* candidatesFor([...ids]))];
      let ranked = rank(candidates);
      const fuzzyTokens = contextTokens.length > 0 ? contextTokens : tokens;
      for (const includeFragments of [false, true]) {
        if (ranked.length >= 20 || index.length === 0) break;
        if (!fuzzyTokens.some((token) => fuzzySearchSeeds(token, includeFragments).length > 1))
          continue;
        const fuzzy = fuzzyIndexTokens(fuzzyTokens, includeFragments);
        const extra = (yield* indexedIds(fuzzy, 256))
          .map((row) => ThreadId.make(row.id))
          .filter((id) => !ids.has(id));
        for (const id of extra) ids.add(id);
        candidates.push(...(yield* candidatesFor(extra)));
        ranked = rank(candidates);
      }
      const titleIds = ranked.slice(0, 20).map(({ item }) => item.id);
      const titles = new Set(titleIds);
      const messages = yield* candidatesFor(messageThreadIds.filter((id) => !titles.has(id)));
      const eligibleMessages = new Set(messages.map((row) => row.id));
      return [
        ...titleIds,
        ...messageThreadIds.filter((id) => eligibleMessages.has(id)).slice(0, 10),
      ];
    },
  );

  return ThreadSearch.of({ search, searchThreads, searchOlderSettled, searchAll });
});

export const layer = Layer.effect(ThreadSearch, make);

/**
 * The client search: message hits, and with `olderSettledBefore`, the rows of the best older
 * settled matches, which shells that omit them do not hold.
 */
export const searchThreadsWithOlderSettledRows = Effect.fn(
  "ThreadSearch.searchThreadsWithOlderSettledRows",
)(function* <E1, E2, E3, E4, E5>(input: {
  readonly request: OrchestrationV2SearchThreadsInput;
  readonly search: (
    input: ThreadSearchInput,
  ) => Effect.Effect<OrchestrationSearchThreadsResult, E1>;
  readonly searchOlderSettled: (
    input: Parameters<ThreadSearch["Service"]["searchOlderSettled"]>[0],
  ) => Effect.Effect<ReadonlyArray<ThreadId>, E2>;
  readonly searchAll: ThreadSearch["Service"]["searchAll"];
  readonly sql: SqlClient.SqlClient;
  readonly readThreads: (
    threadIds: ReadonlyArray<ThreadId>,
  ) => Effect.Effect<Effect.Effect<OrchestrationV2ThreadShellSnapshot, E4>, E3>;
  readonly latestSequence: Effect.Effect<number, E5>;
}) {
  const { olderSettledBefore, projectIds, environmentLabel, titlesOnly, ...request } =
    input.request;
  const messages: OrchestrationV2SearchThreadsResult =
    titlesOnly === true ? { matches: [] } : yield* input.search(request);
  if (olderSettledBefore === undefined && request.includeArchived !== true) return messages;
  // Ranked before the rows' transaction, so scoring never holds the shared reader.
  const threadIds =
    request.includeArchived === true
      ? yield* input.searchAll({
          query: request.query,
          projectIds,
          environmentLabel,
          messageThreadIds: messages.matches.map((match) => match.threadId),
        })
      : yield* input.searchOlderSettled({
          query: request.query,
          before: olderSettledBefore!,
          projectIds,
          environmentLabel,
          messageThreadIds: messages.matches.map((match) => match.threadId),
        });
  const older = yield* loadOlderSettledThreadsPage({
    sql: input.sql,
    listThreads: Effect.succeed({ threadIds, counts: [] }),
    readThreads: (threadIds) =>
      input.readThreads(threadIds).pipe(
        Effect.map((decode) =>
          request.includeArchived === true
            ? decode.pipe(
                Effect.map((snapshot) => ({
                  ...snapshot,
                  threads: [...snapshot.threads, ...snapshot.archivedThreads],
                })),
              )
            : decode,
        ),
      ),
    latestSequence: input.latestSequence,
  });
  return { ...messages, snapshotSequence: older.snapshotSequence, threads: older.threads };
});
