import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as Jira from "./JiraClient.ts";
import { parseJiraTicket } from "./JiraClient.ts";

it("reads Jira Cloud's document format without losing acceptance criteria", () => {
  const ticket = parseJiraTicket(
    {
      key: "RD-123",
      fields: {
        summary: "Health endpoint",
        updated: "2026-11-01T00:00:00Z",
        status: { name: "To Do" },
        description: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Return service status." }] },
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "Test failures." }] },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
    "https://example.atlassian.net",
  );
  assert.strictEqual(ticket.description, "Return service status.\nTest failures.");
  assert.strictEqual(ticket.url, "https://example.atlassian.net/browse/RD-123");
  assert.throws(() =>
    parseJiraTicket({ key: "../../secrets", fields: {} }, "https://example.atlassian.net"),
  );
});

it.effect(
  "uses the configured Jira origin and rejects redirects without exposing server responses",
  () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const http = HttpClient.make((request) =>
        Effect.sync(() => {
          calls.push(request.url);
          return HttpClientResponse.fromWeb(
            request,
            new Response("private upstream response", {
              status: 302,
              headers: { location: "https://elsewhere.example" },
            }),
          );
        }),
      );
      const dependencies = Layer.mergeAll(
        Layer.succeed(HttpClient.HttpClient, http),
        ConfigProvider.layer(
          ConfigProvider.fromEnv({
            env: {
              VALHALLA2_JIRA_URL: "https://example.atlassian.net",
              VALHALLA2_JIRA_EMAIL: "engineer@example.com",
              VALHALLA2_JIRA_TOKEN: "fake-test-token",
            },
          }),
        ),
      );
      yield* Effect.gen(function* () {
        const jira = yield* Jira.JiraClient;
        assert.isTrue(jira.configured);
        const error = yield* jira.inspect({ ticketKey: "RD-123" }).pipe(Effect.flip);
        assert.strictEqual(error.reason, "unavailable");
        assert.notInclude(error.message, "private");
        assert.deepEqual(calls, [
          "https://example.atlassian.net/rest/api/3/issue/RD-123?fields=summary,description,updated,status",
        ]);
        yield* jira.inspect({ ticketKey: "../../different" }).pipe(Effect.flip);
        assert.strictEqual(calls.length, 1);
      }).pipe(Effect.provide(Jira.layer.pipe(Layer.provide(dependencies))));
    }),
);
