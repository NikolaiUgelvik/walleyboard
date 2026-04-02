import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { nanoid } from "nanoid";
import type {
  DraftTicketState,
  ExecutionAttempt,
  ExecutionSession,
  Project,
  ReasoningEffort,
  RepositoryConfig,
  RequestedChangeNote,
  ReviewPackage,
  StructuredEvent,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import { nowIso } from "../time.js";

export type JsonValue =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null;

export const slotOccupyingExecutionSessionStatuses = [
  "awaiting_input",
  "running",
] as const;
export const defaultMaxConcurrentSessions = 4;

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function normalizeTitle(value: string): string {
  return value.trim();
}

export function preserveMarkdown(value: string): string {
  return value;
}

export function hasMeaningfulContent(
  value: string | null | undefined,
): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function preserveMarkdownList(values: string[]): string[] {
  return values.filter((value) => hasMeaningfulContent(value));
}

export function formatMarkdownLog(label: string, body: string): string {
  return `${label}:\n${body}`;
}

export function normalizeOptionalModel(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return value ?? null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeOptionalReasoningEffort(
  value: ReasoningEffort | null | undefined,
): ReasoningEffort | null {
  return value ?? null;
}

export function normalizeOptionalCommand(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return value ?? null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function stringifyJson(value: JsonValue): string {
  return JSON.stringify(value);
}

export function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }

  return value;
}

export function deriveAcceptanceCriteria(
  title: string,
  description: string,
  instruction?: string,
): string[] {
  const criteria = new Set<string>();
  criteria.add(`Implement ${title}.`);

  if (description.length > 0) {
    criteria.add(`Cover the workflow described in:\n${description}`);
  }

  if (hasMeaningfulContent(instruction)) {
    criteria.add(`Account for refinement guidance:\n${instruction}`);
  }

  criteria.add("Keep the user-facing workflow coherent and testable.");
  return Array.from(criteria);
}

export function deriveWorkingBranch(ticketId: number, title: string): string {
  return `codex/ticket-${ticketId}-${slugify(title).slice(0, 24)}`;
}

export function mapProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    agent_adapter: row.agent_adapter === "codex" ? "codex" : "codex",
    execution_backend: row.execution_backend === "docker" ? "docker" : "host",
    default_target_branch:
      row.default_target_branch === null
        ? null
        : String(row.default_target_branch),
    pre_worktree_command:
      row.pre_worktree_command === null
        ? null
        : String(row.pre_worktree_command),
    post_worktree_command:
      row.post_worktree_command === null
        ? null
        : String(row.post_worktree_command),
    draft_analysis_model:
      row.draft_analysis_model === null
        ? null
        : String(row.draft_analysis_model),
    draft_analysis_reasoning_effort:
      row.draft_analysis_reasoning_effort === null
        ? null
        : (String(
            row.draft_analysis_reasoning_effort,
          ) as Project["draft_analysis_reasoning_effort"]),
    ticket_work_model:
      row.ticket_work_model === null ? null : String(row.ticket_work_model),
    ticket_work_reasoning_effort:
      row.ticket_work_reasoning_effort === null
        ? null
        : (String(
            row.ticket_work_reasoning_effort,
          ) as Project["ticket_work_reasoning_effort"]),
    max_concurrent_sessions: Number(row.max_concurrent_sessions),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function mapRepository(row: Record<string, unknown>): RepositoryConfig {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    name: String(row.name),
    path: String(row.path),
    target_branch:
      row.target_branch === null ? null : String(row.target_branch),
    setup_hook: parseJson(row.setup_hook, null),
    cleanup_hook: parseJson(row.cleanup_hook, null),
    validation_profile: parseJson(row.validation_profile, []),
    extra_env_allowlist: parseJson(row.extra_env_allowlist, []),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function mapDraft(row: Record<string, unknown>): DraftTicketState {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    artifact_scope_id: String(row.artifact_scope_id),
    title_draft: String(row.title_draft),
    description_draft:
      row.description_draft === null ? "" : String(row.description_draft),
    proposed_repo_id:
      row.proposed_repo_id === null ? null : String(row.proposed_repo_id),
    confirmed_repo_id:
      row.confirmed_repo_id === null ? null : String(row.confirmed_repo_id),
    proposed_ticket_type:
      row.proposed_ticket_type === null
        ? null
        : (String(
            row.proposed_ticket_type,
          ) as DraftTicketState["proposed_ticket_type"]),
    proposed_acceptance_criteria: parseJson(
      row.proposed_acceptance_criteria,
      [],
    ),
    wizard_status: String(
      row.wizard_status,
    ) as DraftTicketState["wizard_status"],
    split_proposal_summary:
      row.split_proposal_summary === null
        ? null
        : String(row.split_proposal_summary),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function mapTicket(row: Record<string, unknown>): TicketFrontmatter {
  return {
    id: Number(row.id),
    project: String(row.project_id),
    repo: String(row.repo_id),
    artifact_scope_id: String(row.artifact_scope_id),
    status: String(row.status) as TicketFrontmatter["status"],
    title: String(row.title),
    description: row.description === null ? "" : String(row.description),
    ticket_type: String(row.ticket_type) as TicketFrontmatter["ticket_type"],
    acceptance_criteria: parseJson(row.acceptance_criteria, []),
    working_branch:
      row.working_branch === null ? null : String(row.working_branch),
    target_branch: String(row.target_branch),
    linked_pr: parseJson(row.linked_pr, null),
    session_id: row.session_id === null ? null : String(row.session_id),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function mapStructuredEvent(
  row: Record<string, unknown>,
): StructuredEvent {
  return {
    id: String(row.id),
    occurred_at: String(row.occurred_at),
    entity_type: String(row.entity_type) as StructuredEvent["entity_type"],
    entity_id: String(row.entity_id),
    event_type: String(row.event_type),
    payload: parseJson(row.payload, {}),
  };
}

export function mapExecutionSession(
  row: Record<string, unknown>,
): ExecutionSession {
  return {
    id: String(row.id),
    ticket_id: Number(row.ticket_id),
    project_id: String(row.project_id),
    repo_id: String(row.repo_id),
    agent_adapter: row.agent_adapter === "codex" ? "codex" : "codex",
    worktree_path:
      row.worktree_path === null ? null : String(row.worktree_path),
    adapter_session_ref:
      row.adapter_session_ref === null ? null : String(row.adapter_session_ref),
    status: String(row.status) as ExecutionSession["status"],
    planning_enabled: Boolean(row.planning_enabled),
    plan_status: String(row.plan_status) as ExecutionSession["plan_status"],
    plan_summary: row.plan_summary === null ? null : String(row.plan_summary),
    current_attempt_id:
      row.current_attempt_id === null ? null : String(row.current_attempt_id),
    latest_requested_change_note_id:
      row.latest_requested_change_note_id === null
        ? null
        : String(row.latest_requested_change_note_id),
    latest_review_package_id:
      row.latest_review_package_id === null
        ? null
        : String(row.latest_review_package_id),
    queue_entered_at:
      row.queue_entered_at === null ? null : String(row.queue_entered_at),
    started_at: row.started_at === null ? null : String(row.started_at),
    completed_at: row.completed_at === null ? null : String(row.completed_at),
    last_heartbeat_at:
      row.last_heartbeat_at === null ? null : String(row.last_heartbeat_at),
    last_summary: row.last_summary === null ? null : String(row.last_summary),
  };
}

export function mapExecutionAttempt(
  row: Record<string, unknown>,
): ExecutionAttempt {
  return {
    id: String(row.id),
    session_id: String(row.session_id),
    attempt_number: Number(row.attempt_number),
    status: String(row.status) as ExecutionAttempt["status"],
    pty_pid: row.pty_pid === null ? null : Number(row.pty_pid),
    started_at: String(row.started_at),
    ended_at: row.ended_at === null ? null : String(row.ended_at),
    end_reason: row.end_reason === null ? null : String(row.end_reason),
  };
}

export function mapReviewPackage(row: Record<string, unknown>): ReviewPackage {
  return {
    id: String(row.id),
    ticket_id: Number(row.ticket_id),
    session_id: String(row.session_id),
    diff_ref: String(row.diff_ref),
    commit_refs: parseJson(row.commit_refs, []),
    change_summary: String(row.change_summary),
    validation_results: parseJson(row.validation_results, []),
    remaining_risks: parseJson(row.remaining_risks, []),
    created_at: String(row.created_at),
  };
}

export function mapRequestedChangeNote(
  row: Record<string, unknown>,
): RequestedChangeNote {
  return {
    id: String(row.id),
    ticket_id: Number(row.ticket_id),
    review_package_id:
      row.review_package_id === null ? null : String(row.review_package_id),
    author_type: String(row.author_type) as RequestedChangeNote["author_type"],
    body: String(row.body),
    created_at: String(row.created_at),
  };
}

export class SqliteStoreContext {
  readonly #db: DatabaseSync;

  constructor(databasePath?: string) {
    const resolvedPath =
      databasePath ?? join(process.cwd(), ".local", "orchestrator.sqlite");
    mkdirSync(dirname(resolvedPath), { recursive: true });
    this.#db = new DatabaseSync(resolvedPath);
    this.#db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.#initSchema();
  }

  get db(): DatabaseSync {
    return this.#db;
  }

  appendSessionLog(sessionId: string, line: string): void {
    this.#db
      .prepare(
        `
          INSERT INTO session_logs (session_id, line, created_at)
          VALUES (?, ?, ?)
        `,
      )
      .run(sessionId, line, nowIso());
  }

  recordStructuredEvent(
    entityType: StructuredEvent["entity_type"],
    entityId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): StructuredEvent {
    const event: StructuredEvent = {
      id: nanoid(),
      occurred_at: nowIso(),
      entity_type: entityType,
      entity_id: entityId,
      event_type: eventType,
      payload,
    };

    this.#db
      .prepare(
        `
          INSERT INTO structured_events (
            id, occurred_at, entity_type, entity_id, event_type, payload
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        event.id,
        event.occurred_at,
        event.entity_type,
        event.entity_id,
        event.event_type,
        stringifyJson(event.payload),
      );

    return event;
  }

  countOccupiedExecutionSlotsForProject(
    projectId: string,
    excludedSessionId?: string,
  ): number {
    const row = this.#db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM execution_sessions
          WHERE project_id = ?
            ${excludedSessionId ? "AND id != ?" : ""}
            AND status IN (${slotOccupyingExecutionSessionStatuses.map(() => "?").join(", ")})
        `,
      )
      .get(
        projectId,
        ...(excludedSessionId ? [excludedSessionId] : []),
        ...slotOccupyingExecutionSessionStatuses,
      ) as { count: number };

    return Number(row.count);
  }

  nextAttemptNumber(sessionId: string): number {
    const row = this.#db
      .prepare(
        `
          SELECT COALESCE(MAX(attempt_number), 0) AS max_attempt_number
          FROM execution_attempts
          WHERE session_id = ?
        `,
      )
      .get(sessionId) as { max_attempt_number: number };

    return Number(row.max_attempt_number) + 1;
  }

  #initSchema() {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
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
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS repositories (
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

      CREATE TABLE IF NOT EXISTS draft_ticket_states (
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
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS tickets (
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

      CREATE TABLE IF NOT EXISTS execution_sessions (
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

      CREATE TABLE IF NOT EXISTS execution_attempts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        attempt_number INTEGER NOT NULL,
        status TEXT NOT NULL,
        pty_pid INTEGER,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        end_reason TEXT
      );

      CREATE TABLE IF NOT EXISTS structured_events (
        id TEXT PRIMARY KEY,
        occurred_at TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS review_packages (
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

      CREATE TABLE IF NOT EXISTS requested_change_notes (
        id TEXT PRIMARY KEY,
        ticket_id INTEGER NOT NULL,
        review_package_id TEXT,
        author_type TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        line TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_repositories_project_id ON repositories(project_id);
      CREATE INDEX IF NOT EXISTS idx_drafts_project_id ON draft_ticket_states(project_id);
      CREATE INDEX IF NOT EXISTS idx_tickets_project_id ON tickets(project_id);
      CREATE INDEX IF NOT EXISTS idx_events_entity ON structured_events(entity_type, entity_id, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_session_logs_session_id ON session_logs(session_id, id ASC);
    `);

    this.#renameColumnIfPresent(
      "execution_sessions",
      "codex_session_id",
      "adapter_session_ref",
    );
    this.#ensureColumn(
      "projects",
      "agent_adapter",
      "TEXT NOT NULL DEFAULT 'codex'",
    );
    this.#ensureColumn(
      "execution_sessions",
      "agent_adapter",
      "TEXT NOT NULL DEFAULT 'codex'",
    );
    this.#ensureColumn("execution_sessions", "worktree_path", "TEXT");
    this.#ensureColumn("execution_sessions", "adapter_session_ref", "TEXT");
    this.#ensureColumn(
      "execution_sessions",
      "plan_status",
      "TEXT NOT NULL DEFAULT 'not_requested'",
    );
    this.#ensureColumn("execution_sessions", "plan_summary", "TEXT");
    this.#ensureColumn("tickets", "description", "TEXT NOT NULL DEFAULT ''");
    this.#ensureColumn(
      "tickets",
      "acceptance_criteria",
      "TEXT NOT NULL DEFAULT '[]'",
    );
    this.#ensureColumn("tickets", "archived_at", "TEXT");
    this.#ensureColumn("draft_ticket_states", "artifact_scope_id", "TEXT");
    this.#ensureColumn("tickets", "artifact_scope_id", "TEXT");
    this.#ensureColumn("projects", "draft_analysis_model", "TEXT");
    this.#ensureColumn("projects", "draft_analysis_reasoning_effort", "TEXT");
    this.#ensureColumn("projects", "ticket_work_model", "TEXT");
    this.#ensureColumn("projects", "ticket_work_reasoning_effort", "TEXT");
    this.#ensureColumn("projects", "pre_worktree_command", "TEXT");
    this.#ensureColumn("projects", "post_worktree_command", "TEXT");
    this.#ensureColumn(
      "projects",
      "execution_backend",
      "TEXT NOT NULL DEFAULT 'host'",
    );
    this.#backfillArtifactScopes();
    this.#backfillAgentAdapterDefaults();
    this.#backfillProjectConcurrencyDefaults();
    this.#backfillProjectExecutionBackendDefaults();
    this.#backfillTicketContext();
  }

  #ensureColumn(
    tableName: string,
    columnName: string,
    definition: string,
  ): void {
    const columns = this.#listColumns(tableName);

    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    this.#db.exec(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`,
    );
  }

  #renameColumnIfPresent(
    tableName: string,
    fromColumn: string,
    toColumn: string,
  ): void {
    const columns = this.#listColumns(tableName);
    const hasFromColumn = columns.some((column) => column.name === fromColumn);
    const hasToColumn = columns.some((column) => column.name === toColumn);

    if (!hasFromColumn || hasToColumn) {
      return;
    }

    this.#db.exec(
      `ALTER TABLE ${tableName} RENAME COLUMN ${fromColumn} TO ${toColumn};`,
    );
  }

  #listColumns(tableName: string): Array<{ name: string }> {
    return this.#db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
      name: string;
    }>;
  }

  #backfillTicketContext(): void {
    const ticketsNeedingContext = this.#db
      .prepare(
        `
          SELECT id, description, acceptance_criteria
          FROM tickets
          WHERE description = '' OR acceptance_criteria = '[]'
        `,
      )
      .all() as Array<{
      id: number;
      description: string;
      acceptance_criteria: string;
    }>;

    for (const ticket of ticketsNeedingContext) {
      const eventRow = this.#db
        .prepare(
          `
            SELECT payload
            FROM structured_events
            WHERE entity_type = 'ticket'
              AND entity_id = ?
              AND event_type = 'ticket.created'
            ORDER BY occurred_at DESC
            LIMIT 1
          `,
        )
        .get(String(ticket.id)) as { payload: string } | undefined;

      if (!eventRow) {
        continue;
      }

      const payload = parseJson(eventRow.payload, {}) as {
        description?: unknown;
        acceptance_criteria?: unknown;
      };
      const description =
        ticket.description.length > 0
          ? ticket.description
          : typeof payload.description === "string"
            ? payload.description
            : "";
      const acceptanceCriteria =
        ticket.acceptance_criteria !== "[]"
          ? ticket.acceptance_criteria
          : stringifyJson(
              Array.isArray(payload.acceptance_criteria)
                ? preserveMarkdownList(
                    payload.acceptance_criteria.filter(
                      (criterion): criterion is string =>
                        typeof criterion === "string",
                    ),
                  )
                : [],
            );

      this.#db
        .prepare(
          `
            UPDATE tickets
            SET description = ?, acceptance_criteria = ?
            WHERE id = ?
          `,
        )
        .run(description, acceptanceCriteria, ticket.id);
    }
  }

  #backfillProjectConcurrencyDefaults(): void {
    this.#db
      .prepare(
        `
          UPDATE projects
          SET max_concurrent_sessions = ?
          WHERE max_concurrent_sessions = 1
        `,
      )
      .run(defaultMaxConcurrentSessions);
  }

  #backfillProjectExecutionBackendDefaults(): void {
    this.#db
      .prepare(
        `
          UPDATE projects
          SET execution_backend = 'host'
          WHERE execution_backend IS NULL OR execution_backend = ''
        `,
      )
      .run();
  }

  #backfillAgentAdapterDefaults(): void {
    this.#db
      .prepare(
        `
          UPDATE projects
          SET agent_adapter = 'codex'
          WHERE agent_adapter IS NULL OR agent_adapter = ''
        `,
      )
      .run();

    this.#db
      .prepare(
        `
          UPDATE execution_sessions
          SET agent_adapter = 'codex'
          WHERE agent_adapter IS NULL OR agent_adapter = ''
        `,
      )
      .run();
  }

  #backfillArtifactScopes(): void {
    const draftRows = this.#db
      .prepare(
        `
          SELECT id
          FROM draft_ticket_states
          WHERE artifact_scope_id IS NULL OR artifact_scope_id = ''
        `,
      )
      .all() as Array<{ id: string }>;

    for (const row of draftRows) {
      this.#db
        .prepare(
          `
            UPDATE draft_ticket_states
            SET artifact_scope_id = ?
            WHERE id = ?
          `,
        )
        .run(nanoid(), row.id);
    }

    const ticketRows = this.#db
      .prepare(
        `
          SELECT id
          FROM tickets
          WHERE artifact_scope_id IS NULL OR artifact_scope_id = ''
        `,
      )
      .all() as Array<{ id: number }>;

    for (const row of ticketRows) {
      this.#db
        .prepare(
          `
            UPDATE tickets
            SET artifact_scope_id = ?
            WHERE id = ?
          `,
        )
        .run(nanoid(), row.id);
    }
  }
}
