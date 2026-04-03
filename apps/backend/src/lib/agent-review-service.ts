import type {
  ExecutionSession,
  Project,
  RepositoryConfig,
  ReviewPackage,
  ReviewReport,
  ReviewRun,
  TicketFrontmatter,
} from "../../../../packages/contracts/src/index.js";

import { type EventHub, makeProtocolEvent } from "./event-hub.js";
import {
  publishSessionUpdated,
  shouldPublishPreExecutionSessionUpdate,
} from "./execution-runtime/publishers.js";
import type { ExecutionRuntime } from "./execution-runtime.js";
import type { RestartTicketResult, Store } from "./store.js";

type AgentReviewServiceOptions = {
  eventHub: EventHub;
  executionRuntime: ExecutionRuntime;
  store: Store;
};

type ReviewLoopContext = {
  project: Project;
  repository: RepositoryConfig;
  reviewPackage: ReviewPackage;
  session: ExecutionSession;
  ticket: TicketFrontmatter;
};

export class AgentReviewService {
  readonly #eventHub: EventHub;
  readonly #executionRuntime: ExecutionRuntime;
  readonly #store: Store;
  readonly #activeTicketIds = new Set<number>();

  constructor({
    eventHub,
    executionRuntime,
    store,
  }: AgentReviewServiceOptions) {
    this.#eventHub = eventHub;
    this.#executionRuntime = executionRuntime;
    this.#store = store;
  }

  hasActiveReviewLoop(ticketId: number): boolean {
    return this.#activeTicketIds.has(ticketId);
  }

  startReviewLoop(ticketId: number): ReviewRun {
    if (this.#activeTicketIds.has(ticketId)) {
      throw new Error("Agent review is already running for this ticket");
    }

    const latestReviewRun = this.#store.getLatestReviewRun(ticketId);
    if (latestReviewRun?.status === "running") {
      this.#store.updateReviewRun(latestReviewRun.id, {
        status: "failed",
        failure_message:
          "The previous agent review run was interrupted before completion.",
      });
    }

    const context = this.#loadReviewLoopContext(ticketId);
    const reviewRun = this.#store.createReviewRun({
      ticket_id: ticketId,
      review_package_id: context.reviewPackage.id,
      implementation_session_id: context.session.id,
    });

    this.#activeTicketIds.add(ticketId);
    this.#appendSessionOutput(
      context.session.id,
      context.session.current_attempt_id,
      `Starting separate agent review session for review package ${context.reviewPackage.id}.`,
    );

    void this.#runLoop(ticketId, context, reviewRun).finally(() => {
      this.#activeTicketIds.delete(ticketId);
    });

    return reviewRun;
  }

  async #runLoop(
    ticketId: number,
    initialContext: ReviewLoopContext,
    initialReviewRun: ReviewRun,
  ): Promise<void> {
    let context = initialContext;
    let reviewRun = initialReviewRun;

    while (true) {
      try {
        const reviewResult = await this.#executionRuntime.runTicketReview({
          project: context.project,
          repository: context.repository,
          reviewPackage: context.reviewPackage,
          reviewRunId: reviewRun.id,
          session: context.session,
          ticket: context.ticket,
        });

        this.#store.updateReviewRun(reviewRun.id, {
          status: "completed",
          adapter_session_ref: reviewResult.adapterSessionRef,
          report: reviewResult.report,
        });

        const actionableFindingCount =
          reviewResult.report.actionable_findings.length;
        this.#appendSessionOutput(
          context.session.id,
          context.session.current_attempt_id,
          `Agent review completed with ${actionableFindingCount} actionable finding${
            actionableFindingCount === 1 ? "" : "s"
          }.`,
        );

        if (actionableFindingCount === 0) {
          this.#appendSessionOutput(
            context.session.id,
            context.session.current_attempt_id,
            "Agent review returned no actionable findings.",
          );
          return;
        }

        const restartResult = this.#store.requestTicketChanges(
          ticketId,
          this.#formatRequestedChanges(reviewResult.report),
          "system",
        );
        this.#publishRestartResult(restartResult);
        this.#executionRuntime.startExecution({
          project: context.project,
          repository: context.repository,
          ticket: restartResult.ticket,
          session: restartResult.session,
        });

        const nextContext = await this.#waitForNextReviewLoopContext(
          ticketId,
          context.reviewPackage.id,
          restartResult.session.id,
        );
        if (!nextContext) {
          return;
        }

        context = nextContext;
        reviewRun = this.#store.createReviewRun({
          ticket_id: ticketId,
          review_package_id: context.reviewPackage.id,
          implementation_session_id: context.session.id,
        });
        this.#appendSessionOutput(
          context.session.id,
          context.session.current_attempt_id,
          `Starting separate agent review session for review package ${context.reviewPackage.id}.`,
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Agent review failed unexpectedly.";
        this.#store.updateReviewRun(reviewRun.id, {
          status: "failed",
          failure_message: message,
        });
        this.#appendSessionOutput(
          context.session.id,
          context.session.current_attempt_id,
          `[agent review failed] ${message}`,
        );
        return;
      }
    }
  }

  #loadReviewLoopContext(ticketId: number): ReviewLoopContext {
    const ticket = this.#store.getTicket(ticketId);
    if (!ticket) {
      throw new Error("Ticket not found");
    }
    if (ticket.status !== "review") {
      throw new Error("Only review tickets can start an agent review");
    }
    if (!ticket.session_id) {
      throw new Error("Ticket has no implementation session");
    }

    const session = this.#store.getSession(ticket.session_id);
    if (!session) {
      throw new Error("Implementation session not found");
    }
    if (!session.worktree_path) {
      throw new Error("Implementation session has no prepared worktree");
    }

    const reviewPackage = this.#store.getReviewPackage(ticketId);
    if (!reviewPackage) {
      throw new Error("Review package not found");
    }

    const project = this.#store.getProject(ticket.project);
    if (!project) {
      throw new Error("Project not found");
    }

    const repository = this.#store.getRepository(ticket.repo);
    if (!repository) {
      throw new Error("Repository not found");
    }

    return {
      project,
      repository,
      reviewPackage,
      session,
      ticket,
    };
  }

  async #waitForNextReviewLoopContext(
    ticketId: number,
    previousReviewPackageId: string,
    sessionId: string,
  ): Promise<ReviewLoopContext | null> {
    while (this.#activeTicketIds.has(ticketId)) {
      await new Promise((resolve) => {
        setTimeout(resolve, 1_000);
      });

      const ticket = this.#store.getTicket(ticketId);
      const session = this.#store.getSession(sessionId);
      if (!ticket || !session) {
        return null;
      }

      if (
        ticket.status === "review" &&
        session.status === "completed" &&
        session.latest_review_package_id &&
        session.latest_review_package_id !== previousReviewPackageId
      ) {
        return this.#loadReviewLoopContext(ticketId);
      }

      if (session.status === "failed" || session.status === "interrupted") {
        this.#appendSessionOutput(
          session.id,
          session.current_attempt_id,
          "Agent review loop stopped because the implementation session did not return to review successfully.",
        );
        return null;
      }
    }

    return null;
  }

  #formatRequestedChanges(report: ReviewReport): string {
    return [
      "A separate agent review session found actionable issues. Address every finding before returning to review.",
      "",
      "Review summary:",
      report.summary,
      "",
      "Review report JSON:",
      "```json",
      JSON.stringify(report, null, 2),
      "```",
    ].join("\n");
  }

  #publishRestartResult(restartResult: RestartTicketResult): void {
    this.#eventHub.publish(
      makeProtocolEvent(
        "ticket.updated",
        "ticket",
        String(restartResult.ticket.id),
        {
          ticket: restartResult.ticket,
        },
      ),
    );
    if (shouldPublishPreExecutionSessionUpdate(restartResult.session)) {
      publishSessionUpdated(
        this.#eventHub,
        restartResult.session,
        this.#executionRuntime.hasActiveExecution(restartResult.session.id),
      );
    }
    restartResult.logs.forEach((logLine, index) => {
      this.#eventHub.publish(
        makeProtocolEvent(
          "session.output",
          "session",
          restartResult.session.id,
          {
            session_id: restartResult.session.id,
            attempt_id: restartResult.attempt.id,
            sequence:
              this.#store.getSessionLogs(restartResult.session.id).length -
              restartResult.logs.length +
              index,
            chunk: logLine,
          },
        ),
      );
    });
  }

  #appendSessionOutput(
    sessionId: string,
    attemptId: string | null,
    chunk: string,
  ): void {
    const sequence = this.#store.appendSessionLog(sessionId, chunk);
    this.#eventHub.publish(
      makeProtocolEvent("session.output", "session", sessionId, {
        session_id: sessionId,
        attempt_id: attemptId,
        sequence,
        chunk,
      }),
    );
  }
}
