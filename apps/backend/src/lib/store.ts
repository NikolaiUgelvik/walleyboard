import type {
  CreateDraftInput,
  CreateProjectInput,
  DraftTicketState,
  ExecutionAttempt,
  ExecutionPlanStatus,
  ExecutionSession,
  ExecutionSessionStatus,
  Project,
  RepositoryConfig,
  RequestedChangeNote,
  ReviewPackage,
  StructuredEvent,
  TicketFrontmatter,
  TicketType,
  UpdateDraftInput,
  UpdateProjectInput,
  ValidationResult,
} from "../../../../packages/contracts/src/index.js";

export type ConfirmDraftInput = {
  title: string;
  description: string;
  repo_id: string;
  ticket_type: TicketType;
  acceptance_criteria: string[];
  target_branch: string;
};

export type UpdateDraftRecordInput = UpdateDraftInput & {
  split_proposal_summary?: string | null;
  wizard_status?: DraftTicketState["wizard_status"];
};

export type PreparedExecutionRuntime = {
  workingBranch: string;
  worktreePath: string;
  logs: string[];
};

export type StartTicketResult = {
  ticket: TicketFrontmatter;
  session: ExecutionSession;
  attempt: ExecutionAttempt;
  logs: string[];
};

export type RestartTicketResult = {
  ticket: TicketFrontmatter;
  session: ExecutionSession;
  attempt: ExecutionAttempt;
  logs: string[];
  requestedChangeNote?: RequestedChangeNote;
};

export type StopTicketResult = {
  ticket: TicketFrontmatter;
  session: ExecutionSession;
  attempt: ExecutionAttempt | null;
  logs: string[];
};

export type MergeConflictResult = {
  ticket: TicketFrontmatter;
  session: ExecutionSession;
  requestedChangeNote: RequestedChangeNote;
  logs: string[];
};

export type CreateReviewPackageInput = {
  ticket_id: number;
  session_id: string;
  diff_ref: string;
  commit_refs: string[];
  change_summary: string;
  validation_results: ValidationResult[];
  remaining_risks: string[];
};

export type UpdateExecutionAttemptInput = {
  status?: ExecutionAttempt["status"];
  pty_pid?: number | null;
  end_reason?: string | null;
};

export type UpdateSessionPlanInput = {
  plan_status?: ExecutionPlanStatus;
  plan_summary?: string | null;
  status?: ExecutionSessionStatus;
  last_summary?: string | null;
};

export type CompleteSessionInput = {
  status: ExecutionSessionStatus;
  last_summary?: string | null;
  latest_review_package_id?: string | null;
};

export type StartupRecoveryResult = {
  sessions: ExecutionSession[];
};

export type ListProjectTicketsOptions = {
  includeArchived?: boolean;
};

export interface Store {
  listProjects(): Project[];
  getProject(projectId: string): Project | undefined;
  getRepository(repositoryId: string): RepositoryConfig | undefined;
  createProject(input: CreateProjectInput): {
    project: Project;
    repository: RepositoryConfig;
  };
  updateProject(projectId: string, input: UpdateProjectInput): Project;
  deleteProject(projectId: string): Project | undefined;
  listProjectRepositories(projectId: string): RepositoryConfig[];
  listProjectDrafts(projectId: string): DraftTicketState[];
  listProjectTickets(
    projectId: string,
    options?: ListProjectTicketsOptions,
  ): TicketFrontmatter[];
  createDraft(input: CreateDraftInput): DraftTicketState;
  getDraft(draftId: string): DraftTicketState | undefined;
  updateDraft(draftId: string, input: UpdateDraftRecordInput): DraftTicketState;
  deleteDraft(draftId: string): DraftTicketState | undefined;
  refineDraft(draftId: string, instruction?: string): DraftTicketState;
  getDraftEvents(draftId: string): StructuredEvent[];
  recordDraftEvent(
    draftId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): StructuredEvent;
  confirmDraft(draftId: string, input: ConfirmDraftInput): TicketFrontmatter;
  getTicket(ticketId: number): TicketFrontmatter | undefined;
  getReviewPackage(ticketId: number): ReviewPackage | undefined;
  startTicket(
    ticketId: number,
    planningEnabled: boolean,
    runtime: PreparedExecutionRuntime,
  ): StartTicketResult;
  stopTicket(ticketId: number, reason?: string): StopTicketResult;
  requestTicketChanges(ticketId: number, body: string): RestartTicketResult;
  recordMergeConflict(ticketId: number, body: string): MergeConflictResult;
  resumeTicket(ticketId: number, reason?: string): RestartTicketResult;
  addSessionInput(sessionId: string, body: string): ExecutionSession;
  updateSessionPlan(
    sessionId: string,
    input: UpdateSessionPlanInput,
  ): ExecutionSession | undefined;
  updateSessionStatus(
    sessionId: string,
    status: ExecutionSessionStatus,
    lastSummary?: string | null,
  ): ExecutionSession | undefined;
  claimNextQueuedSession(projectId: string): ExecutionSession | undefined;
  completeSession(
    sessionId: string,
    input: CompleteSessionInput,
  ): ExecutionSession | undefined;
  appendSessionLog(sessionId: string, line: string): number;
  updateExecutionAttempt(
    attemptId: string,
    input: UpdateExecutionAttemptInput,
  ): ExecutionAttempt | undefined;
  createReviewPackage(input: CreateReviewPackageInput): ReviewPackage;
  recoverInterruptedSessions(): StartupRecoveryResult;
  updateTicketStatus(
    ticketId: number,
    status: TicketFrontmatter["status"],
  ): TicketFrontmatter | undefined;
  listSessionAttempts(sessionId: string): ExecutionAttempt[];
  getSession(sessionId: string): ExecutionSession | undefined;
  getSessionLogs(sessionId: string): string[];
  getTicketEvents(ticketId: number): StructuredEvent[];
  recordTicketEvent(
    ticketId: number,
    eventType: string,
    payload: Record<string, unknown>,
  ): StructuredEvent;
  archiveTicket(ticketId: number): TicketFrontmatter | undefined;
  deleteTicket(ticketId: number): TicketFrontmatter | undefined;
  getRequestedChangeNote(noteId: string): RequestedChangeNote | undefined;
}
