import websocket from "@fastify/websocket";
import Fastify from "fastify";

import { EventHub } from "./lib/event-hub.js";
import { MemoryStore } from "./lib/memory-store.js";
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
  const store = new MemoryStore();

  await app.register(websocket);
  await app.register(healthRoutes);
  await app.register(projectRoutes, { eventHub, store });
  await app.register(draftRoutes, { eventHub, store });
  await app.register(ticketRoutes, { eventHub, store });
  await app.register(sessionRoutes, { eventHub, store });
  await app.register(websocketRoutes, { eventHub });

  return app;
}
