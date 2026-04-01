import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { nanoid } from "nanoid";
import type {
  CreateDraftInput,
  CreateProjectInput,
  DraftTicketState,
  ExecutionAttempt,
  ExecutionPlanStatus,
  ExecutionSession,
  ExecutionSessionStatus,
  Project,
  ReasoningEffort,
  RepositoryConfig,
  RequestedChangeNote,
  ReviewPackage,
  StructuredEvent,
  TicketFrontmatter,
  UpdateProjectInput,
} from "../../../../packages/contracts/src/index.js";

import type {
  CompleteSessionInput,
  ConfirmDraftInput,
  CreateReviewPackageInput,
  ListProjectTicketsOptions,
  MergeConflictResult,
  PreparedExecutionRuntime,
  RestartTicketResult,
  StartTicketResult,
  StartupRecoveryResult,
  StopTicketResult,
  Store,
  UpdateDraftRecordInput,
  UpdateSessionPlanInput,
} from "./store.js";
import { nowIso } from "./time.js";

type JsonValue =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null;

const slotOccupyingExecutionSessionStatuses = [
  "awaiting_input",
  "running",
] as const;
const defaultMaxConcurrentSessions = 4;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function normalizeTitle(value: string): string {
  return value.trim();
}

function preserveMarkdown(value: string): string {
  return value;
}

function hasMeaningfulContent(
  value: string | null | undefined,
): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function preserveMarkdownList(values: string[]): string[] {
  return values.filter((value) => hasMeaningfulContent(value));
}

function formatMarkdownLog(label: string, body: string): string {
  return `${label}:\n${body}`;
}

function normalizeOptionalModel(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return value ?? null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalReasoningEffort(
  value: ReasoningEffort | null | undefined,
): ReasoningEffort | null {
  return value ?? null;
}

function normalizeOptionalCommand(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return value ?? null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function stringifyJson(value: JsonValue): string {
  return JSON.stringify(value);
}

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }

  return value;
}

function deriveAcceptanceCriteria(
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

function deriveWorkingBranch(ticketId: number, title: string): string {
  return `codex/ticket-${ticketId}-${slugify(title).slice(0, 24)}`;
}

function mapProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
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

function mapRepository(row: Record<string, unknown>): RepositoryConfig {
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

function mapDraft(row: Record<string, unknown>): DraftTicketState {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    artifact_scope_id: String(row.artifact_scope_id),
    title_draft: String(row.title_draft),
    description_draft: String(row.description_draft),
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

function mapTicket(row: Record<string, unknown>): TicketFrontmatter {
  return {
    id: Number(row.id),
    project: String(row.project_id),
    repo: String(row.repo_id),
    artifact_scope_id: String(row.artifact_scope_id),
    status: String(row.status) as TicketFrontmatter["status"],
    title: String(row.title),
    description: String(row.description ?? ""),
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

function mapStructuredEvent(row: Record<string, unknown>): StructuredEvent {
  return {
    id: String(row.id),
    occurred_at: String(row.occurred_at),
    entity_type: String(row.entity_type) as StructuredEvent["entity_type"],
    entity_id: String(row.entity_id),
    event_type: String(row.event_type),
    payload: parseJson(row.payload, {}),
  };
}

function mapExecutionSession(row: Record<string, unknown>): ExecutionSession {
  return {
    id: String(row.id),
    ticket_id: Number(row.ticket_id),
    project_id: String(row.project_id),
    repo_id: String(row.repo_id),
    worktree_path:
      row.worktree_path === null ? null : String(row.worktree_path),
    status: String(row.status) as ExecutionSession["status"],
    planning_enabled: Boolean(row.planning_enabled),
    plan_status: String(row.plan_status) as ExecutionPlanStatus,
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

function mapExecutionAttempt(row: Record<string, unknown>): ExecutionAttempt {
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

function mapReviewPackage(row: Record<string, unknown>): ReviewPackage {
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

function mapRequestedChangeNote(
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

export class SqliteStore implements Store {
  readonly #db: DatabaseSync;

  constructor(databasePath?: string) {
    const resolvedPath =
      databasePath ?? join(process.cwd(), ".local", "orchestrator.sqlite");
    mkdirSync(dirname(resolvedPath), { recursive: true });
    this.#db = new DatabaseSync(resolvedPath);
    this.#db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.#initSchema();
  }

  #initSchema() {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
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
        worktree_path TEXT,
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

    this.#ensureColumn("execution_sessions", "worktree_path", "TEXT");
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
    this.#backfillArtifactScopes();
    this.#backfillProjectConcurrencyDefaults();
    this.#backfillTicketContext();
  }

  #ensureColumn(
    tableName: string,
    columnName: string,
    definition: string,
  ): void {
    const columns = this.#db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{ name: string }>;

    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    this.#db.exec(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`,
    );
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

  #recordStructuredEvent(
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

  #appendSessionLog(sessionId: string, line: string): void {
    this.#db
      .prepare(
        `
          INSERT INTO session_logs (session_id, line, created_at)
          VALUES (?, ?, ?)
        `,
      )
      .run(sessionId, line, nowIso());
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

  #countOccupiedExecutionSlotsForProject(
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

  #nextAttemptNumber(sessionId: string): number {
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

  appendSessionLog(sessionId: string, line: string): number {
    this.#appendSessionLog(sessionId, line);
    return this.getSessionLogs(sessionId).length - 1;
  }

  listProjects(): Project[] {
    const rows = this.#db
      .prepare("SELECT * FROM projects ORDER BY updated_at DESC, name ASC")
      .all() as Record<string, unknown>[];
    return rows.map(mapProject);
  }

  getProject(projectId: string): Project | undefined {
    const row = this.#db
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(projectId) as Record<string, unknown> | undefined;
    return row ? mapProject(row) : undefined;
  }

  getRepository(repositoryId: string): RepositoryConfig | undefined {
    const row = this.#db
      .prepare("SELECT * FROM repositories WHERE id = ?")
      .get(repositoryId) as Record<string, unknown> | undefined;
    return row ? mapRepository(row) : undefined;
  }

  createProject(input: CreateProjectInput): {
    project: Project;
    repository: RepositoryConfig;
  } {
    const timestamp = nowIso();
    const projectId = nanoid();
    const repositoryId = nanoid();
    const slug = slugify(input.slug ?? input.name);
    const defaultTargetBranch = input.default_target_branch ?? "main";

    this.#db
      .prepare(
        `
          INSERT INTO projects (
            id, slug, name, default_target_branch, pre_worktree_command,
            post_worktree_command, draft_analysis_model,
            draft_analysis_reasoning_effort, ticket_work_model,
            ticket_work_reasoning_effort, max_concurrent_sessions, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        projectId,
        slug,
        input.name.trim(),
        defaultTargetBranch,
        null,
        null,
        null,
        null,
        null,
        null,
        defaultMaxConcurrentSessions,
        timestamp,
        timestamp,
      );

    this.#db
      .prepare(
        `
          INSERT INTO repositories (
            id, project_id, name, path, target_branch, setup_hook, cleanup_hook,
            validation_profile, extra_env_allowlist, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        repositoryId,
        projectId,
        input.repository.name.trim(),
        input.repository.path,
        input.repository.target_branch ?? defaultTargetBranch,
        null,
        null,
        stringifyJson(
          (input.repository.validation_commands ?? []).map(
            (command, index) => ({
              id: nanoid(),
              label: `Validation ${index + 1}`,
              command: command.trim(),
              working_directory: input.repository.path,
              timeout_ms: 300_000,
              required_for_review: true,
              shell: true,
            }),
          ),
        ),
        stringifyJson([]),
        timestamp,
        timestamp,
      );

    return {
      project: requireValue(
        this.getProject(projectId),
        "Project not found after creation",
      ),
      repository: requireValue(
        this.listProjectRepositories(projectId)[0],
        "Repository not found after creation",
      ),
    };
  }

  updateProject(projectId: string, input: UpdateProjectInput): Project {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    const draftAnalysisModel =
      input.draft_analysis_model === undefined
        ? project.draft_analysis_model
        : normalizeOptionalModel(input.draft_analysis_model);
    const preWorktreeCommand =
      input.pre_worktree_command === undefined
        ? project.pre_worktree_command
        : normalizeOptionalCommand(input.pre_worktree_command);
    const postWorktreeCommand =
      input.post_worktree_command === undefined
        ? project.post_worktree_command
        : normalizeOptionalCommand(input.post_worktree_command);
    const draftAnalysisReasoningEffort =
      input.draft_analysis_reasoning_effort === undefined
        ? project.draft_analysis_reasoning_effort
        : normalizeOptionalReasoningEffort(
            input.draft_analysis_reasoning_effort,
          );
    const ticketWorkModel =
      input.ticket_work_model === undefined
        ? project.ticket_work_model
        : normalizeOptionalModel(input.ticket_work_model);
    const ticketWorkReasoningEffort =
      input.ticket_work_reasoning_effort === undefined
        ? project.ticket_work_reasoning_effort
        : normalizeOptionalReasoningEffort(input.ticket_work_reasoning_effort);
    const timestamp = nowIso();

    this.#db
      .prepare(
        `
          UPDATE projects
          SET pre_worktree_command = ?,
              post_worktree_command = ?,
              draft_analysis_model = ?,
              draft_analysis_reasoning_effort = ?,
              ticket_work_model = ?,
              ticket_work_reasoning_effort = ?,
              updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        preWorktreeCommand,
        postWorktreeCommand,
        draftAnalysisModel,
        draftAnalysisReasoningEffort,
        ticketWorkModel,
        ticketWorkReasoningEffort,
        timestamp,
        projectId,
      );

    return requireValue(
      this.getProject(projectId),
      "Project not found after update",
    );
  }

  deleteProject(projectId: string): Project | undefined {
    const project = this.getProject(projectId);
    if (!project) {
      return undefined;
    }

    for (const draft of this.listProjectDrafts(projectId)) {
      this.deleteDraft(draft.id);
    }

    for (const ticket of this.listProjectTickets(projectId, {
      includeArchived: true,
    })) {
      this.deleteTicket(ticket.id);
    }

    this.#db
      .prepare("DELETE FROM repositories WHERE project_id = ?")
      .run(projectId);
    this.#db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);

    return project;
  }

  listProjectRepositories(projectId: string): RepositoryConfig[] {
    const rows = this.#db
      .prepare(
        "SELECT * FROM repositories WHERE project_id = ? ORDER BY created_at ASC",
      )
      .all(projectId) as Record<string, unknown>[];
    return rows.map(mapRepository);
  }

  listProjectDrafts(projectId: string): DraftTicketState[] {
    const rows = this.#db
      .prepare(
        "SELECT * FROM draft_ticket_states WHERE project_id = ? ORDER BY updated_at DESC",
      )
      .all(projectId) as Record<string, unknown>[];
    return rows.map(mapDraft);
  }

  listProjectTickets(
    projectId: string,
    options: ListProjectTicketsOptions = {},
  ): TicketFrontmatter[] {
    const { includeArchived = false } = options;
    const rows = this.#db
      .prepare(
        `
          SELECT *
          FROM tickets
          WHERE project_id = ?
            AND (? OR archived_at IS NULL)
          ORDER BY updated_at DESC, id DESC
        `,
      )
      .all(projectId, includeArchived ? 1 : 0) as Record<string, unknown>[];
    return rows.map(mapTicket);
  }

  createDraft(input: CreateDraftInput): DraftTicketState {
    const project = this.getProject(input.project_id);
    if (!project) {
      throw new Error("Project not found");
    }

    const firstRepository = this.listProjectRepositories(project.id)[0];
    const proposedTicketType =
      input.proposed_ticket_type === undefined
        ? "feature"
        : input.proposed_ticket_type;
    const proposedAcceptanceCriteria = (
      input.proposed_acceptance_criteria ?? []
    ).filter((criterion) => hasMeaningfulContent(criterion));
    const timestamp = nowIso();
    const draftId = nanoid();
    const artifactScopeId = input.artifact_scope_id ?? nanoid();

    this.#db
      .prepare(
        `
          INSERT INTO draft_ticket_states (
            id, project_id, artifact_scope_id, title_draft, description_draft, proposed_repo_id, confirmed_repo_id,
            proposed_ticket_type, proposed_acceptance_criteria, wizard_status, split_proposal_summary,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        draftId,
        input.project_id,
        artifactScopeId,
        normalizeTitle(input.title),
        preserveMarkdown(input.description),
        firstRepository?.id ?? null,
        null,
        proposedTicketType,
        stringifyJson(proposedAcceptanceCriteria),
        "editing",
        null,
        timestamp,
        timestamp,
      );

    return requireValue(
      this.getDraft(draftId),
      "Draft not found after creation",
    );
  }

  getDraft(draftId: string): DraftTicketState | undefined {
    const row = this.#db
      .prepare("SELECT * FROM draft_ticket_states WHERE id = ?")
      .get(draftId) as Record<string, unknown> | undefined;
    return row ? mapDraft(row) : undefined;
  }

  updateDraft(
    draftId: string,
    input: UpdateDraftRecordInput,
  ): DraftTicketState {
    const draft = this.getDraft(draftId);
    if (!draft) {
      throw new Error("Draft not found");
    }

    const title = normalizeTitle(input.title_draft ?? draft.title_draft);
    const description = preserveMarkdown(
      input.description_draft ?? draft.description_draft,
    );
    const proposedTicketType =
      input.proposed_ticket_type === undefined
        ? draft.proposed_ticket_type
        : input.proposed_ticket_type;
    const proposedAcceptanceCriteria =
      input.proposed_acceptance_criteria === undefined
        ? draft.proposed_acceptance_criteria
        : preserveMarkdownList(input.proposed_acceptance_criteria);
    const splitProposalSummary =
      input.split_proposal_summary === undefined
        ? draft.split_proposal_summary
        : input.split_proposal_summary;
    const wizardStatus = input.wizard_status ?? draft.wizard_status;
    const timestamp = nowIso();

    this.#db
      .prepare(
        `
          UPDATE draft_ticket_states
          SET title_draft = ?, description_draft = ?, proposed_ticket_type = ?,
              proposed_acceptance_criteria = ?, wizard_status = ?, split_proposal_summary = ?,
              updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        title,
        description,
        proposedTicketType,
        stringifyJson(proposedAcceptanceCriteria),
        wizardStatus,
        splitProposalSummary,
        timestamp,
        draftId,
      );

    return requireValue(this.getDraft(draftId), "Draft not found after update");
  }

  deleteDraft(draftId: string): DraftTicketState | undefined {
    const draft = this.getDraft(draftId);
    if (!draft) {
      return undefined;
    }

    this.#db
      .prepare(
        `
          DELETE FROM structured_events
          WHERE entity_type = 'draft' AND entity_id = ?
        `,
      )
      .run(draftId);
    this.#db
      .prepare("DELETE FROM draft_ticket_states WHERE id = ?")
      .run(draftId);
    return draft;
  }

  refineDraft(draftId: string, instruction?: string): DraftTicketState {
    const draft = this.getDraft(draftId);
    if (!draft) {
      throw new Error("Draft not found");
    }

    const title = normalizeTitle(draft.title_draft);
    const description = preserveMarkdown(draft.description_draft);
    const acceptanceCriteria = deriveAcceptanceCriteria(
      title,
      description,
      instruction,
    );
    const timestamp = nowIso();

    this.#db
      .prepare(
        `
          UPDATE draft_ticket_states
          SET title_draft = ?, description_draft = ?, proposed_acceptance_criteria = ?,
              wizard_status = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        title,
        description,
        stringifyJson(acceptanceCriteria),
        "awaiting_confirmation",
        timestamp,
        draftId,
      );

    return requireValue(
      this.getDraft(draftId),
      "Draft not found after refinement",
    );
  }

  confirmDraft(draftId: string, input: ConfirmDraftInput): TicketFrontmatter {
    const draft = this.getDraft(draftId);
    if (!draft) {
      throw new Error("Draft not found");
    }

    const repository = this.#db
      .prepare("SELECT * FROM repositories WHERE id = ?")
      .get(input.repo_id) as Record<string, unknown> | undefined;
    if (!repository) {
      throw new Error("Repository not found");
    }

    const timestamp = nowIso();

    const insertTicket = this.#db
      .prepare(
        `
          INSERT INTO tickets (
            project_id, repo_id, artifact_scope_id, status, title, description, ticket_type,
            acceptance_criteria, working_branch, target_branch, linked_pr,
            session_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        draft.project_id,
        input.repo_id,
        draft.artifact_scope_id,
        "ready",
        normalizeTitle(input.title),
        preserveMarkdown(input.description),
        input.ticket_type,
        stringifyJson(preserveMarkdownList(input.acceptance_criteria)),
        null,
        input.target_branch,
        null,
        null,
        timestamp,
        timestamp,
      );
    const ticketId = Number(insertTicket.lastInsertRowid);

    this.#db
      .prepare("DELETE FROM draft_ticket_states WHERE id = ?")
      .run(draftId);

    this.recordTicketEvent(ticketId, "ticket.created", {
      title: normalizeTitle(input.title),
      description: preserveMarkdown(input.description),
      acceptance_criteria: preserveMarkdownList(input.acceptance_criteria),
    });

    return requireValue(
      this.getTicket(ticketId),
      "Ticket not found after creation",
    );
  }

  getTicket(ticketId: number): TicketFrontmatter | undefined {
    const row = this.#db
      .prepare("SELECT * FROM tickets WHERE id = ?")
      .get(ticketId) as Record<string, unknown> | undefined;
    return row ? mapTicket(row) : undefined;
  }

  getReviewPackage(ticketId: number): ReviewPackage | undefined {
    const row = this.#db
      .prepare(
        "SELECT * FROM review_packages WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(ticketId) as Record<string, unknown> | undefined;
    return row ? mapReviewPackage(row) : undefined;
  }

  startTicket(
    ticketId: number,
    planningEnabled: boolean,
    runtime: PreparedExecutionRuntime,
  ): StartTicketResult {
    const ticket = this.getTicket(ticketId);
    if (!ticket) {
      throw new Error("Ticket not found");
    }
    if (ticket.status !== "ready") {
      throw new Error("Only ready tickets can be started");
    }
    if (ticket.session_id) {
      throw new Error("Ticket already has an execution session");
    }

    const project = this.getProject(ticket.project);
    if (!project) {
      throw new Error("Project not found");
    }
    const sessionId = nanoid();
    const attemptId = nanoid();
    const timestamp = nowIso();
    const shouldQueue =
      this.#countOccupiedExecutionSlotsForProject(ticket.project) >=
      project.max_concurrent_sessions;
    const planStatus: ExecutionPlanStatus = planningEnabled
      ? "drafting"
      : "not_requested";
    const summary = shouldQueue
      ? planningEnabled
        ? "Execution queued. The worktree is ready and planning will begin when a project slot opens."
        : "Execution queued. The worktree is ready and Codex will start when a project slot opens."
      : planningEnabled
        ? "Execution session created, worktree prepared, and plan requested from Codex."
        : "Execution session created, worktree prepared, and Codex launch requested.";

    this.#db
      .prepare(
        `
          UPDATE tickets
          SET status = ?, session_id = ?, working_branch = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        "in_progress",
        sessionId,
        runtime.workingBranch,
        timestamp,
        ticketId,
      );

    this.#db
      .prepare(
        `
          INSERT INTO execution_sessions (
            id, ticket_id, project_id, repo_id, worktree_path, status, planning_enabled, plan_status, plan_summary, current_attempt_id,
            latest_requested_change_note_id, latest_review_package_id, queue_entered_at,
            started_at, completed_at, last_heartbeat_at, last_summary
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        sessionId,
        ticket.id,
        ticket.project,
        ticket.repo,
        runtime.worktreePath,
        shouldQueue ? "queued" : "awaiting_input",
        planningEnabled ? 1 : 0,
        planStatus,
        null,
        attemptId,
        null,
        null,
        shouldQueue ? timestamp : null,
        timestamp,
        null,
        timestamp,
        summary,
      );

    this.#db
      .prepare(
        `
          INSERT INTO execution_attempts (
            id, session_id, attempt_number, status, pty_pid, started_at, ended_at, end_reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(attemptId, sessionId, 1, "queued", null, timestamp, null, null);

    const logs = [
      `Session created for ticket #${ticket.id}: ${ticket.title}`,
      `Working branch reserved: ${runtime.workingBranch}`,
      `Worktree prepared at: ${runtime.worktreePath}`,
      `Planning mode: ${planningEnabled ? "enabled" : "disabled"}`,
      ...runtime.logs,
      shouldQueue
        ? `Execution queued. ${project.max_concurrent_sessions} running slots are already in use for this project.`
        : "Codex launch has been handed off to the execution runtime.",
    ];

    for (const line of logs) {
      this.#appendSessionLog(sessionId, line);
    }

    this.#recordStructuredEvent("ticket", String(ticket.id), "ticket.started", {
      ticket_id: ticket.id,
      session_id: sessionId,
      working_branch: runtime.workingBranch,
      worktree_path: runtime.worktreePath,
    });
    this.#recordStructuredEvent("session", sessionId, "session.started", {
      ticket_id: ticket.id,
      attempt_id: attemptId,
      planning_enabled: planningEnabled,
      worktree_path: runtime.worktreePath,
    });

    return {
      ticket: requireValue(
        this.getTicket(ticket.id),
        "Ticket not found after session start",
      ),
      session: requireValue(
        this.getSession(sessionId),
        "Session not found after start",
      ),
      attempt: requireValue(
        this.listSessionAttempts(sessionId)[0],
        "Execution attempt not found after start",
      ),
      logs,
    };
  }

  stopTicket(ticketId: number, reason?: string): StopTicketResult {
    const ticket = this.getTicket(ticketId);
    if (!ticket) {
      throw new Error("Ticket not found");
    }
    if (ticket.status !== "in_progress") {
      throw new Error("Only in-progress tickets can be stopped");
    }
    if (!ticket.session_id) {
      throw new Error("Ticket has no execution session");
    }

    const session = this.getSession(ticket.session_id);
    if (!session) {
      throw new Error("Execution session not found");
    }
    if (
      ![
        "queued",
        "running",
        "paused_checkpoint",
        "paused_user_control",
        "awaiting_input",
      ].includes(session.status)
    ) {
      throw new Error(
        `Session cannot be stopped from status ${session.status}`,
      );
    }

    const timestamp = nowIso();
    const reasonBody = hasMeaningfulContent(reason) ? reason : null;
    const summary = reasonBody
      ? formatMarkdownLog("Execution stopped by user", reasonBody)
      : "Execution was stopped by user and can be resumed from the existing worktree.";

    this.#db
      .prepare(
        `
          UPDATE execution_sessions
          SET status = ?, last_heartbeat_at = ?, last_summary = ?
          WHERE id = ?
        `,
      )
      .run("interrupted", timestamp, summary, session.id);

    const attempt = session.current_attempt_id
      ? (this.updateExecutionAttempt(session.current_attempt_id, {
          status: "interrupted",
          end_reason: "user_stop",
        }) ?? null)
      : null;

    const logs = [
      reasonBody
        ? formatMarkdownLog("Execution stopped by user", reasonBody)
        : "Execution stopped by user.",
      `Worktree preserved at: ${session.worktree_path ?? "unknown"}`,
      `Working branch preserved: ${ticket.working_branch ?? "unknown"}`,
    ];

    for (const line of logs) {
      this.#appendSessionLog(session.id, line);
    }

    this.#recordStructuredEvent("session", session.id, "session.interrupted", {
      ticket_id: ticketId,
      reason: reasonBody,
      interruption_source: "user_stop",
    });
    this.#recordStructuredEvent("ticket", String(ticketId), "ticket.stopped", {
      ticket_id: ticketId,
      session_id: session.id,
      reason: reasonBody,
    });

    return {
      ticket: requireValue(
        this.getTicket(ticketId),
        "Ticket not found after stop",
      ),
      session: requireValue(
        this.getSession(session.id),
        "Session not found after stop",
      ),
      attempt,
      logs,
    };
  }

  requestTicketChanges(ticketId: number, body: string): RestartTicketResult {
    const ticket = this.getTicket(ticketId);
    if (!ticket) {
      throw new Error("Ticket not found");
    }
    if (ticket.status !== "review") {
      throw new Error("Only review tickets can request changes");
    }
    if (!ticket.session_id) {
      throw new Error("Ticket has no execution session");
    }

    const session = this.getSession(ticket.session_id);
    if (!session) {
      throw new Error("Execution session not found");
    }
    if (!session.worktree_path) {
      throw new Error("Execution session has no prepared worktree");
    }
    const project = this.getProject(ticket.project);
    if (!project) {
      throw new Error("Project not found");
    }
    const reviewPackage = this.getReviewPackage(ticketId);
    if (!reviewPackage) {
      throw new Error("Review package not found");
    }

    const noteId = nanoid();
    const attemptId = nanoid();
    const timestamp = nowIso();
    const attemptNumber = this.#nextAttemptNumber(session.id);
    const shouldQueue =
      this.#countOccupiedExecutionSlotsForProject(ticket.project) >=
      project.max_concurrent_sessions;
    const summary = shouldQueue
      ? "Review feedback was recorded. The session is queued and will relaunch on the existing worktree when a project slot opens."
      : "Review feedback was recorded and the execution session is relaunching on the existing worktree.";

    this.#db
      .prepare(
        `
          INSERT INTO requested_change_notes (
            id, ticket_id, review_package_id, author_type, body, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(noteId, ticketId, reviewPackage.id, "user", body, timestamp);

    this.#db
      .prepare(
        `
          UPDATE tickets
          SET status = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run("in_progress", timestamp, ticketId);

    this.#db
      .prepare(
        `
          UPDATE execution_sessions
          SET status = ?,
              queue_entered_at = ?,
              current_attempt_id = ?,
              latest_requested_change_note_id = ?,
              completed_at = ?,
              last_heartbeat_at = ?,
              last_summary = ?
          WHERE id = ?
        `,
      )
      .run(
        shouldQueue ? "queued" : "awaiting_input",
        shouldQueue ? timestamp : null,
        attemptId,
        noteId,
        null,
        timestamp,
        summary,
        session.id,
      );

    this.#db
      .prepare(
        `
          INSERT INTO execution_attempts (
            id, session_id, attempt_number, status, pty_pid, started_at, ended_at, end_reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        attemptId,
        session.id,
        attemptNumber,
        "queued",
        null,
        timestamp,
        null,
        null,
      );

    const logs = [
      formatMarkdownLog("Requested changes recorded", body),
      `Reusing worktree at: ${session.worktree_path}`,
      `Reusing working branch: ${ticket.working_branch ?? deriveWorkingBranch(ticket.id, ticket.title)}`,
      shouldQueue
        ? `Queued execution attempt ${attemptNumber} until a project running slot opens.`
        : `Starting execution attempt ${attemptNumber}.`,
    ];

    for (const line of logs) {
      this.#appendSessionLog(session.id, line);
    }

    this.#recordStructuredEvent(
      "ticket",
      String(ticketId),
      "ticket.changes_requested",
      {
        ticket_id: ticketId,
        session_id: session.id,
        requested_change_note_id: noteId,
        review_package_id: reviewPackage.id,
        attempt_id: attemptId,
      },
    );
    this.#recordStructuredEvent("session", session.id, "session.relaunched", {
      ticket_id: ticketId,
      attempt_id: attemptId,
      reason: "review_changes",
      requested_change_note_id: noteId,
    });

    return {
      ticket: requireValue(
        this.getTicket(ticketId),
        "Ticket not found after change request",
      ),
      session: requireValue(
        this.getSession(session.id),
        "Session not found after change request",
      ),
      attempt: requireValue(
        this.listSessionAttempts(session.id)[attemptNumber - 1],
        "Execution attempt not found after change request",
      ),
      logs,
      requestedChangeNote: requireValue(
        this.getRequestedChangeNote(noteId),
        "Requested change note not found after creation",
      ),
    };
  }

  recordMergeConflict(ticketId: number, body: string): MergeConflictResult {
    const ticket = this.getTicket(ticketId);
    if (!ticket) {
      throw new Error("Ticket not found");
    }
    if (ticket.status !== "review") {
      throw new Error("Only review tickets can record merge conflicts");
    }
    if (!ticket.session_id) {
      throw new Error("Ticket has no execution session");
    }

    const session = this.getSession(ticket.session_id);
    if (!session) {
      throw new Error("Execution session not found");
    }
    if (!session.worktree_path) {
      throw new Error("Execution session has no prepared worktree");
    }

    const reviewPackage = this.getReviewPackage(ticketId);
    const noteId = nanoid();
    const timestamp = nowIso();
    const summary = formatMarkdownLog("Merge conflict detected", body);

    this.#db
      .prepare(
        `
          INSERT INTO requested_change_notes (
            id, ticket_id, review_package_id, author_type, body, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        noteId,
        ticketId,
        reviewPackage?.id ?? null,
        "system",
        body,
        timestamp,
      );

    this.#db
      .prepare(
        `
          UPDATE tickets
          SET status = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run("in_progress", timestamp, ticketId);

    this.#db
      .prepare(
        `
          UPDATE execution_sessions
          SET status = ?,
              latest_requested_change_note_id = ?,
              completed_at = ?,
              last_heartbeat_at = ?,
              last_summary = ?
          WHERE id = ?
        `,
      )
      .run("failed", noteId, timestamp, timestamp, summary, session.id);

    const logs = [
      formatMarkdownLog("Merge conflict note recorded", body),
      `Worktree preserved at: ${session.worktree_path}`,
      `Working branch preserved: ${ticket.working_branch ?? deriveWorkingBranch(ticket.id, ticket.title)}`,
      "Ticket returned to in-progress so the merge conflict can be resolved on the existing branch.",
    ];

    for (const line of logs) {
      this.#appendSessionLog(session.id, line);
    }

    this.#recordStructuredEvent(
      "ticket",
      String(ticketId),
      "ticket.merge_failed",
      {
        ticket_id: ticketId,
        session_id: session.id,
        requested_change_note_id: noteId,
        review_package_id: reviewPackage?.id ?? null,
      },
    );
    this.#recordStructuredEvent("session", session.id, "session.merge_failed", {
      ticket_id: ticketId,
      requested_change_note_id: noteId,
    });

    return {
      ticket: requireValue(
        this.getTicket(ticketId),
        "Ticket not found after merge conflict handling",
      ),
      session: requireValue(
        this.getSession(session.id),
        "Session not found after merge conflict handling",
      ),
      requestedChangeNote: requireValue(
        this.getRequestedChangeNote(noteId),
        "Merge conflict note not found after creation",
      ),
      logs,
    };
  }

  resumeTicket(ticketId: number, reason?: string): RestartTicketResult {
    const ticket = this.getTicket(ticketId);
    if (!ticket) {
      throw new Error("Ticket not found");
    }
    if (ticket.status !== "in_progress") {
      throw new Error("Only in-progress tickets can be resumed");
    }
    if (!ticket.session_id) {
      throw new Error("Ticket has no execution session");
    }

    const session = this.getSession(ticket.session_id);
    if (!session) {
      throw new Error("Execution session not found");
    }
    if (!session.worktree_path) {
      throw new Error("Execution session has no prepared worktree");
    }
    if (
      ![
        "failed",
        "interrupted",
        "awaiting_input",
        "paused_checkpoint",
        "paused_user_control",
      ].includes(session.status)
    ) {
      throw new Error(
        `Session cannot be resumed from status ${session.status}`,
      );
    }
    const project = this.getProject(ticket.project);
    if (!project) {
      throw new Error("Project not found");
    }
    const attemptId = nanoid();
    const timestamp = nowIso();
    const attemptNumber = this.#nextAttemptNumber(session.id);
    const shouldQueue =
      this.#countOccupiedExecutionSlotsForProject(ticket.project) >=
      project.max_concurrent_sessions;
    const reasonBody = hasMeaningfulContent(reason) ? reason : null;
    const nextPlanStatus: ExecutionPlanStatus =
      session.planning_enabled && session.plan_status !== "approved"
        ? "drafting"
        : session.plan_status;
    const summary = reasonBody
      ? formatMarkdownLog("Execution resume requested", reasonBody)
      : shouldQueue
        ? "Execution resume requested. The session is queued and will start when a project slot opens."
        : "Execution resume requested on the existing worktree.";

    this.#db
      .prepare(
        `
          UPDATE execution_sessions
          SET status = ?,
              queue_entered_at = ?,
              plan_status = ?,
              plan_summary = ?,
              current_attempt_id = ?,
              completed_at = ?,
              last_heartbeat_at = ?,
              last_summary = ?
          WHERE id = ?
        `,
      )
      .run(
        shouldQueue ? "queued" : "awaiting_input",
        shouldQueue ? timestamp : null,
        nextPlanStatus,
        nextPlanStatus === "drafting" ? null : session.plan_summary,
        attemptId,
        null,
        timestamp,
        summary,
        session.id,
      );

    this.#db
      .prepare(
        `
          INSERT INTO execution_attempts (
            id, session_id, attempt_number, status, pty_pid, started_at, ended_at, end_reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        attemptId,
        session.id,
        attemptNumber,
        "queued",
        null,
        timestamp,
        null,
        null,
      );

    const logs = [
      reasonBody
        ? formatMarkdownLog("Resume instruction recorded", reasonBody)
        : "Resume requested without additional instruction.",
      `Reusing worktree at: ${session.worktree_path}`,
      `Reusing working branch: ${ticket.working_branch ?? deriveWorkingBranch(ticket.id, ticket.title)}`,
      shouldQueue
        ? `Queued execution attempt ${attemptNumber} until a project running slot opens.`
        : `Starting execution attempt ${attemptNumber}.`,
    ];

    for (const line of logs) {
      this.#appendSessionLog(session.id, line);
    }

    this.#recordStructuredEvent("session", session.id, "session.resumed", {
      ticket_id: ticketId,
      attempt_id: attemptId,
      reason: reasonBody,
    });

    return {
      ticket,
      session: requireValue(
        this.getSession(session.id),
        "Session not found after resume",
      ),
      attempt: requireValue(
        this.listSessionAttempts(session.id)[attemptNumber - 1],
        "Execution attempt not found after resume",
      ),
      logs,
    };
  }

  addSessionInput(sessionId: string, body: string): ExecutionSession {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const timestamp = nowIso();
    const summary =
      "User input was recorded for the session. If no live process was attached, the note will be available for the next attempt.";

    this.#appendSessionLog(
      sessionId,
      formatMarkdownLog("User input recorded", body),
    );

    this.#db
      .prepare(
        `
          UPDATE execution_sessions
          SET last_heartbeat_at = ?, last_summary = ?, status = ?
          WHERE id = ?
        `,
      )
      .run(timestamp, summary, "awaiting_input", sessionId);

    this.#recordStructuredEvent(
      "session",
      sessionId,
      "session.input_recorded",
      {
        body,
        received_at: timestamp,
      },
    );

    return requireValue(
      this.getSession(sessionId),
      "Session not found after input",
    );
  }

  updateSessionPlan(
    sessionId: string,
    input: UpdateSessionPlanInput,
  ): ExecutionSession | undefined {
    const existingSession = this.getSession(sessionId);
    if (!existingSession) {
      return undefined;
    }

    this.#db
      .prepare(
        `
          UPDATE execution_sessions
          SET status = ?,
              plan_status = ?,
              plan_summary = ?,
              last_heartbeat_at = ?,
              last_summary = ?
          WHERE id = ?
        `,
      )
      .run(
        input.status ?? existingSession.status,
        input.plan_status ?? existingSession.plan_status,
        input.plan_summary !== undefined
          ? input.plan_summary
          : existingSession.plan_summary,
        nowIso(),
        input.last_summary ?? existingSession.last_summary,
        sessionId,
      );

    return this.getSession(sessionId);
  }

  updateSessionStatus(
    sessionId: string,
    status: ExecutionSessionStatus,
    lastSummary?: string | null,
  ): ExecutionSession | undefined {
    const existingSession = this.getSession(sessionId);
    if (!existingSession) {
      return undefined;
    }

    this.#db
      .prepare(
        `
          UPDATE execution_sessions
          SET status = ?, last_heartbeat_at = ?, last_summary = ?
          WHERE id = ?
        `,
      )
      .run(
        status,
        nowIso(),
        lastSummary ?? existingSession.last_summary,
        sessionId,
      );

    return this.getSession(sessionId);
  }

  claimNextQueuedSession(projectId: string): ExecutionSession | undefined {
    const project = this.getProject(projectId);
    if (!project) {
      return undefined;
    }

    if (
      this.#countOccupiedExecutionSlotsForProject(projectId) >=
      project.max_concurrent_sessions
    ) {
      return undefined;
    }

    const queuedSession = this.#db
      .prepare(
        `
          SELECT id
          FROM execution_sessions
          WHERE project_id = ?
            AND status = 'queued'
          ORDER BY queue_entered_at ASC, started_at ASC, id ASC
          LIMIT 1
        `,
      )
      .get(projectId) as { id: string } | undefined;

    if (!queuedSession) {
      return undefined;
    }

    this.#db
      .prepare(
        `
          UPDATE execution_sessions
          SET status = ?, queue_entered_at = ?, last_heartbeat_at = ?
          WHERE id = ?
        `,
      )
      .run("awaiting_input", null, nowIso(), queuedSession.id);

    return this.getSession(queuedSession.id);
  }

  completeSession(
    sessionId: string,
    input: CompleteSessionInput,
  ): ExecutionSession | undefined {
    const existingSession = this.getSession(sessionId);
    if (!existingSession) {
      return undefined;
    }

    this.#db
      .prepare(
        `
          UPDATE execution_sessions
          SET status = ?,
              last_heartbeat_at = ?,
              completed_at = ?,
              last_summary = ?,
              latest_review_package_id = ?
          WHERE id = ?
        `,
      )
      .run(
        input.status,
        nowIso(),
        nowIso(),
        input.last_summary ?? existingSession.last_summary,
        input.latest_review_package_id ??
          existingSession.latest_review_package_id,
        sessionId,
      );

    return this.getSession(sessionId);
  }

  updateExecutionAttempt(
    attemptId: string,
    input: {
      status?: ExecutionAttempt["status"];
      pty_pid?: number | null;
      end_reason?: string | null;
    },
  ): ExecutionAttempt | undefined {
    const row = this.#db
      .prepare("SELECT * FROM execution_attempts WHERE id = ?")
      .get(attemptId) as Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }

    const existingAttempt = mapExecutionAttempt(row);
    const nextStatus = input.status ?? existingAttempt.status;
    const shouldEnd = input.status !== undefined && input.status !== "running";

    this.#db
      .prepare(
        `
          UPDATE execution_attempts
          SET status = ?,
              pty_pid = ?,
              ended_at = ?,
              end_reason = ?
          WHERE id = ?
        `,
      )
      .run(
        nextStatus,
        input.pty_pid !== undefined ? input.pty_pid : existingAttempt.pty_pid,
        shouldEnd ? nowIso() : existingAttempt.ended_at,
        input.end_reason ?? existingAttempt.end_reason,
        attemptId,
      );

    const updatedRow = this.#db
      .prepare("SELECT * FROM execution_attempts WHERE id = ?")
      .get(attemptId) as Record<string, unknown> | undefined;
    return updatedRow ? mapExecutionAttempt(updatedRow) : undefined;
  }

  createReviewPackage(input: CreateReviewPackageInput): ReviewPackage {
    const id = nanoid();
    const timestamp = nowIso();

    this.#db
      .prepare(
        `
          INSERT INTO review_packages (
            id, ticket_id, session_id, diff_ref, commit_refs, change_summary,
            validation_results, remaining_risks, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        id,
        input.ticket_id,
        input.session_id,
        input.diff_ref,
        stringifyJson(input.commit_refs),
        input.change_summary,
        stringifyJson(input.validation_results),
        stringifyJson(input.remaining_risks),
        timestamp,
      );

    this.#recordStructuredEvent(
      "review_package",
      id,
      "review_package.generated",
      {
        ticket_id: input.ticket_id,
        session_id: input.session_id,
        diff_ref: input.diff_ref,
        commit_refs: input.commit_refs,
      },
    );

    return requireValue(
      this.getReviewPackage(input.ticket_id),
      "Review package not found after creation",
    );
  }

  recoverInterruptedSessions(): StartupRecoveryResult {
    const rows = this.#db
      .prepare(
        `
          SELECT *
          FROM execution_sessions
          WHERE status IN ('queued', 'running', 'paused_checkpoint', 'paused_user_control', 'awaiting_input')
          ORDER BY started_at ASC, id ASC
        `,
      )
      .all() as Record<string, unknown>[];

    const interruptedSessions: ExecutionSession[] = [];

    for (const row of rows) {
      const session = mapExecutionSession(row);
      const timestamp = nowIso();
      const summary =
        "The backend restarted while this session was active. The session was marked interrupted and can be resumed on the existing worktree.";

      this.#db
        .prepare(
          `
            UPDATE execution_sessions
            SET status = ?,
                last_heartbeat_at = ?,
                last_summary = ?
            WHERE id = ?
          `,
        )
        .run("interrupted", timestamp, summary, session.id);

      if (session.current_attempt_id) {
        this.updateExecutionAttempt(session.current_attempt_id, {
          status: "interrupted",
          end_reason: "backend_restart",
        });
      }

      this.#appendSessionLog(
        session.id,
        "Session was marked interrupted after backend startup recovery.",
      );

      this.#recordStructuredEvent(
        "session",
        session.id,
        "session.interrupted",
        {
          ticket_id: session.ticket_id,
          reason: "backend_restart",
        },
      );
      this.#recordStructuredEvent(
        "ticket",
        String(session.ticket_id),
        "ticket.interrupted",
        {
          ticket_id: session.ticket_id,
          session_id: session.id,
          reason: "backend_restart",
        },
      );

      interruptedSessions.push(
        requireValue(
          this.getSession(session.id),
          "Session not found after recovery",
        ),
      );
    }

    return {
      sessions: interruptedSessions,
    };
  }

  updateTicketStatus(
    ticketId: number,
    status: TicketFrontmatter["status"],
  ): TicketFrontmatter | undefined {
    const ticket = this.getTicket(ticketId);
    if (!ticket) {
      return undefined;
    }

    this.#db
      .prepare(
        `
          UPDATE tickets
          SET status = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(status, nowIso(), ticketId);

    return this.getTicket(ticketId);
  }

  listSessionAttempts(sessionId: string): ExecutionAttempt[] {
    const rows = this.#db
      .prepare(
        "SELECT * FROM execution_attempts WHERE session_id = ? ORDER BY attempt_number ASC",
      )
      .all(sessionId) as Record<string, unknown>[];
    return rows.map(mapExecutionAttempt);
  }

  getSession(sessionId: string): ExecutionSession | undefined {
    const row = this.#db
      .prepare("SELECT * FROM execution_sessions WHERE id = ?")
      .get(sessionId) as Record<string, unknown> | undefined;
    return row ? mapExecutionSession(row) : undefined;
  }

  getSessionLogs(sessionId: string): string[] {
    const rows = this.#db
      .prepare(
        "SELECT line FROM session_logs WHERE session_id = ? ORDER BY id ASC",
      )
      .all(sessionId) as Array<{ line: string }>;
    return rows.map((row) => row.line);
  }

  getDraftEvents(draftId: string): StructuredEvent[] {
    const rows = this.#db
      .prepare(
        `
          SELECT * FROM structured_events
          WHERE entity_type = 'draft' AND entity_id = ?
          ORDER BY occurred_at DESC
        `,
      )
      .all(draftId) as Record<string, unknown>[];
    return rows.map(mapStructuredEvent);
  }

  recordDraftEvent(
    draftId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): StructuredEvent {
    return this.#recordStructuredEvent("draft", draftId, eventType, payload);
  }

  getTicketEvents(ticketId: number): StructuredEvent[] {
    const rows = this.#db
      .prepare(
        `
          SELECT * FROM structured_events
          WHERE entity_type = 'ticket' AND entity_id = ?
          ORDER BY occurred_at DESC
        `,
      )
      .all(String(ticketId)) as Record<string, unknown>[];
    return rows.map(mapStructuredEvent);
  }

  recordTicketEvent(
    ticketId: number,
    eventType: string,
    payload: Record<string, unknown>,
  ): StructuredEvent {
    return this.#recordStructuredEvent(
      "ticket",
      String(ticketId),
      eventType,
      payload,
    );
  }

  archiveTicket(ticketId: number): TicketFrontmatter | undefined {
    const ticketRow = this.#db
      .prepare("SELECT status, archived_at FROM tickets WHERE id = ?")
      .get(ticketId) as
      | { status: string; archived_at: string | null }
      | undefined;

    if (!ticketRow) {
      return undefined;
    }

    if (ticketRow.archived_at !== null) {
      throw new Error("Ticket already archived");
    }

    if (ticketRow.status !== "done") {
      throw new Error("Only completed tickets can be archived");
    }

    const timestamp = nowIso();
    this.#db
      .prepare(
        `
          UPDATE tickets
          SET archived_at = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(timestamp, timestamp, ticketId);

    return this.getTicket(ticketId);
  }

  deleteTicket(ticketId: number): TicketFrontmatter | undefined {
    const ticket = this.getTicket(ticketId);
    if (!ticket) {
      return undefined;
    }

    const reviewPackageRows = this.#db
      .prepare("SELECT id FROM review_packages WHERE ticket_id = ?")
      .all(ticketId) as Array<{ id: string }>;
    const reviewPackageIds = reviewPackageRows.map((row) => row.id);

    const sessionId = ticket.session_id;
    const attemptRows =
      sessionId === null
        ? []
        : (this.#db
            .prepare("SELECT id FROM execution_attempts WHERE session_id = ?")
            .all(sessionId) as Array<{ id: string }>);
    const attemptIds = attemptRows.map((row) => row.id);

    this.#db
      .prepare("DELETE FROM requested_change_notes WHERE ticket_id = ?")
      .run(ticketId);
    this.#db
      .prepare("DELETE FROM review_packages WHERE ticket_id = ?")
      .run(ticketId);

    if (sessionId) {
      this.#db
        .prepare("DELETE FROM session_logs WHERE session_id = ?")
        .run(sessionId);
      this.#db
        .prepare("DELETE FROM execution_attempts WHERE session_id = ?")
        .run(sessionId);
      this.#db
        .prepare("DELETE FROM execution_sessions WHERE id = ?")
        .run(sessionId);
      this.#db
        .prepare(
          `
            DELETE FROM structured_events
            WHERE entity_type = 'session' AND entity_id = ?
          `,
        )
        .run(sessionId);
    }

    for (const reviewPackageId of reviewPackageIds) {
      this.#db
        .prepare(
          `
            DELETE FROM structured_events
            WHERE entity_type = 'review_package' AND entity_id = ?
          `,
        )
        .run(reviewPackageId);
    }

    for (const attemptId of attemptIds) {
      this.#db
        .prepare(
          `
            DELETE FROM structured_events
            WHERE entity_type = 'attempt' AND entity_id = ?
          `,
        )
        .run(attemptId);
    }

    this.#db
      .prepare(
        `
          DELETE FROM structured_events
          WHERE entity_type = 'ticket' AND entity_id = ?
        `,
      )
      .run(String(ticketId));

    this.#db.prepare("DELETE FROM tickets WHERE id = ?").run(ticketId);

    return ticket;
  }

  getRequestedChangeNote(noteId: string): RequestedChangeNote | undefined {
    const row = this.#db
      .prepare("SELECT * FROM requested_change_notes WHERE id = ?")
      .get(noteId) as Record<string, unknown> | undefined;
    return row ? mapRequestedChangeNote(row) : undefined;
  }
}
