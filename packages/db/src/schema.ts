import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projectsTable = sqliteTable("projects", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  defaultTargetBranch: text("default_target_branch"),
  maxConcurrentSessions: integer("max_concurrent_sessions").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const repositoriesTable = sqliteTable("repositories", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  name: text("name").notNull(),
  path: text("path").notNull(),
  targetBranch: text("target_branch"),
  setupHook: text("setup_hook", { mode: "json" }),
  cleanupHook: text("cleanup_hook", { mode: "json" }),
  validationProfile: text("validation_profile", { mode: "json" }).notNull(),
  extraEnvAllowlist: text("extra_env_allowlist", { mode: "json" }).notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const draftTicketStatesTable = sqliteTable("draft_ticket_states", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  titleDraft: text("title_draft").notNull(),
  descriptionDraft: text("description_draft").notNull(),
  proposedRepoId: text("proposed_repo_id"),
  confirmedRepoId: text("confirmed_repo_id"),
  proposedTicketType: text("proposed_ticket_type"),
  proposedAcceptanceCriteria: text("proposed_acceptance_criteria", {
    mode: "json"
  }).notNull(),
  wizardStatus: text("wizard_status").notNull(),
  splitProposalSummary: text("split_proposal_summary"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const ticketsTable = sqliteTable("tickets", {
  id: integer("id").primaryKey(),
  projectId: text("project_id").notNull(),
  repoId: text("repo_id").notNull(),
  status: text("status").notNull(),
  title: text("title").notNull(),
  ticketType: text("ticket_type").notNull(),
  workingBranch: text("working_branch"),
  targetBranch: text("target_branch").notNull(),
  linkedPr: text("linked_pr", { mode: "json" }),
  sessionId: text("session_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const executionSessionsTable = sqliteTable("execution_sessions", {
  id: text("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  projectId: text("project_id").notNull(),
  repoId: text("repo_id").notNull(),
  status: text("status").notNull(),
  planningEnabled: integer("planning_enabled", { mode: "boolean" }).notNull(),
  currentAttemptId: text("current_attempt_id"),
  latestRequestedChangeNoteId: text("latest_requested_change_note_id"),
  latestReviewPackageId: text("latest_review_package_id"),
  queueEnteredAt: text("queue_entered_at"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  lastHeartbeatAt: text("last_heartbeat_at"),
  lastSummary: text("last_summary")
});

export const executionAttemptsTable = sqliteTable("execution_attempts", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  status: text("status").notNull(),
  ptyPid: integer("pty_pid"),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
  endReason: text("end_reason")
});

export const structuredEventsTable = sqliteTable("structured_events", {
  id: text("id").primaryKey(),
  occurredAt: text("occurred_at").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: text("payload", { mode: "json" }).notNull()
});

export const reviewPackagesTable = sqliteTable("review_packages", {
  id: text("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  sessionId: text("session_id").notNull(),
  diffRef: text("diff_ref").notNull(),
  commitRefs: text("commit_refs", { mode: "json" }).notNull(),
  changeSummary: text("change_summary").notNull(),
  validationResults: text("validation_results", { mode: "json" }).notNull(),
  remainingRisks: text("remaining_risks", { mode: "json" }).notNull(),
  createdAt: text("created_at").notNull()
});

export const requestedChangeNotesTable = sqliteTable("requested_change_notes", {
  id: text("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  reviewPackageId: text("review_package_id"),
  authorType: text("author_type").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull()
});

export const sessionLogsTable = sqliteTable("session_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull(),
  line: text("line").notNull(),
  createdAt: text("created_at").notNull()
});
