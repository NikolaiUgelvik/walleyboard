import type { FastifyInstance } from "fastify";

import { requestChangesInputSchema } from "../../../../../packages/contracts/src/index.js";

import { makeCommandAck } from "../../lib/command-ack.js";
import { makeProtocolEvent } from "../../lib/event-hub.js";
import {
  parseBody,
  parsePositiveInt,
  sendNotImplemented,
} from "../../lib/http.js";
import { commandRouteRateLimit } from "../../lib/rate-limit.js";
import {
  AutomaticMergeRecoveryError,
  mergeReviewedBranch,
  removeLocalBranch,
  removePreparedWorktree,
} from "../../lib/worktree-service.js";
import type { TicketRouteDependencies } from "./shared.js";

export function registerTicketReviewRoutes(
  app: FastifyInstance,
  {
    appendSessionOutput,
    eventHub,
    executionRuntime,
    store,
    ticketWorkspaceService,
  }: TicketRouteDependencies,
) {
  app.post<{ Params: { ticketId: string } }>(
    "/tickets/:ticketId/request-changes",
    { preHandler: commandRouteRateLimit(app) },
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
    { preHandler: commandRouteRateLimit(app) },
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
      if (ticket.status !== "review") {
        reply.code(409).send({ error: "Only review tickets can be merged" });
        return;
      }
      if (!ticket.session_id || !ticket.working_branch) {
        reply.code(409).send({ error: "Ticket is missing merge metadata" });
        return;
      }
      const sessionId = ticket.session_id;

      const session = store.getSession(sessionId);
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
        reply.code(409).send({
          error: "Review package is required before merge",
        });
        return;
      }

      try {
        await ticketWorkspaceService.stopPreviewAndWait(ticketId);

        const mergeResult = await mergeReviewedBranch(
          repository,
          session.worktree_path,
          ticket.working_branch,
          ticket.target_branch,
          {
            resolveConflicts: (input) =>
              executionRuntime.resolveMergeConflicts({
                project,
                repository,
                ticket,
                session,
                targetBranch: ticket.target_branch,
                stage: input.stage,
                conflictedFiles: input.conflictedFiles,
                failureMessage: input.failureMessage,
              }),
          },
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
          sessionId,
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
          appendSessionOutput(sessionId, session.current_attempt_id, line);
        }

        eventHub.publish(
          makeProtocolEvent("ticket.updated", "ticket", String(ticketId), {
            ticket: mergedTicket,
          }),
        );
        eventHub.publish(
          makeProtocolEvent("session.updated", "session", sessionId, {
            session: mergedSession,
          }),
        );
        await ticketWorkspaceService.disposeTicket(ticketId);

        reply.send(
          makeCommandAck(true, "Ticket merged into the target branch", {
            ticket_id: ticketId,
            session_id: sessionId,
          }),
        );
      } catch (error) {
        if (error instanceof AutomaticMergeRecoveryError) {
          for (const line of error.logs) {
            appendSessionOutput(sessionId, session.current_attempt_id, line);
          }

          const mergeConflict = store.recordMergeConflict(ticketId, error.note);
          eventHub.publish(
            makeProtocolEvent("ticket.updated", "ticket", String(ticketId), {
              ticket: mergeConflict.ticket,
            }),
          );
          eventHub.publish(
            makeProtocolEvent("session.updated", "session", sessionId, {
              session: mergeConflict.session,
            }),
          );
          mergeConflict.logs.forEach((logLine, index) => {
            eventHub.publish(
              makeProtocolEvent("session.output", "session", sessionId, {
                session_id: sessionId,
                attempt_id: session.current_attempt_id,
                sequence:
                  store.getSessionLogs(sessionId).length -
                  mergeConflict.logs.length +
                  index,
                chunk: logLine,
              }),
            );
          });
          appendSessionOutput(
            sessionId,
            session.current_attempt_id,
            `[merge blocked] ${error.message}`,
          );
          reply.code(409).send({ error: error.message });
          return;
        }

        const message =
          error instanceof Error ? error.message : "Unable to merge ticket";
        appendSessionOutput(
          sessionId,
          session.current_attempt_id,
          `[merge blocked] ${message}`,
        );
        reply.code(409).send({ error: message });
      }
    },
  );

  app.post<{ Params: { ticketId: string } }>(
    "/tickets/:ticketId/reconcile",
    { preHandler: commandRouteRateLimit(app) },
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
}
