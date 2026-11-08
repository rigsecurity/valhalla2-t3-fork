import { ValhallaCommandSchema } from "@rig/valhalla2/commands";
import { ValhallaSnapshotSchema } from "@rig/valhalla2/snapshot";
import * as Schema from "effect/Schema";

export class ValhallaError extends Schema.TaggedError<ValhallaError>()("ValhallaError", {
  message: Schema.String,
}) {}

const validated = <A>(validator: {
  parse: (value: unknown) => A;
  safeParse: (value: unknown) => { success: boolean };
}) =>
  Schema.declare((value: unknown): value is A => validator.safeParse(value).success, {
    toCodecJson: () => undefined,
  });

export const ValhallaCommand = validated(ValhallaCommandSchema);
export const ValhallaSnapshot = validated(ValhallaSnapshotSchema);
