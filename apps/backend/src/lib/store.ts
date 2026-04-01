import type {
  CreateDraftInput,
  CreateProjectInput,
  DraftTicketState,
  ExecutionAttempt,
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

export interface Store {
  listProjects(): Project[];
  getProject(projectId: string): Project | undefined;
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
