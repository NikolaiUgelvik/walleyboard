import type { FastifyInstance } from "fastify";

import { makeCommandAck } from "../../lib/command-ack.js";
import { makeProtocolEvent } from "../../lib/event-hub.js";
import { parsePositiveInt } from "../../lib/http.js";
import { commandRouteRateLimit } from "../../lib/rate-limit.js";
import { removeTicketArtifacts } from "../../lib/ticket-artifacts.js";
import {
  removeLocalBranch,
  removePreparedWorktree,
} from "../../lib/worktree-service.js";
import type { TicketRouteDependencies } from "./shared.js";

export function registerTicketLifecycleRoutes(
  app: FastifyInstance,
  {
    eventHub,
    executionRuntime,
    store,
    ticketWorkspaceService,
  }: TicketRouteDependencies,
) {
  app.post<{ Params: { ticketId: string } }>(
    "/tickets/:ticketId/edit",
    { preHandler: commandRouteRateLimit(app) },
    async (request, reply) => {
      const ticketId = parsePositiveInt(request.params.ticketId);
      if (!ticketId) {
        reply.code(400).send({ error: "Invalid ticket id" });
        return;
      }

      try {
        const originalTicket = store.getTicket(ticketId);
        const draft = store.editReadyTicket(ticketId);

        eventHub.publish(
          makeProtocolEvent("draft.updated", "draft", draft.id, {
            draft,
          }),
        );
        eventHub.publish(
          makeProtocolEvent("ticket.deleted", "ticket", String(ticketId), {
            ticket_id: ticketId,
            project_id: originalTicket?.project ?? draft.project_id,
            session_id: originalTicket?.session_id ?? null,
          }),
        );

        reply.send(
          makeCommandAck(true, "Ticket moved back to draft", {
            draft_id: draft.id,
            project_id: draft.project_id,
            ticket_id: ticketId,
          }),
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to reopen ticket for editing";
        reply.code(message === "Ticket not found" ? 404 : 409).send({
          error: message,
        });
      }
    },
  );

  app.post<{ Params: { ticketId: string } }>(
    "/tickets/:ticketId/archive",
    async (request, reply) => {
      const ticketId = parsePositiveInt(request.params.ticketId);
      if (!ticketId) {
        reply.code(400).send({ error: "Invalid ticket id" });
        return;
      }

      try {
        const archivedTicket = store.archiveTicket(ticketId);
        if (!archivedTicket) {
          reply.code(404).send({ error: "Ticket not found" });
          return;
        }

        store.recordTicketEvent(ticketId, "ticket.archived", {
          ticket_id: archivedTicket.id,
          project_id: archivedTicket.project,
          session_id: archivedTicket.session_id,
        });
        eventHub.publish(
          makeProtocolEvent("ticket.archived", "ticket", String(ticketId), {
            ticket_id: archivedTicket.id,
            project_id: archivedTicket.project,
            session_id: archivedTicket.session_id,
          }),
        );

        reply.send(
          makeCommandAck(true, "Ticket archived", {
            project_id: archivedTicket.project,
            ticket_id: archivedTicket.id,
            session_id: archivedTicket.session_id ?? undefined,
          }),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to archive ticket";
        reply.code(409).send({ error: message });
      }
    },
  );

  app.post<{ Params: { ticketId: string } }>(
    "/tickets/:ticketId/restore",
    async (request, reply) => {
      const ticketId = parsePositiveInt(request.params.ticketId);
      if (!ticketId) {
        reply.code(400).send({ error: "Invalid ticket id" });
        return;
      }

      try {
        const restoredTicket = store.restoreTicket(ticketId);
        if (!restoredTicket) {
          reply.code(404).send({ error: "Ticket not found" });
          return;
        }

        store.recordTicketEvent(ticketId, "ticket.restored", {
          ticket_id: restoredTicket.id,
          project_id: restoredTicket.project,
          session_id: restoredTicket.session_id,
        });
        eventHub.publish(
          makeProtocolEvent("ticket.updated", "ticket", String(ticketId), {
            ticket: restoredTicket,
          }),
        );

        reply.send(
          makeCommandAck(true, "Ticket restored", {
            project_id: restoredTicket.project,
            ticket_id: restoredTicket.id,
            session_id: restoredTicket.session_id ?? undefined,
          }),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to restore ticket";
        reply.code(409).send({ error: message });
      }
    },
  );

  app.post<{ Params: { ticketId: string } }>(
    "/tickets/:ticketId/delete",
    { preHandler: commandRouteRateLimit(app) },
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

      const session = ticket.session_id
        ? store.getSession(ticket.session_id)
        : undefined;
      const project = store.getProject(ticket.project);
      const repository = store.getRepository(ticket.repo);
      const cleanupWarnings: string[] = [];
      let deferredWorktreeCleanup = false;
      let skipLocalBranchCleanup = false;

      if (session) {
        try {
          await executionRuntime.stopExecution(
            session.id,
            `Execution stopped because ticket #${ticket.id} was deleted.`,
          );
        } catch (error) {
          cleanupWarnings.push(
            error instanceof Error
              ? error.message
              : "Unable to stop active execution",
          );
        }

        executionRuntime.cleanupExecutionEnvironment(session.id);
      }

      await ticketWorkspaceService.stopPreviewAndWait(ticketId);

      if (repository && session?.worktree_path) {
        try {
          executionRuntime.closeWorkspaceTerminals(
            session.id,
            "This workspace terminal closed because the ticket worktree was cleaned up.",
          );
          const worktreeRemoval = removePreparedWorktree(
            repository,
            session.worktree_path,
            project?.post_worktree_command,
            ticket.working_branch,
          );
          if (worktreeRemoval.status === "scheduled") {
            deferredWorktreeCleanup = true;
            skipLocalBranchCleanup = true;
          }
        } catch (error) {
          cleanupWarnings.push(
            error instanceof Error
              ? error.message
              : "Unable to remove worktree",
          );
        }
      }

      if (repository && ticket.working_branch && !skipLocalBranchCleanup) {
        try {
          removeLocalBranch(repository, ticket.working_branch);
        } catch (error) {
          cleanupWarnings.push(
            error instanceof Error
              ? error.message
              : "Unable to delete local branch",
          );
        }
      }

      if (project) {
        try {
          removeTicketArtifacts(
            project.slug,
            ticket.id,
            session?.id ?? ticket.session_id,
            ticket.artifact_scope_id,
          );
        } catch (error) {
          cleanupWarnings.push(
            error instanceof Error
              ? error.message
              : "Unable to remove local ticket artifacts",
          );
        }
      }

      const deletedTicket = store.deleteTicket(ticketId);
      if (!deletedTicket) {
        reply.code(404).send({ error: "Ticket not found" });
        return;
      }
      if (project) {
        executionRuntime.startQueuedSessions(project.id);
      }
      await ticketWorkspaceService.disposeTicket(ticketId);

      eventHub.publish(
        makeProtocolEvent("ticket.deleted", "ticket", String(ticketId), {
          ticket_id: ticketId,
          project_id: deletedTicket.project,
          session_id: deletedTicket.session_id,
          cleanup_warnings: cleanupWarnings,
        }),
      );

      reply.send(
        makeCommandAck(
          true,
          cleanupWarnings.length === 0
            ? deferredWorktreeCleanup
              ? "Ticket deleted. Worktree cleanup is continuing in the background."
              : "Ticket deleted and local artifacts cleaned up"
            : `Ticket deleted, but cleanup needs attention: ${cleanupWarnings.join(" | ")}`,
          {
            ticket_id: ticketId,
            session_id: deletedTicket.session_id ?? undefined,
          },
        ),
      );
    },
  );
}
