import {
  createMigratedWalleyboardDatabase,
  executionAttemptsTable,
  executionSessionsTable,
  sessionLogsTable,
  structuredEventsTable,
  type WalleyboardDatabase,
  type WalleyboardDatabaseHandle,
} from "@walleyboard/db";
import { and, count, eq, inArray, max, ne } from "drizzle-orm";
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

function readRowValue(row: SqliteRow, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in row) {
      return row[key];
    }
  }

  return undefined;
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") {
    return value === undefined ? fallback : (value as T);
  }

  if (value.length === 0) {
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
  const color = readRowValue(row, "color");
  const agentAdapter = readRowValue(row, "agent_adapter", "agentAdapter");
  const draftAnalysisAgentAdapter = readRowValue(
    row,
    "draft_analysis_agent_adapter",
    "draftAnalysisAgentAdapter",
  );
  const ticketWorkAgentAdapter = readRowValue(
    row,
    "ticket_work_agent_adapter",
    "ticketWorkAgentAdapter",
  );
  const disabledMcpServers = readRowValue(
    row,
    "disabled_mcp_servers",
    "disabledMcpServers",
  );
  const automaticAgentReview = readRowValue(
    row,
    "automatic_agent_review",
    "automaticAgentReview",
  );
  const automaticAgentReviewRunLimit = readRowValue(
    row,
    "automatic_agent_review_run_limit",
    "automaticAgentReviewRunLimit",
  );
  const defaultReviewAction = readRowValue(
    row,
    "default_review_action",
    "defaultReviewAction",
  );
  const defaultTargetBranch = readRowValue(
    row,
    "default_target_branch",
    "defaultTargetBranch",
  );
  const previewStartCommand = readRowValue(
    row,
    "preview_start_command",
    "previewStartCommand",
  );
  const worktreeInitCommand = readRowValue(
    row,
    "worktree_init_command",
    "worktreeInitCommand",
  );
  const worktreeTeardownCommand = readRowValue(
    row,
    "worktree_teardown_command",
    "worktreeTeardownCommand",
  );
  const worktreeInitRunSequential = readRowValue(
    row,
    "worktree_init_run_sequential",
    "worktreeInitRunSequential",
  );
  const draftAnalysisModel = readRowValue(
    row,
    "draft_analysis_model",
    "draftAnalysisModel",
  );
  const draftAnalysisReasoningEffort = readRowValue(
    row,
    "draft_analysis_reasoning_effort",
    "draftAnalysisReasoningEffort",
  );
  const ticketWorkModel = readRowValue(
    row,
    "ticket_work_model",
    "ticketWorkModel",
  );
  const ticketWorkReasoningEffort = readRowValue(
    row,
    "ticket_work_reasoning_effort",
    "ticketWorkReasoningEffort",
  );
  const maxConcurrentSessions = readRowValue(
    row,
    "max_concurrent_sessions",
    "maxConcurrentSessions",
  );
  const createdAt = readRowValue(row, "created_at", "createdAt");
  const updatedAt = readRowValue(row, "updated_at", "updatedAt");

  return {
    id: String(readRowValue(row, "id")),
    slug: String(readRowValue(row, "slug")),
    name: String(readRowValue(row, "name")),
    color: normalizeProjectColor(color as string | null | undefined),
    agent_adapter: agentAdapter === "claude-code" ? "claude-code" : "codex",
    draft_analysis_agent_adapter:
      draftAnalysisAgentAdapter === "claude-code"
        ? "claude-code"
        : draftAnalysisAgentAdapter === "codex"
          ? "codex"
          : agentAdapter === "claude-code"
            ? "claude-code"
            : "codex",
    ticket_work_agent_adapter:
      ticketWorkAgentAdapter === "claude-code"
        ? "claude-code"
        : ticketWorkAgentAdapter === "codex"
          ? "codex"
          : agentAdapter === "claude-code"
            ? "claude-code"
            : "codex",
    execution_backend: "docker",
    disabled_mcp_servers: parseJson<unknown[]>(disabledMcpServers, [])
      .filter((server): server is string => typeof server === "string")
      .map((server) => server.trim())
      .filter((server) => server.length > 0),
    automatic_agent_review:
      automaticAgentReview === true || Number(automaticAgentReview) === 1,
    automatic_agent_review_run_limit: Math.max(
      1,
      Number(automaticAgentReviewRunLimit ?? 1),
    ),
    default_review_action: normalizeReviewAction(
      defaultReviewAction as ReviewAction | null | undefined,
    ),
    default_target_branch:
      defaultTargetBranch === null || defaultTargetBranch === undefined
        ? null
        : String(defaultTargetBranch),
    preview_start_command:
      previewStartCommand === null || previewStartCommand === undefined
        ? null
        : String(previewStartCommand),
    worktree_init_command:
      worktreeInitCommand === null || worktreeInitCommand === undefined
        ? null
        : String(worktreeInitCommand),
    worktree_teardown_command:
      worktreeTeardownCommand === null || worktreeTeardownCommand === undefined
        ? null
        : String(worktreeTeardownCommand),
    worktree_init_run_sequential:
      worktreeInitRunSequential === true ||
      Number(worktreeInitRunSequential) === 1,
    draft_analysis_model:
      draftAnalysisModel === null || draftAnalysisModel === undefined
        ? null
        : String(draftAnalysisModel),
    draft_analysis_reasoning_effort:
      draftAnalysisReasoningEffort === null ||
      draftAnalysisReasoningEffort === undefined
        ? null
        : (String(
            draftAnalysisReasoningEffort,
          ) as Project["draft_analysis_reasoning_effort"]),
    ticket_work_model:
      ticketWorkModel === null || ticketWorkModel === undefined
        ? null
        : String(ticketWorkModel),
    ticket_work_reasoning_effort:
      ticketWorkReasoningEffort === null ||
      ticketWorkReasoningEffort === undefined
        ? null
        : (String(
            ticketWorkReasoningEffort,
          ) as Project["ticket_work_reasoning_effort"]),
    max_concurrent_sessions: Number(maxConcurrentSessions),
    created_at: String(createdAt),
    updated_at: String(updatedAt),
  };
}

export function mapRepository(row: SqliteRow): RepositoryConfig {
  const projectId = readRowValue(row, "project_id", "projectId");
  const targetBranch = readRowValue(row, "target_branch", "targetBranch");
  const setupHook = readRowValue(row, "setup_hook", "setupHook");
  const cleanupHook = readRowValue(row, "cleanup_hook", "cleanupHook");
  const validationProfile = readRowValue(
    row,
    "validation_profile",
    "validationProfile",
  );
  const extraEnvAllowlist = readRowValue(
    row,
    "extra_env_allowlist",
    "extraEnvAllowlist",
  );
  const createdAt = readRowValue(row, "created_at", "createdAt");
  const updatedAt = readRowValue(row, "updated_at", "updatedAt");

  return {
    id: String(readRowValue(row, "id")),
    project_id: String(projectId),
    name: String(readRowValue(row, "name")),
    path: String(readRowValue(row, "path")),
    target_branch:
      targetBranch === null || targetBranch === undefined
        ? null
        : String(targetBranch),
    setup_hook: parseJson(setupHook, null),
    cleanup_hook: parseJson(cleanupHook, null),
    validation_profile: parseJson(validationProfile, []),
    extra_env_allowlist: parseJson(extraEnvAllowlist, []),
    created_at: String(createdAt),
    updated_at: String(updatedAt),
  };
}

export function mapDraft(
  row: SqliteRow,
  ticketReferences: TicketReference[] = [],
): DraftTicketState {
  const descriptionDraft = readRowValue(
    row,
    "description_draft",
    "descriptionDraft",
  );
  const proposedRepoId = readRowValue(
    row,
    "proposed_repo_id",
    "proposedRepoId",
  );
  const confirmedRepoId = readRowValue(
    row,
    "confirmed_repo_id",
    "confirmedRepoId",
  );
  const proposedTicketType = readRowValue(
    row,
    "proposed_ticket_type",
    "proposedTicketType",
  );
  const proposedAcceptanceCriteria = readRowValue(
    row,
    "proposed_acceptance_criteria",
    "proposedAcceptanceCriteria",
  );
  const wizardStatus = readRowValue(row, "wizard_status", "wizardStatus");
  const splitProposalSummary = readRowValue(
    row,
    "split_proposal_summary",
    "splitProposalSummary",
  );
  const sourceTicketId = readRowValue(
    row,
    "source_ticket_id",
    "sourceTicketId",
  );
  const targetBranch = readRowValue(row, "target_branch", "targetBranch");
  const createdAt = readRowValue(row, "created_at", "createdAt");
  const updatedAt = readRowValue(row, "updated_at", "updatedAt");

  return {
    id: String(readRowValue(row, "id")),
    project_id: String(readRowValue(row, "project_id", "projectId")),
    artifact_scope_id: String(
      readRowValue(row, "artifact_scope_id", "artifactScopeId"),
    ),
    title_draft: String(readRowValue(row, "title_draft", "titleDraft")),
    description_draft:
      descriptionDraft === null || descriptionDraft === undefined
        ? ""
        : String(descriptionDraft),
    ticket_references: ticketReferences,
    proposed_repo_id:
      proposedRepoId === null || proposedRepoId === undefined
        ? null
        : String(proposedRepoId),
    confirmed_repo_id:
      confirmedRepoId === null || confirmedRepoId === undefined
        ? null
        : String(confirmedRepoId),
    proposed_ticket_type:
      proposedTicketType === null || proposedTicketType === undefined
        ? null
        : (String(
            proposedTicketType,
          ) as DraftTicketState["proposed_ticket_type"]),
    proposed_acceptance_criteria: parseJson(proposedAcceptanceCriteria, []),
    wizard_status: String(wizardStatus) as DraftTicketState["wizard_status"],
    split_proposal_summary:
      splitProposalSummary === null || splitProposalSummary === undefined
        ? null
        : String(splitProposalSummary),
    source_ticket_id:
      sourceTicketId === null || sourceTicketId === undefined
        ? null
        : Number(sourceTicketId),
    target_branch:
      targetBranch === null || targetBranch === undefined
        ? null
        : String(targetBranch),
    created_at: String(createdAt),
    updated_at: String(updatedAt),
  };
}

export function mapTicket(
  row: SqliteRow,
  ticketReferences: TicketReference[] = [],
): TicketFrontmatter {
  const description = readRowValue(row, "description");
  const acceptanceCriteria = readRowValue(
    row,
    "acceptance_criteria",
    "acceptanceCriteria",
  );
  const workingBranch = readRowValue(row, "working_branch", "workingBranch");
  const targetBranch = readRowValue(row, "target_branch", "targetBranch");
  const linkedPr = readRowValue(row, "linked_pr", "linkedPr");
  const sessionId = readRowValue(row, "session_id", "sessionId");
  const createdAt = readRowValue(row, "created_at", "createdAt");
  const updatedAt = readRowValue(row, "updated_at", "updatedAt");

  return {
    id: Number(readRowValue(row, "id")),
    project: String(readRowValue(row, "project_id", "projectId")),
    repo: String(readRowValue(row, "repo_id", "repoId")),
    artifact_scope_id: String(
      readRowValue(row, "artifact_scope_id", "artifactScopeId"),
    ),
    status: String(readRowValue(row, "status")) as TicketFrontmatter["status"],
    title: String(readRowValue(row, "title")),
    description:
      description === null || description === undefined
        ? ""
        : String(description),
    ticket_references: ticketReferences,
    ticket_type: String(
      readRowValue(row, "ticket_type", "ticketType"),
    ) as TicketFrontmatter["ticket_type"],
    acceptance_criteria: parseJson(acceptanceCriteria, []),
    working_branch:
      workingBranch === null || workingBranch === undefined
        ? null
        : String(workingBranch),
    target_branch: String(targetBranch),
    linked_pr: normalizePullRequestRef(parseJson(linkedPr, null)),
    session_id:
      sessionId === null || sessionId === undefined ? null : String(sessionId),
    created_at: String(createdAt),
    updated_at: String(updatedAt),
  };
}

export function mapStructuredEvent(row: SqliteRow): StructuredEvent {
  const occurredAt = readRowValue(row, "occurred_at", "occurredAt");
  const entityType = readRowValue(row, "entity_type", "entityType");
  const entityId = readRowValue(row, "entity_id", "entityId");
  const eventType = readRowValue(row, "event_type", "eventType");

  return {
    id: String(readRowValue(row, "id")),
    occurred_at: String(occurredAt),
    entity_type: String(entityType) as StructuredEvent["entity_type"],
    entity_id: String(entityId),
    event_type: String(eventType),
    payload: parseJson(readRowValue(row, "payload"), {}),
  };
}

export function mapExecutionSession(row: SqliteRow): ExecutionSession {
  const agentAdapter = readRowValue(row, "agent_adapter", "agentAdapter");
  const worktreePath = readRowValue(row, "worktree_path", "worktreePath");
  const adapterSessionRef = readRowValue(
    row,
    "adapter_session_ref",
    "adapterSessionRef",
  );
  const planningEnabled = readRowValue(
    row,
    "planning_enabled",
    "planningEnabled",
  );
  const planStatus = readRowValue(row, "plan_status", "planStatus");
  const planSummary = readRowValue(row, "plan_summary", "planSummary");
  const currentAttemptId = readRowValue(
    row,
    "current_attempt_id",
    "currentAttemptId",
  );
  const latestRequestedChangeNoteId = readRowValue(
    row,
    "latest_requested_change_note_id",
    "latestRequestedChangeNoteId",
  );
  const latestReviewPackageId = readRowValue(
    row,
    "latest_review_package_id",
    "latestReviewPackageId",
  );
  const queueEnteredAt = readRowValue(
    row,
    "queue_entered_at",
    "queueEnteredAt",
  );
  const startedAt = readRowValue(row, "started_at", "startedAt");
  const completedAt = readRowValue(row, "completed_at", "completedAt");
  const lastHeartbeatAt = readRowValue(
    row,
    "last_heartbeat_at",
    "lastHeartbeatAt",
  );
  const lastSummary = readRowValue(row, "last_summary", "lastSummary");

  return {
    id: String(readRowValue(row, "id")),
    ticket_id: Number(readRowValue(row, "ticket_id", "ticketId")),
    project_id: String(readRowValue(row, "project_id", "projectId")),
    repo_id: String(readRowValue(row, "repo_id", "repoId")),
    agent_adapter: agentAdapter === "claude-code" ? "claude-code" : "codex",
    worktree_path:
      worktreePath === null || worktreePath === undefined
        ? null
        : String(worktreePath),
    adapter_session_ref:
      adapterSessionRef === null || adapterSessionRef === undefined
        ? null
        : String(adapterSessionRef),
    status: String(readRowValue(row, "status")) as ExecutionSession["status"],
    planning_enabled: planningEnabled === true || Number(planningEnabled) === 1,
    plan_status: String(planStatus) as ExecutionSession["plan_status"],
    plan_summary:
      planSummary === null || planSummary === undefined
        ? null
        : String(planSummary),
    current_attempt_id:
      currentAttemptId === null || currentAttemptId === undefined
        ? null
        : String(currentAttemptId),
    latest_requested_change_note_id:
      latestRequestedChangeNoteId === null ||
      latestRequestedChangeNoteId === undefined
        ? null
        : String(latestRequestedChangeNoteId),
    latest_review_package_id:
      latestReviewPackageId === null || latestReviewPackageId === undefined
        ? null
        : String(latestReviewPackageId),
    queue_entered_at:
      queueEnteredAt === null || queueEnteredAt === undefined
        ? null
        : String(queueEnteredAt),
    started_at:
      startedAt === null || startedAt === undefined ? null : String(startedAt),
    completed_at:
      completedAt === null || completedAt === undefined
        ? null
        : String(completedAt),
    last_heartbeat_at:
      lastHeartbeatAt === null || lastHeartbeatAt === undefined
        ? null
        : String(lastHeartbeatAt),
    last_summary:
      lastSummary === null || lastSummary === undefined
        ? null
        : String(lastSummary),
  };
}

export function mapExecutionAttempt(row: SqliteRow): ExecutionAttempt {
  const promptKind = readRowValue(row, "prompt_kind", "promptKind");
  const prompt = readRowValue(row, "prompt");
  const ptyPid = readRowValue(row, "pty_pid", "ptyPid");
  const startedAt = readRowValue(row, "started_at", "startedAt");
  const endedAt = readRowValue(row, "ended_at", "endedAt");
  const endReason = readRowValue(row, "end_reason", "endReason");

  return {
    id: String(readRowValue(row, "id")),
    session_id: String(readRowValue(row, "session_id", "sessionId")),
    attempt_number: Number(
      readRowValue(row, "attempt_number", "attemptNumber"),
    ),
    status: String(readRowValue(row, "status")) as ExecutionAttempt["status"],
    prompt_kind:
      promptKind === null || promptKind === undefined
        ? null
        : (String(promptKind) as ExecutionAttempt["prompt_kind"]),
    prompt: prompt === null || prompt === undefined ? null : String(prompt),
    pty_pid: ptyPid === null || ptyPid === undefined ? null : Number(ptyPid),
    started_at: String(startedAt),
    ended_at:
      endedAt === null || endedAt === undefined ? null : String(endedAt),
    end_reason:
      endReason === null || endReason === undefined ? null : String(endReason),
  };
}

export function mapReviewPackage(row: SqliteRow): ReviewPackage {
  const commitRefs = readRowValue(row, "commit_refs", "commitRefs");
  const changeSummary = readRowValue(row, "change_summary", "changeSummary");
  const validationResults = readRowValue(
    row,
    "validation_results",
    "validationResults",
  );
  const remainingRisks = readRowValue(row, "remaining_risks", "remainingRisks");
  const createdAt = readRowValue(row, "created_at", "createdAt");

  return {
    id: String(readRowValue(row, "id")),
    ticket_id: Number(readRowValue(row, "ticket_id", "ticketId")),
    session_id: String(readRowValue(row, "session_id", "sessionId")),
    diff_ref: String(readRowValue(row, "diff_ref", "diffRef")),
    commit_refs: parseJson(commitRefs, []),
    change_summary: String(changeSummary),
    validation_results: parseJson(validationResults, []),
    remaining_risks: parseJson(remainingRisks, []),
    created_at: String(createdAt),
  };
}

export function mapReviewRun(row: SqliteRow): ReviewRun {
  const reviewPackageId = readRowValue(
    row,
    "review_package_id",
    "reviewPackageId",
  );
  const implementationSessionId = readRowValue(
    row,
    "implementation_session_id",
    "implementationSessionId",
  );
  const adapterSessionRef = readRowValue(
    row,
    "adapter_session_ref",
    "adapterSessionRef",
  );
  const failureMessage = readRowValue(row, "failure_message", "failureMessage");
  const prompt = readRowValue(row, "prompt");
  const createdAt = readRowValue(row, "created_at", "createdAt");
  const updatedAt = readRowValue(row, "updated_at", "updatedAt");
  const completedAt = readRowValue(row, "completed_at", "completedAt");

  return {
    id: String(readRowValue(row, "id")),
    ticket_id: Number(readRowValue(row, "ticket_id", "ticketId")),
    review_package_id: String(reviewPackageId),
    implementation_session_id: String(implementationSessionId),
    status: String(readRowValue(row, "status")) as ReviewRun["status"],
    adapter_session_ref:
      adapterSessionRef === null || adapterSessionRef === undefined
        ? null
        : String(adapterSessionRef),
    prompt: prompt === null || prompt === undefined ? null : String(prompt),
    report: parseJson<ReviewReport | null>(readRowValue(row, "report"), null),
    failure_message:
      failureMessage === null || failureMessage === undefined
        ? null
        : String(failureMessage),
    created_at: String(createdAt),
    updated_at: String(updatedAt),
    completed_at:
      completedAt === null || completedAt === undefined
        ? null
        : String(completedAt),
  };
}

export function mapRequestedChangeNote(row: SqliteRow): RequestedChangeNote {
  const reviewPackageId = readRowValue(
    row,
    "review_package_id",
    "reviewPackageId",
  );
  const authorType = readRowValue(row, "author_type", "authorType");
  const createdAt = readRowValue(row, "created_at", "createdAt");

  return {
    id: String(readRowValue(row, "id")),
    ticket_id: Number(readRowValue(row, "ticket_id", "ticketId")),
    review_package_id:
      reviewPackageId === null || reviewPackageId === undefined
        ? null
        : String(reviewPackageId),
    author_type: String(authorType) as RequestedChangeNote["author_type"],
    body: String(readRowValue(row, "body")),
    created_at: String(createdAt),
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
    this.#databaseHandle.close();
  }

  transaction<T>(operation: () => T): T {
    return this.#databaseHandle.transaction(operation);
  }

  appendSessionLog(sessionId: string, line: string): void {
    this.#db
      .insert(sessionLogsTable)
      .values({
        sessionId,
        line,
        createdAt: nowIso(),
      })
      .run();
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
      .insert(structuredEventsTable)
      .values({
        id: event.id,
        occurredAt: event.occurred_at,
        entityType: event.entity_type,
        entityId: event.entity_id,
        eventType: event.event_type,
        payload: event.payload,
      })
      .run();

    return event;
  }

  countOccupiedExecutionSlotsForProject(
    projectId: string,
    excludedSessionId?: string,
  ): number {
    const row = this.#db
      .select({ count: count() })
      .from(executionSessionsTable)
      .where(
        and(
          eq(executionSessionsTable.projectId, projectId),
          inArray(
            executionSessionsTable.status,
            slotOccupyingExecutionSessionStatuses,
          ),
          excludedSessionId === undefined
            ? undefined
            : ne(executionSessionsTable.id, excludedSessionId),
        ),
      )
      .get();

    return Number(row?.count ?? 0);
  }

  nextAttemptNumber(sessionId: string): number {
    const row = this.#db
      .select({
        maxAttemptNumber: max(executionAttemptsTable.attemptNumber),
      })
      .from(executionAttemptsTable)
      .where(eq(executionAttemptsTable.sessionId, sessionId))
      .get();

    return Number(row?.maxAttemptNumber ?? 0) + 1;
  }
}
