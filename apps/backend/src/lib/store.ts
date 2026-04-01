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
  TicketType
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
  addSessionInput(sessionId: string, body: string): ExecutionSession;
  updateSessionStatus(
    sessionId: string,
    status: ExecutionSessionStatus,
    lastSummary?: string | null
  ): ExecutionSession | undefined;
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
