import { z } from "zod";

import {
  absolutePathSchema,
  agentAdapterSchema,
  draftTicketStateSchema,
  executionAttemptSchema,
  executionBackendSchema,
  executionSessionSchema,
  opaqueIdSchema,
  projectColorSchema,
  projectSchema,
  pullRequestRefSchema,
  reasoningEffortSchema,
  repositoryConfigSchema,
  reviewActionSchema,
  reviewPackageSchema,
  reviewRunSchema,
  structuredEventSchema,
  ticketFrontmatterSchema,
  ticketTypeSchema,
  timestampSchema,
} from "./models.js";

export const createProjectInputSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  color: projectColorSchema.optional(),
  default_target_branch: z.string().min(1).nullable().optional(),
  repository: z.object({
    name: z.string().min(1),
    path: absolutePathSchema,
    target_branch: z.string().min(1).nullable().optional(),
    validation_commands: z.array(z.string().min(1)).optional(),
  }),
});

export const updateProjectInputSchema = z.object({
  color: projectColorSchema.optional(),
  agent_adapter: agentAdapterSchema.optional(),
  execution_backend: executionBackendSchema.optional(),
  disabled_mcp_servers: z.array(z.string().min(1)).optional(),
  automatic_agent_review: z.boolean().optional(),
  automatic_agent_review_run_limit: z.number().int().positive().optional(),
  default_review_action: reviewActionSchema.optional(),
  preview_start_command: z.string().min(1).nullable().optional(),
  pre_worktree_command: z.string().min(1).nullable().optional(),
  post_worktree_command: z.string().min(1).nullable().optional(),
  draft_analysis_model: z.string().min(1).nullable().optional(),
  draft_analysis_reasoning_effort: reasoningEffortSchema.nullable().optional(),
  ticket_work_model: z.string().min(1).nullable().optional(),
  ticket_work_reasoning_effort: reasoningEffortSchema.nullable().optional(),
  repository_target_branches: z
    .array(
      z.object({
        repository_id: opaqueIdSchema,
        target_branch: z.string().min(1),
      }),
    )
    .optional(),
});

export const createDraftInputSchema = z.object({
  project_id: opaqueIdSchema,
  artifact_scope_id: opaqueIdSchema.optional(),
  title: z.string().min(1),
  description: z.string().min(1),
  proposed_ticket_type: ticketTypeSchema.nullable().optional(),
  proposed_acceptance_criteria: z.array(z.string().min(1)).optional(),
});

export const updateDraftInputSchema = z.object({
  title_draft: z.string().min(1).optional(),
  description_draft: z.string().min(1).optional(),
  proposed_ticket_type: ticketTypeSchema.nullable().optional(),
  proposed_acceptance_criteria: z.array(z.string().min(1)).optional(),
});

export const refineDraftInputSchema = z.object({
  instruction: z.string().min(1).optional(),
});

export const confirmDraftInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  repo_id: opaqueIdSchema,
  ticket_type: ticketTypeSchema,
  acceptance_criteria: z.array(z.string().min(1)).min(1),
  target_branch: z.string().min(1),
});

export const uploadDraftArtifactInputSchema = z.object({
  artifact_scope_id: opaqueIdSchema.optional(),
  mime_type: z.string().min(1),
  data_base64: z.string().min(1),
});

export const uploadDraftArtifactResponseSchema = z.object({
  artifact_scope_id: opaqueIdSchema,
  artifact_url: z.string().min(1),
  markdown_image: z.string().min(1),
});

export const startTicketInputSchema = z.object({
  planning_enabled: z.boolean().optional().default(false),
});

export const stopTicketInputSchema = z.object({
  reason: z.string().min(1).optional(),
});

export const resumeTicketInputSchema = z.object({
  reason: z.string().min(1).optional(),
});

export const restartTicketInputSchema = z.object({
  reason: z.string().min(1).optional(),
});

export const requestChangesInputSchema = z.object({
  body: z.string().min(1),
});

export const checkpointResponseInputSchema = z.object({
  body: z.string().min(1),
  approved: z.boolean().optional(),
});

export const sessionInputSchema = z.object({
  body: z.string().min(1),
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
    draft_id: opaqueIdSchema.optional(),
  }),
  message: z.string().nullable(),
});

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("backend"),
  timestamp: timestampSchema,
  codex_mcp_servers: z.array(z.string().min(1)),
  docker: z.object({
    installed: z.boolean(),
    available: z.boolean(),
    client_version: z.string().min(1).nullable(),
    server_version: z.string().min(1).nullable(),
    error: z.string().min(1).nullable(),
  }),
  claude_code: z.object({
    available: z.boolean(),
    detected_path: z.string().min(1).nullable(),
    error: z.string().min(1).nullable(),
  }),
});

export const projectsResponseSchema = z.object({
  projects: z.array(projectSchema),
});

export const projectResponseSchema = z.object({
  project: projectSchema,
});

export const repositoriesResponseSchema = z.object({
  repositories: z.array(repositoryConfigSchema),
});

export const repositoryBranchChoicesSchema = z.object({
  repository_id: opaqueIdSchema,
  repository_name: z.string().min(1),
  current_target_branch: z.string().min(1).nullable(),
  branches: z.array(z.string().min(1)),
  error: z.string().min(1).nullable(),
});

export const repositoryBranchesResponseSchema = z.object({
  repository_branches: z.array(repositoryBranchChoicesSchema),
});

export const draftsResponseSchema = z.object({
  drafts: z.array(draftTicketStateSchema),
});

export const ticketsResponseSchema = z.object({
  tickets: z.array(ticketFrontmatterSchema),
});

export const draftEventsResponseSchema = z.object({
  events: z.array(structuredEventSchema),
  active_run: z.boolean(),
});

export const ticketResponseSchema = z.object({
  ticket: ticketFrontmatterSchema,
});

export const reviewPackageResponseSchema = z.object({
  review_package: reviewPackageSchema,
});

export const reviewRunResponseSchema = z.object({
  review_run: reviewRunSchema,
});

export const reviewRunsResponseSchema = z.object({
  review_runs: z.array(reviewRunSchema),
});

export const ticketEventsResponseSchema = z.object({
  events: z.array(structuredEventSchema),
});

export const ticketWorkspaceDiffSchema = z.object({
  ticket_id: z.number().int().positive(),
  source: z.enum(["live_worktree", "review_artifact"]),
  target_branch: z.string().min(1),
  working_branch: z.string().min(1).nullable(),
  worktree_path: absolutePathSchema.nullable(),
  artifact_path: absolutePathSchema.nullable(),
  patch: z.string(),
  generated_at: timestampSchema,
});

export const ticketWorkspaceDiffResponseSchema = z.object({
  workspace_diff: ticketWorkspaceDiffSchema,
});

export const ticketWorkspacePreviewStateSchema = z.enum([
  "idle",
  "starting",
  "ready",
  "failed",
]);

export const ticketWorkspacePreviewSchema = z.object({
  ticket_id: z.number().int().positive(),
  state: ticketWorkspacePreviewStateSchema,
  preview_url: z.string().url().nullable(),
  backend_url: z.string().url().nullable(),
  started_at: timestampSchema.nullable(),
  error: z.string().nullable(),
});

export const ticketWorkspacePreviewResponseSchema = z.object({
  preview: ticketWorkspacePreviewSchema,
});

export const sessionResponseSchema = z.object({
  session: executionSessionSchema,
  agent_controls_worktree: z.boolean(),
});

export const sessionAttemptsResponseSchema = z.object({
  attempts: z.array(executionAttemptSchema),
});

export const sessionLogsResponseSchema = z.object({
  session_id: opaqueIdSchema,
  logs: z.array(z.string()),
});

export const eventTypeSchema = z.enum([
  "ticket.updated",
  "ticket.workspace.updated",
  "ticket.archived",
  "ticket.deleted",
  "draft.updated",
  "draft.deleted",
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
  "command.rejected",
]);

export const eventEntityTypeSchema = z.enum([
  "ticket",
  "session",
  "attempt",
  "draft",
  "review_package",
  "review_run",
  "pull_request",
  "worktree",
  "git",
  "system",
]);

export const protocolEventSchema = z.object({
  event_id: opaqueIdSchema,
  event_type: eventTypeSchema,
  occurred_at: timestampSchema,
  entity_type: eventEntityTypeSchema,
  entity_id: opaqueIdSchema,
  payload: z.record(z.string(), z.unknown()),
});

export const sessionOutputEventPayloadSchema = z.object({
  session_id: opaqueIdSchema,
  attempt_id: opaqueIdSchema,
  sequence: z.number().int().nonnegative(),
  chunk: z.string(),
});

export const pullRequestUpdatedEventPayloadSchema = pullRequestRefSchema;

export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;
export type RepositoryBranchChoices = z.infer<
  typeof repositoryBranchChoicesSchema
>;
export type CreateDraftInput = z.infer<typeof createDraftInputSchema>;
export type UpdateDraftInput = z.infer<typeof updateDraftInputSchema>;
export type RefineDraftInput = z.infer<typeof refineDraftInputSchema>;
export type ConfirmDraftInput = z.infer<typeof confirmDraftInputSchema>;
export type UploadDraftArtifactInput = z.infer<
  typeof uploadDraftArtifactInputSchema
>;
export type UploadDraftArtifactResponse = z.infer<
  typeof uploadDraftArtifactResponseSchema
>;
export type StartTicketInput = z.infer<typeof startTicketInputSchema>;
export type StopTicketInput = z.infer<typeof stopTicketInputSchema>;
export type ResumeTicketInput = z.infer<typeof resumeTicketInputSchema>;
export type RestartTicketInput = z.infer<typeof restartTicketInputSchema>;
export type RequestChangesInput = z.infer<typeof requestChangesInputSchema>;
export type CheckpointResponseInput = z.infer<
  typeof checkpointResponseInputSchema
>;
export type SessionInput = z.infer<typeof sessionInputSchema>;
export type CommandAck = z.infer<typeof commandAckSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type DraftEventsResponse = z.infer<typeof draftEventsResponseSchema>;
export type RepositoryBranchesResponse = z.infer<
  typeof repositoryBranchesResponseSchema
>;
export type ProtocolEvent = z.infer<typeof protocolEventSchema>;
export type EventType = z.infer<typeof eventTypeSchema>;
export type EventEntityType = z.infer<typeof eventEntityTypeSchema>;
export type TicketWorkspaceDiff = z.infer<typeof ticketWorkspaceDiffSchema>;
export type TicketWorkspaceDiffResponse = z.infer<
  typeof ticketWorkspaceDiffResponseSchema
>;
export type TicketWorkspacePreviewState = z.infer<
  typeof ticketWorkspacePreviewStateSchema
>;
export type ReviewRunResponse = z.infer<typeof reviewRunResponseSchema>;
export type TicketWorkspacePreview = z.infer<
  typeof ticketWorkspacePreviewSchema
>;
export type TicketWorkspacePreviewResponse = z.infer<
  typeof ticketWorkspacePreviewResponseSchema
>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
