import { z } from "zod";

import {
  absolutePathSchema,
  draftTicketStateSchema,
  executionAttemptSchema,
  executionSessionSchema,
  opaqueIdSchema,
  projectSchema,
  pullRequestRefSchema,
  repositoryConfigSchema,
  reviewPackageSchema,
  structuredEventSchema,
  ticketFrontmatterSchema,
  ticketTypeSchema,
  timestampSchema
} from "./models.js";

export const createProjectInputSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  default_target_branch: z.string().min(1).nullable().optional(),
  repository: z.object({
    name: z.string().min(1),
    path: absolutePathSchema,
    target_branch: z.string().min(1).nullable().optional()
  })
});

export const createDraftInputSchema = z.object({
  project_id: opaqueIdSchema,
  title: z.string().min(1),
  description: z.string().min(1)
});

export const refineDraftInputSchema = z.object({
  instruction: z.string().min(1).optional()
});

export const confirmDraftInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  repo_id: opaqueIdSchema,
  ticket_type: ticketTypeSchema,
  acceptance_criteria: z.array(z.string().min(1)).min(1),
  target_branch: z.string().min(1)
});

export const startTicketInputSchema = z.object({
  planning_enabled: z.boolean().optional().default(false)
});

export const resumeTicketInputSchema = z.object({
  reason: z.string().min(1).optional()
});

export const requestChangesInputSchema = z.object({
  body: z.string().min(1)
});

export const checkpointResponseInputSchema = z.object({
  body: z.string().min(1),
  approved: z.boolean().optional()
});

export const sessionInputSchema = z.object({
  body: z.string().min(1)
});

export const commandAckSchema = z.object({
  accepted: z.boolean(),
  command_id: opaqueIdSchema,
  issued_at: timestampSchema,
  resource_refs: z.object({
    project_id: opaqueIdSchema.optional(),
    repo_id: opaqueIdSchema.optional(),
    ticket_id: z.number().int().positive().optional(),
    session_id: opaqueIdSchema.optional(),
    draft_id: opaqueIdSchema.optional()
  }),
  message: z.string().nullable()
});

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("backend"),
  timestamp: timestampSchema
});

export const projectsResponseSchema = z.object({
  projects: z.array(projectSchema)
});

export const projectResponseSchema = z.object({
  project: projectSchema
});

export const repositoriesResponseSchema = z.object({
  repositories: z.array(repositoryConfigSchema)
});

export const draftsResponseSchema = z.object({
  drafts: z.array(draftTicketStateSchema)
});

export const ticketsResponseSchema = z.object({
  tickets: z.array(ticketFrontmatterSchema)
});

export const ticketResponseSchema = z.object({
  ticket: ticketFrontmatterSchema
});

export const reviewPackageResponseSchema = z.object({
  review_package: reviewPackageSchema
});

export const ticketEventsResponseSchema = z.object({
  events: z.array(structuredEventSchema)
});

export const sessionResponseSchema = z.object({
  session: executionSessionSchema
});

export const sessionAttemptsResponseSchema = z.object({
  attempts: z.array(executionAttemptSchema)
});

export const sessionLogsResponseSchema = z.object({
  session_id: opaqueIdSchema,
  logs: z.array(z.string())
});

export const eventTypeSchema = z.enum([
  "ticket.updated",
  "ticket.deleted",
  "draft.updated",
  "draft.ready",
  "session.updated",
  "session.output",
  "session.checkpoint_requested",
  "session.input_requested",
  "session.summary_generated",
  "review_package.generated",
  "validation.updated",
  "pull_request.updated",
  "structured_event.created",
  "command.rejected"
]);

export const eventEntityTypeSchema = z.enum([
  "ticket",
  "session",
  "attempt",
  "draft",
  "review_package",
  "pull_request",
  "worktree",
  "git",
  "system"
]);

export const protocolEventSchema = z.object({
  event_id: opaqueIdSchema,
  event_type: eventTypeSchema,
  occurred_at: timestampSchema,
  entity_type: eventEntityTypeSchema,
  entity_id: opaqueIdSchema,
  payload: z.record(z.string(), z.unknown())
});

export const sessionOutputEventPayloadSchema = z.object({
  session_id: opaqueIdSchema,
  attempt_id: opaqueIdSchema,
  sequence: z.number().int().nonnegative(),
  chunk: z.string()
});

export const pullRequestUpdatedEventPayloadSchema = pullRequestRefSchema;

export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export type CreateDraftInput = z.infer<typeof createDraftInputSchema>;
export type RefineDraftInput = z.infer<typeof refineDraftInputSchema>;
export type ConfirmDraftInput = z.infer<typeof confirmDraftInputSchema>;
export type StartTicketInput = z.infer<typeof startTicketInputSchema>;
export type ResumeTicketInput = z.infer<typeof resumeTicketInputSchema>;
export type RequestChangesInput = z.infer<typeof requestChangesInputSchema>;
export type CheckpointResponseInput = z.infer<typeof checkpointResponseInputSchema>;
export type SessionInput = z.infer<typeof sessionInputSchema>;
export type CommandAck = z.infer<typeof commandAckSchema>;
export type ProtocolEvent = z.infer<typeof protocolEventSchema>;
export type EventType = z.infer<typeof eventTypeSchema>;
export type EventEntityType = z.infer<typeof eventEntityTypeSchema>;
