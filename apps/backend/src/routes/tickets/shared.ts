import type { AgentReviewService } from "../../lib/agent-review-service.js";
import { type EventHub, makeProtocolEvent } from "../../lib/event-hub.js";
import type { ExecutionRuntime } from "../../lib/execution-runtime.js";
import type { GitHubPullRequestService } from "../../lib/github-pull-request-service.js";
import type { Store } from "../../lib/store.js";
import type { TicketWorkspaceService } from "../../lib/ticket-workspace-service.js";

export type TicketRouteOptions = {
  agentReviewService: AgentReviewService;
  eventHub: EventHub;
  executionRuntime: ExecutionRuntime;
  githubPullRequestService: GitHubPullRequestService;
  store: Store;
  ticketWorkspaceService: TicketWorkspaceService;
};

export type TicketRouteDependencies = TicketRouteOptions & {
  appendSessionOutput: (
    sessionId: string,
    attemptId: string | null,
    chunk: string,
  ) => void;
};

export function createTicketRouteDependencies(
  options: TicketRouteOptions,
): TicketRouteDependencies {
  const { eventHub, store } = options;

  return {
    ...options,
    appendSessionOutput: (
      sessionId: string,
      attemptId: string | null,
      chunk: string,
    ) => {
      const sequence = store.appendSessionLog(sessionId, chunk);
      eventHub.publish(
        makeProtocolEvent("session.output", "session", sessionId, {
          session_id: sessionId,
          attempt_id: attemptId,
          sequence,
          chunk,
        }),
      );
    },
  };
}
