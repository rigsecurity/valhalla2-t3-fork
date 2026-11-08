import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as Memorywell from "../../MemorywellMcpService.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagement.ThreadManagementService,
    Memorywell.MemorywellMcpService,
  ],
};

const Retrieve = Tool.make("memorywell_retrieve", {
  ...shared,
  description:
    "Find relevant repo notes and verified common knowledge before unfamiliar work. Check sources against current code before relying on a note. Outside T3, pass projectId from t3_project_list. Query an id to focus a truncated note.",
  parameters: Memorywell.MemoryRetrieveInput,
  success: Memorywell.MemoryRetrieveResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const Propose = Tool.make("memorywell_propose", {
  ...shared,
  description:
    "Capture a reusable finding when it can save future work. Set reason to research, convention, or pitfall and cite 1–4 checked sources. Keep it under 1600 characters and omit secrets or task logs. It is reusable as an agent note. Omit reason to leave a proposal for review. Reuse idempotencyKey for retries. Outside T3, pass projectId.",
  parameters: Memorywell.MemoryProposeInput,
  success: Memorywell.MemoryProposeResult,
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const MemorywellToolkit = Toolkit.make(Retrieve, Propose);
