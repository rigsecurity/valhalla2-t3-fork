import { z } from "zod";
import { OutcomeInput, WorkflowProfile, WorkflowStartInput } from "./contracts.ts";
import {
  ImportLegacyInputSchema,
  ProposeInputSchema,
  SupersedeInputSchema,
  VerifyInputSchema,
} from "./memorywell/schema.ts";
import { TicketInputSchema, TicketPublishInputSchema, JiraTicketSchema } from "./tickets.ts";

const Id = z.string().min(1).max(200);
export const ValhallaCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("profile.save"), profile: WorkflowProfile }),
  z.strictObject({ type: z.literal("profile.select"), id: Id }),
  z.strictObject({ type: z.literal("workflow.start"), input: WorkflowStartInput }),
  z.strictObject({ type: z.literal("memory.propose"), input: ProposeInputSchema }),
  z.strictObject({ type: z.literal("memory.verify"), input: VerifyInputSchema }),
  z.strictObject({ type: z.literal("memory.supersede"), input: SupersedeInputSchema }),
  z.strictObject({ type: z.literal("memory.import"), input: ImportLegacyInputSchema }),
  z.strictObject({ type: z.literal("outcome.record"), input: OutcomeInput }),
  z.strictObject({ type: z.literal("ticket.inspect"), ticketKey: JiraTicketSchema.shape.key }),
  z.strictObject({ type: z.literal("ticket.start"), input: TicketInputSchema }),
  z.strictObject({ type: z.literal("ticket.refresh"), id: Id }),
  z.strictObject({ type: z.literal("ticket.retry"), id: Id }),
  z.strictObject({ type: z.literal("ticket.takeOver"), id: Id }),
  z.strictObject({ type: z.literal("ticket.cancel"), id: Id }),
  TicketPublishInputSchema.extend({ type: z.literal("ticket.publish") }).strict(),
]);

export type ValhallaCommand = z.infer<typeof ValhallaCommandSchema>;
