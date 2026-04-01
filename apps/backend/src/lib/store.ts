import type {
  CreateDraftInput,
  CreateProjectInput,
  DraftTicketState,
  ExecutionAttempt,
  ExecutionSessionStatus,
  ExecutionSession,
  Project,
  RepositoryConfig,
  RequestedChangeNote,
  ReviewPackage,
  StructuredEvent,
  TicketFrontmatter,
  TicketType,
  ValidationResult
} from "@orchestrator/contracts";

export type ConfirmDraftInput = {
  title: string;
  description: string;
  repo_id: string;
  ticket_type: TicketType;
  acceptance_criteria: string[];
  target_branch: string;
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

export type CompleteSessionInput = {
  status: ExecutionSessionStatus;
  last_summary?: string | null;
  latest_review_package_id?: string | null;
};

export type StartupRecoveryResult = {
  sessions: ExecutionSession[];
};

export interface Store {
  listProjects(): Project[];
  getProject(projectId: string): Project | undefined;
  getRepository(repositoryId: string): RepositoryConfig | undefined;
  createProject(input: CreateProjectInput): {
    project: Project;
    repository: RepositoryConfig;
  };
  listProjectRepositories(projectId: string): RepositoryConfig[];
  listProjectDrafts(projectId: string): DraftTicketState[];
  listProjectTickets(projectId: string): TicketFrontmatter[];
  createDraft(input: CreateDraftInput): DraftTicketState;
  getDraft(draftId: string): DraftTicketState | undefined;
  refineDraft(draftId: string, instruction?: string): DraftTicketState;
  confirmDraft(draftId: string, input: ConfirmDraftInput): TicketFrontmatter;
  getTicket(ticketId: number): TicketFrontmatter | undefined;
  getReviewPackage(ticketId: number): ReviewPackage | undefined;
  startTicket(
    ticketId: number,
    planningEnabled: boolean,
    runtime: PreparedExecutionRuntime
  ): StartTicketResult;
  requestTicketChanges(ticketId: number, body: string): RestartTicketResult;
  resumeTicket(ticketId: number, reason?: string): RestartTicketResult;
  addSessionInput(sessionId: string, body: string): ExecutionSession;
  updateSessionStatus(
    sessionId: string,
    status: ExecutionSessionStatus,
    lastSummary?: string | null
  ): ExecutionSession | undefined;
  completeSession(sessionId: string, input: CompleteSessionInput): ExecutionSession | undefined;
  appendSessionLog(sessionId: string, line: string): number;
  updateExecutionAttempt(
    attemptId: string,
    input: UpdateExecutionAttemptInput
  ): ExecutionAttempt | undefined;
  createReviewPackage(input: CreateReviewPackageInput): ReviewPackage;
  recoverInterruptedSessions(): StartupRecoveryResult;
  updateTicketStatus(
    ticketId: number,
    status: TicketFrontmatter["status"]
  ): TicketFrontmatter | undefined;
  listSessionAttempts(sessionId: string): ExecutionAttempt[];
  getSession(sessionId: string): ExecutionSession | undefined;
  getSessionLogs(sessionId: string): string[];
  getTicketEvents(ticketId: number): StructuredEvent[];
  recordTicketEvent(
    ticketId: number,
    eventType: string,
    payload: Record<string, unknown>
  ): StructuredEvent;
  getRequestedChangeNote(noteId: string): RequestedChangeNote | undefined;
}
