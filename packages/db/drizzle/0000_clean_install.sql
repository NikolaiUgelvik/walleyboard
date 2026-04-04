BEGIN;

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

COMMIT;
