import type { FastifyPluginAsync } from "fastify";

import {
  checkpointResponseInputSchema,
  sessionInputSchema
} from "@orchestrator/contracts";

import type { EventHub } from "../lib/event-hub.js";
import { parseBody, sendNotImplemented } from "../lib/http.js";
import { MemoryStore } from "../lib/memory-store.js";

type SessionRouteOptions = {
  eventHub: EventHub;
  store: MemoryStore;
};

export const sessionRoutes: FastifyPluginAsync<SessionRouteOptions> = async (
  app,
  { store }
) => {
  app.get<{ Params: { sessionId: string } }>("/sessions/:sessionId", async (request, reply) => {
    const session = store.getSession(request.params.sessionId);
    if (!session) {
      reply.code(404).send({ error: "Session not found" });
      return;
    }

    return { session };
  });

  app.get<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId/attempts",
    async (request) => ({
      attempts: store.listSessionAttempts(request.params.sessionId)
    })
  );

  app.get<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId/logs",
    async (request) => ({
      session_id: request.params.sessionId,
      logs: store.getSessionLogs(request.params.sessionId)
    })
  );

  app.post<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId/terminal/takeover",
    async (request, reply) => {
      sendNotImplemented(
        reply,
        "Terminal takeover route is scaffolded, but live PTY control is not implemented yet.",
        { session_id: request.params.sessionId }
      );
    }
  );

  app.post<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId/terminal/restore-agent",
    async (request, reply) => {
      sendNotImplemented(
        reply,
        "Terminal handoff restoration is scaffolded, but live PTY control is not implemented yet.",
        { session_id: request.params.sessionId }
      );
    }
  );

  app.post<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId/checkpoint-response",
    async (request, reply) => {
      const input = parseBody(reply, checkpointResponseInputSchema, request.body);
      if (!input) {
        return;
      }

      sendNotImplemented(
        reply,
        `Checkpoint response route is scaffolded, but agent checkpoint handling is not implemented yet. approved=${input.approved ?? false}`,
        { session_id: request.params.sessionId }
      );
    }
  );

  app.post<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId/input",
    async (request, reply) => {
      const input = parseBody(reply, sessionInputSchema, request.body);
      if (!input) {
        return;
      }

      sendNotImplemented(
        reply,
        `Session input route is scaffolded, but agent input handling is not implemented yet. body_length=${input.body.length}`,
        { session_id: request.params.sessionId }
      );
    }
  );
};
