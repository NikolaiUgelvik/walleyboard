import type { AgentAdapterRegistry } from "./agent-adapters/registry.js";
import type { DockerRuntime } from "./docker-runtime.js";
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
  discussionComments: string[];
};

export type PullRequestSchedule = {
  intervalMs: number;
  nextRunAt: number;
  fingerprint: string | null;
};

export type ReviewRouteDependencies = {
  adapterRegistry: AgentAdapterRegistry;
  dockerRuntime: DockerRuntime;
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

export type GraphQlDiscussionCommentNode = {
  body?: unknown;
  createdAt?: unknown;
  isMinimized?: unknown;
  author?: {
    login?: unknown;
  } | null;
} | null;

export type GraphQlCheckRunAnnotationNode = {
  title?: unknown;
  path?: unknown;
  startLine?: unknown;
  endLine?: unknown;
  startColumn?: unknown;
  endColumn?: unknown;
  message?: unknown;
  rawDetails?: unknown;
} | null;

export type GraphQlCheckRunContextNode = {
  __typename?: unknown;
  name?: unknown;
  status?: unknown;
  conclusion?: unknown;
  detailsUrl?: unknown;
  summary?: unknown;
  text?: unknown;
  annotations?: {
    nodes?: Array<GraphQlCheckRunAnnotationNode | null> | null;
  } | null;
} | null;

export type GraphQlStatusContextNode = {
  __typename?: unknown;
  context?: unknown;
  state?: unknown;
  targetUrl?: unknown;
  description?: unknown;
} | null;
