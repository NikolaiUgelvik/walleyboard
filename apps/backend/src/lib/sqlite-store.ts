import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  CreateDraftInput,
  CreateProjectInput,
  DraftTicketState,
  ExecutionAttempt,
  ExecutionSession,
  ExecutionSessionStatus,
  Project,
  RepositoryConfig,
  RequestedChangeNote,
  ReviewPackage,
  StructuredEvent,
  TicketFrontmatter
} from "@orchestrator/contracts";
import { nanoid } from "nanoid";

import { nowIso } from "./time.js";
import type {
  ConfirmDraftInput,
  StartTicketResult,
  Store
} from "./store.js";

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function normalizeTitle(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) {
    return trimmed;
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function normalizeDescription(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) {
    return trimmed;
  }

  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
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

function deriveAcceptanceCriteria(
  title: string,
  description: string,
  instruction?: string
): string[] {
  const criteria = new Set<string>();
  criteria.add(`Implement ${title}.`);

  if (description.length > 0) {
    criteria.add(`Cover the workflow described in: ${description}`);
  }

  if (instruction && instruction.trim().length > 0) {
    criteria.add(`Account for refinement guidance: ${normalizeDescription(instruction)}`);
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
      row.default_target_branch === null ? null : String(row.default_target_branch),
    max_concurrent_sessions: Number(row.max_concurrent_sessions),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

function mapRepository(row: Record<string, unknown>): RepositoryConfig {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    name: String(row.name),
    path: String(row.path),
    target_branch: row.target_branch === null ? null : String(row.target_branch),
    setup_hook: parseJson(row.setup_hook, null),
    cleanup_hook: parseJson(row.cleanup_hook, null),
    validation_profile: parseJson(row.validation_profile, []),
    extra_env_allowlist: parseJson(row.extra_env_allowlist, []),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

function mapDraft(row: Record<string, unknown>): DraftTicketState {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    title_draft: String(row.title_draft),
    description_draft: String(row.description_draft),
    proposed_repo_id: row.proposed_repo_id === null ? null : String(row.proposed_repo_id),
    confirmed_repo_id:
      row.confirmed_repo_id === null ? null : String(row.confirmed_repo_id),
    proposed_ticket_type:
      row.proposed_ticket_type === null
        ? null
        : (String(row.proposed_ticket_type) as DraftTicketState["proposed_ticket_type"]),
    proposed_acceptance_criteria: parseJson(row.proposed_acceptance_criteria, []),
    wizard_status: String(row.wizard_status) as DraftTicketState["wizard_status"],
    split_proposal_summary:
      row.split_proposal_summary === null ? null : String(row.split_proposal_summary),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

function mapTicket(row: Record<string, unknown>): TicketFrontmatter {
  return {
    id: Number(row.id),
    project: String(row.project_id),
    repo: String(row.repo_id),
    status: String(row.status) as TicketFrontmatter["status"],
    title: String(row.title),
    ticket_type: String(row.ticket_type) as TicketFrontmatter["ticket_type"],
    working_branch: row.working_branch === null ? null : String(row.working_branch),
    target_branch: String(row.target_branch),
    linked_pr: parseJson(row.linked_pr, null),
    session_id: row.session_id === null ? null : String(row.session_id),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

function mapStructuredEvent(row: Record<string, unknown>): StructuredEvent {
  return {
    id: String(row.id),
    occurred_at: String(row.occurred_at),
    entity_type: String(row.entity_type) as StructuredEvent["entity_type"],
    entity_id: String(row.entity_id),
    event_type: String(row.event_type),
    payload: parseJson(row.payload, {})
  };
}

function mapExecutionSession(row: Record<string, unknown>): ExecutionSession {
  return {
    id: String(row.id),
    ticket_id: Number(row.ticket_id),
    project_id: String(row.project_id),
    repo_id: String(row.repo_id),
    status: String(row.status) as ExecutionSession["status"],
    planning_enabled: Boolean(row.planning_enabled),
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
    queue_entered_at: row.queue_entered_at === null ? null : String(row.queue_entered_at),
    started_at: row.started_at === null ? null : String(row.started_at),
    completed_at: row.completed_at === null ? null : String(row.completed_at),
    last_heartbeat_at:
      row.last_heartbeat_at === null ? null : String(row.last_heartbeat_at),
    last_summary: row.last_summary === null ? null : String(row.last_summary)
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
    end_reason: row.end_reason === null ? null : String(row.end_reason)
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
    created_at: String(row.created_at)
  };
}

function mapRequestedChangeNote(row: Record<string, unknown>): RequestedChangeNote {
  return {
    id: String(row.id),
    ticket_id: Number(row.ticket_id),
    review_package_id:
      row.review_package_id === null ? null : String(row.review_package_id),
    author_type: String(row.author_type) as RequestedChangeNote["author_type"],
    body: String(row.body),
    created_at: String(row.created_at)
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
        max_concurrent_sessions INTEGER NOT NULL DEFAULT 1,
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
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        ticket_type TEXT NOT NULL,
        working_branch TEXT,
        target_branch TEXT NOT NULL,
        linked_pr TEXT,
        session_id TEXT,
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
        status TEXT NOT NULL,
        planning_enabled INTEGER NOT NULL,
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
  }

  #recordStructuredEvent(
    entityType: StructuredEvent["entity_type"],
    entityId: string,
    eventType: string,
    payload: Record<string, unknown>
  ): StructuredEvent {
    const event: StructuredEvent = {
      id: nanoid(),
      occurred_at: nowIso(),
      entity_type: entityType,
      entity_id: entityId,
      event_type: eventType,
      payload
    };

    this.#db
      .prepare(
        `
          INSERT INTO structured_events (
            id, occurred_at, entity_type, entity_id, event_type, payload
          ) VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        event.id,
        event.occurred_at,
        event.entity_type,
        event.entity_id,
        event.event_type,
        stringifyJson(event.payload)
      );

    return event;
  }

  #appendSessionLog(sessionId: string, line: string): void {
    this.#db
      .prepare(
        `
          INSERT INTO session_logs (session_id, line, created_at)
          VALUES (?, ?, ?)
        `
      )
      .run(sessionId, line, nowIso());
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
            id, slug, name, default_target_branch, max_concurrent_sessions, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(projectId, slug, input.name.trim(), defaultTargetBranch, 1, timestamp, timestamp);

    this.#db
      .prepare(
        `
          INSERT INTO repositories (
            id, project_id, name, path, target_branch, setup_hook, cleanup_hook,
            validation_profile, extra_env_allowlist, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        repositoryId,
        projectId,
        input.repository.name.trim(),
        input.repository.path,
        input.repository.target_branch ?? defaultTargetBranch,
        null,
        null,
        stringifyJson([]),
        stringifyJson([]),
        timestamp,
        timestamp
      );

    return {
      project: this.getProject(projectId)!,
      repository: this.listProjectRepositories(projectId)[0]!
    };
  }

  listProjectRepositories(projectId: string): RepositoryConfig[] {
    const rows = this.#db
      .prepare("SELECT * FROM repositories WHERE project_id = ? ORDER BY created_at ASC")
      .all(projectId) as Record<string, unknown>[];
    return rows.map(mapRepository);
  }

  listProjectDrafts(projectId: string): DraftTicketState[] {
    const rows = this.#db
      .prepare(
        "SELECT * FROM draft_ticket_states WHERE project_id = ? ORDER BY updated_at DESC"
      )
      .all(projectId) as Record<string, unknown>[];
    return rows.map(mapDraft);
  }

  listProjectTickets(projectId: string): TicketFrontmatter[] {
    const rows = this.#db
      .prepare("SELECT * FROM tickets WHERE project_id = ? ORDER BY updated_at DESC, id DESC")
      .all(projectId) as Record<string, unknown>[];
    return rows.map(mapTicket);
  }

  createDraft(input: CreateDraftInput): DraftTicketState {
    const project = this.getProject(input.project_id);
    if (!project) {
      throw new Error("Project not found");
    }

    const firstRepository = this.listProjectRepositories(project.id)[0];
    const timestamp = nowIso();
    const draftId = nanoid();

    this.#db
      .prepare(
        `
          INSERT INTO draft_ticket_states (
            id, project_id, title_draft, description_draft, proposed_repo_id, confirmed_repo_id,
            proposed_ticket_type, proposed_acceptance_criteria, wizard_status, split_proposal_summary,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        draftId,
        input.project_id,
        normalizeTitle(input.title),
        normalizeDescription(input.description),
        firstRepository?.id ?? null,
        null,
        "feature",
        stringifyJson([]),
        "editing",
        null,
        timestamp,
        timestamp
      );

    return this.getDraft(draftId)!;
  }

  getDraft(draftId: string): DraftTicketState | undefined {
    const row = this.#db
      .prepare("SELECT * FROM draft_ticket_states WHERE id = ?")
      .get(draftId) as Record<string, unknown> | undefined;
    return row ? mapDraft(row) : undefined;
  }

  refineDraft(draftId: string, instruction?: string): DraftTicketState {
    const draft = this.getDraft(draftId);
    if (!draft) {
      throw new Error("Draft not found");
    }

    const title = normalizeTitle(draft.title_draft);
    const description = normalizeDescription(draft.description_draft);
    const acceptanceCriteria = deriveAcceptanceCriteria(title, description, instruction);
    const timestamp = nowIso();

    this.#db
      .prepare(
        `
          UPDATE draft_ticket_states
          SET title_draft = ?, description_draft = ?, proposed_acceptance_criteria = ?,
              wizard_status = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(
        title,
        description,
        stringifyJson(acceptanceCriteria),
        "awaiting_confirmation",
        timestamp,
        draftId
      );

    return this.getDraft(draftId)!;
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

    const nextTicketRow = this.#db
      .prepare("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM tickets WHERE project_id = ?")
      .get(draft.project_id) as { next_id: number };
    const ticketId = Number(nextTicketRow.next_id);
    const timestamp = nowIso();

    this.#db
      .prepare(
        `
          INSERT INTO tickets (
            id, project_id, repo_id, status, title, ticket_type, working_branch,
            target_branch, linked_pr, session_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        ticketId,
        draft.project_id,
        input.repo_id,
        "ready",
        normalizeTitle(input.title),
        input.ticket_type,
        null,
        input.target_branch,
        null,
        null,
        timestamp,
        timestamp
      );

    this.#db
      .prepare("DELETE FROM draft_ticket_states WHERE id = ?")
      .run(draftId);

    this.recordTicketEvent(ticketId, "ticket.created", {
      title: normalizeTitle(input.title),
      description: normalizeDescription(input.description),
      acceptance_criteria: input.acceptance_criteria
    });

    return this.getTicket(ticketId)!;
  }

  getTicket(ticketId: number): TicketFrontmatter | undefined {
    const row = this.#db
      .prepare("SELECT * FROM tickets WHERE id = ?")
      .get(ticketId) as Record<string, unknown> | undefined;
    return row ? mapTicket(row) : undefined;
  }

  getReviewPackage(ticketId: number): ReviewPackage | undefined {
    const row = this.#db
      .prepare("SELECT * FROM review_packages WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(ticketId) as Record<string, unknown> | undefined;
    return row ? mapReviewPackage(row) : undefined;
  }

  startTicket(ticketId: number, planningEnabled: boolean): StartTicketResult {
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

    const activeSessionCount = this.#db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM execution_sessions
          WHERE status IN ('queued', 'running', 'paused_checkpoint', 'paused_user_control', 'awaiting_input')
        `
      )
      .get() as { count: number };
    if (Number(activeSessionCount.count) > 0) {
      throw new Error("Only one active execution session is supported in the current MVP slice");
    }

    const sessionId = nanoid();
    const attemptId = nanoid();
    const timestamp = nowIso();
    const workingBranch = deriveWorkingBranch(ticket.id, ticket.title);
    const summary =
      "Execution session created. The real Codex runner and worktree lifecycle are still pending, so this session is parked in a waiting state.";

    this.#db
      .prepare(
        `
          UPDATE tickets
          SET status = ?, session_id = ?, working_branch = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run("in_progress", sessionId, workingBranch, timestamp, ticketId);

    this.#db
      .prepare(
        `
          INSERT INTO execution_sessions (
            id, ticket_id, project_id, repo_id, status, planning_enabled, current_attempt_id,
            latest_requested_change_note_id, latest_review_package_id, queue_entered_at,
            started_at, completed_at, last_heartbeat_at, last_summary
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        sessionId,
        ticket.id,
        ticket.project,
        ticket.repo,
        "awaiting_input",
        planningEnabled ? 1 : 0,
        attemptId,
        null,
        null,
        null,
        timestamp,
        null,
        timestamp,
        summary
      );

    this.#db
      .prepare(
        `
          INSERT INTO execution_attempts (
            id, session_id, attempt_number, status, pty_pid, started_at, ended_at, end_reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(attemptId, sessionId, 1, "running", null, timestamp, null, null);

    const logs = [
      `Session created for ticket #${ticket.id}: ${ticket.title}`,
      `Working branch reserved: ${workingBranch}`,
      `Planning mode: ${planningEnabled ? "enabled" : "disabled"}`,
      "Execution runtime is not wired yet in this build.",
      "Session is waiting for input so the UI, persistence, and transport layers can be exercised."
    ];

    for (const line of logs) {
      this.#appendSessionLog(sessionId, line);
    }

    this.#recordStructuredEvent("ticket", String(ticket.id), "ticket.started", {
      ticket_id: ticket.id,
      session_id: sessionId,
      working_branch: workingBranch
    });
    this.#recordStructuredEvent("session", sessionId, "session.started", {
      ticket_id: ticket.id,
      attempt_id: attemptId,
      planning_enabled: planningEnabled
    });

    return {
      ticket: this.getTicket(ticket.id)!,
      session: this.getSession(sessionId)!,
      attempt: this.listSessionAttempts(sessionId)[0]!,
      logs
    };
  }

  addSessionInput(sessionId: string, body: string): ExecutionSession {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const timestamp = nowIso();
    const summary =
      "User input was recorded. The runtime is still not connected, so the session remains parked in the waiting state.";

    this.#appendSessionLog(sessionId, `User input recorded: ${body.trim()}`);

    this.#db
      .prepare(
        `
          UPDATE execution_sessions
          SET last_heartbeat_at = ?, last_summary = ?, status = ?
          WHERE id = ?
        `
      )
      .run(timestamp, summary, "awaiting_input", sessionId);

    this.#recordStructuredEvent("session", sessionId, "session.input_recorded", {
      body,
      received_at: timestamp
    });

    return this.getSession(sessionId)!;
  }

  updateSessionStatus(
    sessionId: string,
    status: ExecutionSessionStatus,
    lastSummary?: string | null
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
        `
      )
      .run(status, nowIso(), lastSummary ?? existingSession.last_summary, sessionId);

    return this.getSession(sessionId);
  }

  listSessionAttempts(sessionId: string): ExecutionAttempt[] {
    const rows = this.#db
      .prepare(
        "SELECT * FROM execution_attempts WHERE session_id = ? ORDER BY attempt_number ASC"
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
      .prepare("SELECT line FROM session_logs WHERE session_id = ? ORDER BY id ASC")
      .all(sessionId) as Array<{ line: string }>;
    return rows.map((row) => row.line);
  }

  getTicketEvents(ticketId: number): StructuredEvent[] {
    const rows = this.#db
      .prepare(
        `
          SELECT * FROM structured_events
          WHERE entity_type = 'ticket' AND entity_id = ?
          ORDER BY occurred_at DESC
        `
      )
      .all(String(ticketId)) as Record<string, unknown>[];
    return rows.map(mapStructuredEvent);
  }

  recordTicketEvent(
    ticketId: number,
    eventType: string,
    payload: Record<string, unknown>
  ): StructuredEvent {
    return this.#recordStructuredEvent("ticket", String(ticketId), eventType, payload);
  }

  getRequestedChangeNote(noteId: string): RequestedChangeNote | undefined {
    const row = this.#db
      .prepare("SELECT * FROM requested_change_notes WHERE id = ?")
      .get(noteId) as Record<string, unknown> | undefined;
    return row ? mapRequestedChangeNote(row) : undefined;
  }
}
