import {
  createMigratedWalleyboardDatabase,
  type WalleyboardDatabase,
  type WalleyboardDatabaseHandle,
} from "@walleyboard/db";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import type {
  DraftTicketState,
  ExecutionAttempt,
  ExecutionSession,
  Project,
  PullRequestRef,
  ReasoningEffort,
  RepositoryConfig,
  RequestedChangeNote,
  ReviewAction,
  ReviewPackage,
  ReviewReport,
  ReviewRun,
  StructuredEvent,
  TicketFrontmatter,
  TicketReference,
} from "../../../../../packages/contracts/src/index.js";
import {
  normalizeProjectColor as normalizeSharedProjectColor,
  defaultProjectColor as sharedDefaultProjectColor,
} from "../../../../../packages/contracts/src/index.js";

import { nowIso } from "../time.js";
import { resolveWalleyBoardPath } from "../walleyboard-paths.js";

export type JsonValue =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null;

type SqliteRow = Record<string, unknown>;

export const slotOccupyingExecutionSessionStatuses = [
  "awaiting_input",
  "running",
] as const;
export const defaultMaxConcurrentSessions = 4;
export const defaultProjectColor = sharedDefaultProjectColor;

export function normalizeProjectColor(
  value: string | null | undefined,
): Project["color"] {
  return normalizeSharedProjectColor(value);
}

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

export function normalizeReviewAction(
  value: ReviewAction | null | undefined,
): ReviewAction {
  return value === "pull_request" ? "pull_request" : "direct_merge";
}

export function normalizePullRequestRef(value: unknown): PullRequestRef | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    record.provider !== "github" ||
    typeof record.repo_owner !== "string" ||
    typeof record.repo_name !== "string" ||
    typeof record.number !== "number" ||
    typeof record.url !== "string" ||
    typeof record.head_branch !== "string" ||
    typeof record.base_branch !== "string"
  ) {
    return null;
  }

  return {
    provider: "github",
    repo_owner: record.repo_owner,
    repo_name: record.repo_name,
    number: record.number,
    url: record.url,
    head_branch: record.head_branch,
    base_branch: record.base_branch,
    state:
      record.state === "open" ||
      record.state === "closed" ||
      record.state === "merged" ||
      record.state === "unknown"
        ? record.state
        : "unknown",
    review_status:
      record.review_status === "approved" ||
      record.review_status === "changes_requested" ||
      record.review_status === "unknown"
        ? record.review_status
        : "pending",
    head_sha:
      typeof record.head_sha === "string" && record.head_sha.length > 0
        ? record.head_sha
        : null,
    changes_requested_by:
      typeof record.changes_requested_by === "string" &&
      record.changes_requested_by.length > 0
        ? record.changes_requested_by
        : null,
    last_changes_requested_head_sha:
      typeof record.last_changes_requested_head_sha === "string" &&
      record.last_changes_requested_head_sha.length > 0
        ? record.last_changes_requested_head_sha
        : null,
    last_reconciled_at:
      typeof record.last_reconciled_at === "string" &&
      record.last_reconciled_at.length > 0
        ? record.last_reconciled_at
        : null,
  };
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

export function deriveWorkingBranch(
  ticketId: number,
  title: string,
  agentAdapter?: string,
): string {
  const prefix = agentAdapter === "claude-code" ? "claude" : "codex";
  return `${prefix}/ticket-${ticketId}-${slugify(title).slice(0, 24)}`;
}

export function mapProject(row: SqliteRow): Project {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    color: normalizeProjectColor(row.color as string | null | undefined),
    agent_adapter:
      row.agent_adapter === "claude-code" ? "claude-code" : "codex",
    execution_backend: "docker",
    disabled_mcp_servers: parseJson<unknown[]>(row.disabled_mcp_servers, [])
      .filter((server): server is string => typeof server === "string")
      .map((server) => server.trim())
      .filter((server) => server.length > 0),
    automatic_agent_review: Number(row.automatic_agent_review) === 1,
    automatic_agent_review_run_limit: Math.max(
      1,
      Number(row.automatic_agent_review_run_limit ?? 1),
    ),
    default_review_action: normalizeReviewAction(
      row.default_review_action as ReviewAction | null | undefined,
    ),
    default_target_branch:
      row.default_target_branch === null
        ? null
        : String(row.default_target_branch),
    preview_start_command:
      row.preview_start_command === null
        ? null
        : String(row.preview_start_command),
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

export function mapRepository(row: SqliteRow): RepositoryConfig {
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

export function mapDraft(
  row: SqliteRow,
  ticketReferences: TicketReference[] = [],
): DraftTicketState {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    artifact_scope_id: String(row.artifact_scope_id),
    title_draft: String(row.title_draft),
    description_draft:
      row.description_draft === null ? "" : String(row.description_draft),
    ticket_references: ticketReferences,
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
    source_ticket_id:
      row.source_ticket_id === null || row.source_ticket_id === undefined
        ? null
        : Number(row.source_ticket_id),
    target_branch:
      row.target_branch === null || row.target_branch === undefined
        ? null
        : String(row.target_branch),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function mapTicket(
  row: SqliteRow,
  ticketReferences: TicketReference[] = [],
): TicketFrontmatter {
  return {
    id: Number(row.id),
    project: String(row.project_id),
    repo: String(row.repo_id),
    artifact_scope_id: String(row.artifact_scope_id),
    status: String(row.status) as TicketFrontmatter["status"],
    title: String(row.title),
    description: row.description === null ? "" : String(row.description),
    ticket_references: ticketReferences,
    ticket_type: String(row.ticket_type) as TicketFrontmatter["ticket_type"],
    acceptance_criteria: parseJson(row.acceptance_criteria, []),
    working_branch:
      row.working_branch === null ? null : String(row.working_branch),
    target_branch: String(row.target_branch),
    linked_pr: normalizePullRequestRef(parseJson(row.linked_pr, null)),
    session_id: row.session_id === null ? null : String(row.session_id),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function mapStructuredEvent(row: SqliteRow): StructuredEvent {
  return {
    id: String(row.id),
    occurred_at: String(row.occurred_at),
    entity_type: String(row.entity_type) as StructuredEvent["entity_type"],
    entity_id: String(row.entity_id),
    event_type: String(row.event_type),
    payload: parseJson(row.payload, {}),
  };
}

export function mapExecutionSession(row: SqliteRow): ExecutionSession {
  return {
    id: String(row.id),
    ticket_id: Number(row.ticket_id),
    project_id: String(row.project_id),
    repo_id: String(row.repo_id),
    agent_adapter:
      row.agent_adapter === "claude-code" ? "claude-code" : "codex",
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

export function mapExecutionAttempt(row: SqliteRow): ExecutionAttempt {
  return {
    id: String(row.id),
    session_id: String(row.session_id),
    attempt_number: Number(row.attempt_number),
    status: String(row.status) as ExecutionAttempt["status"],
    prompt_kind:
      row.prompt_kind === null || row.prompt_kind === undefined
        ? null
        : (String(row.prompt_kind) as ExecutionAttempt["prompt_kind"]),
    prompt:
      row.prompt === null || row.prompt === undefined
        ? null
        : String(row.prompt),
    pty_pid: row.pty_pid === null ? null : Number(row.pty_pid),
    started_at: String(row.started_at),
    ended_at: row.ended_at === null ? null : String(row.ended_at),
    end_reason: row.end_reason === null ? null : String(row.end_reason),
  };
}

export function mapReviewPackage(row: SqliteRow): ReviewPackage {
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

export function mapReviewRun(row: SqliteRow): ReviewRun {
  return {
    id: String(row.id),
    ticket_id: Number(row.ticket_id),
    review_package_id: String(row.review_package_id),
    implementation_session_id: String(row.implementation_session_id),
    status: String(row.status) as ReviewRun["status"],
    adapter_session_ref:
      row.adapter_session_ref === null ? null : String(row.adapter_session_ref),
    prompt:
      row.prompt === null || row.prompt === undefined
        ? null
        : String(row.prompt),
    report: parseJson<ReviewReport | null>(row.report, null),
    failure_message:
      row.failure_message === null ? null : String(row.failure_message),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    completed_at: row.completed_at === null ? null : String(row.completed_at),
  };
}

export function mapRequestedChangeNote(row: SqliteRow): RequestedChangeNote {
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
  readonly #databasePath: string;
  readonly #databaseHandle: WalleyboardDatabaseHandle;
  readonly #db: WalleyboardDatabase;

  constructor(databasePath?: string) {
    this.#databasePath =
      databasePath ?? resolveWalleyBoardPath("walleyboard.sqlite");
    this.#databaseHandle = createMigratedWalleyboardDatabase(
      this.#databasePath,
    );
    this.#db = this.#databaseHandle.db;
  }

  get databasePath(): string {
    return this.#databasePath;
  }

  get db() {
    return this.#db;
  }

  close(): void {
    this.#databaseHandle.sqlite.close();
  }

  transaction<T>(operation: () => T): T {
    return this.#databaseHandle.sqlite.transaction(operation)();
  }

  appendSessionLog(sessionId: string, line: string): void {
    this.#db.run(sql`
      INSERT INTO session_logs (session_id, line, created_at)
      VALUES (${sessionId}, ${line}, ${nowIso()})
    `);
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

    this.#db.run(sql`
      INSERT INTO structured_events (
        id, occurred_at, entity_type, entity_id, event_type, payload
      ) VALUES (
        ${event.id},
        ${event.occurred_at},
        ${event.entity_type},
        ${event.entity_id},
        ${event.event_type},
        ${stringifyJson(event.payload)}
      )
    `);

    return event;
  }

  countOccupiedExecutionSlotsForProject(
    projectId: string,
    excludedSessionId?: string,
  ): number {
    const excludedClause =
      excludedSessionId === undefined
        ? sql.empty()
        : sql`AND id != ${excludedSessionId}`;
    const statusList = sql.join(
      slotOccupyingExecutionSessionStatuses.map((status) => sql`${status}`),
      sql`, `,
    );
    const row = this.#db.get<{ count: number }>(sql`
      SELECT COUNT(*) AS count
      FROM execution_sessions
      WHERE project_id = ${projectId}
        ${excludedClause}
        AND status IN (${statusList})
    `);

    return Number(row?.count ?? 0);
  }

  nextAttemptNumber(sessionId: string): number {
    const row = this.#db.get<{ max_attempt_number: number | null }>(sql`
      SELECT COALESCE(MAX(attempt_number), 0) AS max_attempt_number
      FROM execution_attempts
      WHERE session_id = ${sessionId}
    `);

    return Number(row?.max_attempt_number ?? 0) + 1;
  }
}
