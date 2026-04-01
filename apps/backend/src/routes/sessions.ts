import type { FastifyPluginAsync } from "fastify";

import {
  checkpointResponseInputSchema,
  sessionInputSchema
} from "@orchestrator/contracts";

import { makeCommandAck } from "../lib/command-ack.js";
import { makeProtocolEvent, type EventHub } from "../lib/event-hub.js";
import { parseBody, sendNotImplemented } from "../lib/http.js";
import type { Store } from "../lib/store.js";

type SessionRouteOptions = {
  eventHub: EventHub;
  store: Store;
};

export const sessionRoutes: FastifyPluginAsync<SessionRouteOptions> = async (
  app,
  { eventHub, store }
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

      try {
        const session = store.addSessionInput(
          request.params.sessionId,
          `Checkpoint response (approved=${input.approved ?? false}): ${input.body}`
        );

        eventHub.publish(
          makeProtocolEvent("session.updated", "session", session.id, {
            session
          })
        );
        eventHub.publish(
          makeProtocolEvent("session.output", "session", session.id, {
            session_id: session.id,
            chunk: `Checkpoint response recorded: ${input.body}`,
            sequence: store.getSessionLogs(session.id).length - 1
          })
        );

        reply.send(
          makeCommandAck(true, "Checkpoint response recorded", {
            session_id: session.id
          })
        );
      } catch (error) {
        reply.code(404).send({
          error:
            error instanceof Error ? error.message : "Unable to record checkpoint response"
        });
      }
    }
  );

  app.post<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId/input",
    async (request, reply) => {
      const input = parseBody(reply, sessionInputSchema, request.body);
      if (!input) {
        return;
      }

      try {
        const session = store.addSessionInput(request.params.sessionId, input.body);

        eventHub.publish(
          makeProtocolEvent("session.updated", "session", session.id, {
            session
          })
        );
        eventHub.publish(
          makeProtocolEvent("session.output", "session", session.id, {
            session_id: session.id,
            chunk: `User input recorded: ${input.body}`,
            sequence: store.getSessionLogs(session.id).length - 1
          })
        );

        reply.send(
          makeCommandAck(true, "Session input recorded", {
            session_id: session.id
          })
        );
      } catch (error) {
        reply.code(404).send({
          error:
            error instanceof Error ? error.message : "Unable to record session input"
        });
      }
    }
  );
};
