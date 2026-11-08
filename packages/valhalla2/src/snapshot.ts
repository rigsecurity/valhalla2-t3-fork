import { z } from "zod";
import { OutcomeEntry, TeamPolicy, WorkflowProfile, type ValhallaSnapshot } from "./contracts.ts";
import { MemoryRecordSchema } from "./memorywell/schema.ts";
import { TicketRunSchema } from "./tickets.ts";

const Count = z.number().int().nonnegative();
const Measurement = z.number().finite().nullable();
export const ValhallaSnapshotSchema: z.ZodType<ValhallaSnapshot> = z.object({
  profiles: z.array(WorkflowProfile),
  selectedProfileId: z.string(),
  memory: z.array(MemoryRecordSchema),
  outcomes: z.array(OutcomeEntry),
  roi: z.object({
    started: Count,
    accepted: Count,
    failed: Count,
    abandoned: Count,
    running: Count,
    acceptanceRate: z.number().min(0).max(1).nullable(),
    measuredAccepted: Count,
    humanMinutes: Measurement,
    baselineMinutes: Measurement,
    savedMinutes: Measurement,
    actualCostUsd: Measurement,
    estimatedCostUsd: Measurement,
    maintenanceCostUsd: Measurement,
    costSamples: Count,
    estimatedCostSamples: Count,
    defects: Count.nullable(),
    trend: z.array(
      z.object({
        date: z.string(),
        accepted: Count,
        failed: Count,
        abandoned: Count,
        measured: Count,
        humanMinutes: Measurement,
        savedMinutes: Measurement,
      }),
    ),
  }),
  runs: z.array(TicketRunSchema),
  health: z.object({
    jiraConfigured: z.boolean(),
    memory: z.enum(["ready", "unavailable"]),
    sharedEndpoint: z.string().nullable(),
    availableSkills: z.array(z.string()),
    missingSkills: z.array(z.string()),
  }),
  policy: TeamPolicy,
});
