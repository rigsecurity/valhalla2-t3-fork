import { z } from "zod";

export const ModelRoute = z.object({
  provider: z.string().trim().min(1).max(120),
  model: z.string().trim().min(1).max(120),
  effort: z.string().trim().min(1).max(40).optional(),
});
export type ModelRoute = z.infer<typeof ModelRoute>;

export const WorkflowProfile = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    name: z.string().trim().min(1).max(100),
    mode: z.enum(["freestyle", "skills", "ticket"]),
    planner: ModelRoute.optional(),
    implementer: ModelRoute,
    reviewer: ModelRoute.optional(),
    skills: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
    optionalTools: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
    maxRepairAttempts: z.number().int().min(0).max(3).default(1),
  })
  .strict();
export type WorkflowProfile = z.infer<typeof WorkflowProfile>;

export const TeamPolicy = z.object({
  memoryRequired: z.literal(true),
  measurementRequired: z.literal(true),
  isolatedWorktrees: z.literal(true),
});
export type TeamPolicy = z.infer<typeof TeamPolicy>;
export const teamPolicy: TeamPolicy = {
  memoryRequired: true,
  measurementRequired: true,
  isolatedWorktrees: true,
};

export const OutcomeInput = z
  .object({
    idempotencyKey: z.string().min(1).max(200),
    id: z.string().min(1).max(200).optional(),
    ticketKey: z.string().max(80).optional(),
    repository: z.string().trim().min(1).max(300),
    profileId: z.string().min(1).max(64),
    model: z.string().min(1).max(200),
    workflowVersion: z.string().max(120).default("valhalla2-v1"),
    memoryVersion: z.string().max(200).optional(),
    status: z.enum(["running", "accepted", "failed", "abandoned"]),
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime().optional(),
    humanMinutes: z.number().finite().nonnegative().max(100000).nullable().optional(),
    baselineMinutes: z.number().finite().nonnegative().max(100000).nullable().optional(),
    actualCostUsd: z.number().finite().nonnegative().max(1000000).nullable().optional(),
    estimatedCostUsd: z.number().finite().nonnegative().max(1000000).nullable().optional(),
    maintenanceCostUsd: z.number().finite().nonnegative().max(1000000).nullable().optional(),
    reworkMinutes: z.number().finite().nonnegative().max(100000).nullable().optional(),
    defects: z.number().int().nonnegative().nullable().optional(),
    prUrl: z.url().optional(),
  })
  .strict()
  .refine((input) => !input.completedAt || input.completedAt >= input.startedAt, {
    message: "Completion must follow the start.",
  });
export type OutcomeInput = z.infer<typeof OutcomeInput>;
export const OutcomeEntry = OutcomeInput.safeExtend({
  id: z.string(),
  updatedAt: z.iso.datetime(),
});
export type OutcomeEntry = z.infer<typeof OutcomeEntry>;

export interface OutcomeSummary {
  started: number;
  accepted: number;
  failed: number;
  abandoned: number;
  running: number;
  acceptanceRate: number | null;
  measuredAccepted: number;
  humanMinutes: number | null;
  baselineMinutes: number | null;
  savedMinutes: number | null;
  actualCostUsd: number | null;
  estimatedCostUsd: number | null;
  maintenanceCostUsd: number | null;
  costSamples: number;
  estimatedCostSamples: number;
  defects: number | null;
  trend: Array<{
    date: string;
    accepted: number;
    failed: number;
    abandoned: number;
    measured: number;
    humanMinutes: number | null;
    savedMinutes: number | null;
  }>;
}

export interface ValhallaSnapshot {
  profiles: WorkflowProfile[];
  selectedProfileId: string;
  memory: import("./memorywell/schema.ts").MemoryRecord[];
  outcomes: OutcomeEntry[];
  roi: OutcomeSummary;
  runs: import("./tickets.ts").TicketRun[];
  health: {
    jiraConfigured: boolean;
    memory: "ready" | "unavailable";
    sharedEndpoint: string | null;
    availableSkills: string[];
    missingSkills: string[];
  };
  policy: TeamPolicy;
}

export const WorkflowStartInput = z.strictObject({
  requestId: z.string().min(1).max(120),
  projectId: z.string().min(1).max(200),
  profileId: z.string().min(1).max(64),
  baseRef: z.string().min(1).max(200),
  prompt: z.string().trim().min(1).max(30000),
});
export type WorkflowStartInput = z.infer<typeof WorkflowStartInput>;
export const WorkflowStartResult = z.strictObject({ threadId: z.string().min(1) });
