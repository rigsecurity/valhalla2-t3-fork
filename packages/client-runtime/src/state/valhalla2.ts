import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentGuardedRpcQueryAtomFamily,
  createEnvironmentRpcCommand,
} from "./runtime.ts";

export function createValhalla2Commands<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    snapshot: createEnvironmentGuardedRpcQueryAtomFamily(runtime, {
      label: "valhalla2:snapshot",
      tag: WS_METHODS.valhalla2GetSnapshot,
      staleTimeMs: 0,
      idleTtlMs: 60_000,
    }),
    command: createEnvironmentRpcCommand(runtime, {
      label: "valhalla2:command",
      tag: WS_METHODS.valhalla2Command,
    }),
  };
}
