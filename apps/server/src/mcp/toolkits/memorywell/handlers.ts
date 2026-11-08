import * as Effect from "effect/Effect";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as Memorywell from "../../MemorywellMcpService.ts";
import { MemorywellToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(MemorywellToolkit, {
  memorywell_retrieve: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* Memorywell.MemorywellMcpService;
      return yield* service.retrieve(scope, input);
    }),
  ),
  memorywell_propose: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* Memorywell.MemorywellMcpService;
      return yield* service.propose(scope, input);
    }),
  ),
});
