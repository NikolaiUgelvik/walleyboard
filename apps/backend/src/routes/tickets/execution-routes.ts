import type { FastifyInstance } from "fastify";

import type { Project } from "../../../../../packages/contracts/src/index.js";
import {
  restartTicketInputSchema,
  resumeTicketInputSchema,
  startTicketInputSchema,
  stopTicketInputSchema,
} from "../../../../../packages/contracts/src/index.js";

import {
  assertAgentAdapterAvailable,
  createClaudeCodeAvailabilityGetter,
} from "../../lib/claude-code-availability.js";
import { makeCommandAck } from "../../lib/command-ack.js";
import { makeProtocolEvent } from "../../lib/event-hub.js";
import {
  publishSessionUpdated,
  shouldPublishPreExecutionSessionUpdate,
} from "../../lib/execution-runtime/publishers.js";
import { parseBody, parsePositiveInt } from "../../lib/http.js";
import { commandRouteRateLimit } from "../../lib/rate-limit.js";
import type { PreparedExecutionRuntime } from "../../lib/store.js";
import {
  awaitWorktreeInitWithTimeout,
  prepareWorktreeAsync,
  resetPreparedWorktreeImmediately,
  runWorktreeInitCommand,
} from "../../lib/worktree-service.js";
import type { TicketRouteDependencies } from "./shared.js";

function runInitCommandAndStartExecution(input: {
  project: Project;
  runtime: PreparedExecutionRuntime;
  executionRuntime: TicketRouteDependencies["executionRuntime"];
  ticketWorkspaceService: TicketRouteDependencies["ticketWorkspaceService"];
  ticketId: number;
  startExecutionArgs: Parameters<
    TicketRouteDependencies["executionRuntime"]["startExecution"]
  >[0];
  appendWarning?: (message: string) => void;
}): void {
  if (input.project.worktree_init_run_sequential) {
    const initCommand = runWorktreeInitCommand(
      input.runtime.worktreePath,
      input.project.worktree_init_command,
    );
    if (initCommand.started) {
      awaitWorktreeInitWithTimeout(initCommand)
        .catch((error) => {
          input.appendWarning?.(
            error instanceof Error
              ? error.message
              : "Worktree init command failed",
          );
        })
        .finally(() => {
          input.executionRuntime.startExecution(input.startExecutionArgs);
        });
    } else {
      input.executionRuntime.startExecution(input.startExecutionArgs);
    }
  } else {
    input.executionRuntime.startExecution(input.startExecutionArgs);
    const initCommand = runWorktreeInitCommand(
      input.runtime.worktreePath,
      input.project.worktree_init_command,
    );
    if (initCommand.started) {
      input.ticketWorkspaceService.deferWatcher(
        input.ticketId,
        initCommand.done,
      );
    }
  }
}

export function registerTicketExecutionRoutes(
  app: FastifyInstance,
  {
    appendSessionOutput,
    eventHub,
    executionRuntime,
    getClaudeCodeAvailability = createClaudeCodeAvailabilityGetter(),
    store,
    ticketWorkspaceService,
  }: TicketRouteDependencies,
) {
  app.post<{ Params: { ticketId: string } }>(
    "/tickets/:ticketId/start",
    { preHandler: commandRouteRateLimit(app) },
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

        assertAgentAdapterAvailable(
          project.ticket_work_agent_adapter,
          getClaudeCodeAvailability,
        );
        executionRuntime.assertProjectExecutionBackendAvailable(
          project,
          project.ticket_work_agent_adapter,
        );

        const runtime = await prepareWorktreeAsync(
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
        if (shouldPublishPreExecutionSessionUpdate(session)) {
          publishSessionUpdated(
            eventHub,
            session,
            executionRuntime.hasActiveExecution(session.id),
          );
        }
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
        runInitCommandAndStartExecution({
          project,
          runtime,
          executionRuntime,
          ticketWorkspaceService,
          ticketId: ticket.id,
          startExecutionArgs: { project, repository, ticket, session },
          appendWarning: (message) =>
            appendSessionOutput(
              session.id,
              session.current_attempt_id,
              `Worktree init warning: ${message}`,
            ),
        });

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
    { preHandler: commandRouteRateLimit(app) },
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
        publishSessionUpdated(
          eventHub,
          stopped.session,
          executionRuntime.hasActiveExecution(stopped.session.id),
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
    { preHandler: commandRouteRateLimit(app) },
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
        const ticket = store.getTicket(ticketId);
        if (!ticket) {
          reply.code(404).send({ error: "Ticket not found" });
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

        assertAgentAdapterAvailable(
          project.ticket_work_agent_adapter,
          getClaudeCodeAvailability,
        );
        executionRuntime.assertProjectExecutionBackendAvailable(
          project,
          project.ticket_work_agent_adapter,
        );

        const resumeResult = store.resumeTicket(ticketId, input.reason);

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
        if (shouldPublishPreExecutionSessionUpdate(resumeResult.session)) {
          publishSessionUpdated(
            eventHub,
            resumeResult.session,
            executionRuntime.hasActiveExecution(resumeResult.session.id),
          );
        }
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
    { preHandler: commandRouteRateLimit(app) },
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

      assertAgentAdapterAvailable(
        project.ticket_work_agent_adapter,
        getClaudeCodeAvailability,
      );
      executionRuntime.assertProjectExecutionBackendAvailable(
        project,
        project.ticket_work_agent_adapter,
      );

      try {
        appendSessionOutput(
          session.id,
          session.current_attempt_id,
          "Fresh restart requested. Discarding the preserved worktree and local branch before creating a clean attempt.",
        );

        await ticketWorkspaceService.stopPreviewAndWait(ticketId);
        executionRuntime.closeWorkspaceTerminals(
          session.id,
          "This workspace terminal closed because the ticket worktree was reset for a fresh restart.",
        );
        await ticketWorkspaceService.disposeTicket(ticketId);
        executionRuntime.cleanupExecutionEnvironment(session.id);

        const cleanup = resetPreparedWorktreeImmediately(
          repository,
          session.worktree_path,
          ticket.working_branch,
          project.worktree_teardown_command,
        );
        for (const warning of cleanup.warnings) {
          appendSessionOutput(
            session.id,
            session.current_attempt_id,
            `Restart cleanup warning: ${warning}`,
          );
        }

        const runtime = await prepareWorktreeAsync(project, repository, {
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
        if (shouldPublishPreExecutionSessionUpdate(restartResult.session)) {
          publishSessionUpdated(
            eventHub,
            restartResult.session,
            executionRuntime.hasActiveExecution(restartResult.session.id),
          );
        }
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

        runInitCommandAndStartExecution({
          project,
          runtime,
          executionRuntime,
          ticketWorkspaceService,
          ticketId: restartResult.ticket.id,
          startExecutionArgs: {
            project,
            repository,
            ticket: restartResult.ticket,
            session: restartResult.session,
            ...(input.reason && input.reason.trim().length > 0
              ? { additionalInstruction: input.reason }
              : {}),
          },
          appendWarning: (message) =>
            appendSessionOutput(
              restartResult.session.id,
              restartResult.attempt.id,
              `Worktree init warning: ${message}`,
            ),
        });

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
}
