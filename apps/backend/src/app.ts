import Fastify from "fastify";
import fastifyRateLimit from "fastify-rate-limit";

import { ClaudeCodeAdapter } from "./lib/agent-adapters/claude-code-adapter.js";
import type { ClaudeCodeAvailability } from "./lib/agent-adapters/claude-code-runtime.js";
import { CodexCliAdapter } from "./lib/agent-adapters/codex-cli-adapter.js";
import { AgentAdapterRegistry } from "./lib/agent-adapters/registry.js";
import { AgentReviewService } from "./lib/agent-review-service.js";
import { createClaudeCodeAvailabilityGetter } from "./lib/claude-code-availability.js";
import {
  type DockerRuntime,
  DockerRuntimeManager,
} from "./lib/docker-runtime.js";
import { EventHub } from "./lib/event-hub.js";
import { ExecutionRuntime } from "./lib/execution-runtime.js";
import { registerFrontendStaticRoutes } from "./lib/frontend-static.js";
import { GitHubPullRequestService } from "./lib/github-pull-request-service.js";
import { globalRateLimitOptions } from "./lib/rate-limit.js";
import { runReviewFollowUp } from "./lib/review-follow-up-handler.js";
import { createSocketServer } from "./lib/socket-server.js";
import { SqliteStore } from "./lib/sqlite-store.js";
import type { WalleyboardPersistence } from "./lib/store.js";
import { TicketWorkspaceService } from "./lib/ticket-workspace-service.js";
import { draftRoutes } from "./routes/drafts.js";
import { healthRoutes } from "./routes/health.js";
import { projectRoutes } from "./routes/projects.js";
import { sessionRoutes } from "./routes/sessions.js";
import { ticketRoutes } from "./routes/tickets.js";

function shouldSkipStartupDockerCleanup(): boolean {
  return process.env.WALLEYBOARD_SKIP_STARTUP_DOCKER_CLEANUP === "1";
}

export type CreateAppOptions = {
  databasePath?: string;
  dockerRuntime?: DockerRuntime;
  eventHub?: EventHub;
  executionRuntime?: ExecutionRuntime;
  githubPullRequestService?: GitHubPullRequestService;
  host?: string;
  port?: number;
  probeClaudeCodeAvailability?: () => ClaudeCodeAvailability;
  skipStartupDockerCleanup?: boolean;
  staticAssetDir?: string;
  store?: WalleyboardPersistence;
  ticketWorkspaceService?: TicketWorkspaceService;
};

export async function createApp(options: CreateAppOptions = {}) {
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const port = options.port ?? Number.parseInt(process.env.PORT ?? "4000", 10);
  const staticAssetDir =
    options.staticAssetDir ?? process.env.WALLEYBOARD_STATIC_DIR;
  const apiHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  const app = Fastify({
    logger: true,
  });

  const eventHub = options.eventHub ?? new EventHub();
  const store = options.store ?? new SqliteStore(options.databasePath);
  const dockerRuntime = options.dockerRuntime ?? new DockerRuntimeManager();
  const getClaudeCodeAvailability = createClaudeCodeAvailabilityGetter(
    options.probeClaudeCodeAvailability ??
      (() => dockerRuntime.getClaudeCodeAvailability()),
  );
  const adapterRegistry = new AgentAdapterRegistry([
    new CodexCliAdapter(),
    new ClaudeCodeAdapter(),
  ]);
  const executionRuntime =
    options.executionRuntime ??
    new ExecutionRuntime({
      adapterRegistry,
      dockerRuntime,
      eventHub,
      store,
    });
  const agentReviewService = new AgentReviewService({
    eventHub,
    executionRuntime,
    store,
  });
  const socketServer = createSocketServer({
    eventHub,
    executionRuntime,
    server: app.server,
    store,
  });
  const ticketWorkspaceService =
    options.ticketWorkspaceService ??
    new TicketWorkspaceService({
      apiBaseUrl: `http://${apiHost}:${port}`,
      eventHub,
    });
  const githubPullRequestService =
    options.githubPullRequestService ??
    new GitHubPullRequestService({
      eventHub,
      executionRuntime,
      store,
      ticketWorkspaceService,
    });
  executionRuntime.setReviewReadyHandler((input) =>
    runReviewFollowUp(input, {
      agentReviewService,
      githubPullRequestService,
    }),
  );
  githubPullRequestService.start();
  const recovery = store.recoverInterruptedSessions();
  const skipStartupDockerCleanup =
    options.skipStartupDockerCleanup ?? shouldSkipStartupDockerCleanup();

  if (!skipStartupDockerCleanup) {
    try {
      dockerRuntime.cleanupStaleContainers({
        preserveSessionIds: recovery.activeSessionIds,
      });
    } catch (error) {
      app.log.warn(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        "Unable to clean up stale Docker containers during backend startup",
      );
    }
  }

  if (recovery.sessions.length > 0) {
    app.log.warn(
      {
        sessionIds: recovery.sessions.map((session) => session.id),
      },
      "Recovered active sessions as interrupted during backend startup",
    );
  }

  app.addHook("onRequest", async (request, reply) => {
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-methods", "GET,POST,PATCH,OPTIONS");
    reply.header("access-control-allow-headers", "content-type");

    if (request.method === "OPTIONS") {
      reply.code(204).send();
    }
  });

  await app.register(fastifyRateLimit, globalRateLimitOptions());
  await app.register(healthRoutes, {
    dockerRuntime,
    getClaudeCodeAvailability,
  });
  await app.register(projectRoutes, {
    store,
    executionRuntime,
    ticketWorkspaceService,
    getClaudeCodeAvailability,
  });
  await app.register(draftRoutes, { eventHub, store, executionRuntime });
  await app.register(ticketRoutes, {
    agentReviewService,
    eventHub,
    store,
    executionRuntime,
    githubPullRequestService,
    getClaudeCodeAvailability,
    ticketWorkspaceService,
  });
  await app.register(sessionRoutes, {
    eventHub,
    store,
    executionRuntime,
    getClaudeCodeAvailability,
  });
  if (staticAssetDir) {
    registerFrontendStaticRoutes(app, staticAssetDir);
  }

  app.addHook("onClose", async () => {
    socketServer.close();
    githubPullRequestService.stop();
    executionRuntime.dispose();
    store.close();
  });

  return app;
}
