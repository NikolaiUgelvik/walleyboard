import type { FastifyInstance } from "fastify";

import { parsePositiveInt } from "../../lib/http.js";
import type { TicketRouteDependencies } from "./shared.js";

export function registerTicketReadWorkspaceRoutes(
  app: FastifyInstance,
  { store, ticketWorkspaceService }: TicketRouteDependencies,
) {
  app.get<{ Params: { ticketId: string } }>(
    "/tickets/:ticketId",
    async (request, reply) => {
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
    },
  );

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
    },
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
        events: store.getTicketEvents(ticketId),
      };
    },
  );

  app.get<{ Params: { ticketId: string } }>(
    "/tickets/:ticketId/workspace/diff",
    async (request, reply) => {
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
      if (!ticket.session_id || !ticket.working_branch) {
        reply.code(409).send({ error: "Ticket has no prepared workspace yet" });
        return;
      }

      const session = store.getSession(ticket.session_id);
      if (!session?.worktree_path) {
        reply.code(409).send({ error: "Session has no prepared worktree" });
        return;
      }

      return {
        workspace_diff: ticketWorkspaceService.getDiff({
          targetBranch: ticket.target_branch,
          ticketId: ticket.id,
          workingBranch: ticket.working_branch,
          worktreePath: session.worktree_path,
        }),
      };
    },
  );

  app.get<{ Params: { ticketId: string } }>(
    "/tickets/:ticketId/workspace/preview",
    async (request, reply) => {
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

      return {
        preview: ticketWorkspaceService.getPreview(ticket.id),
      };
    },
  );

  app.post<{ Params: { ticketId: string } }>(
    "/tickets/:ticketId/workspace/preview",
    async (request, reply) => {
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
      if (!ticket.session_id) {
        reply.code(409).send({ error: "Ticket has no prepared workspace yet" });
        return;
      }

      const session = store.getSession(ticket.session_id);
      if (!session?.worktree_path) {
        reply.code(409).send({ error: "Session has no prepared worktree" });
        return;
      }

      try {
        const preview = await ticketWorkspaceService.ensurePreview({
          ticketId: ticket.id,
          worktreePath: session.worktree_path,
        });
        reply.send({ preview });
      } catch (error) {
        reply.code(409).send({
          error:
            error instanceof Error ? error.message : "Unable to start preview",
        });
      }
    },
  );
}
