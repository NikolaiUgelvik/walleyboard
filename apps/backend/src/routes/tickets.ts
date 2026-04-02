import type { FastifyPluginAsync } from "fastify";

import {
  requestChangesInputSchema,
  restartTicketInputSchema,
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
import type { TicketWorkspaceService } from "../lib/ticket-workspace-service.js";
import {
  AutomaticMergeRecoveryError,
  mergeReviewedBranch,
  prepareWorktree,
  removeLocalBranch,
  removePreparedWorktree,
  resetPreparedWorktreeImmediately,
  runPreWorktreeCommand,
} from "../lib/worktree-service.js";

type TicketRouteOptions = {
  eventHub: EventHub;
  executionRuntime: ExecutionRuntime;
  store: Store;
  ticketWorkspaceService: TicketWorkspaceService;
};

export const ticketRoutes: FastifyPluginAsync<TicketRouteOptions> = async (
  app,
  { eventHub, executionRuntime, store, ticketWorkspaceService },
) => {
  const appendSessionOutput = (
    sessionId: string,
    attemptId: string | null,
    chunk: string,
  ) => {
    const sequence = store.appendSessionLog(sessionId, chunk);
    eventHub.publish(
      makeProtocolEvent("session.output", "session", sessionId, {
        session_id: sessionId,
        attempt_id: attemptId,
        sequence,
        chunk,
      }),
    );
  };

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
        executionRuntime.startQueuedSessions(ticket.project);

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
    "/tickets/:ticketId/restart",
    async (request, reply) => {
      const ticketId = parsePositiveInt(request.params.ticketId);
      if (!ticketId) {
        reply.code(400).send({ error: "Invalid ticket id" });
        return;
      }

      const input = parseBody(reply, restartTicketInputSchema, request.body);
      if (!input) {
        return;
      }

      const ticket = store.getTicket(ticketId);
      if (!ticket) {
        reply.code(404).send({ error: "Ticket not found" });
        return;
      }
      if (ticket.status !== "in_progress") {
        reply.code(409).send({
          error: "Only in-progress tickets can restart from scratch",
        });
        return;
      }
      if (!ticket.session_id) {
        reply.code(409).send({ error: "Ticket has no execution session" });
        return;
      }

      const session = store.getSession(ticket.session_id);
      if (!session) {
        reply.code(404).send({ error: "Execution session not found" });
        return;
      }
      if (session.status !== "interrupted") {
        reply.code(409).send({
          error: "Only interrupted sessions can restart from scratch",
        });
        return;
      }

      const project = store.getProject(ticket.project);
      if (!project) {
        reply.code(404).send({ error: "Project not found" });
        return;
      }

      const repository = store.getRepository(ticket.repo);
      if (!repository) {
        reply.code(404).send({ error: "Repository not found" });
        return;
      }

      try {
        appendSessionOutput(
          session.id,
          session.current_attempt_id,
          "Fresh restart requested. Discarding the preserved worktree and local branch before creating a clean attempt.",
        );

        await ticketWorkspaceService.stopPreviewAndWait(ticketId);
        await ticketWorkspaceService.disposeTicket(ticketId);

        const cleanup = resetPreparedWorktreeImmediately(
          repository,
          session.worktree_path,
          ticket.working_branch,
          project.post_worktree_command,
        );
        for (const warning of cleanup.warnings) {
          appendSessionOutput(
            session.id,
            session.current_attempt_id,
            `Restart cleanup warning: ${warning}`,
          );
        }

        const runtime = prepareWorktree(project, repository, {
          ...ticket,
          working_branch: null,
        });
        const restartResult = store.restartInterruptedTicket(
          ticketId,
          runtime,
          input.reason,
        );

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
          ...(input.reason && input.reason.trim().length > 0
            ? { additionalInstruction: input.reason }
            : {}),
        });
        runPreWorktreeCommand(
          runtime.worktreePath,
          project.pre_worktree_command,
        );

        reply.send(
          makeCommandAck(true, "Execution session restarted from scratch", {
            ticket_id: restartResult.ticket.id,
            session_id: restartResult.session.id,
          }),
        );
      } catch (error) {
        reply.code(409).send({
          error:
            error instanceof Error
              ? error.message
              : "Unable to restart ticket from scratch",
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

      await ticketWorkspaceService.stopPreviewAndWait(ticketId);

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
        reply
          .code(409)
          .send({ error: "Review package is required before merge" });
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
