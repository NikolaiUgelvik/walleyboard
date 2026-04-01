import type { FastifyPluginAsync } from "fastify";

import {
  requestChangesInputSchema,
  resumeTicketInputSchema,
  startTicketInputSchema,
  stopTicketInputSchema,
} from "../../../../packages/contracts/src/index.js";

import { makeCommandAck } from "../lib/command-ack.js";
import { type EventHub, makeProtocolEvent } from "../lib/event-hub.js";
import type { ExecutionRuntime } from "../lib/execution-runtime.js";
import {
  parseBody,
  parsePositiveInt,
  sendNotImplemented,
} from "../lib/http.js";
import type { Store } from "../lib/store.js";
import { removeTicketArtifacts } from "../lib/ticket-artifacts.js";
import {
  mergeReviewedBranch,
  prepareWorktree,
  removeLocalBranch,
  removePreparedWorktree,
  runPreWorktreeCommand,
} from "../lib/worktree-service.js";

type TicketRouteOptions = {
  eventHub: EventHub;
  executionRuntime: ExecutionRuntime;
  store: Store;
};

export const ticketRoutes: FastifyPluginAsync<TicketRouteOptions> = async (
  app,
  { eventHub, executionRuntime, store },
) => {
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

      try {
        const ticketForPreparation = store.getTicket(ticketId);
        if (!ticketForPreparation) {
          reply.code(404).send({ error: "Ticket not found" });
          return;
        }

        const project = store.getProject(ticketForPreparation.project);
        if (!project) {
          reply.code(404).send({ error: "Project not found" });
          return;
        }

        const repository = store.getRepository(ticketForPreparation.repo);
        if (!repository) {
          reply.code(404).send({ error: "Repository not found" });
          return;
        }

        const runtime = prepareWorktree(
          project,
          repository,
          ticketForPreparation,
        );
        const { ticket, session, logs } = store.startTicket(
          ticketId,
          input.planning_enabled,
          runtime,
        );

        eventHub.publish(
          makeProtocolEvent("ticket.updated", "ticket", String(ticket.id), {
            ticket,
          }),
        );
        eventHub.publish(
          makeProtocolEvent("session.updated", "session", session.id, {
            session,
          }),
        );
        logs.forEach((logLine, index) => {
          eventHub.publish(
            makeProtocolEvent("session.output", "session", session.id, {
              session_id: session.id,
              attempt_id: session.current_attempt_id,
              sequence: index,
              chunk: logLine,
            }),
          );
        });
        executionRuntime.startExecution({
          project,
          repository,
          ticket,
          session,
        });
        runPreWorktreeCommand(
          runtime.worktreePath,
          project.pre_worktree_command,
        );

        reply.send(
          makeCommandAck(
            true,
            "Ticket moved to in progress and execution session created",
            {
              ticket_id: ticket.id,
              session_id: session.id,
            },
          ),
        );
      } catch (error) {
        reply.code(409).send({
          error:
            error instanceof Error ? error.message : "Unable to start ticket",
        });
      }
    },
  );

  app.post<{ Params: { ticketId: string } }>(
    "/tickets/:ticketId/stop",
    async (request, reply) => {
      const ticketId = parsePositiveInt(request.params.ticketId);
      if (!ticketId) {
        reply.code(400).send({ error: "Invalid ticket id" });
        return;
      }

      const input = parseBody(reply, stopTicketInputSchema, request.body);
      if (!input) {
        return;
      }

      try {
        const ticket = store.getTicket(ticketId);
        if (!ticket) {
          reply.code(404).send({ error: "Ticket not found" });
          return;
        }
        if (!ticket.session_id) {
          reply.code(409).send({ error: "Ticket has no execution session" });
          return;
        }

        await executionRuntime.stopExecution(
          ticket.session_id,
          input.reason ?? "Execution stopped by user.",
        );
        const stopped = store.stopTicket(ticketId, input.reason);

        eventHub.publish(
          makeProtocolEvent(
            "ticket.updated",
            "ticket",
            String(stopped.ticket.id),
            {
              ticket: stopped.ticket,
            },
          ),
        );
        eventHub.publish(
          makeProtocolEvent("session.updated", "session", stopped.session.id, {
            session: stopped.session,
          }),
        );
        stopped.logs.forEach((logLine, index) => {
          eventHub.publish(
            makeProtocolEvent("session.output", "session", stopped.session.id, {
              session_id: stopped.session.id,
              attempt_id:
                stopped.attempt?.id ?? stopped.session.current_attempt_id,
              sequence:
                store.getSessionLogs(stopped.session.id).length -
                stopped.logs.length +
                index,
              chunk: logLine,
            }),
          );
        });

        reply.send(
          makeCommandAck(true, "Ticket execution stopped", {
            ticket_id: stopped.ticket.id,
            session_id: stopped.session.id,
          }),
        );
      } catch (error) {
        reply.code(409).send({
          error:
            error instanceof Error ? error.message : "Unable to stop ticket",
        });
      }
    },
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

      try {
        const resumeResult = store.resumeTicket(ticketId, input.reason);
        const project = store.getProject(resumeResult.ticket.project);
        if (!project) {
          reply.code(404).send({ error: "Project not found" });
          return;
        }

        const repository = store.getRepository(resumeResult.ticket.repo);
        if (!repository) {
          reply.code(404).send({ error: "Repository not found" });
          return;
        }

        eventHub.publish(
          makeProtocolEvent(
            "ticket.updated",
            "ticket",
            String(resumeResult.ticket.id),
            {
              ticket: resumeResult.ticket,
            },
          ),
        );
        eventHub.publish(
          makeProtocolEvent(
            "session.updated",
            "session",
            resumeResult.session.id,
            {
              session: resumeResult.session,
            },
          ),
        );
        resumeResult.logs.forEach((logLine, index) => {
          eventHub.publish(
            makeProtocolEvent(
              "session.output",
              "session",
              resumeResult.session.id,
              {
                session_id: resumeResult.session.id,
                attempt_id: resumeResult.attempt.id,
                sequence:
                  store.getSessionLogs(resumeResult.session.id).length -
                  resumeResult.logs.length +
                  index,
                chunk: logLine,
              },
            ),
          );
        });

        executionRuntime.startExecution({
          project,
          repository,
          ticket: resumeResult.ticket,
          session: resumeResult.session,
          ...(input.reason && input.reason.trim().length > 0
            ? { additionalInstruction: input.reason }
            : {}),
        });

        reply.send(
          makeCommandAck(true, "Execution session resumed", {
            ticket_id: resumeResult.ticket.id,
            session_id: resumeResult.session.id,
          }),
        );
      } catch (error) {
        reply.code(409).send({
          error:
            error instanceof Error ? error.message : "Unable to resume ticket",
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
    "/tickets/:ticketId/delete",
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
      }

      if (repository && session?.worktree_path) {
        try {
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

      try {
        const restartResult = store.requestTicketChanges(ticketId, input.body);
        const project = store.getProject(restartResult.ticket.project);
        if (!project) {
          reply.code(404).send({ error: "Project not found" });
          return;
        }

        const repository = store.getRepository(restartResult.ticket.repo);
        if (!repository) {
          reply.code(404).send({ error: "Repository not found" });
          return;
        }

        eventHub.publish(
          makeProtocolEvent(
            "ticket.updated",
            "ticket",
            String(restartResult.ticket.id),
            {
              ticket: restartResult.ticket,
            },
          ),
        );
        eventHub.publish(
          makeProtocolEvent(
            "session.updated",
            "session",
            restartResult.session.id,
            {
              session: restartResult.session,
            },
          ),
        );
        restartResult.logs.forEach((logLine, index) => {
          eventHub.publish(
            makeProtocolEvent(
              "session.output",
              "session",
              restartResult.session.id,
              {
                session_id: restartResult.session.id,
                attempt_id: restartResult.attempt.id,
                sequence:
                  store.getSessionLogs(restartResult.session.id).length -
                  restartResult.logs.length +
                  index,
                chunk: logLine,
              },
            ),
          );
        });

        executionRuntime.startExecution({
          project,
          repository,
          ticket: restartResult.ticket,
          session: restartResult.session,
        });

        reply.send(
          makeCommandAck(
            true,
            "Requested changes were attached and execution restarted",
            {
              ticket_id: restartResult.ticket.id,
              session_id: restartResult.session.id,
            },
          ),
        );
      } catch (error) {
        reply.code(409).send({
          error:
            error instanceof Error
              ? error.message
              : "Unable to request changes",
        });
      }
    },
  );

  app.post<{ Params: { ticketId: string } }>(
    "/tickets/:ticketId/create-pr",
    async (request, reply) => {
      const ticketId = parsePositiveInt(request.params.ticketId);
      if (!ticketId) {
        reply.code(400).send({ error: "Invalid ticket id" });
        return;
      }

      sendNotImplemented(
        reply,
        "PR creation is intentionally deferred in the strict MVP.",
        {
          ticket_id: ticketId,
        },
      );
    },
  );

  app.post<{ Params: { ticketId: string } }>(
    "/tickets/:ticketId/merge",
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
      if (ticket.status !== "review") {
        reply.code(409).send({ error: "Only review tickets can be merged" });
        return;
      }
      if (!ticket.session_id || !ticket.working_branch) {
        reply.code(409).send({ error: "Ticket is missing merge metadata" });
        return;
      }

      const session = store.getSession(ticket.session_id);
      if (!session) {
        reply.code(404).send({ error: "Session not found" });
        return;
      }
      if (!session.worktree_path) {
        reply.code(409).send({ error: "Session has no prepared worktree" });
        return;
      }

      const repository = store.getRepository(ticket.repo);
      if (!repository) {
        reply.code(404).send({ error: "Repository not found" });
        return;
      }
      const project = store.getProject(ticket.project);
      if (!project) {
        reply.code(404).send({ error: "Project not found" });
        return;
      }

      const reviewPackage = store.getReviewPackage(ticketId);
      if (!reviewPackage) {
        reply
          .code(409)
          .send({ error: "Review package is required before merge" });
        return;
      }

      try {
        const mergeResult = mergeReviewedBranch(
          repository,
          session.worktree_path,
          ticket.working_branch,
          ticket.target_branch,
        );

        const logLines = [...mergeResult.logs];
        const cleanupWarnings: string[] = [];
        let deferredWorktreeCleanup = false;
        let skipLocalBranchCleanup = false;

        try {
          const worktreeRemoval = removePreparedWorktree(
            repository,
            session.worktree_path,
            project.post_worktree_command,
            ticket.working_branch,
          );
          if (worktreeRemoval.status === "scheduled") {
            deferredWorktreeCleanup = true;
            skipLocalBranchCleanup = true;
          }
          logLines.push(
            worktreeRemoval.status === "scheduled"
              ? `Scheduled worktree removal for ${session.worktree_path} after the post-worktree command finishes`
              : `Removed worktree ${session.worktree_path}`,
          );
        } catch (error) {
          cleanupWarnings.push(
            error instanceof Error
              ? error.message
              : "Unable to remove worktree",
          );
        }

        if (!skipLocalBranchCleanup) {
          try {
            removeLocalBranch(repository, ticket.working_branch);
            logLines.push(`Deleted local branch ${ticket.working_branch}`);
          } catch (error) {
            cleanupWarnings.push(
              error instanceof Error
                ? error.message
                : "Unable to delete local branch",
            );
          }
        }

        const mergedTicket = store.updateTicketStatus(ticketId, "done");
        const summary =
          cleanupWarnings.length === 0
            ? deferredWorktreeCleanup
              ? `Merged ${ticket.working_branch} into ${ticket.target_branch}. Worktree cleanup is continuing in the background.`
              : `Merged ${ticket.working_branch} into ${ticket.target_branch} and cleaned up local artifacts.`
            : `Merged ${ticket.working_branch} into ${ticket.target_branch}, but cleanup needs attention: ${cleanupWarnings.join(
                " | ",
              )}`;
        const mergedSession = store.updateSessionStatus(
          ticket.session_id,
          "completed",
          summary,
        );

        store.recordTicketEvent(ticketId, "ticket.merged", {
          ticket_id: ticketId,
          target_branch: ticket.target_branch,
          target_head: mergeResult.targetHead,
          cleanup_warnings: cleanupWarnings,
        });

        for (const line of [
          ...logLines,
          ...cleanupWarnings.map((warning) => `Cleanup warning: ${warning}`),
        ]) {
          const sequence = store.appendSessionLog(ticket.session_id, line);
          eventHub.publish(
            makeProtocolEvent("session.output", "session", ticket.session_id, {
              session_id: ticket.session_id,
              attempt_id: session.current_attempt_id,
              sequence,
              chunk: line,
            }),
          );
        }

        eventHub.publish(
          makeProtocolEvent("ticket.updated", "ticket", String(ticketId), {
            ticket: mergedTicket,
          }),
        );
        eventHub.publish(
          makeProtocolEvent("session.updated", "session", ticket.session_id, {
            session: mergedSession,
          }),
        );

        reply.send(
          makeCommandAck(true, "Ticket merged into the target branch", {
            ticket_id: ticketId,
            session_id: ticket.session_id,
          }),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to merge ticket";
        const sequence = store.appendSessionLog(
          ticket.session_id,
          `[merge blocked] ${message}`,
        );
        eventHub.publish(
          makeProtocolEvent("session.output", "session", ticket.session_id, {
            session_id: ticket.session_id,
            attempt_id: session.current_attempt_id,
            sequence,
            chunk: `[merge blocked] ${message}`,
          }),
        );
        reply.code(409).send({ error: message });
      }
    },
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
        { ticket_id: ticketId },
      );
    },
  );
};
