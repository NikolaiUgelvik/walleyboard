import type {
  CreateDraftInput,
  CreateProjectInput,
  DraftTicketState,
  ExecutionAttempt,
  ExecutionPlanStatus,
  ExecutionSession,
  ExecutionSessionStatus,
  Project,
  PullRequestRef,
  RepositoryConfig,
  RequestedChangeNote,
  ReviewPackage,
  ReviewReport,
  ReviewRun,
  StructuredEvent,
  TicketFrontmatter,
  TicketReference,
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

export type CreateReviewRunInput = {
  ticket_id: number;
  review_package_id: string;
  implementation_session_id: string;
  trigger_source?: "automatic" | "manual";
  prompt?: string | null;
};

export type UpdateReviewRunInput = {
  status?: ReviewRun["status"];
  adapter_session_ref?: string | null;
  prompt?: string | null;
  report?: ReviewReport | null;
  failure_message?: string | null;
  completed_at?: string | null;
};

export type UpdateExecutionAttemptInput = {
  status?: ExecutionAttempt["status"];
  prompt_kind?: ExecutionAttempt["prompt_kind"];
  prompt?: string | null;
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
  activeSessionIds: string[];
  sessions: ExecutionSession[];
};

export type ListProjectTicketsOptions = {
  includeArchived?: boolean;
  archivedOnly?: boolean;
};

export type SearchProjectTicketReferencesInput = {
  limit: number;
  query: string;
};

export interface ProjectPersistence {
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
}

export interface DraftPersistence {
  listProjectDrafts(projectId: string): DraftTicketState[];
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
  editReadyTicket(ticketId: number): DraftTicketState;
}

export interface TicketPersistence {
  listProjectTickets(
    projectId: string,
    options?: ListProjectTicketsOptions,
  ): TicketFrontmatter[];
  searchProjectTicketReferences(
    projectId: string,
    input: SearchProjectTicketReferencesInput,
  ): TicketReference[];
  getTicket(ticketId: number): TicketFrontmatter | undefined;
  startTicket(
    ticketId: number,
    planningEnabled: boolean,
    runtime: PreparedExecutionRuntime,
  ): StartTicketResult;
  stopTicket(ticketId: number, reason?: string): StopTicketResult;
  requestTicketChanges(
    ticketId: number,
    body: string,
    authorType?: RequestedChangeNote["author_type"],
  ): RestartTicketResult;
  recordMergeConflict(ticketId: number, body: string): MergeConflictResult;
  resumeTicket(ticketId: number, reason?: string): RestartTicketResult;
  restartInterruptedTicket(
    ticketId: number,
    runtime: PreparedExecutionRuntime,
    reason?: string,
  ): RestartTicketResult;
  updateTicketStatus(
    ticketId: number,
    status: TicketFrontmatter["status"],
  ): TicketFrontmatter | undefined;
  updateTicketLinkedPr(
    ticketId: number,
    linkedPr: PullRequestRef | null,
  ): TicketFrontmatter | undefined;
  getTicketEvents(ticketId: number): StructuredEvent[];
  recordTicketEvent(
    ticketId: number,
    eventType: string,
    payload: Record<string, unknown>,
  ): StructuredEvent;
  archiveTicket(ticketId: number): TicketFrontmatter | undefined;
  restoreTicket(ticketId: number): TicketFrontmatter | undefined;
  deleteTicket(ticketId: number): TicketFrontmatter | undefined;
}

export interface ReviewPersistence {
  getReviewPackage(ticketId: number): ReviewPackage | undefined;
  getLatestReviewRun(ticketId: number): ReviewRun | undefined;
  listReviewRuns(ticketId: number): ReviewRun[];
  recoverInterruptedReviewRuns(): ReviewRun[];
  countAutomaticReviewRuns(ticketId: number): number;
  createReviewPackage(input: CreateReviewPackageInput): ReviewPackage;
  createReviewRun(input: CreateReviewRunInput): ReviewRun;
  updateReviewRun(
    reviewRunId: string,
    input: UpdateReviewRunInput,
  ): ReviewRun | undefined;
  getRequestedChangeNote(noteId: string): RequestedChangeNote | undefined;
}

export interface SessionPersistence {
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
  updateSessionWorktreePath(
    sessionId: string,
    worktreePath: string | null,
  ): ExecutionSession | undefined;
  updateSessionAdapterSessionRef(
    sessionId: string,
    adapterSessionRef: string,
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
  recoverInterruptedSessions(): StartupRecoveryResult;
  listSessionAttempts(sessionId: string): ExecutionAttempt[];
  getSession(sessionId: string): ExecutionSession | undefined;
  getSessionLogs(sessionId: string): string[];
}

export type DraftRefineSessionStatus = "running" | "completed" | "failed";

export type DraftRefineSession = {
  id: string;
  draft_id: string;
  project_id: string;
  repository_id: string;
  adapter_session_ref: string | null;
  attempt_count: number;
  status: DraftRefineSessionStatus;
  created_at: string;
  last_attempt_at: string;
};

export interface DraftRefineSessionPersistence {
  create(input: {
    draftId: string;
    projectId: string;
    repositoryId: string;
  }): DraftRefineSession;
  recordAttempt(
    id: string,
    input: {
      adapterSessionRef: string | null;
      attemptCount: number;
    },
  ): DraftRefineSession | undefined;
  complete(id: string, status: "completed" | "failed"): void;
}

export interface WalleyboardPersistence
  extends ProjectPersistence,
    DraftPersistence,
    TicketPersistence,
    ReviewPersistence,
    SessionPersistence {
  projects: ProjectPersistence;
  drafts: DraftPersistence;
  tickets: TicketPersistence;
  reviews: ReviewPersistence;
  sessions: SessionPersistence;
  draftRefineSessions: DraftRefineSessionPersistence | null;
  withTransaction<T>(operation: (persistence: WalleyboardPersistence) => T): T;
  close(): void;
}

export type AgentReviewPersistence = ProjectPersistence &
  ReviewPersistence &
  SessionPersistence &
  TicketPersistence;

export type ExecutionRuntimePersistence = DraftPersistence &
  ProjectPersistence &
  ReviewPersistence &
  SessionPersistence &
  TicketPersistence;

export type DraftRoutePersistence = DraftPersistence &
  ProjectPersistence &
  TicketPersistence;

export type GitHubPullRequestPersistence = ProjectPersistence &
  ReviewPersistence &
  SessionPersistence &
  TicketPersistence;

export type ProjectRoutePersistence = DraftPersistence &
  ProjectPersistence &
  SessionPersistence &
  TicketPersistence;

export type SessionRoutePersistence = ProjectPersistence &
  SessionPersistence &
  TicketPersistence;

export type SocketServerPersistence = ProjectPersistence &
  ReviewPersistence &
  SessionPersistence &
  TicketPersistence;

export type TicketRoutePersistence = DraftPersistence &
  ProjectPersistence &
  ReviewPersistence &
  SessionPersistence &
  TicketPersistence;
