import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createMigratedWalleyboardDatabase } from "@walleyboard/db";

import { createApp } from "../app.js";
import { createTestDockerRuntime } from "../test-support/create-isolated-app.js";
import { SqliteStore } from "./sqlite-store.js";

const liveSchemaSql = `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    agent_adapter TEXT NOT NULL DEFAULT 'codex',
    execution_backend TEXT NOT NULL DEFAULT 'host',
    default_target_branch TEXT,
    pre_worktree_command TEXT,
    post_worktree_command TEXT,
    draft_analysis_model TEXT,
    draft_analysis_reasoning_effort TEXT,
    ticket_work_model TEXT,
    ticket_work_reasoning_effort TEXT,
    max_concurrent_sessions INTEGER NOT NULL DEFAULT 4,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    default_review_action TEXT NOT NULL DEFAULT 'direct_merge',
    automatic_agent_review INTEGER NOT NULL DEFAULT 0,
    preview_start_command TEXT,
    automatic_agent_review_run_limit INTEGER NOT NULL DEFAULT 1,
    disabled_mcp_servers TEXT NOT NULL DEFAULT '[]',
    color TEXT
  );

  CREATE TABLE repositories (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    target_branch TEXT,
    setup_hook TEXT,
    cleanup_hook TEXT,
    validation_profile TEXT NOT NULL,
    extra_env_allowlist TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE draft_ticket_states (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    artifact_scope_id TEXT NOT NULL,
    title_draft TEXT NOT NULL,
    description_draft TEXT NOT NULL,
    proposed_repo_id TEXT,
    confirmed_repo_id TEXT,
    proposed_ticket_type TEXT,
    proposed_acceptance_criteria TEXT NOT NULL,
    wizard_status TEXT NOT NULL,
    split_proposal_summary TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source_ticket_id INTEGER,
    target_branch TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE tickets (
    id INTEGER PRIMARY KEY,
    project_id TEXT NOT NULL,
    repo_id TEXT NOT NULL,
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
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (repo_id) REFERENCES repositories(id) ON DELETE CASCADE
  );

  CREATE TABLE execution_sessions (
    id TEXT PRIMARY KEY,
    ticket_id INTEGER NOT NULL,
    project_id TEXT NOT NULL,
    repo_id TEXT NOT NULL,
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
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    status TEXT NOT NULL,
    pty_pid INTEGER,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    end_reason TEXT,
    prompt_kind TEXT,
    prompt TEXT
  );

  CREATE TABLE structured_events (
    id TEXT PRIMARY KEY,
    occurred_at TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL
  );

  CREATE TABLE review_packages (
    id TEXT PRIMARY KEY,
    ticket_id INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    diff_ref TEXT NOT NULL,
    commit_refs TEXT NOT NULL,
    change_summary TEXT NOT NULL,
    validation_results TEXT NOT NULL,
    remaining_risks TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE requested_change_notes (
    id TEXT PRIMARY KEY,
    ticket_id INTEGER NOT NULL,
    review_package_id TEXT,
    author_type TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE session_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    line TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX idx_repositories_project_id
    ON repositories(project_id);
  CREATE INDEX idx_drafts_project_id
    ON draft_ticket_states(project_id);
  CREATE INDEX idx_tickets_project_id
    ON tickets(project_id);
  CREATE INDEX idx_events_entity
    ON structured_events(entity_type, entity_id, occurred_at DESC);
  CREATE INDEX idx_session_logs_session_id
    ON session_logs(session_id, id ASC);

  CREATE TABLE review_runs (
    id TEXT PRIMARY KEY,
    ticket_id INTEGER NOT NULL,
    review_package_id TEXT NOT NULL,
    implementation_session_id TEXT NOT NULL,
    status TEXT NOT NULL,
    adapter_session_ref TEXT,
    report TEXT,
    failure_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    trigger_source TEXT NOT NULL DEFAULT 'manual',
    prompt TEXT
  );

  CREATE INDEX idx_review_runs_ticket_id
    ON review_runs(ticket_id, created_at DESC);
`;

const expectedTableColumns = {
  draft_ticket_states: [
    "id",
    "project_id",
    "artifact_scope_id",
    "title_draft",
    "description_draft",
    "proposed_repo_id",
    "confirmed_repo_id",
    "proposed_ticket_type",
    "proposed_acceptance_criteria",
    "wizard_status",
    "split_proposal_summary",
    "source_ticket_id",
    "target_branch",
    "created_at",
    "updated_at",
  ],
  execution_attempts: [
    "id",
    "session_id",
    "attempt_number",
    "status",
    "prompt_kind",
    "prompt",
    "pty_pid",
    "started_at",
    "ended_at",
    "end_reason",
  ],
  execution_sessions: [
    "id",
    "ticket_id",
    "project_id",
    "repo_id",
    "agent_adapter",
    "worktree_path",
    "adapter_session_ref",
    "status",
    "planning_enabled",
    "plan_status",
    "plan_summary",
    "current_attempt_id",
    "latest_requested_change_note_id",
    "latest_review_package_id",
    "queue_entered_at",
    "started_at",
    "completed_at",
    "last_heartbeat_at",
    "last_summary",
  ],
  projects: [
    "id",
    "slug",
    "name",
    "color",
    "agent_adapter",
    "execution_backend",
    "disabled_mcp_servers",
    "automatic_agent_review",
    "automatic_agent_review_run_limit",
    "default_review_action",
    "default_target_branch",
    "preview_start_command",
    "pre_worktree_command",
    "post_worktree_command",
    "draft_analysis_model",
    "draft_analysis_reasoning_effort",
    "ticket_work_model",
    "ticket_work_reasoning_effort",
    "max_concurrent_sessions",
    "created_at",
    "updated_at",
  ],
  repositories: [
    "id",
    "project_id",
    "name",
    "path",
    "target_branch",
    "setup_hook",
    "cleanup_hook",
    "validation_profile",
    "extra_env_allowlist",
    "created_at",
    "updated_at",
  ],
  requested_change_notes: [
    "id",
    "ticket_id",
    "review_package_id",
    "author_type",
    "body",
    "created_at",
  ],
  review_packages: [
    "id",
    "ticket_id",
    "session_id",
    "diff_ref",
    "commit_refs",
    "change_summary",
    "validation_results",
    "remaining_risks",
    "created_at",
  ],
  review_runs: [
    "id",
    "ticket_id",
    "review_package_id",
    "implementation_session_id",
    "trigger_source",
    "status",
    "adapter_session_ref",
    "prompt",
    "report",
    "failure_message",
    "created_at",
    "updated_at",
    "completed_at",
  ],
  session_logs: ["id", "session_id", "line", "created_at"],
  structured_events: [
    "id",
    "occurred_at",
    "entity_type",
    "entity_id",
    "event_type",
    "payload",
  ],
  tickets: [
    "id",
    "project_id",
    "repo_id",
    "artifact_scope_id",
    "status",
    "title",
    "description",
    "ticket_type",
    "acceptance_criteria",
    "working_branch",
    "target_branch",
    "linked_pr",
    "session_id",
    "archived_at",
    "created_at",
    "updated_at",
  ],
} as const;

function listUserTables(db: DatabaseSync): string[] {
  const rows = db
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `,
    )
    .all() as Array<{ name: string }>;

  return rows.map((row) => row.name);
}

function listColumnNames(db: DatabaseSync, tableName: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
  }>;
  return rows.map((row) => row.name);
}

function listColumns(
  db: DatabaseSync,
  tableName: string,
): Map<string, { dflt_value: string | null; notnull: number }> {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    dflt_value: string | null;
    name: string;
    notnull: number;
  }>;

  return new Map(
    rows.map((row) => [
      row.name,
      {
        dflt_value: row.dflt_value,
        notnull: row.notnull,
      },
    ]),
  );
}

function listForeignKeyTables(db: DatabaseSync, tableName: string): string[] {
  const rows = db
    .prepare(`PRAGMA foreign_key_list(${tableName})`)
    .all() as Array<{ table: string }>;
  return rows
    .map((row) => row.table)
    .sort((left, right) => left.localeCompare(right));
}

function listNamedIndexes(db: DatabaseSync): string[] {
  const rows = db
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'index'
          AND name LIKE 'idx_%'
        ORDER BY name
      `,
    )
    .all() as Array<{ name: string }>;

  return rows.map((row) => row.name);
}

function listMigrationNames(db: DatabaseSync): string[] {
  const rows = db
    .prepare(
      `
        SELECT name
        FROM __walleyboard_migrations
        ORDER BY name
      `,
    )
    .all() as Array<{ name: string }>;

  return rows.map((row) => row.name);
}

function createRepresentativeLiveDatabase(databasePath: string): void {
  const db = new DatabaseSync(databasePath);

  try {
    db.exec(liveSchemaSql);

    db.prepare(
      `
        INSERT INTO projects (
          id, slug, name, agent_adapter, execution_backend,
          default_target_branch, pre_worktree_command, post_worktree_command,
          draft_analysis_model, draft_analysis_reasoning_effort,
          ticket_work_model, ticket_work_reasoning_effort,
          max_concurrent_sessions, created_at, updated_at,
          default_review_action, automatic_agent_review, preview_start_command,
          automatic_agent_review_run_limit, disabled_mcp_servers, color
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "project-1",
      "legacy-project",
      "Legacy Project",
      "copilot",
      "host",
      "main",
      "pnpm install",
      "pnpm test",
      "gpt-5-mini",
      "medium",
      "gpt-5",
      "high",
      1,
      "2026-04-03T10:00:00.000Z",
      "2026-04-03T11:00:00.000Z",
      "ship_it",
      1,
      "pnpm dev",
      0,
      "",
      "#2563EB",
    );

    db.prepare(
      `
        INSERT INTO repositories (
          id, project_id, name, path, target_branch, setup_hook, cleanup_hook,
          validation_profile, extra_env_allowlist, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "repo-1",
      "project-1",
      "repo",
      join(tmpdir(), "legacy-repo"),
      "main",
      JSON.stringify({ command: "pnpm install" }),
      JSON.stringify({ command: "pnpm cleanup" }),
      JSON.stringify([
        {
          id: "lint",
          label: "Lint",
          command: "pnpm lint",
          shell: false,
          timeout_ms: 60_000,
          required_for_review: true,
        },
      ]),
      JSON.stringify(["OPENAI_API_KEY"]),
      "2026-04-03T10:00:00.000Z",
      "2026-04-03T11:00:00.000Z",
    );

    db.prepare(
      `
        INSERT INTO draft_ticket_states (
          id, project_id, artifact_scope_id, title_draft, description_draft,
          proposed_repo_id, confirmed_repo_id, proposed_ticket_type,
          proposed_acceptance_criteria, wizard_status, split_proposal_summary,
          created_at, updated_at, source_ticket_id, target_branch
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "draft-1",
      "project-1",
      "artifact-scope-1",
      "Legacy draft",
      "Keep the migrated draft intact.",
      "repo-1",
      null,
      "bug",
      JSON.stringify(["Ship the migrated draft as-is."]),
      "draft",
      "Split the work later.",
      "2026-04-03T10:05:00.000Z",
      "2026-04-03T10:06:00.000Z",
      41,
      "release/1.0",
    );

    db.prepare(
      `
        INSERT INTO tickets (
          id, project_id, repo_id, artifact_scope_id, status, title,
          description, ticket_type, acceptance_criteria, working_branch,
          target_branch, linked_pr, session_id, archived_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      41,
      "project-1",
      "repo-1",
      "artifact-scope-1",
      "review",
      "Legacy ticket",
      "Ensure the migrated ticket keeps its existing ids and review state.",
      "feature",
      JSON.stringify(["Preserve ids", "Preserve review metadata"]),
      "codex/ticket-41",
      "main",
      JSON.stringify({
        provider: "github",
        repo_owner: "openai",
        repo_name: "walleyboard",
        number: 41,
        url: "https://github.com/openai/walleyboard/pull/41",
        head_branch: "codex/ticket-41",
        base_branch: "main",
        state: "open",
        review_status: "pending",
      }),
      "session-1",
      null,
      "2026-04-03T10:10:00.000Z",
      "2026-04-03T10:20:00.000Z",
    );

    db.prepare(
      `
        INSERT INTO execution_sessions (
          id, ticket_id, project_id, repo_id, agent_adapter, worktree_path,
          adapter_session_ref, status, planning_enabled, plan_status, plan_summary,
          current_attempt_id, latest_requested_change_note_id,
          latest_review_package_id, queue_entered_at, started_at, completed_at,
          last_heartbeat_at, last_summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "session-1",
      41,
      "project-1",
      "repo-1",
      "claude-code",
      join(tmpdir(), "legacy-worktree"),
      "adapter-thread-1",
      "running",
      1,
      "completed",
      "Plan completed",
      "attempt-1",
      "note-1",
      "review-package-1",
      "2026-04-03T10:12:00.000Z",
      "2026-04-03T10:12:30.000Z",
      null,
      "2026-04-03T10:14:00.000Z",
      "Waiting for backend recovery",
    );

    db.prepare(
      `
        INSERT INTO execution_attempts (
          id, session_id, attempt_number, status, pty_pid, started_at,
          ended_at, end_reason, prompt_kind, prompt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "attempt-1",
      "session-1",
      1,
      "running",
      999_999,
      "2026-04-03T10:12:30.000Z",
      null,
      null,
      "implementation",
      "Finish the migrated review ticket.",
    );

    db.prepare(
      `
        INSERT INTO structured_events (
          id, occurred_at, entity_type, entity_id, event_type, payload
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "event-draft-1",
      "2026-04-03T10:06:00.000Z",
      "draft",
      "draft-1",
      "draft.refine.completed",
      JSON.stringify({
        run_id: "run-1",
        before_draft: {
          id: "draft-1",
        },
      }),
    );
    db.prepare(
      `
        INSERT INTO structured_events (
          id, occurred_at, entity_type, entity_id, event_type, payload
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "event-ticket-1",
      "2026-04-03T10:21:00.000Z",
      "ticket",
      "41",
      "ticket.review_ready",
      JSON.stringify({
        ticket_id: 41,
        review_package_id: "review-package-1",
      }),
    );

    db.prepare(
      `
        INSERT INTO review_packages (
          id, ticket_id, session_id, diff_ref, commit_refs, change_summary,
          validation_results, remaining_risks, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "review-package-1",
      41,
      "session-1",
      "/tmp/review-package-1.diff",
      JSON.stringify(["abc123"]),
      "Legacy diff summary",
      JSON.stringify([
        {
          command_id: "lint",
          label: "Lint",
          status: "passed",
          started_at: "2026-04-03T10:15:00.000Z",
          ended_at: "2026-04-03T10:15:10.000Z",
          exit_code: 0,
          failure_overridden: false,
          summary: "Lint passed",
          log_ref: "/tmp/lint.log",
        },
      ]),
      JSON.stringify(["Manual QA"]),
      "2026-04-03T10:16:00.000Z",
    );

    db.prepare(
      `
        INSERT INTO review_runs (
          id, ticket_id, review_package_id, implementation_session_id, status,
          adapter_session_ref, report, failure_message, created_at, updated_at,
          completed_at, trigger_source, prompt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "review-run-1",
      41,
      "review-package-1",
      "session-1",
      "completed",
      "review-thread-1",
      JSON.stringify({
        summary: "Looks good overall.",
        actionable_findings: [],
        remaining_risks: ["Manual QA"],
      }),
      null,
      "2026-04-03T10:16:30.000Z",
      "2026-04-03T10:17:30.000Z",
      "2026-04-03T10:17:30.000Z",
      "automatic",
      "Review the migrated changes.",
    );

    db.prepare(
      `
        INSERT INTO requested_change_notes (
          id, ticket_id, review_package_id, author_type, body, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "note-1",
      41,
      "review-package-1",
      "system",
      "Please preserve the review package and session history.",
      "2026-04-03T10:18:00.000Z",
    );

    db.prepare(
      `
        INSERT INTO session_logs (id, session_id, line, created_at)
        VALUES (?, ?, ?, ?)
      `,
    ).run(7, "session-1", "First persisted line", "2026-04-03T10:12:31.000Z");
    db.prepare(
      `
        INSERT INTO session_logs (id, session_id, line, created_at)
        VALUES (?, ?, ?, ?)
      `,
    ).run(8, "session-1", "Second persisted line", "2026-04-03T10:12:32.000Z");
  } finally {
    db.close();
  }
}

test("drizzle clean install matches the normalized WalleyBoard schema", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-drizzle-schema-"));
  const databasePath = join(tempDir, "walleyboard.sqlite");

  try {
    const handle = createMigratedWalleyboardDatabase(databasePath);
    handle.sqlite.close();

    const db = new DatabaseSync(databasePath);

    try {
      assert.deepEqual(listUserTables(db), [
        "__walleyboard_migrations",
        "draft_ticket_states",
        "execution_attempts",
        "execution_sessions",
        "projects",
        "repositories",
        "requested_change_notes",
        "review_packages",
        "review_runs",
        "session_logs",
        "structured_events",
        "tickets",
      ]);

      for (const [tableName, columns] of Object.entries(expectedTableColumns)) {
        assert.deepEqual(listColumnNames(db, tableName), columns);
      }

      const projectColumns = listColumns(db, "projects");
      assert.equal(projectColumns.get("agent_adapter")?.dflt_value, "'codex'");
      assert.equal(
        projectColumns.get("execution_backend")?.dflt_value,
        "'docker'",
      );
      assert.equal(
        projectColumns.get("disabled_mcp_servers")?.dflt_value,
        "'[]'",
      );
      assert.equal(
        projectColumns.get("default_review_action")?.dflt_value,
        "'direct_merge'",
      );
      assert.equal(
        projectColumns.get("max_concurrent_sessions")?.dflt_value,
        "4",
      );

      const reviewRunColumns = listColumns(db, "review_runs");
      assert.equal(
        reviewRunColumns.get("trigger_source")?.dflt_value,
        "'manual'",
      );

      assert.deepEqual(listForeignKeyTables(db, "execution_sessions"), [
        "projects",
        "repositories",
        "tickets",
      ]);
      assert.deepEqual(listForeignKeyTables(db, "review_runs"), [
        "execution_sessions",
        "review_packages",
        "tickets",
      ]);
      assert.deepEqual(listForeignKeyTables(db, "session_logs"), [
        "execution_sessions",
      ]);

      assert.deepEqual(listNamedIndexes(db), [
        "idx_drafts_project_id",
        "idx_events_entity",
        "idx_execution_attempts_session_attempt",
        "idx_execution_attempts_session_id",
        "idx_execution_sessions_project_status_queue",
        "idx_execution_sessions_ticket_id",
        "idx_repositories_project_id",
        "idx_requested_change_notes_ticket_id",
        "idx_review_packages_ticket_id",
        "idx_review_runs_ticket_id",
        "idx_session_logs_session_id",
        "idx_tickets_project_id",
        "idx_tickets_session_id",
      ]);

      assert.deepEqual(listMigrationNames(db), ["0000_clean_install"]);
    } finally {
      db.close();
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("drizzle upgrade preserves representative live data and normalizes project defaults", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-drizzle-upgrade-"));
  const databasePath = join(tempDir, "walleyboard.sqlite");
  let store: SqliteStore | undefined;

  try {
    createRepresentativeLiveDatabase(databasePath);

    store = new SqliteStore(databasePath);

    const project = store.getProject("project-1");
    assert.ok(project);
    assert.equal(project.agent_adapter, "codex");
    assert.equal(project.execution_backend, "docker");
    assert.equal(project.automatic_agent_review, true);
    assert.equal(project.automatic_agent_review_run_limit, 1);
    assert.deepEqual(project.disabled_mcp_servers, []);
    assert.equal(project.default_review_action, "direct_merge");
    assert.equal(project.max_concurrent_sessions, 4);
    assert.equal(project.color, "#2563EB");

    const repository = store.getRepository("repo-1");
    assert.ok(repository);
    assert.equal(repository.target_branch, "main");
    assert.deepEqual(repository.extra_env_allowlist, ["OPENAI_API_KEY"]);

    const draft = store.getDraft("draft-1");
    assert.ok(draft);
    assert.equal(draft.source_ticket_id, 41);
    assert.equal(draft.target_branch, "release/1.0");
    assert.deepEqual(draft.proposed_acceptance_criteria, [
      "Ship the migrated draft as-is.",
    ]);

    const ticket = store.getTicket(41);
    assert.ok(ticket);
    assert.equal(ticket.session_id, "session-1");
    assert.equal(ticket.working_branch, "codex/ticket-41");
    assert.equal(ticket.linked_pr?.number, 41);

    const session = store.getSession("session-1");
    assert.ok(session);
    assert.equal(session.agent_adapter, "claude-code");
    assert.equal(session.adapter_session_ref, "adapter-thread-1");
    assert.equal(session.current_attempt_id, "attempt-1");
    assert.equal(session.latest_review_package_id, "review-package-1");

    assert.deepEqual(store.getSessionLogs("session-1"), [
      "First persisted line",
      "Second persisted line",
    ]);
    assert.equal(store.listSessionAttempts("session-1")[0]?.id, "attempt-1");
    assert.equal(
      store.listSessionAttempts("session-1")[0]?.prompt,
      "Finish the migrated review ticket.",
    );

    assert.equal(store.getDraftEvents("draft-1")[0]?.payload.run_id, "run-1");
    assert.equal(
      store.getTicketEvents(41)[0]?.payload.review_package_id,
      "review-package-1",
    );
    assert.equal(store.getReviewPackage(41)?.id, "review-package-1");
    assert.equal(store.getLatestReviewRun(41)?.id, "review-run-1");
    assert.equal(
      store.getRequestedChangeNote("note-1")?.review_package_id,
      "review-package-1",
    );

    const validationDb = new DatabaseSync(databasePath);

    try {
      assert.deepEqual(listMigrationNames(validationDb), [
        "0001_upgrade_live_20260404",
      ]);
      assert.deepEqual(
        validationDb
          .prepare(
            `
              SELECT COUNT(*) AS count FROM projects
              UNION ALL
              SELECT COUNT(*) AS count FROM repositories
              UNION ALL
              SELECT COUNT(*) AS count FROM draft_ticket_states
              UNION ALL
              SELECT COUNT(*) AS count FROM tickets
              UNION ALL
              SELECT COUNT(*) AS count FROM execution_sessions
              UNION ALL
              SELECT COUNT(*) AS count FROM execution_attempts
              UNION ALL
              SELECT COUNT(*) AS count FROM structured_events
              UNION ALL
              SELECT COUNT(*) AS count FROM review_packages
              UNION ALL
              SELECT COUNT(*) AS count FROM review_runs
              UNION ALL
              SELECT COUNT(*) AS count FROM requested_change_notes
              UNION ALL
              SELECT COUNT(*) AS count FROM session_logs
            `,
          )
          .all()
          .map((row) => Number((row as { count: number }).count)),
        [1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 2],
      );

      const projectColumns = listColumns(validationDb, "projects");
      assert.equal(
        projectColumns.get("execution_backend")?.dflt_value,
        "'docker'",
      );
    } finally {
      validationDb.close();
    }

    const { project: freshProject } = store.createProject({
      name: "Fresh migrated project",
      repository: {
        name: "fresh-repo",
        path: join(tempDir, "fresh-repo"),
      },
    });
    assert.equal(freshProject.execution_backend, "docker");
  } finally {
    store?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("createApp migrates the live database before startup services query it", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-startup-migrate-"));
  const databasePath = join(tempDir, "walleyboard.sqlite");

  try {
    createRepresentativeLiveDatabase(databasePath);

    const app = await createApp({
      databasePath,
      dockerRuntime: createTestDockerRuntime(),
      skipStartupDockerCleanup: true,
    });

    try {
      const projectResponse = await app.inject({
        method: "GET",
        url: "/projects/project-1",
      });
      assert.equal(projectResponse.statusCode, 200);
      assert.equal(projectResponse.json().project.execution_backend, "docker");

      const sessionResponse = await app.inject({
        method: "GET",
        url: "/sessions/session-1",
      });
      assert.equal(sessionResponse.statusCode, 200);
      assert.equal(sessionResponse.json().session.status, "interrupted");

      const db = new DatabaseSync(databasePath);
      try {
        assert.deepEqual(listMigrationNames(db), [
          "0001_upgrade_live_20260404",
        ]);
        assert.equal(
          (
            db
              .prepare(
                `
                SELECT execution_backend
                FROM projects
                WHERE id = ?
              `,
              )
              .get("project-1") as { execution_backend: string } | undefined
          )?.execution_backend,
          "docker",
        );
      } finally {
        db.close();
      }
    } finally {
      await app.close();
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
