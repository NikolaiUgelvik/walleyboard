import websocket from "@fastify/websocket";
import Fastify from "fastify";

import { EventHub } from "./lib/event-hub.js";
import { ExecutionRuntime } from "./lib/execution-runtime.js";
import { SqliteStore } from "./lib/sqlite-store.js";
import { draftRoutes } from "./routes/drafts.js";
import { healthRoutes } from "./routes/health.js";
import { projectRoutes } from "./routes/projects.js";
import { sessionRoutes } from "./routes/sessions.js";
import { ticketRoutes } from "./routes/tickets.js";
import { websocketRoutes } from "./routes/ws.js";

export async function createApp() {
  const app = Fastify({
    logger: true
  });

  const eventHub = new EventHub();
  const store = new SqliteStore();
  const executionRuntime = new ExecutionRuntime({ eventHub, store });
  const recovery = store.recoverInterruptedSessions();

  if (recovery.sessions.length > 0) {
    app.log.warn(
      {
        sessionIds: recovery.sessions.map((session) => session.id)
      },
      "Recovered active sessions as interrupted during backend startup"
    );
  }

  app.addHook("onRequest", async (request, reply) => {
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
    reply.header("access-control-allow-headers", "content-type");

    if (request.method === "OPTIONS") {
      reply.code(204).send();
    }
  });

  await app.register(websocket);
  await app.register(healthRoutes);
  await app.register(projectRoutes, { eventHub, store });
  await app.register(draftRoutes, { eventHub, store });
  await app.register(ticketRoutes, { eventHub, store, executionRuntime });
  await app.register(sessionRoutes, { eventHub, store, executionRuntime });
  await app.register(websocketRoutes, { eventHub });

  return app;
}
