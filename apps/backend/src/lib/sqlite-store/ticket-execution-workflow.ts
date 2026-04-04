import {
  executionAttemptsTable,
  executionSessionsTable,
  requestedChangeNotesTable,
  ticketsTable,
} from "@walleyboard/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { ExecutionPlanStatus } from "../../../../../packages/contracts/src/index.js";

import type {
  MergeConflictResult,
  PreparedExecutionRuntime,
  RestartTicketResult,
  StartTicketResult,
  StopTicketResult,
} from "../store.js";
import { nowIso } from "../time.js";
import type { ProjectRepository } from "./project-repository.js";
import type { ReviewRepository } from "./review-repository.js";
import type { SessionRepository } from "./session-repository.js";
import {
  deriveWorkingBranch,
  formatMarkdownLog,
  hasMeaningfulContent,
  requireValue,
  type SqliteStoreContext,
} from "./shared.js";
import type { TicketRepository } from "./ticket-repository.js";

export class TicketExecutionWorkflowService {
  constructor(
    private readonly context: SqliteStoreContext,
    private readonly projects: ProjectRepository,
    private readonly tickets: TicketRepository,
    private readonly sessions: SessionRepository,
    private readonly reviews: ReviewRepository,
  ) {}

  startTicket(
    ticketId: number,
    planningEnabled: boolean,
    runtime: PreparedExecutionRuntime,
  ): StartTicketResult {
    const ticket = this.tickets.getTicket(ticketId);
    if (!ticket) {
      throw new Error("Ticket not found");
    }
    if (ticket.status !== "ready") {
      throw new Error("Only ready tickets can be started");
    }
    if (ticket.session_id) {
      throw new Error("Ticket already has an execution session");
    }

    const project = this.projects.getProject(ticket.project);
    if (!project) {
      throw new Error("Project not found");
    }
    const sessionId = nanoid();
    const attemptId = nanoid();
    const timestamp = nowIso();
    const shouldQueue =
      this.context.countOccupiedExecutionSlotsForProject(ticket.project) >=
      project.max_concurrent_sessions;
    const planStatus: ExecutionPlanStatus = planningEnabled
      ? "drafting"
      : "not_requested";
    const summary = shouldQueue
      ? planningEnabled
        ? "Execution queued. The worktree is ready and planning will begin when a project slot opens."
        : "Execution queued. The worktree is ready and the agent will start when a project slot opens."
      : planningEnabled
        ? "Execution session created, worktree prepared, and a plan requested from the agent."
        : "Execution session created, worktree prepared, and the agent launch requested.";

    this.context.db
      .update(ticketsTable)
      .set({
        status: "in_progress",
        sessionId,
        workingBranch: runtime.workingBranch,
        updatedAt: timestamp,
      })
      .where(eq(ticketsTable.id, ticketId))
      .run();

    this.context.db
      .insert(executionSessionsTable)
      .values({
        id: sessionId,
        ticketId: ticket.id,
        projectId: ticket.project,
        repoId: ticket.repo,
        agentAdapter: project.agent_adapter,
        worktreePath: runtime.worktreePath,
        adapterSessionRef: null,
        status: shouldQueue ? "queued" : "awaiting_input",
        planningEnabled,
        planStatus,
        planSummary: null,
        currentAttemptId: attemptId,
        latestRequestedChangeNoteId: null,
        latestReviewPackageId: null,
        queueEnteredAt: shouldQueue ? timestamp : null,
        startedAt: timestamp,
        completedAt: null,
        lastHeartbeatAt: timestamp,
        lastSummary: summary,
      })
      .run();

    this.context.db
      .insert(executionAttemptsTable)
      .values({
        id: attemptId,
        sessionId,
        attemptNumber: 1,
        status: "queued",
        promptKind: null,
        prompt: null,
        ptyPid: null,
        startedAt: timestamp,
        endedAt: null,
        endReason: null,
      })
      .run();

    const logs = [
      `Session created for ticket #${ticket.id}: ${ticket.title}`,
      `Working branch reserved: ${runtime.workingBranch}`,
      `Worktree prepared at: ${runtime.worktreePath}`,
      `Planning mode: ${planningEnabled ? "enabled" : "disabled"}`,
      ...runtime.logs,
      shouldQueue
        ? `Execution queued. ${project.max_concurrent_sessions} running slots are already in use for this project.`
        : "Agent launch has been handed off to the execution runtime.",
    ];

    for (const line of logs) {
      this.context.appendSessionLog(sessionId, line);
    }

    this.context.recordStructuredEvent(
      "ticket",
      String(ticket.id),
      "ticket.started",
      {
        ticket_id: ticket.id,
        session_id: sessionId,
        working_branch: runtime.workingBranch,
        worktree_path: runtime.worktreePath,
      },
    );
    this.context.recordStructuredEvent(
      "session",
      sessionId,
      "session.started",
      {
        ticket_id: ticket.id,
        attempt_id: attemptId,
        planning_enabled: planningEnabled,
        worktree_path: runtime.worktreePath,
      },
    );

    return {
      ticket: requireValue(
        this.tickets.getTicket(ticket.id),
        "Ticket not found after session start",
      ),
      session: requireValue(
        this.sessions.getSession(sessionId),
        "Session not found after start",
      ),
      attempt: requireValue(
        this.sessions.listSessionAttempts(sessionId)[0],
        "Execution attempt not found after start",
      ),
      logs,
    };
  }

  stopTicket(ticketId: number, reason?: string): StopTicketResult {
    const ticket = this.tickets.getTicket(ticketId);
    if (!ticket) {
      throw new Error("Ticket not found");
    }
    if (ticket.status !== "in_progress") {
      throw new Error("Only in-progress tickets can be stopped");
    }
    if (!ticket.session_id) {
      throw new Error("Ticket has no execution session");
    }

    const session = this.sessions.getSession(ticket.session_id);
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

    this.context.db
      .update(executionSessionsTable)
      .set({
        status: "interrupted",
        lastHeartbeatAt: timestamp,
        lastSummary: summary,
      })
      .where(eq(executionSessionsTable.id, session.id))
      .run();

    const attempt = session.current_attempt_id
      ? (this.sessions.updateExecutionAttempt(session.current_attempt_id, {
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
      this.context.appendSessionLog(session.id, line);
    }

    this.context.recordStructuredEvent(
      "session",
      session.id,
      "session.interrupted",
      {
        ticket_id: ticketId,
        reason: reasonBody,
        interruption_source: "user_stop",
      },
    );
    this.context.recordStructuredEvent(
      "ticket",
      String(ticketId),
      "ticket.stopped",
      {
        ticket_id: ticketId,
        session_id: session.id,
        reason: reasonBody,
      },
    );

    return {
      ticket: requireValue(
        this.tickets.getTicket(ticketId),
        "Ticket not found after stop",
      ),
      session: requireValue(
        this.sessions.getSession(session.id),
        "Session not found after stop",
      ),
      attempt,
      logs,
    };
  }

  requestTicketChanges(
    ticketId: number,
    body: string,
    authorType: "user" | "system" = "user",
  ): RestartTicketResult {
    const ticket = this.tickets.getTicket(ticketId);
    if (!ticket) {
      throw new Error("Ticket not found");
    }
    if (ticket.status !== "review") {
      throw new Error("Only review tickets can request changes");
    }
    if (!ticket.session_id) {
      throw new Error("Ticket has no execution session");
    }

    const session = this.sessions.getSession(ticket.session_id);
    if (!session) {
      throw new Error("Execution session not found");
    }
    if (!session.worktree_path) {
      throw new Error("Execution session has no prepared worktree");
    }
    const project = this.projects.getProject(ticket.project);
    if (!project) {
      throw new Error("Project not found");
    }
    const reviewPackage = this.reviews.getReviewPackage(ticketId);
    if (!reviewPackage) {
      throw new Error("Review package not found");
    }

    const noteId = nanoid();
    const attemptId = nanoid();
    const timestamp = nowIso();
    const attemptNumber = this.context.nextAttemptNumber(session.id);
    const shouldQueue =
      this.context.countOccupiedExecutionSlotsForProject(ticket.project) >=
      project.max_concurrent_sessions;
    const summary = shouldQueue
      ? "Review feedback was recorded. The session is queued and will relaunch on the existing worktree when a project slot opens."
      : "Review feedback was recorded and the execution session is relaunching on the existing worktree.";

    this.context.db
      .insert(requestedChangeNotesTable)
      .values({
        id: noteId,
        ticketId,
        reviewPackageId: reviewPackage.id,
        authorType,
        body,
        createdAt: timestamp,
      })
      .run();

    this.context.db
      .update(ticketsTable)
      .set({
        status: "in_progress",
        updatedAt: timestamp,
      })
      .where(eq(ticketsTable.id, ticketId))
      .run();

    this.context.db
      .update(executionSessionsTable)
      .set({
        status: shouldQueue ? "queued" : "awaiting_input",
        queueEnteredAt: shouldQueue ? timestamp : null,
        currentAttemptId: attemptId,
        latestRequestedChangeNoteId: noteId,
        completedAt: null,
        lastHeartbeatAt: timestamp,
        lastSummary: summary,
      })
      .where(eq(executionSessionsTable.id, session.id))
      .run();

    this.context.db
      .insert(executionAttemptsTable)
      .values({
        id: attemptId,
        sessionId: session.id,
        attemptNumber,
        status: "queued",
        promptKind: null,
        prompt: null,
        ptyPid: null,
        startedAt: timestamp,
        endedAt: null,
        endReason: null,
      })
      .run();

    const logs = [
      formatMarkdownLog("Requested changes recorded", body),
      `Reusing worktree at: ${session.worktree_path}`,
      `Reusing working branch: ${ticket.working_branch ?? deriveWorkingBranch(ticket.id, ticket.title, project.agent_adapter)}`,
      shouldQueue
        ? `Queued execution attempt ${attemptNumber} until a project running slot opens.`
        : `Starting execution attempt ${attemptNumber}.`,
    ];

    for (const line of logs) {
      this.context.appendSessionLog(session.id, line);
    }

    this.context.recordStructuredEvent(
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
    this.context.recordStructuredEvent(
      "session",
      session.id,
      "session.relaunched",
      {
        ticket_id: ticketId,
        attempt_id: attemptId,
        reason: "review_changes",
        requested_change_note_id: noteId,
      },
    );

    return {
      ticket: requireValue(
        this.tickets.getTicket(ticketId),
        "Ticket not found after change request",
      ),
      session: requireValue(
        this.sessions.getSession(session.id),
        "Session not found after change request",
      ),
      attempt: requireValue(
        this.sessions.listSessionAttempts(session.id)[attemptNumber - 1],
        "Execution attempt not found after change request",
      ),
      logs,
      requestedChangeNote: requireValue(
        this.reviews.getRequestedChangeNote(noteId),
        "Requested change note not found after creation",
      ),
    };
  }

  recordMergeConflict(ticketId: number, body: string): MergeConflictResult {
    const ticket = this.tickets.getTicket(ticketId);
    if (!ticket) {
      throw new Error("Ticket not found");
    }
    if (ticket.status !== "review") {
      throw new Error("Only review tickets can record merge conflicts");
    }
    if (!ticket.session_id) {
      throw new Error("Ticket has no execution session");
    }

    const session = this.sessions.getSession(ticket.session_id);
    if (!session) {
      throw new Error("Execution session not found");
    }
    if (!session.worktree_path) {
      throw new Error("Execution session has no prepared worktree");
    }
    const project = this.projects.getProject(ticket.project);
    if (!project) {
      throw new Error("Project not found");
    }

    const reviewPackage = this.reviews.getReviewPackage(ticketId);
    const noteId = nanoid();
    const timestamp = nowIso();
    const summary = formatMarkdownLog("Merge conflict detected", body);

    this.context.db
      .insert(requestedChangeNotesTable)
      .values({
        id: noteId,
        ticketId,
        reviewPackageId: reviewPackage?.id ?? null,
        authorType: "system",
        body,
        createdAt: timestamp,
      })
      .run();

    this.context.db
      .update(ticketsTable)
      .set({
        status: "in_progress",
        updatedAt: timestamp,
      })
      .where(eq(ticketsTable.id, ticketId))
      .run();

    this.context.db
      .update(executionSessionsTable)
      .set({
        status: "failed",
        latestRequestedChangeNoteId: noteId,
        completedAt: timestamp,
        lastHeartbeatAt: timestamp,
        lastSummary: summary,
      })
      .where(eq(executionSessionsTable.id, session.id))
      .run();

    const logs = [
      formatMarkdownLog("Merge conflict note recorded", body),
      `Worktree preserved at: ${session.worktree_path}`,
      `Working branch preserved: ${ticket.working_branch ?? deriveWorkingBranch(ticket.id, ticket.title, project.agent_adapter)}`,
      "Ticket returned to in-progress so the merge conflict can be resolved on the existing branch.",
    ];

    for (const line of logs) {
      this.context.appendSessionLog(session.id, line);
    }

    this.context.recordStructuredEvent(
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
    this.context.recordStructuredEvent(
      "session",
      session.id,
      "session.merge_failed",
      {
        ticket_id: ticketId,
        requested_change_note_id: noteId,
      },
    );

    return {
      ticket: requireValue(
        this.tickets.getTicket(ticketId),
        "Ticket not found after merge conflict handling",
      ),
      session: requireValue(
        this.sessions.getSession(session.id),
        "Session not found after merge conflict handling",
      ),
      requestedChangeNote: requireValue(
        this.reviews.getRequestedChangeNote(noteId),
        "Merge conflict note not found after creation",
      ),
      logs,
    };
  }

  resumeTicket(ticketId: number, reason?: string): RestartTicketResult {
    const ticket = this.tickets.getTicket(ticketId);
    if (!ticket) {
      throw new Error("Ticket not found");
    }
    if (ticket.status !== "in_progress") {
      throw new Error("Only in-progress tickets can be resumed");
    }
    if (!ticket.session_id) {
      throw new Error("Ticket has no execution session");
    }

    const session = this.sessions.getSession(ticket.session_id);
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
    const project = this.projects.getProject(ticket.project);
    if (!project) {
      throw new Error("Project not found");
    }
    const attemptId = nanoid();
    const timestamp = nowIso();
    const attemptNumber = this.context.nextAttemptNumber(session.id);
    const shouldQueue =
      this.context.countOccupiedExecutionSlotsForProject(ticket.project) >=
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

    this.context.db
      .update(executionSessionsTable)
      .set({
        status: shouldQueue ? "queued" : "awaiting_input",
        queueEnteredAt: shouldQueue ? timestamp : null,
        planStatus: nextPlanStatus,
        planSummary:
          nextPlanStatus === "drafting" ? null : session.plan_summary,
        currentAttemptId: attemptId,
        completedAt: null,
        lastHeartbeatAt: timestamp,
        lastSummary: summary,
      })
      .where(eq(executionSessionsTable.id, session.id))
      .run();

    this.context.db
      .insert(executionAttemptsTable)
      .values({
        id: attemptId,
        sessionId: session.id,
        attemptNumber,
        status: "queued",
        promptKind: null,
        prompt: null,
        ptyPid: null,
        startedAt: timestamp,
        endedAt: null,
        endReason: null,
      })
      .run();

    const logs = [
      reasonBody
        ? formatMarkdownLog("Resume instruction recorded", reasonBody)
        : "Resume requested without additional instruction.",
      `Reusing worktree at: ${session.worktree_path}`,
      `Reusing working branch: ${ticket.working_branch ?? deriveWorkingBranch(ticket.id, ticket.title, project.agent_adapter)}`,
      shouldQueue
        ? `Queued execution attempt ${attemptNumber} until a project running slot opens.`
        : `Starting execution attempt ${attemptNumber}.`,
    ];

    for (const line of logs) {
      this.context.appendSessionLog(session.id, line);
    }

    this.context.recordStructuredEvent(
      "session",
      session.id,
      "session.resumed",
      {
        ticket_id: ticketId,
        attempt_id: attemptId,
        reason: reasonBody,
      },
    );

    return {
      ticket,
      session: requireValue(
        this.sessions.getSession(session.id),
        "Session not found after resume",
      ),
      attempt: requireValue(
        this.sessions.listSessionAttempts(session.id)[attemptNumber - 1],
        "Execution attempt not found after resume",
      ),
      logs,
    };
  }

  restartInterruptedTicket(
    ticketId: number,
    runtime: PreparedExecutionRuntime,
    reason?: string,
  ): RestartTicketResult {
    const ticket = this.tickets.getTicket(ticketId);
    if (!ticket) {
      throw new Error("Ticket not found");
    }
    if (ticket.status !== "in_progress") {
      throw new Error("Only in-progress tickets can be restarted");
    }
    if (!ticket.session_id) {
      throw new Error("Ticket has no execution session");
    }

    const session = this.sessions.getSession(ticket.session_id);
    if (!session) {
      throw new Error("Execution session not found");
    }
    if (session.status !== "interrupted") {
      throw new Error("Only interrupted sessions can restart from scratch");
    }

    const project = this.projects.getProject(ticket.project);
    if (!project) {
      throw new Error("Project not found");
    }

    const attemptId = nanoid();
    const timestamp = nowIso();
    const attemptNumber = this.context.nextAttemptNumber(session.id);
    const shouldQueue =
      this.context.countOccupiedExecutionSlotsForProject(ticket.project) >=
      project.max_concurrent_sessions;
    const reasonBody = hasMeaningfulContent(reason) ? reason : null;
    const nextPlanStatus: ExecutionPlanStatus = session.planning_enabled
      ? "drafting"
      : "not_requested";
    const summary = reasonBody
      ? formatMarkdownLog("Execution restart requested", reasonBody)
      : shouldQueue
        ? "Fresh restart requested. The session is queued and will start when a project slot opens."
        : "Fresh restart requested. A new worktree is ready and execution will start from scratch.";

    this.context.db
      .update(ticketsTable)
      .set({
        workingBranch: runtime.workingBranch,
        updatedAt: timestamp,
      })
      .where(eq(ticketsTable.id, ticketId))
      .run();

    this.context.db
      .update(executionSessionsTable)
      .set({
        worktreePath: runtime.worktreePath,
        adapterSessionRef: null,
        status: shouldQueue ? "queued" : "awaiting_input",
        queueEnteredAt: shouldQueue ? timestamp : null,
        planStatus: nextPlanStatus,
        planSummary: null,
        currentAttemptId: attemptId,
        completedAt: null,
        lastHeartbeatAt: timestamp,
        lastSummary: summary,
      })
      .where(eq(executionSessionsTable.id, session.id))
      .run();

    this.context.db
      .insert(executionAttemptsTable)
      .values({
        id: attemptId,
        sessionId: session.id,
        attemptNumber,
        status: "queued",
        promptKind: null,
        prompt: null,
        ptyPid: null,
        startedAt: timestamp,
        endedAt: null,
        endReason: null,
      })
      .run();

    const logs = [
      reasonBody
        ? formatMarkdownLog("Fresh restart guidance recorded", reasonBody)
        : "Fresh restart requested without additional guidance.",
      "Preserving ticket history while resetting the local worktree and adapter session state.",
      `Working branch recreated: ${runtime.workingBranch}`,
      `Worktree recreated at: ${runtime.worktreePath}`,
      ...runtime.logs,
      shouldQueue
        ? `Queued fresh execution attempt ${attemptNumber} until a project running slot opens.`
        : `Starting fresh execution attempt ${attemptNumber}.`,
    ];

    for (const line of logs) {
      this.context.appendSessionLog(session.id, line);
    }

    this.context.recordStructuredEvent(
      "ticket",
      String(ticketId),
      "ticket.restarted",
      {
        ticket_id: ticketId,
        session_id: session.id,
        attempt_id: attemptId,
        working_branch: runtime.workingBranch,
        worktree_path: runtime.worktreePath,
      },
    );
    this.context.recordStructuredEvent(
      "session",
      session.id,
      "session.restarted",
      {
        ticket_id: ticketId,
        attempt_id: attemptId,
        reason: reasonBody,
        worktree_path: runtime.worktreePath,
      },
    );

    return {
      ticket: requireValue(
        this.tickets.getTicket(ticketId),
        "Ticket not found after fresh restart",
      ),
      session: requireValue(
        this.sessions.getSession(session.id),
        "Session not found after fresh restart",
      ),
      attempt: requireValue(
        this.sessions.listSessionAttempts(session.id)[attemptNumber - 1],
        "Execution attempt not found after fresh restart",
      ),
      logs,
    };
  }
}
