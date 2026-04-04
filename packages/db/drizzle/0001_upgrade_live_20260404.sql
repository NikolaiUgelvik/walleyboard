PRAGMA foreign_keys = OFF;

BEGIN;

ALTER TABLE projects RENAME TO legacy_projects;
ALTER TABLE repositories RENAME TO legacy_repositories;
ALTER TABLE draft_ticket_states RENAME TO legacy_draft_ticket_states;
ALTER TABLE tickets RENAME TO legacy_tickets;
ALTER TABLE execution_sessions RENAME TO legacy_execution_sessions;
ALTER TABLE execution_attempts RENAME TO legacy_execution_attempts;
ALTER TABLE structured_events RENAME TO legacy_structured_events;
ALTER TABLE review_packages RENAME TO legacy_review_packages;
ALTER TABLE review_runs RENAME TO legacy_review_runs;
ALTER TABLE requested_change_notes RENAME TO legacy_requested_change_notes;
ALTER TABLE session_logs RENAME TO legacy_session_logs;

CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  color TEXT,
  agent_adapter TEXT NOT NULL DEFAULT 'codex',
  execution_backend TEXT NOT NULL DEFAULT 'docker',
  disabled_mcp_servers TEXT NOT NULL DEFAULT '[]',
  automatic_agent_review INTEGER NOT NULL DEFAULT 0,
  automatic_agent_review_run_limit INTEGER NOT NULL DEFAULT 1,
  default_review_action TEXT NOT NULL DEFAULT 'direct_merge',
  default_target_branch TEXT,
  preview_start_command TEXT,
  pre_worktree_command TEXT,
  post_worktree_command TEXT,
  draft_analysis_model TEXT,
  draft_analysis_reasoning_effort TEXT,
  ticket_work_model TEXT,
  ticket_work_reasoning_effort TEXT,
  max_concurrent_sessions INTEGER NOT NULL DEFAULT 4,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE repositories (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  target_branch TEXT,
  setup_hook TEXT,
  cleanup_hook TEXT,
  validation_profile TEXT NOT NULL,
  extra_env_allowlist TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE draft_ticket_states (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  artifact_scope_id TEXT NOT NULL,
  title_draft TEXT NOT NULL,
  description_draft TEXT NOT NULL,
  proposed_repo_id TEXT REFERENCES repositories(id) ON DELETE SET NULL,
  confirmed_repo_id TEXT REFERENCES repositories(id) ON DELETE SET NULL,
  proposed_ticket_type TEXT,
  proposed_acceptance_criteria TEXT NOT NULL,
  wizard_status TEXT NOT NULL,
  split_proposal_summary TEXT,
  source_ticket_id INTEGER,
  target_branch TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  artifact_scope_id TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  ticket_type TEXT NOT NULL,
  acceptance_criteria TEXT NOT NULL DEFAULT '[]',
  working_branch TEXT,
  target_branch TEXT NOT NULL,
  linked_pr TEXT,
  session_id TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE execution_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  agent_adapter TEXT NOT NULL DEFAULT 'codex',
  worktree_path TEXT,
  adapter_session_ref TEXT,
  status TEXT NOT NULL,
  planning_enabled INTEGER NOT NULL,
  plan_status TEXT NOT NULL DEFAULT 'not_requested',
  plan_summary TEXT,
  current_attempt_id TEXT,
  latest_requested_change_note_id TEXT,
  latest_review_package_id TEXT,
  queue_entered_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  last_heartbeat_at TEXT,
  last_summary TEXT
);

CREATE TABLE execution_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES execution_sessions(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  prompt_kind TEXT,
  prompt TEXT,
  pty_pid INTEGER,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT
);

CREATE TABLE structured_events (
  id TEXT PRIMARY KEY NOT NULL,
  occurred_at TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE review_packages (
  id TEXT PRIMARY KEY NOT NULL,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES execution_sessions(id) ON DELETE CASCADE,
  diff_ref TEXT NOT NULL,
  commit_refs TEXT NOT NULL,
  change_summary TEXT NOT NULL,
  validation_results TEXT NOT NULL,
  remaining_risks TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE review_runs (
  id TEXT PRIMARY KEY NOT NULL,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  review_package_id TEXT NOT NULL REFERENCES review_packages(id) ON DELETE CASCADE,
  implementation_session_id TEXT NOT NULL REFERENCES execution_sessions(id) ON DELETE CASCADE,
  trigger_source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL,
  adapter_session_ref TEXT,
  prompt TEXT,
  report TEXT,
  failure_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE requested_change_notes (
  id TEXT PRIMARY KEY NOT NULL,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  review_package_id TEXT REFERENCES review_packages(id) ON DELETE SET NULL,
  author_type TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE session_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES execution_sessions(id) ON DELETE CASCADE,
  line TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO projects (
  id,
  slug,
  name,
  color,
  agent_adapter,
  execution_backend,
  disabled_mcp_servers,
  automatic_agent_review,
  automatic_agent_review_run_limit,
  default_review_action,
  default_target_branch,
  preview_start_command,
  pre_worktree_command,
  post_worktree_command,
  draft_analysis_model,
  draft_analysis_reasoning_effort,
  ticket_work_model,
  ticket_work_reasoning_effort,
  max_concurrent_sessions,
  created_at,
  updated_at
)
SELECT
  id,
  slug,
  name,
  color,
  CASE
    WHEN agent_adapter = 'claude-code' THEN 'claude-code'
    ELSE 'codex'
  END,
  'docker',
  CASE
    WHEN disabled_mcp_servers IS NULL OR TRIM(disabled_mcp_servers) = '' THEN '[]'
    ELSE disabled_mcp_servers
  END,
  CASE
    WHEN automatic_agent_review = 1 THEN 1
    ELSE 0
  END,
  CASE
    WHEN automatic_agent_review_run_limit IS NULL OR automatic_agent_review_run_limit < 1 THEN 1
    ELSE automatic_agent_review_run_limit
  END,
  CASE
    WHEN default_review_action = 'pull_request' THEN 'pull_request'
    ELSE 'direct_merge'
  END,
  default_target_branch,
  preview_start_command,
  pre_worktree_command,
  post_worktree_command,
  draft_analysis_model,
  draft_analysis_reasoning_effort,
  ticket_work_model,
  ticket_work_reasoning_effort,
  CASE
    WHEN max_concurrent_sessions IS NULL OR max_concurrent_sessions < 1 OR max_concurrent_sessions = 1 THEN 4
    ELSE max_concurrent_sessions
  END,
  created_at,
  updated_at
FROM legacy_projects;

INSERT INTO repositories (
  id,
  project_id,
  name,
  path,
  target_branch,
  setup_hook,
  cleanup_hook,
  validation_profile,
  extra_env_allowlist,
  created_at,
  updated_at
)
SELECT
  id,
  project_id,
  name,
  path,
  target_branch,
  setup_hook,
  cleanup_hook,
  validation_profile,
  extra_env_allowlist,
  created_at,
  updated_at
FROM legacy_repositories;

INSERT INTO draft_ticket_states (
  id,
  project_id,
  artifact_scope_id,
  title_draft,
  description_draft,
  proposed_repo_id,
  confirmed_repo_id,
  proposed_ticket_type,
  proposed_acceptance_criteria,
  wizard_status,
  split_proposal_summary,
  source_ticket_id,
  target_branch,
  created_at,
  updated_at
)
SELECT
  id,
  project_id,
  artifact_scope_id,
  title_draft,
  description_draft,
  proposed_repo_id,
  confirmed_repo_id,
  proposed_ticket_type,
  proposed_acceptance_criteria,
  wizard_status,
  split_proposal_summary,
  source_ticket_id,
  target_branch,
  created_at,
  updated_at
FROM legacy_draft_ticket_states;

INSERT INTO tickets (
  id,
  project_id,
  repo_id,
  artifact_scope_id,
  status,
  title,
  description,
  ticket_type,
  acceptance_criteria,
  working_branch,
  target_branch,
  linked_pr,
  session_id,
  archived_at,
  created_at,
  updated_at
)
SELECT
  id,
  project_id,
  repo_id,
  artifact_scope_id,
  status,
  title,
  description,
  ticket_type,
  acceptance_criteria,
  working_branch,
  target_branch,
  linked_pr,
  session_id,
  archived_at,
  created_at,
  updated_at
FROM legacy_tickets;

INSERT INTO execution_sessions (
  id,
  ticket_id,
  project_id,
  repo_id,
  agent_adapter,
  worktree_path,
  adapter_session_ref,
  status,
  planning_enabled,
  plan_status,
  plan_summary,
  current_attempt_id,
  latest_requested_change_note_id,
  latest_review_package_id,
  queue_entered_at,
  started_at,
  completed_at,
  last_heartbeat_at,
  last_summary
)
SELECT
  id,
  ticket_id,
  project_id,
  repo_id,
  CASE
    WHEN agent_adapter = 'claude-code' THEN 'claude-code'
    ELSE 'codex'
  END,
  worktree_path,
  adapter_session_ref,
  status,
  planning_enabled,
  CASE
    WHEN plan_status IS NULL OR TRIM(plan_status) = '' THEN 'not_requested'
    ELSE plan_status
  END,
  plan_summary,
  current_attempt_id,
  latest_requested_change_note_id,
  latest_review_package_id,
  queue_entered_at,
  started_at,
  completed_at,
  last_heartbeat_at,
  last_summary
FROM legacy_execution_sessions;

INSERT INTO execution_attempts (
  id,
  session_id,
  attempt_number,
  status,
  prompt_kind,
  prompt,
  pty_pid,
  started_at,
  ended_at,
  end_reason
)
SELECT
  id,
  session_id,
  attempt_number,
  status,
  prompt_kind,
  prompt,
  pty_pid,
  started_at,
  ended_at,
  end_reason
FROM legacy_execution_attempts;

INSERT INTO structured_events (
  id,
  occurred_at,
  entity_type,
  entity_id,
  event_type,
  payload
)
SELECT
  id,
  occurred_at,
  entity_type,
  entity_id,
  event_type,
  payload
FROM legacy_structured_events;

INSERT INTO review_packages (
  id,
  ticket_id,
  session_id,
  diff_ref,
  commit_refs,
  change_summary,
  validation_results,
  remaining_risks,
  created_at
)
SELECT
  id,
  ticket_id,
  session_id,
  diff_ref,
  commit_refs,
  change_summary,
  validation_results,
  remaining_risks,
  created_at
FROM legacy_review_packages;

INSERT INTO review_runs (
  id,
  ticket_id,
  review_package_id,
  implementation_session_id,
  trigger_source,
  status,
  adapter_session_ref,
  prompt,
  report,
  failure_message,
  created_at,
  updated_at,
  completed_at
)
SELECT
  id,
  ticket_id,
  review_package_id,
  implementation_session_id,
  CASE
    WHEN trigger_source = 'automatic' THEN 'automatic'
    ELSE 'manual'
  END,
  status,
  adapter_session_ref,
  prompt,
  report,
  failure_message,
  created_at,
  updated_at,
  completed_at
FROM legacy_review_runs;

INSERT INTO requested_change_notes (
  id,
  ticket_id,
  review_package_id,
  author_type,
  body,
  created_at
)
SELECT
  id,
  ticket_id,
  review_package_id,
  author_type,
  body,
  created_at
FROM legacy_requested_change_notes;

INSERT INTO session_logs (
  id,
  session_id,
  line,
  created_at
)
SELECT
  id,
  session_id,
  line,
  created_at
FROM legacy_session_logs;

DROP TABLE legacy_session_logs;
DROP TABLE legacy_requested_change_notes;
DROP TABLE legacy_review_runs;
DROP TABLE legacy_review_packages;
DROP TABLE legacy_structured_events;
DROP TABLE legacy_execution_attempts;
DROP TABLE legacy_execution_sessions;
DROP TABLE legacy_tickets;
DROP TABLE legacy_draft_ticket_states;
DROP TABLE legacy_repositories;
DROP TABLE legacy_projects;

CREATE INDEX idx_repositories_project_id
  ON repositories(project_id);
CREATE INDEX idx_drafts_project_id
  ON draft_ticket_states(project_id);
CREATE INDEX idx_tickets_project_id
  ON tickets(project_id);
CREATE INDEX idx_tickets_session_id
  ON tickets(session_id);
CREATE INDEX idx_execution_sessions_ticket_id
  ON execution_sessions(ticket_id);
CREATE INDEX idx_execution_sessions_project_status_queue
  ON execution_sessions(project_id, status, queue_entered_at ASC, started_at ASC);
CREATE INDEX idx_execution_attempts_session_id
  ON execution_attempts(session_id);
CREATE INDEX idx_execution_attempts_session_attempt
  ON execution_attempts(session_id, attempt_number);
CREATE INDEX idx_events_entity
  ON structured_events(entity_type, entity_id, occurred_at DESC);
CREATE INDEX idx_review_packages_ticket_id
  ON review_packages(ticket_id, created_at DESC);
CREATE INDEX idx_review_runs_ticket_id
  ON review_runs(ticket_id, created_at DESC);
CREATE INDEX idx_requested_change_notes_ticket_id
  ON requested_change_notes(ticket_id, created_at DESC);
CREATE INDEX idx_session_logs_session_id
  ON session_logs(session_id, id ASC);

DELETE FROM sqlite_sequence WHERE name IN ('tickets', 'session_logs');
INSERT INTO sqlite_sequence (name, seq)
SELECT 'tickets', COALESCE(MAX(id), 0) FROM tickets;
INSERT INTO sqlite_sequence (name, seq)
SELECT 'session_logs', COALESCE(MAX(id), 0) FROM session_logs;

COMMIT;

PRAGMA foreign_keys = ON;
