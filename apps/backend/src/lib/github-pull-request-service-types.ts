import type { EventHub } from "./event-hub.js";
import type { ExecutionRuntime } from "./execution-runtime.js";
import type { GitHubPullRequestPersistence } from "./store.js";
import type { TicketWorkspaceService } from "./ticket-workspace-service.js";

export type DetailedRequestedChanges = {
  reviewerLogin: string | null;
  submittedAt: string | null;
  summary: string | null;
  comments: Array<{
    body: string;
    path: string | null;
    line: number | null;
  }>;
};

export type PullRequestSchedule = {
  intervalMs: number;
  nextRunAt: number;
  fingerprint: string | null;
};

export type ReviewRouteDependencies = {
  eventHub: EventHub;
  executionRuntime: ExecutionRuntime;
  store: GitHubPullRequestPersistence;
  ticketWorkspaceService: TicketWorkspaceService;
};

export type GraphQlReviewNode = {
  state?: unknown;
  submittedAt?: unknown;
  body?: unknown;
  author?: {
    login?: unknown;
  } | null;
  comments?: {
    nodes?: Array<{
      body?: unknown;
      path?: unknown;
      line?: unknown;
    } | null> | null;
  } | null;
} | null;
