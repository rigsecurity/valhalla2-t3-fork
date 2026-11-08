import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "./runtime.ts";

export function createValhalla2Commands<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    snapshot: createEnvironmentRpcCommand(runtime, {
      label: "valhalla2:snapshot",
      tag: WS_METHODS.valhalla2GetSnapshot,
    }),
    command: createEnvironmentRpcCommand(runtime, {
      label: "valhalla2:command",
      tag: WS_METHODS.valhalla2Command,
    }),
  };
}
