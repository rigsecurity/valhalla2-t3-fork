import { z } from "zod";

export const JiraTicketSchema = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9_]*-\d+$/),
  title: z.string().min(1).max(1000),
  description: z.string().max(100_000),
  url: z.url(),
  updatedAt: z.string().min(1),
  status: z.string().max(200),
});
export type JiraTicket = z.infer<typeof JiraTicketSchema>;

export const TicketInputSchema = z.object({
  requestId: z.string().min(1).max(120),
  ticketKey: JiraTicketSchema.shape.key,
  projectId: z.string().min(1).max(200),
  profileId: z.string().min(1).max(120),
  baseRef: z.string().min(1).max(200).default("main"),
});
export type TicketInput = z.infer<typeof TicketInputSchema>;

export const TicketModelSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  effort: z.string().optional(),
});

export const TicketRunSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  requestId: z.string(),
  ticket: JiraTicketSchema,
  projectId: z.string(),
  repository: z.string(),
  profileId: z.string(),
  baseRef: z.string(),
  branch: z.string(),
  threadId: z.string(),
  reviewerThreadId: z.string().nullable(),
  stepRunId: z.string().nullable(),
  worktreePath: z.string().nullable(),
  stage: z.enum(["plan", "implement", "review"]),
  status: z.enum([
    "queued",
    "running",
    "needs_input",
    "ready_to_publish",
    "publishing",
    "published",
    "failed",
    "taken_over",
    "cancelled",
  ]),
  planner: TicketModelSchema.nullable(),
  implementer: TicketModelSchema,
  reviewer: TicketModelSchema.nullable(),
  skills: z.array(z.string()),
  optionalTools: z.array(z.string()),
  maxRepairAttempts: z.number().int().min(0).max(10),
  repairAttempts: z.number().int().min(0),
  deliveryAttempts: z.number().int().min(0),
  startedAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  reviewedHeadSha: z.string().nullable(),
  prUrl: z.url().nullable(),
  error: z.string().nullable(),
});
export type TicketRun = z.infer<typeof TicketRunSchema>;

export const TicketPublishInputSchema = z.object({
  id: z.string().min(1),
  approvedHeadSha: z.string().regex(/^[0-9a-f]{40,64}$/),
});
