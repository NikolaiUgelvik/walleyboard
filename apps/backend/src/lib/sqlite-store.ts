import type {
  CreateDraftInput,
  CreateProjectInput,
  DraftTicketState,
  ExecutionAttempt,
  ExecutionSession,
  Project,
  PullRequestRef,
  RepositoryConfig,
  RequestedChangeNote,
  ReviewPackage,
  StructuredEvent,
  TicketFrontmatter,
  UpdateProjectInput,
} from "../../../../packages/contracts/src/index.js";

import { DraftRepository } from "./sqlite-store/draft-repository.js";
import { DraftWorkflowService } from "./sqlite-store/draft-workflow.js";
import { EventRepository } from "./sqlite-store/event-repository.js";
import { ProjectRepository } from "./sqlite-store/project-repository.js";
import { ProjectWorkflowService } from "./sqlite-store/project-workflow.js";
import { ReviewRepository } from "./sqlite-store/review-repository.js";
import { SessionRepository } from "./sqlite-store/session-repository.js";
import { SqliteStoreContext } from "./sqlite-store/shared.js";
import { TicketExecutionWorkflowService } from "./sqlite-store/ticket-execution-workflow.js";
import { TicketRepository } from "./sqlite-store/ticket-repository.js";
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
  UpdateExecutionAttemptInput,
  UpdateSessionPlanInput,
} from "./store.js";

export class SqliteStore implements Store {
  readonly #context: SqliteStoreContext;
  readonly #projects: ProjectRepository;
  readonly #drafts: DraftRepository;
  readonly #events: EventRepository;
  readonly #reviews: ReviewRepository;
  readonly #sessions: SessionRepository;
  readonly #tickets: TicketRepository;
  readonly #draftWorkflow: DraftWorkflowService;
  readonly #projectWorkflow: ProjectWorkflowService;
  readonly #ticketExecutionWorkflow: TicketExecutionWorkflowService;

  constructor(databasePath?: string) {
    this.#context = new SqliteStoreContext(databasePath);
    this.#projects = new ProjectRepository(this.#context);
    this.#drafts = new DraftRepository(this.#context);
    this.#events = new EventRepository(this.#context);
    this.#reviews = new ReviewRepository(this.#context);
    this.#sessions = new SessionRepository(this.#context);
    this.#tickets = new TicketRepository(this.#context);
    this.#draftWorkflow = new DraftWorkflowService(
      this.#context,
      this.#drafts,
      this.#projects,
      this.#tickets,
      this.#events,
    );
    this.#projectWorkflow = new ProjectWorkflowService(
      this.#context,
      this.#projects,
      this.#drafts,
      this.#tickets,
    );
    this.#ticketExecutionWorkflow = new TicketExecutionWorkflowService(
      this.#context,
      this.#projects,
      this.#tickets,
      this.#sessions,
      this.#reviews,
    );
  }

  appendSessionLog(sessionId: string, line: string): number {
    this.#context.appendSessionLog(sessionId, line);
    return this.getSessionLogs(sessionId).length - 1;
  }

  listProjects(): Project[] {
    return this.#projects.listProjects();
  }

  getProject(projectId: string): Project | undefined {
    return this.#projects.getProject(projectId);
  }

  getRepository(repositoryId: string) {
    return this.#projects.getRepository(repositoryId);
  }

  createProject(input: CreateProjectInput): {
    project: Project;
    repository: RepositoryConfig;
  } {
    return this.#projects.createProject(input);
  }

  updateProject(projectId: string, input: UpdateProjectInput): Project {
    return this.#projects.updateProject(projectId, input);
  }

  deleteProject(projectId: string): Project | undefined {
    return this.#projectWorkflow.deleteProject(projectId);
  }

  listProjectRepositories(projectId: string) {
    return this.#projects.listProjectRepositories(projectId);
  }

  listProjectDrafts(projectId: string): DraftTicketState[] {
    return this.#drafts.listProjectDrafts(projectId);
  }

  listProjectTickets(
    projectId: string,
    options?: ListProjectTicketsOptions,
  ): TicketFrontmatter[] {
    return this.#tickets.listProjectTickets(projectId, options);
  }

  createDraft(input: CreateDraftInput): DraftTicketState {
    return this.#drafts.createDraft(input);
  }

  getDraft(draftId: string): DraftTicketState | undefined {
    return this.#drafts.getDraft(draftId);
  }

  updateDraft(
    draftId: string,
    input: UpdateDraftRecordInput,
  ): DraftTicketState {
    return this.#drafts.updateDraft(draftId, input);
  }

  deleteDraft(draftId: string): DraftTicketState | undefined {
    return this.#drafts.deleteDraft(draftId);
  }

  refineDraft(draftId: string, instruction?: string): DraftTicketState {
    return this.#drafts.refineDraft(draftId, instruction);
  }

  getDraftEvents(draftId: string): StructuredEvent[] {
    return this.#events.getDraftEvents(draftId);
  }

  recordDraftEvent(
    draftId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): StructuredEvent {
    return this.#events.recordDraftEvent(draftId, eventType, payload);
  }

  confirmDraft(draftId: string, input: ConfirmDraftInput): TicketFrontmatter {
    return this.#draftWorkflow.confirmDraft(draftId, input);
  }

  getTicket(ticketId: number): TicketFrontmatter | undefined {
    return this.#tickets.getTicket(ticketId);
  }

  getReviewPackage(ticketId: number): ReviewPackage | undefined {
    return this.#reviews.getReviewPackage(ticketId);
  }

  startTicket(
    ticketId: number,
    planningEnabled: boolean,
    runtime: PreparedExecutionRuntime,
  ): StartTicketResult {
    return this.#ticketExecutionWorkflow.startTicket(
      ticketId,
      planningEnabled,
      runtime,
    );
  }

  stopTicket(ticketId: number, reason?: string): StopTicketResult {
    return this.#ticketExecutionWorkflow.stopTicket(ticketId, reason);
  }

  requestTicketChanges(
    ticketId: number,
    body: string,
    authorType?: RequestedChangeNote["author_type"],
  ): RestartTicketResult {
    return this.#ticketExecutionWorkflow.requestTicketChanges(
      ticketId,
      body,
      authorType,
    );
  }

  recordMergeConflict(ticketId: number, body: string): MergeConflictResult {
    return this.#ticketExecutionWorkflow.recordMergeConflict(ticketId, body);
  }

  resumeTicket(ticketId: number, reason?: string): RestartTicketResult {
    return this.#ticketExecutionWorkflow.resumeTicket(ticketId, reason);
  }

  restartInterruptedTicket(
    ticketId: number,
    runtime: PreparedExecutionRuntime,
    reason?: string,
  ): RestartTicketResult {
    return this.#ticketExecutionWorkflow.restartInterruptedTicket(
      ticketId,
      runtime,
      reason,
    );
  }

  addSessionInput(sessionId: string, body: string): ExecutionSession {
    return this.#sessions.addSessionInput(sessionId, body);
  }

  updateSessionPlan(
    sessionId: string,
    input: UpdateSessionPlanInput,
  ): ExecutionSession | undefined {
    return this.#sessions.updateSessionPlan(sessionId, input);
  }

  updateSessionStatus(
    sessionId: string,
    status: ExecutionSession["status"],
    lastSummary?: string | null,
  ): ExecutionSession | undefined {
    return this.#sessions.updateSessionStatus(sessionId, status, lastSummary);
  }

  updateSessionAdapterSessionRef(
    sessionId: string,
    adapterSessionRef: string,
  ): ExecutionSession | undefined {
    return this.#sessions.updateSessionAdapterSessionRef(
      sessionId,
      adapterSessionRef,
    );
  }

  claimNextQueuedSession(projectId: string): ExecutionSession | undefined {
    const project = this.#projects.getProject(projectId);
    return project ? this.#sessions.claimNextQueuedSession(project) : undefined;
  }

  completeSession(
    sessionId: string,
    input: CompleteSessionInput,
  ): ExecutionSession | undefined {
    return this.#sessions.completeSession(sessionId, input);
  }

  updateExecutionAttempt(
    attemptId: string,
    input: UpdateExecutionAttemptInput,
  ): ExecutionAttempt | undefined {
    return this.#sessions.updateExecutionAttempt(attemptId, input);
  }

  createReviewPackage(input: CreateReviewPackageInput): ReviewPackage {
    return this.#reviews.createReviewPackage(input);
  }

  recoverInterruptedSessions(): StartupRecoveryResult {
    return this.#sessions.recoverInterruptedSessions();
  }

  updateTicketStatus(
    ticketId: number,
    status: TicketFrontmatter["status"],
  ): TicketFrontmatter | undefined {
    return this.#tickets.updateTicketStatus(ticketId, status);
  }

  updateTicketLinkedPr(
    ticketId: number,
    linkedPr: PullRequestRef | null,
  ): TicketFrontmatter | undefined {
    return this.#tickets.updateTicketLinkedPr(ticketId, linkedPr);
  }

  listSessionAttempts(sessionId: string): ExecutionAttempt[] {
    return this.#sessions.listSessionAttempts(sessionId);
  }

  getSession(sessionId: string): ExecutionSession | undefined {
    return this.#sessions.getSession(sessionId);
  }

  getSessionLogs(sessionId: string): string[] {
    return this.#sessions.getSessionLogs(sessionId);
  }

  getTicketEvents(ticketId: number): StructuredEvent[] {
    return this.#events.getTicketEvents(ticketId);
  }

  recordTicketEvent(
    ticketId: number,
    eventType: string,
    payload: Record<string, unknown>,
  ): StructuredEvent {
    return this.#events.recordTicketEvent(ticketId, eventType, payload);
  }

  archiveTicket(ticketId: number): TicketFrontmatter | undefined {
    return this.#tickets.archiveTicket(ticketId);
  }

  restoreTicket(ticketId: number): TicketFrontmatter | undefined {
    return this.#tickets.restoreTicket(ticketId);
  }

  deleteTicket(ticketId: number): TicketFrontmatter | undefined {
    return this.#tickets.deleteTicket(ticketId);
  }

  getRequestedChangeNote(noteId: string): RequestedChangeNote | undefined {
    return this.#reviews.getRequestedChangeNote(noteId);
  }
}
