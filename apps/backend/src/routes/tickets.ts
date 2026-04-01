import type { FastifyPluginAsync } from "fastify";

import {
  requestChangesInputSchema,
  resumeTicketInputSchema,
  startTicketInputSchema
} from "@orchestrator/contracts";

import { makeCommandAck } from "../lib/command-ack.js";
import type { EventHub } from "../lib/event-hub.js";
import { parseBody, parsePositiveInt, sendNotImplemented } from "../lib/http.js";
import type { Store } from "../lib/store.js";

type TicketRouteOptions = {
  eventHub: EventHub;
  store: Store;
};

export const ticketRoutes: FastifyPluginAsync<TicketRouteOptions> = async (
  app,
  { store }
) => {
  app.get<{ Params: { ticketId: string } }>("/tickets/:ticketId", async (request, reply) => {
    const ticketId = parsePositiveInt(request.params.ticketId);
    if (!ticketId) {
      reply.code(400).send({ error: "Invalid ticket id" });
      return;
    }

    const ticket = store.getTicket(ticketId);
    if (!ticket) {
      reply.code(404).send({ error: "Ticket not found" });
      return;
    }

    return { ticket };
  });

  app.get<{ Params: { ticketId: string } }>(
    "/tickets/:ticketId/review-package",
    async (request, reply) => {
      const ticketId = parsePositiveInt(request.params.ticketId);
      if (!ticketId) {
        reply.code(400).send({ error: "Invalid ticket id" });
        return;
      }

      const reviewPackage = store.getReviewPackage(ticketId);
      if (!reviewPackage) {
        reply.code(404).send({ error: "Review package not found" });
        return;
      }

      return { review_package: reviewPackage };
    }
  );

  app.get<{ Params: { ticketId: string } }>(
    "/tickets/:ticketId/events",
    async (request, reply) => {
      const ticketId = parsePositiveInt(request.params.ticketId);
      if (!ticketId) {
        reply.code(400).send({ error: "Invalid ticket id" });
        return;
      }

      return {
        events: store.getTicketEvents(ticketId)
      };
    }
  );

  app.post<{ Params: { ticketId: string } }>(
    "/tickets/:ticketId/start",
    async (request, reply) => {
      const ticketId = parsePositiveInt(request.params.ticketId);
      if (!ticketId) {
        reply.code(400).send({ error: "Invalid ticket id" });
        return;
      }

      const input = parseBody(reply, startTicketInputSchema, request.body);
      if (!input) {
        return;
      }

      sendNotImplemented(
        reply,
        `Execution start scaffolding is in place, but the Codex adapter is not implemented yet. planning_enabled=${input.planning_enabled}`,
        { ticket_id: ticketId }
      );
    }
  );

  app.post<{ Params: { ticketId: string } }>(
    "/tickets/:ticketId/resume",
    async (request, reply) => {
      const ticketId = parsePositiveInt(request.params.ticketId);
      if (!ticketId) {
        reply.code(400).send({ error: "Invalid ticket id" });
        return;
      }

      const input = parseBody(reply, resumeTicketInputSchema, request.body);
      if (!input) {
        return;
      }

      sendNotImplemented(
        reply,
        `Resume scaffolding is in place, but execution attempts are not implemented yet. reason=${input.reason ?? "none"}`,
        { ticket_id: ticketId }
      );
    }
  );

  app.post<{ Params: { ticketId: string } }>(
    "/tickets/:ticketId/request-changes",
    async (request, reply) => {
      const ticketId = parsePositiveInt(request.params.ticketId);
      if (!ticketId) {
        reply.code(400).send({ error: "Invalid ticket id" });
        return;
      }

      const input = parseBody(reply, requestChangesInputSchema, request.body);
      if (!input) {
        return;
      }

      sendNotImplemented(
        reply,
        `Request-changes scaffolding is in place, but review-to-execution handoff is not implemented yet. note=${input.body}`,
        { ticket_id: ticketId }
      );
    }
  );

  app.post<{ Params: { ticketId: string } }>(
    "/tickets/:ticketId/create-pr",
    async (request, reply) => {
      const ticketId = parsePositiveInt(request.params.ticketId);
      if (!ticketId) {
        reply.code(400).send({ error: "Invalid ticket id" });
        return;
      }

      sendNotImplemented(reply, "PR creation is intentionally deferred in the strict MVP.", {
        ticket_id: ticketId
      });
    }
  );

  app.post<{ Params: { ticketId: string } }>(
    "/tickets/:ticketId/merge",
    async (request, reply) => {
      const ticketId = parsePositiveInt(request.params.ticketId);
      if (!ticketId) {
        reply.code(400).send({ error: "Invalid ticket id" });
        return;
      }

      sendNotImplemented(
        reply,
        "Direct merge route is scaffolded, but git orchestration is not implemented yet.",
        { ticket_id: ticketId }
      );
    }
  );

  app.post<{ Params: { ticketId: string } }>(
    "/tickets/:ticketId/reconcile",
    async (request, reply) => {
      const ticketId = parsePositiveInt(request.params.ticketId);
      if (!ticketId) {
        reply.code(400).send({ error: "Invalid ticket id" });
        return;
      }

      sendNotImplemented(
        reply,
        "External reconciliation is scaffolded, but GitHub integration is not implemented yet.",
        { ticket_id: ticketId }
      );
    }
  );
};
