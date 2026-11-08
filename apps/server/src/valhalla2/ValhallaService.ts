import { ValhallaCommandSchema } from "@rig/valhalla2/commands";
import { teamPolicy, type ValhallaSnapshot } from "@rig/valhalla2/contracts";
import { summarizeOutcomes } from "@rig/valhalla2/outcomes";
import { ValhallaSnapshotSchema } from "@rig/valhalla2/snapshot";
import { ValhallaError, type ValhallaSnapshotSection } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Providers from "../provider/ProviderRegistry.ts";
import * as Store from "./ValhallaStore.ts";
import * as Tickets from "./tickets/TicketWorkflow.ts";
import * as Launcher from "./WorkflowLauncher.ts";

export class ValhallaService extends Context.Service<
  ValhallaService,
  {
    readonly snapshot: (
      ownerId: string,
      section?: ValhallaSnapshotSection,
    ) => Effect.Effect<ValhallaSnapshot, ValhallaError>;
    readonly command: (input: unknown, ownerId: string) => Effect.Effect<unknown, ValhallaError>;
  }
>()("t3/valhalla2/ValhallaService") {}

const make = Effect.gen(function* () {
  const store = yield* Store.ValhallaStore;
  const tickets = yield* Tickets.TicketWorkflow;
  const launcher = yield* Launcher.WorkflowLauncher;
  const providers = yield* Providers.ProviderRegistry;
  const attempt = <A>(operation: () => A) =>
    Effect.try({
      try: operation,
      catch: () =>
        new ValhallaError({
          message:
            "The change could not be saved. Check its fields and refresh before retrying; another client may have changed it.",
        }),
    });
  return ValhallaService.of({
    snapshot: Effect.fn("ValhallaService.snapshot")(function* (ownerId, section) {
      const runs =
        !section || section === "tickets"
          ? yield* tickets
              .list(ownerId)
              .pipe(Effect.mapError((error) => new ValhallaError({ message: error.message })))
          : [];
      const includeSkills = !section || section === "workflows";
      const available = includeSkills ? yield* providers.getProviders : [];
      const availableSkills = [
        ...new Set(
          available
            .filter((provider) => provider.enabled)
            .flatMap((provider) =>
              provider.skills
                .filter((skill) => skill.enabled && skill.userInvocable !== false)
                .map((skill) => skill.name),
            ),
        ),
      ].sort();
      return yield* attempt(() => {
        const profiles = store.profilesFor(ownerId);
        const selected = profiles.selected();
        const outcomes = !section || section === "results" ? store.roi.list() : [];
        return ValhallaSnapshotSchema.parse({
          profiles: profiles.list(),
          selectedProfileId: selected.id,
          memory: !section || section === "memory" ? store.memory.list({ limit: 1000 }) : [],
          outcomes,
          roi: summarizeOutcomes(outcomes),
          runs,
          health: {
            jiraConfigured: tickets.jiraConfigured,
            memory: "ready",
            sharedEndpoint: "/mcp",
            availableSkills,
            missingSkills: includeSkills
              ? selected.skills.filter((name) => !availableSkills.includes(name))
              : [],
          },
          policy: teamPolicy,
        });
      });
    }),
    command: Effect.fn("ValhallaService.command")(function* (input, ownerId): Effect.fn.Return<
      unknown,
      ValhallaError
    > {
      const command = yield* Effect.try({
        try: () => ValhallaCommandSchema.parse(input),
        catch: () =>
          new ValhallaError({
            message: "Some fields are missing or invalid. Check the form and try again.",
          }),
      });
      switch (command.type) {
        case "profile.save":
          return yield* attempt(() => store.profilesFor(ownerId).save(command.profile));
        case "profile.select":
          return yield* attempt(() => store.profilesFor(ownerId).select(command.id));
        case "workflow.start":
          return yield* launcher.start(command.input, ownerId);
        case "memory.propose":
          return yield* attempt(() => store.memory.propose(command.input, ownerId));
        case "memory.verify":
          return yield* attempt(() => store.memory.verify(command.input, ownerId));
        case "memory.supersede":
          return yield* attempt(() => store.memory.supersede(command.input, ownerId));
        case "memory.import":
          return yield* attempt(() => store.memory.importLegacy(command.input, ownerId));
        case "outcome.record":
          return yield* attempt(() =>
            store.roi.record({
              ...command.input,
              idempotencyKey: `${ownerId}:${command.input.idempotencyKey}`,
            }),
          );
        case "ticket.inspect":
          return yield* tickets
            .inspect(command)
            .pipe(Effect.mapError((error) => new ValhallaError({ message: error.message })));
        case "ticket.start":
          return yield* tickets
            .start(command.input, ownerId)
            .pipe(Effect.mapError((error) => new ValhallaError({ message: error.message })));
        case "ticket.refresh":
          return yield* tickets
            .refresh(command, ownerId)
            .pipe(Effect.mapError((error) => new ValhallaError({ message: error.message })));
        case "ticket.retry":
          return yield* tickets
            .retry(command, ownerId)
            .pipe(Effect.mapError((error) => new ValhallaError({ message: error.message })));
        case "ticket.takeOver":
          return yield* tickets
            .takeOver(command, ownerId)
            .pipe(Effect.mapError((error) => new ValhallaError({ message: error.message })));
        case "ticket.cancel":
          return yield* tickets
            .cancel(command, ownerId)
            .pipe(Effect.mapError((error) => new ValhallaError({ message: error.message })));
        case "ticket.publish":
          return yield* tickets
            .publish(command, ownerId)
            .pipe(Effect.mapError((error) => new ValhallaError({ message: error.message })));
      }
    }),
  });
});

export const layer = Layer.effect(ValhallaService, make);
