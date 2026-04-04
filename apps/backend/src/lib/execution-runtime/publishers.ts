import type {
  DraftTicketState,
  ExecutionSession,
  ReviewRun,
  SessionResponse,
  StructuredEvent,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import { type EventHub, makeProtocolEvent } from "../event-hub.js";
import type { SessionPersistence } from "../store.js";

export function buildSessionResponse(
  session: ExecutionSession,
  agentControlsWorktree: boolean,
): SessionResponse {
  return {
    session,
    agent_controls_worktree: agentControlsWorktree,
  };
}

export function shouldPublishPreExecutionSessionUpdate(
  session: ExecutionSession,
): boolean {
  return session.status === "queued";
}

export function publishSessionUpdated(
  eventHub: EventHub,
  session: ExecutionSession | undefined,
  agentControlsWorktree: boolean,
): void {
  if (!session) {
    return;
  }

  eventHub.publish(
    makeProtocolEvent("session.updated", "session", session.id, {
      ...buildSessionResponse(session, agentControlsWorktree),
    }),
  );
}

export function publishDraftUpdated(
  eventHub: EventHub,
  draft: DraftTicketState | undefined,
): void {
  if (!draft) {
    return;
  }

  eventHub.publish(
    makeProtocolEvent("draft.updated", "draft", draft.id, {
      draft,
    }),
  );
}

export function publishStructuredEvent(
  eventHub: EventHub,
  event: StructuredEvent | undefined,
): void {
  if (!event) {
    return;
  }

  eventHub.publish(
    makeProtocolEvent(
      "structured_event.created",
      event.entity_type,
      event.entity_id,
      {
        structured_event: event,
      },
    ),
  );
}

export function publishTicketUpdated(
  eventHub: EventHub,
  ticket: TicketFrontmatter | undefined,
): void {
  if (!ticket) {
    return;
  }

  eventHub.publish(
    makeProtocolEvent("ticket.updated", "ticket", String(ticket.id), {
      ticket,
    }),
  );
}

export function publishReviewRunUpdated(
  eventHub: EventHub,
  reviewRun: ReviewRun | undefined,
): void {
  if (!reviewRun) {
    return;
  }

  eventHub.publish(
    makeProtocolEvent("review_run.updated", "review_run", reviewRun.id, {
      review_run: reviewRun,
    }),
  );
}

export function publishSessionOutput(
  eventHub: EventHub,
  store: SessionPersistence,
  sessionId: string,
  attemptId: string,
  line: string,
): void {
  const sequence = store.appendSessionLog(sessionId, line);
  eventHub.publish(
    makeProtocolEvent("session.output", "session", sessionId, {
      session_id: sessionId,
      attempt_id: attemptId,
      sequence,
      chunk: line,
    }),
  );
}
