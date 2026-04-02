import { z } from "zod";

export const timestampSchema = z.string().min(1);
export const absolutePathSchema = z.string().startsWith("/");
export const opaqueIdSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/);

export const ticketStatusSchema = z.enum([
  "draft",
  "ready",
  "in_progress",
  "review",
  "done",
]);

export const ticketTypeSchema = z.enum([
  "feature",
  "bugfix",
  "chore",
  "research",
]);

export const reasoningEffortSchema = z.enum(["low", "medium", "high", "xhigh"]);
export const agentAdapterSchema = z.enum(["codex", "claude-code"]);
export const executionBackendSchema = z.enum(["host", "docker"]);
export const reviewActionSchema = z.enum(["direct_merge", "pull_request"]);

export const executionSessionStatusSchema = z.enum([
  "queued",
  "running",
  "paused_checkpoint",
  "paused_user_control",
  "awaiting_input",
  "interrupted",
  "failed",
  "completed",
]);

export const executionAttemptStatusSchema = z.enum([
  "queued",
  "running",
  "interrupted",
  "failed",
  "completed",
]);

export const executionPlanStatusSchema = z.enum([
  "not_requested",
  "drafting",
  "awaiting_feedback",
  "approved",
]);

export const hookFailurePolicySchema = z.enum(["block", "warn", "ignore"]);

export const hookConfigSchema = z.object({
  command: z.string().min(1),
  working_directory: absolutePathSchema,
  timeout_ms: z.number().int().positive(),
  failure_policy: hookFailurePolicySchema,
  shell: z.boolean(),
});

export const validationCommandSchema = z.object({
  id: opaqueIdSchema,
  label: z.string().min(1),
  command: z.string().min(1),
  working_directory: absolutePathSchema,
  timeout_ms: z.number().int().positive(),
  required_for_review: z.boolean(),
  shell: z.boolean(),
});

export const validationResultSchema = z.object({
  command_id: opaqueIdSchema,
  label: z.string().min(1),
  status: z.enum(["passed", "failed", "skipped"]),
  started_at: timestampSchema,
  ended_at: timestampSchema,
  exit_code: z.number().int().nullable(),
  failure_overridden: z.boolean(),
  summary: z.string().nullable(),
  log_ref: z.string().nullable(),
});

export const pullRequestRefSchema = z.object({
  provider: z.literal("github"),
  repo_owner: z.string().min(1),
  repo_name: z.string().min(1),
  number: z.number().int().positive(),
  url: z.string().url(),
  head_branch: z.string().min(1),
  base_branch: z.string().min(1),
  state: z.enum(["open", "closed", "merged", "unknown"]),
  review_status: z.enum([
    "pending",
    "approved",
    "changes_requested",
    "unknown",
  ]),
  head_sha: z.string().min(1).nullable(),
  changes_requested_by: z.string().min(1).nullable(),
  last_changes_requested_head_sha: z.string().min(1).nullable(),
  last_reconciled_at: timestampSchema.nullable(),
});

export const requestedChangeNoteSchema = z.object({
  id: opaqueIdSchema,
  ticket_id: z.number().int().positive(),
  review_package_id: opaqueIdSchema.nullable(),
  author_type: z.enum(["user", "system"]),
  body: z.string().min(1),
  created_at: timestampSchema,
});

export const draftTicketStateSchema = z.object({
  id: opaqueIdSchema,
  project_id: opaqueIdSchema,
  artifact_scope_id: opaqueIdSchema,
  title_draft: z.string().min(1),
  description_draft: z.string().min(1),
  proposed_repo_id: opaqueIdSchema.nullable(),
  confirmed_repo_id: opaqueIdSchema.nullable(),
  proposed_ticket_type: ticketTypeSchema.nullable(),
  proposed_acceptance_criteria: z.array(z.string().min(1)),
  wizard_status: z.enum([
    "editing",
    "awaiting_confirmation",
    "ready_to_create",
  ]),
  split_proposal_summary: z.string().nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const projectSchema = z.object({
  id: opaqueIdSchema,
  slug: z.string().min(1),
  name: z.string().min(1),
  agent_adapter: agentAdapterSchema,
  execution_backend: executionBackendSchema,
  automatic_agent_review: z.boolean(),
  default_review_action: reviewActionSchema,
  default_target_branch: z.string().min(1).nullable(),
  pre_worktree_command: z.string().min(1).nullable(),
  post_worktree_command: z.string().min(1).nullable(),
  draft_analysis_model: z.string().min(1).nullable(),
  draft_analysis_reasoning_effort: reasoningEffortSchema.nullable(),
  ticket_work_model: z.string().min(1).nullable(),
  ticket_work_reasoning_effort: reasoningEffortSchema.nullable(),
  max_concurrent_sessions: z.number().int().positive(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const repositoryConfigSchema = z.object({
  id: opaqueIdSchema,
  project_id: opaqueIdSchema,
  name: z.string().min(1),
  path: absolutePathSchema,
  target_branch: z.string().min(1).nullable(),
  setup_hook: hookConfigSchema.nullable(),
  cleanup_hook: hookConfigSchema.nullable(),
  validation_profile: z.array(validationCommandSchema),
  extra_env_allowlist: z.array(z.string().min(1)),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const ticketFrontmatterSchema = z.object({
  id: z.number().int().positive(),
  project: opaqueIdSchema,
  repo: opaqueIdSchema,
  artifact_scope_id: opaqueIdSchema,
  status: ticketStatusSchema,
  title: z.string().min(1),
  description: z.string(),
  ticket_type: ticketTypeSchema,
  acceptance_criteria: z.array(z.string().min(1)),
  working_branch: z.string().min(1).nullable(),
  target_branch: z.string().min(1),
  linked_pr: pullRequestRefSchema.nullable(),
  session_id: opaqueIdSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const executionSessionSchema = z.object({
  id: opaqueIdSchema,
  ticket_id: z.number().int().positive(),
  project_id: opaqueIdSchema,
  repo_id: opaqueIdSchema,
  agent_adapter: agentAdapterSchema,
  worktree_path: absolutePathSchema.nullable(),
  adapter_session_ref: opaqueIdSchema.nullable(),
  status: executionSessionStatusSchema,
  planning_enabled: z.boolean(),
  plan_status: executionPlanStatusSchema,
  plan_summary: z.string().nullable(),
  current_attempt_id: opaqueIdSchema.nullable(),
  latest_requested_change_note_id: opaqueIdSchema.nullable(),
  latest_review_package_id: opaqueIdSchema.nullable(),
  queue_entered_at: timestampSchema.nullable(),
  started_at: timestampSchema.nullable(),
  completed_at: timestampSchema.nullable(),
  last_heartbeat_at: timestampSchema.nullable(),
  last_summary: z.string().nullable(),
});

export const executionAttemptSchema = z.object({
  id: opaqueIdSchema,
  session_id: opaqueIdSchema,
  attempt_number: z.number().int().positive(),
  status: executionAttemptStatusSchema,
  pty_pid: z.number().int().nullable(),
  started_at: timestampSchema,
  ended_at: timestampSchema.nullable(),
  end_reason: z.string().nullable(),
});

export const structuredEventSchema = z.object({
  id: opaqueIdSchema,
  occurred_at: timestampSchema,
  entity_type: z.enum([
    "ticket",
    "session",
    "attempt",
    "draft",
    "review_package",
    "review_run",
    "worktree",
    "git",
    "pull_request",
    "system",
  ]),
  entity_id: opaqueIdSchema,
  event_type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export const reviewPackageSchema = z.object({
  id: opaqueIdSchema,
  ticket_id: z.number().int().positive(),
  session_id: opaqueIdSchema,
  diff_ref: z.string().min(1),
  commit_refs: z.array(z.string().min(1)),
  change_summary: z.string().min(1),
  validation_results: z.array(validationResultSchema),
  remaining_risks: z.array(z.string().min(1)),
  created_at: timestampSchema,
});

export const reviewFindingSeveritySchema = z.enum(["high", "medium", "low"]);
export const reviewFindingCategorySchema = z.enum([
  "first_principles",
  "code_smell",
  "separation_of_concerns",
  "correctness",
  "testing",
  "maintainability",
]);

export const reviewFindingSchema = z.object({
  severity: reviewFindingSeveritySchema,
  category: reviewFindingCategorySchema,
  title: z.string().min(1),
  details: z.string().min(1),
  suggested_fix: z.string().min(1),
});

export const reviewReportSchema = z.object({
  summary: z.string().min(1),
  strengths: z.array(z.string().min(1)).default([]),
  actionable_findings: z.array(reviewFindingSchema).default([]),
});

export const reviewRunStatusSchema = z.enum(["running", "completed", "failed"]);

export const reviewRunSchema = z.object({
  id: opaqueIdSchema,
  ticket_id: z.number().int().positive(),
  review_package_id: opaqueIdSchema,
  implementation_session_id: opaqueIdSchema,
  status: reviewRunStatusSchema,
  adapter_session_ref: opaqueIdSchema.nullable(),
  report: reviewReportSchema.nullable(),
  failure_message: z.string().nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  completed_at: timestampSchema.nullable(),
});

export type HookConfig = z.infer<typeof hookConfigSchema>;
export type ValidationCommand = z.infer<typeof validationCommandSchema>;
export type ValidationResult = z.infer<typeof validationResultSchema>;
export type PullRequestRef = z.infer<typeof pullRequestRefSchema>;
export type RequestedChangeNote = z.infer<typeof requestedChangeNoteSchema>;
export type DraftTicketState = z.infer<typeof draftTicketStateSchema>;
export type Project = z.infer<typeof projectSchema>;
export type RepositoryConfig = z.infer<typeof repositoryConfigSchema>;
export type TicketFrontmatter = z.infer<typeof ticketFrontmatterSchema>;
export type ExecutionSession = z.infer<typeof executionSessionSchema>;
export type ExecutionAttempt = z.infer<typeof executionAttemptSchema>;
export type StructuredEvent = z.infer<typeof structuredEventSchema>;
export type ReviewPackage = z.infer<typeof reviewPackageSchema>;
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;
export type ReviewReport = z.infer<typeof reviewReportSchema>;
export type ReviewRun = z.infer<typeof reviewRunSchema>;
export type TicketStatus = z.infer<typeof ticketStatusSchema>;
export type TicketType = z.infer<typeof ticketTypeSchema>;
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;
export type AgentAdapter = z.infer<typeof agentAdapterSchema>;
export type ExecutionBackend = z.infer<typeof executionBackendSchema>;
export type ReviewAction = z.infer<typeof reviewActionSchema>;
export type ExecutionPlanStatus = z.infer<typeof executionPlanStatusSchema>;
export type ExecutionSessionStatus = z.infer<
  typeof executionSessionStatusSchema
>;
