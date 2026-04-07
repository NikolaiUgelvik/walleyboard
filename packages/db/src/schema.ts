import type {
  HookConfig,
  PullRequestRef,
  ReviewReport,
  ValidationCommand,
  ValidationResult,
} from "@walleyboard/contracts";
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { jsonText } from "./json-column.js";

export const projectsTable = sqliteTable(
  "projects",
  {
    id: text("id").notNull().primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    color: text("color"),
    agentAdapter: text("agent_adapter").notNull().default("codex"),
    draftAnalysisAgentAdapter: text("draft_analysis_agent_adapter"),
    ticketWorkAgentAdapter: text("ticket_work_agent_adapter"),
    executionBackend: text("execution_backend").notNull().default("docker"),
    disabledMcpServers: jsonText<string[]>("disabled_mcp_servers")
      .notNull()
      .default([]),
    automaticAgentReview: integer("automatic_agent_review", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    automaticAgentReviewRunLimit: integer("automatic_agent_review_run_limit")
      .notNull()
      .default(1),
    defaultReviewAction: text("default_review_action")
      .notNull()
      .default("direct_merge"),
    defaultTargetBranch: text("default_target_branch"),
    previewStartCommand: text("preview_start_command"),
    worktreeInitCommand: text("worktree_init_command"),
    worktreeTeardownCommand: text("worktree_teardown_command"),
    worktreeInitRunSequential: integer("worktree_init_run_sequential", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    draftAnalysisModel: text("draft_analysis_model"),
    draftAnalysisReasoningEffort: text("draft_analysis_reasoning_effort"),
    ticketWorkModel: text("ticket_work_model"),
    ticketWorkReasoningEffort: text("ticket_work_reasoning_effort"),
    maxConcurrentSessions: integer("max_concurrent_sessions")
      .notNull()
      .default(4),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  () => [],
);

export const repositoriesTable = sqliteTable(
  "repositories",
  {
    id: text("id").notNull().primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    path: text("path").notNull(),
    targetBranch: text("target_branch"),
    setupHook: jsonText<HookConfig | null>("setup_hook"),
    cleanupHook: jsonText<HookConfig | null>("cleanup_hook"),
    validationProfile:
      jsonText<ValidationCommand[]>("validation_profile").notNull(),
    extraEnvAllowlist: jsonText<string[]>("extra_env_allowlist").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_repositories_project_id").on(table.projectId)],
);

export const draftTicketStatesTable = sqliteTable(
  "draft_ticket_states",
  {
    id: text("id").notNull().primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    artifactScopeId: text("artifact_scope_id").notNull(),
    titleDraft: text("title_draft").notNull(),
    descriptionDraft: text("description_draft").notNull(),
    proposedRepoId: text("proposed_repo_id").references(
      () => repositoriesTable.id,
      {
        onDelete: "set null",
      },
    ),
    confirmedRepoId: text("confirmed_repo_id").references(
      () => repositoriesTable.id,
      { onDelete: "set null" },
    ),
    proposedTicketType: text("proposed_ticket_type"),
    proposedAcceptanceCriteria: jsonText<string[]>(
      "proposed_acceptance_criteria",
    ).notNull(),
    wizardStatus: text("wizard_status").notNull(),
    splitProposalSummary: text("split_proposal_summary"),
    sourceTicketId: integer("source_ticket_id"),
    targetBranch: text("target_branch"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_drafts_project_id").on(table.projectId)],
);

export const ticketsTable = sqliteTable(
  "tickets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    repoId: text("repo_id")
      .notNull()
      .references(() => repositoriesTable.id, { onDelete: "cascade" }),
    artifactScopeId: text("artifact_scope_id").notNull(),
    status: text("status").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    ticketType: text("ticket_type").notNull(),
    acceptanceCriteria: jsonText<string[]>("acceptance_criteria")
      .notNull()
      .default([]),
    workingBranch: text("working_branch"),
    targetBranch: text("target_branch").notNull(),
    linkedPr: jsonText<PullRequestRef | null>("linked_pr"),
    sessionId: text("session_id"),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_tickets_project_id").on(table.projectId),
    index("idx_tickets_session_id").on(table.sessionId),
  ],
);

export const executionSessionsTable = sqliteTable(
  "execution_sessions",
  {
    id: text("id").notNull().primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => ticketsTable.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    repoId: text("repo_id")
      .notNull()
      .references(() => repositoriesTable.id, { onDelete: "cascade" }),
    agentAdapter: text("agent_adapter").notNull().default("codex"),
    worktreePath: text("worktree_path"),
    adapterSessionRef: text("adapter_session_ref"),
    status: text("status").notNull(),
    planningEnabled: integer("planning_enabled", { mode: "boolean" }).notNull(),
    planStatus: text("plan_status").notNull().default("not_requested"),
    planSummary: text("plan_summary"),
    currentAttemptId: text("current_attempt_id"),
    latestRequestedChangeNoteId: text("latest_requested_change_note_id"),
    latestReviewPackageId: text("latest_review_package_id"),
    queueEnteredAt: text("queue_entered_at"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    lastHeartbeatAt: text("last_heartbeat_at"),
    lastSummary: text("last_summary"),
  },
  (table) => [
    index("idx_execution_sessions_ticket_id").on(table.ticketId),
    index("idx_execution_sessions_project_status_queue").on(
      table.projectId,
      table.status,
      sql`${table.queueEnteredAt} asc`,
      sql`${table.startedAt} asc`,
    ),
  ],
);

export const executionAttemptsTable = sqliteTable(
  "execution_attempts",
  {
    id: text("id").notNull().primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => executionSessionsTable.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    status: text("status").notNull(),
    promptKind: text("prompt_kind"),
    prompt: text("prompt"),
    ptyPid: integer("pty_pid"),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    endReason: text("end_reason"),
  },
  (table) => [
    index("idx_execution_attempts_session_id").on(table.sessionId),
    index("idx_execution_attempts_session_attempt").on(
      table.sessionId,
      table.attemptNumber,
    ),
  ],
);

export const structuredEventsTable = sqliteTable(
  "structured_events",
  {
    id: text("id").notNull().primaryKey(),
    occurredAt: text("occurred_at").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonText<Record<string, unknown>>("payload").notNull(),
  },
  (table) => [
    index("idx_events_entity").on(
      table.entityType,
      table.entityId,
      sql`${table.occurredAt} desc`,
    ),
  ],
);

export const reviewPackagesTable = sqliteTable(
  "review_packages",
  {
    id: text("id").notNull().primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => ticketsTable.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => executionSessionsTable.id, { onDelete: "cascade" }),
    diffRef: text("diff_ref").notNull(),
    commitRefs: jsonText<string[]>("commit_refs").notNull(),
    changeSummary: text("change_summary").notNull(),
    validationResults:
      jsonText<ValidationResult[]>("validation_results").notNull(),
    remainingRisks: jsonText<string[]>("remaining_risks").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_review_packages_ticket_id").on(
      table.ticketId,
      sql`${table.createdAt} desc`,
    ),
  ],
);

export const reviewRunsTable = sqliteTable(
  "review_runs",
  {
    id: text("id").notNull().primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => ticketsTable.id, { onDelete: "cascade" }),
    reviewPackageId: text("review_package_id")
      .notNull()
      .references(() => reviewPackagesTable.id, { onDelete: "cascade" }),
    implementationSessionId: text("implementation_session_id")
      .notNull()
      .references(() => executionSessionsTable.id, { onDelete: "cascade" }),
    triggerSource: text("trigger_source").notNull().default("manual"),
    status: text("status").notNull(),
    adapterSessionRef: text("adapter_session_ref"),
    prompt: text("prompt"),
    report: jsonText<ReviewReport | null>("report"),
    failureMessage: text("failure_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("idx_review_runs_ticket_id").on(
      table.ticketId,
      sql`${table.createdAt} desc`,
    ),
  ],
);

export const requestedChangeNotesTable = sqliteTable(
  "requested_change_notes",
  {
    id: text("id").notNull().primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => ticketsTable.id, { onDelete: "cascade" }),
    reviewPackageId: text("review_package_id").references(
      () => reviewPackagesTable.id,
      { onDelete: "set null" },
    ),
    authorType: text("author_type").notNull(),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_requested_change_notes_ticket_id").on(
      table.ticketId,
      sql`${table.createdAt} desc`,
    ),
  ],
);

export const sessionLogsTable = sqliteTable(
  "session_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => executionSessionsTable.id, { onDelete: "cascade" }),
    line: text("line").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_session_logs_session_id").on(
      table.sessionId,
      sql`${table.id} asc`,
    ),
  ],
);

export const walleyboardSchema = {
  projectsTable,
  repositoriesTable,
  draftTicketStatesTable,
  ticketsTable,
  executionSessionsTable,
  executionAttemptsTable,
  structuredEventsTable,
  reviewPackagesTable,
  reviewRunsTable,
  requestedChangeNotesTable,
  sessionLogsTable,
};

export type WalleyboardSchema = typeof walleyboardSchema;
