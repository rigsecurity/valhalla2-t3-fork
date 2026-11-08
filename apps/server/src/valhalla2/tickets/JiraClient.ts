import { JiraTicketSchema, type JiraTicket } from "@rig/valhalla2/tickets";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { z } from "zod";

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const JiraDocument = z.object({
  type: z.string(),
  text: z.string().optional(),
  get content(): z.ZodOptional<z.ZodArray<typeof JiraDocument>> {
    return z.array(JiraDocument).optional();
  },
});

const JiraResponse = z.object({
  key: JiraTicketSchema.shape.key,
  fields: z.object({
    summary: JiraTicketSchema.shape.title,
    description: z.union([z.string(), JiraDocument]).nullable().optional(),
    updated: z.string().min(1),
    status: z.object({ name: z.string() }),
  }),
});

function documentText(node: z.infer<typeof JiraDocument>, depth = 0): string {
  if (depth > 30) return "";
  const text =
    node.text ?? node.content?.map((child) => documentText(child, depth + 1)).join("") ?? "";
  return ["paragraph", "heading", "listItem", "hardBreak"].includes(node.type) ? `${text}\n` : text;
}

export function parseJiraTicket(input: unknown, origin: string): JiraTicket {
  const issue = JiraResponse.parse(input);
  return JiraTicketSchema.parse({
    key: issue.key,
    title: issue.fields.summary,
    description:
      typeof issue.fields.description === "string"
        ? issue.fields.description
        : issue.fields.description
          ? documentText(issue.fields.description).trim()
          : "",
    updatedAt: issue.fields.updated,
    status: issue.fields.status.name,
    url: `${origin}/browse/${encodeURIComponent(issue.key)}`,
  });
}

export class JiraError extends Schema.TaggedError<JiraError>()("ValhallaJiraError", {
  reason: Schema.Literals([
    "not_configured",
    "invalid_request",
    "unavailable",
    "not_found",
    "unauthorized",
    "invalid_response",
  ]),
}) {
  override get message(): string {
    switch (this.reason) {
      case "not_configured":
        return "Set the Jira URL, email and API token on this server to read tickets.";
      case "invalid_request":
        return "Enter a Jira ticket key such as RD-123.";
      case "not_found":
        return "That Jira ticket was not found or is not visible to this account.";
      case "unauthorized":
        return "Jira did not accept the configured credentials.";
      case "invalid_response":
        return "Jira returned a ticket format Valhalla could not read.";
      case "unavailable":
        return "Jira could not be reached. Try again shortly.";
    }
  }
}

export class JiraClient extends Context.Service<
  JiraClient,
  {
    readonly configured: boolean;
    readonly inspect: (input: {
      readonly ticketKey: string;
    }) => Effect.Effect<JiraTicket, JiraError>;
  }
>()("t3/valhalla2/tickets/JiraClient") {}

const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;
  const base = yield* Config.String("VALHALLA2_JIRA_URL").pipe(Config.option);
  const email = yield* Config.Redacted("VALHALLA2_JIRA_EMAIL").pipe(Config.option);
  const token = yield* Config.Redacted("VALHALLA2_JIRA_TOKEN").pipe(Config.option);
  const parsed = Option.isSome(base) ? z.url().safeParse(base.value) : null;
  const candidate = parsed?.success ? new URL(parsed.data) : null;
  const origin =
    candidate?.protocol === "https:" &&
    !candidate.username &&
    !candidate.password &&
    !candidate.search &&
    !candidate.hash &&
    ["", "/"].includes(candidate.pathname)
      ? candidate.origin
      : null;
  const configured = origin !== null && Option.isSome(email) && Option.isSome(token);

  const inspect = Effect.fn("JiraClient.inspect")(
    function* (input: { readonly ticketKey: string }) {
      const key = JiraTicketSchema.shape.key.safeParse(input.ticketKey);
      if (!key.success) return yield* new JiraError({ reason: "invalid_request" });
      if (origin === null || Option.isNone(email) || Option.isNone(token)) {
        return yield* new JiraError({ reason: "not_configured" });
      }
      const response = yield* http
        .execute(
          HttpClientRequest.get(
            `${origin}/rest/api/3/issue/${encodeURIComponent(key.data)}?fields=summary,description,updated,status`,
          ).pipe(
            HttpClientRequest.setHeader("accept", "application/json"),
            HttpClientRequest.basicAuth(email.value, token.value),
          ),
        )
        .pipe(
          Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
          Effect.mapError(() => new JiraError({ reason: "unavailable" })),
        );
      if (response.status === 404) return yield* new JiraError({ reason: "not_found" });
      if (response.status === 401 || response.status === 403)
        return yield* new JiraError({ reason: "unauthorized" });
      if (response.status < 200 || response.status >= 300)
        return yield* new JiraError({ reason: "unavailable" });
      const body = yield* response.text.pipe(
        Effect.mapError(() => new JiraError({ reason: "invalid_response" })),
      );
      if (body.length > 250_000) return yield* new JiraError({ reason: "invalid_response" });
      const value = yield* decodeJson(body).pipe(
        Effect.mapError(() => new JiraError({ reason: "invalid_response" })),
      );
      return yield* Effect.try({
        try: () => parseJiraTicket(value, origin),
        catch: () => new JiraError({ reason: "invalid_response" }),
      });
    },
    Effect.timeout("15 seconds"),
    Effect.catchTags({ TimeoutError: () => Effect.fail(new JiraError({ reason: "unavailable" })) }),
  );

  return JiraClient.of({ configured, inspect });
});

export const layer = Layer.effect(JiraClient, make);
