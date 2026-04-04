import websocket from "@fastify/websocket";
import Fastify from "fastify";
import fastifyRateLimit from "fastify-rate-limit";

import { ClaudeCodeAdapter } from "./lib/agent-adapters/claude-code-adapter.js";
import { CodexCliAdapter } from "./lib/agent-adapters/codex-cli-adapter.js";
import { AgentAdapterRegistry } from "./lib/agent-adapters/registry.js";
import { AgentReviewService } from "./lib/agent-review-service.js";
import { DockerRuntimeManager } from "./lib/docker-runtime.js";
import { EventHub } from "./lib/event-hub.js";
import { ExecutionRuntime } from "./lib/execution-runtime.js";
import { GitHubPullRequestService } from "./lib/github-pull-request-service.js";
import { globalRateLimitOptions } from "./lib/rate-limit.js";
import { runReviewFollowUp } from "./lib/review-follow-up-handler.js";
import { SqliteStore } from "./lib/sqlite-store.js";
import { TicketWorkspaceService } from "./lib/ticket-workspace-service.js";
import { draftRoutes } from "./routes/drafts.js";
import { healthRoutes } from "./routes/health.js";
import { projectRoutes } from "./routes/projects.js";
import { sessionRoutes } from "./routes/sessions.js";
import { ticketRoutes } from "./routes/tickets.js";
import { websocketRoutes } from "./routes/ws.js";

export async function createApp() {
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number.parseInt(process.env.PORT ?? "4000", 10);
  const apiHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  const app = Fastify({
    logger: true,
  });

  const eventHub = new EventHub();
  const store = new SqliteStore();
  const dockerRuntime = new DockerRuntimeManager();
  const adapterRegistry = new AgentAdapterRegistry([
    new CodexCliAdapter(),
    new ClaudeCodeAdapter(),
  ]);
  const executionRuntime = new ExecutionRuntime({
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
  const ticketWorkspaceService = new TicketWorkspaceService({
    apiBaseUrl: `http://${apiHost}:${port}`,
    eventHub,
  });
  const githubPullRequestService = new GitHubPullRequestService({
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

  await app.register(websocket);
  await app.register(fastifyRateLimit, globalRateLimitOptions());
  await app.register(healthRoutes, { dockerRuntime });
  await app.register(projectRoutes, {
    store,
    executionRuntime,
    ticketWorkspaceService,
  });
  await app.register(draftRoutes, { eventHub, store, executionRuntime });
  await app.register(ticketRoutes, {
    agentReviewService,
    eventHub,
    store,
    executionRuntime,
    githubPullRequestService,
    ticketWorkspaceService,
  });
  await app.register(sessionRoutes, { eventHub, store, executionRuntime });
  await app.register(websocketRoutes, { eventHub });

  app.addHook("onClose", async () => {
    githubPullRequestService.stop();
    executionRuntime.dispose();
  });

  return app;
}
