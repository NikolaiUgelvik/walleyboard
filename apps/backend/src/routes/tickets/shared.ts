import type { AgentReviewService } from "../../lib/agent-review-service.js";
import {
  createClaudeCodeAvailabilityGetter,
  type GetClaudeCodeAvailability,
} from "../../lib/claude-code-availability.js";
import { type EventHub, makeProtocolEvent } from "../../lib/event-hub.js";
import type { ExecutionRuntime } from "../../lib/execution-runtime.js";
import type { GitHubPullRequestService } from "../../lib/github-pull-request-service.js";
import type { TicketRoutePersistence } from "../../lib/store.js";
import type { TicketWorkspaceService } from "../../lib/ticket-workspace-service.js";

export type TicketRouteOptions = {
  agentReviewService: AgentReviewService;
  eventHub: EventHub;
  executionRuntime: ExecutionRuntime;
  githubPullRequestService: GitHubPullRequestService;
  getClaudeCodeAvailability?: GetClaudeCodeAvailability;
  store: TicketRoutePersistence;
  ticketWorkspaceService: TicketWorkspaceService;
};

export type TicketRouteDependencies = TicketRouteOptions & {
  appendSessionOutput: (
    sessionId: string,
    attemptId: string | null,
    chunk: string,
  ) => void;
  getClaudeCodeAvailability?: GetClaudeCodeAvailability;
};

export function createTicketRouteDependencies(
  options: TicketRouteOptions,
): TicketRouteDependencies {
  const { eventHub, store } = options;

  return {
    ...options,
    getClaudeCodeAvailability:
      options.getClaudeCodeAvailability ?? createClaudeCodeAvailabilityGetter(),
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
