import type { FastifyInstance } from "fastify";

import { requestChangesInputSchema } from "../../../../../packages/contracts/src/index.js";

import { makeCommandAck } from "../../lib/command-ack.js";
import { makeProtocolEvent } from "../../lib/event-hub.js";
import { publishSessionUpdated } from "../../lib/execution-runtime/publishers.js";
import { parseBody, parsePositiveInt } from "../../lib/http.js";
import { createKeyedSerialTaskRunner } from "../../lib/keyed-serial-task-runner.js";
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
    agentReviewService,
    appendSessionOutput,
    eventHub,
    executionRuntime,
    githubPullRequestService,
    store,
    ticketWorkspaceService,
  }: TicketRouteDependencies,
) {
  const runMergeForRepository = createKeyedSerialTaskRunner();

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
        publishSessionUpdated(
          eventHub,
          restartResult.session,
          executionRuntime.hasActiveExecution(restartResult.session.id),
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
    "/tickets/:ticketId/start-agent-review",
    { preHandler: commandRouteRateLimit(app) },
    async (request, reply) => {
      const ticketId = parsePositiveInt(request.params.ticketId);
      if (!ticketId) {
        reply.code(400).send({ error: "Invalid ticket id" });
        return;
      }

      try {
        const reviewRun = agentReviewService.startReviewLoop(ticketId);
        reply.send(
          makeCommandAck(true, "Agent review started", {
            ticket_id: ticketId,
            session_id: reviewRun.implementation_session_id,
          }),
        );
      } catch (error) {
        reply.code(409).send({
          error:
            error instanceof Error
              ? error.message
              : "Unable to start agent review",
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

      try {
        const ticket =
          await githubPullRequestService.createPullRequest(ticketId);
        reply.send(
          makeCommandAck(true, "GitHub pull request created", {
            ticket_id: ticket.id,
            session_id: ticket.session_id ?? undefined,
          }),
        );
      } catch (error) {
        reply.code(409).send({
          error:
            error instanceof Error
              ? error.message
              : "Unable to create pull request",
        });
      }
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

      const repository = store.getRepository(ticket.repo);
      if (!repository) {
        reply.code(404).send({ error: "Repository not found" });
        return;
      }

      try {
        const response = await runMergeForRepository(
          repository.id,
          async () => {
            const lockedTicket = store.getTicket(ticketId);
            if (!lockedTicket) {
              return {
                statusCode: 404,
                body: { error: "Ticket not found" },
              };
            }
            if (lockedTicket.status !== "review") {
              return {
                statusCode: 409,
                body: { error: "Only review tickets can be merged" },
              };
            }
            if (!lockedTicket.session_id || !lockedTicket.working_branch) {
              return {
                statusCode: 409,
                body: { error: "Ticket is missing merge metadata" },
              };
            }

            const lockedSession = store.getSession(lockedTicket.session_id);
            if (!lockedSession) {
              return {
                statusCode: 404,
                body: { error: "Session not found" },
              };
            }
            if (!lockedSession.worktree_path) {
              return {
                statusCode: 409,
                body: { error: "Session has no prepared worktree" },
              };
            }

            const lockedProject = store.getProject(lockedTicket.project);
            if (!lockedProject) {
              return {
                statusCode: 404,
                body: { error: "Project not found" },
              };
            }

            if (!store.getReviewPackage(ticketId)) {
              return {
                statusCode: 409,
                body: { error: "Review package is required before merge" },
              };
            }

            await ticketWorkspaceService.stopPreviewAndWait(ticketId);

            try {
              const mergeResult = await mergeReviewedBranch(
                repository,
                lockedSession.worktree_path,
                lockedTicket.working_branch,
                lockedTicket.target_branch,
                {
                  resolveConflicts: (input) =>
                    executionRuntime.resolveMergeConflicts({
                      project: lockedProject,
                      recoveryKind: input.recoveryKind,
                      repository,
                      ticket: lockedTicket,
                      session: lockedSession,
                      targetBranch: lockedTicket.target_branch,
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
              let workspaceRetired = false;

              try {
                executionRuntime.closeWorkspaceTerminals(
                  lockedSession.id,
                  "This workspace terminal closed because the ticket worktree was cleaned up after merge.",
                );
                const worktreeRemoval = removePreparedWorktree(
                  repository,
                  lockedSession.worktree_path,
                  lockedProject.post_worktree_command,
                  lockedTicket.working_branch,
                );
                if (worktreeRemoval.status === "scheduled") {
                  deferredWorktreeCleanup = true;
                  skipLocalBranchCleanup = true;
                }
                workspaceRetired = true;
                logLines.push(
                  worktreeRemoval.status === "scheduled"
                    ? `Scheduled worktree removal for ${lockedSession.worktree_path} after the post-worktree command finishes`
                    : `Removed worktree ${lockedSession.worktree_path}`,
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
                  removeLocalBranch(repository, lockedTicket.working_branch);
                  logLines.push(
                    `Deleted local branch ${lockedTicket.working_branch}`,
                  );
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
                    ? `Merged ${lockedTicket.working_branch} into ${lockedTicket.target_branch}. Worktree cleanup is continuing in the background.`
                    : `Merged ${lockedTicket.working_branch} into ${lockedTicket.target_branch} and cleaned up local artifacts.`
                  : `Merged ${lockedTicket.working_branch} into ${lockedTicket.target_branch}, but cleanup needs attention: ${cleanupWarnings.join(
                      " | ",
                    )}`;
              const mergedSession = store.updateSessionStatus(
                lockedSession.id,
                "completed",
                summary,
              );
              const completedSession =
                workspaceRetired && mergedSession
                  ? (store.updateSessionWorktreePath(lockedSession.id, null) ??
                    mergedSession)
                  : mergedSession;

              store.recordTicketEvent(ticketId, "ticket.merged", {
                ticket_id: ticketId,
                target_branch: lockedTicket.target_branch,
                target_head: mergeResult.targetHead,
                cleanup_warnings: cleanupWarnings,
              });

              for (const line of [
                ...logLines,
                ...cleanupWarnings.map(
                  (warning) => `Cleanup warning: ${warning}`,
                ),
              ]) {
                appendSessionOutput(
                  lockedSession.id,
                  lockedSession.current_attempt_id,
                  line,
                );
              }

              eventHub.publish(
                makeProtocolEvent(
                  "ticket.updated",
                  "ticket",
                  String(ticketId),
                  {
                    ticket: mergedTicket,
                  },
                ),
              );
              publishSessionUpdated(
                eventHub,
                completedSession,
                completedSession
                  ? executionRuntime.hasActiveExecution(completedSession.id)
                  : false,
              );
              await ticketWorkspaceService.disposeTicket(ticketId);

              return {
                statusCode: 200,
                body: makeCommandAck(
                  true,
                  "Ticket merged into the target branch",
                  {
                    ticket_id: ticketId,
                    session_id: lockedSession.id,
                  },
                ),
              };
            } catch (error) {
              if (error instanceof AutomaticMergeRecoveryError) {
                for (const line of error.logs) {
                  appendSessionOutput(
                    lockedSession.id,
                    lockedSession.current_attempt_id,
                    line,
                  );
                }

                const mergeConflict = store.recordMergeConflict(
                  ticketId,
                  error.note,
                );
                eventHub.publish(
                  makeProtocolEvent(
                    "ticket.updated",
                    "ticket",
                    String(ticketId),
                    {
                      ticket: mergeConflict.ticket,
                    },
                  ),
                );
                publishSessionUpdated(
                  eventHub,
                  mergeConflict.session,
                  executionRuntime.hasActiveExecution(mergeConflict.session.id),
                );
                mergeConflict.logs.forEach((logLine, index) => {
                  eventHub.publish(
                    makeProtocolEvent(
                      "session.output",
                      "session",
                      lockedSession.id,
                      {
                        session_id: lockedSession.id,
                        attempt_id: lockedSession.current_attempt_id,
                        sequence:
                          store.getSessionLogs(lockedSession.id).length -
                          mergeConflict.logs.length +
                          index,
                        chunk: logLine,
                      },
                    ),
                  );
                });
                appendSessionOutput(
                  lockedSession.id,
                  lockedSession.current_attempt_id,
                  `[merge blocked] ${error.message}`,
                );
                return {
                  statusCode: 409,
                  body: { error: error.message },
                };
              }

              const message =
                error instanceof Error
                  ? error.message
                  : "Unable to merge ticket";
              appendSessionOutput(
                lockedSession.id,
                lockedSession.current_attempt_id,
                `[merge blocked] ${message}`,
              );
              return {
                statusCode: 409,
                body: { error: message },
              };
            }
          },
        );

        reply.code(response.statusCode).send(response.body);
      } catch (error) {
        reply.code(409).send({
          error:
            error instanceof Error ? error.message : "Unable to merge ticket",
        });
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

      try {
        const ticket = await githubPullRequestService.reconcileTicket(ticketId);
        reply.send(
          makeCommandAck(true, "Linked pull request reconciled", {
            ticket_id: ticket.id,
            session_id: ticket.session_id ?? undefined,
          }),
        );
      } catch (error) {
        reply.code(409).send({
          error:
            error instanceof Error
              ? error.message
              : "Unable to reconcile linked pull request",
        });
      }
    },
  );
}
