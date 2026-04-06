import type { FastifyPluginAsync } from "fastify";

import {
  checkpointResponseInputSchema,
  sessionInputSchema,
} from "../../../../packages/contracts/src/index.js";

import {
  assertAgentAdapterAvailable,
  createClaudeCodeAvailabilityGetter,
  type GetClaudeCodeAvailability,
} from "../lib/claude-code-availability.js";
import { makeCommandAck } from "../lib/command-ack.js";
import { type EventHub, makeProtocolEvent } from "../lib/event-hub.js";
import {
  buildSessionResponse,
  publishSessionUpdated,
  shouldPublishPreExecutionSessionUpdate,
} from "../lib/execution-runtime/publishers.js";
import type { ExecutionRuntime } from "../lib/execution-runtime.js";
import { parseBody } from "../lib/http.js";
import { commandRouteRateLimit } from "../lib/rate-limit.js";
import type { SessionRoutePersistence } from "../lib/store.js";

type SessionRouteOptions = {
  eventHub: EventHub;
  executionRuntime: ExecutionRuntime;
  getClaudeCodeAvailability?: GetClaudeCodeAvailability;
  store: SessionRoutePersistence;
};

export const sessionRoutes: FastifyPluginAsync<SessionRouteOptions> = async (
  app,
  {
    eventHub,
    executionRuntime,
    getClaudeCodeAvailability = createClaudeCodeAvailabilityGetter(),
    store,
  },
) => {
  app.get<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId",
    async (request, reply) => {
      const session = store.getSession(request.params.sessionId);
      if (!session) {
        reply.code(404).send({ error: "Session not found" });
        return;
      }

      return buildSessionResponse(
        session,
        executionRuntime.hasActiveExecution(session.id),
      );
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId/attempts",
    async (request) => ({
      attempts: store.listSessionAttempts(request.params.sessionId),
    }),
  );

  app.get<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId/logs",
    async (request) => ({
      session_id: request.params.sessionId,
      logs: store.getSessionLogs(request.params.sessionId),
    }),
  );

  app.post<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId/terminal/takeover",
    { preHandler: commandRouteRateLimit(app) },
    async (request, reply) => {
      const session = store.getSession(request.params.sessionId);
      if (!session) {
        reply.code(404).send({ error: "Session not found" });
        return;
      }

      const ticket = store.getTicket(session.ticket_id);
      if (!ticket) {
        reply.code(404).send({ error: "Ticket not found" });
        return;
      }
      if (ticket.status !== "in_progress") {
        reply.code(409).send({
          error: "Only in-progress tickets support manual terminal takeover",
        });
        return;
      }
      if (!session.worktree_path) {
        reply.code(409).send({ error: "Session has no prepared worktree" });
        return;
      }

      try {
        if (executionRuntime.hasManualTerminal(session.id)) {
          const existingSession =
            store.updateSessionStatus(
              session.id,
              "paused_user_control",
              `Manual terminal attached in ${session.worktree_path}. Run direct project commands here, then restore the agent when you're ready to continue.`,
            ) ?? session;

          publishSessionUpdated(
            eventHub,
            existingSession,
            executionRuntime.hasActiveExecution(existingSession.id),
          );

          reply.send(
            makeCommandAck(true, "Manual terminal is already attached", {
              ticket_id: ticket.id,
              session_id: session.id,
            }),
          );
          return;
        }

        const hadActiveExecution = executionRuntime.hasActiveExecution(
          session.id,
        );
        if (hadActiveExecution) {
          await executionRuntime.stopExecution(
            session.id,
            "Manual terminal takeover requested.",
          );
        }

        if (
          session.current_attempt_id &&
          ["queued", "running", "paused_checkpoint", "awaiting_input"].includes(
            session.status,
          )
        ) {
          store.updateExecutionAttempt(session.current_attempt_id, {
            status: "interrupted",
            end_reason: "manual_terminal_takeover",
          });
        }

        executionRuntime.startManualTerminal({
          sessionId: session.id,
          worktreePath: session.worktree_path,
          attemptId: session.current_attempt_id,
        });

        const updatedSession =
          store.updateSessionStatus(
            session.id,
            "paused_user_control",
            `Manual terminal attached in ${session.worktree_path}. Run direct project commands here, then restore the agent when you're ready to continue.`,
          ) ?? session;

        publishSessionUpdated(
          eventHub,
          updatedSession,
          executionRuntime.hasActiveExecution(updatedSession.id),
        );
        executionRuntime.startQueuedSessions(ticket.project);

        reply.send(
          makeCommandAck(true, "Manual terminal takeover started", {
            ticket_id: ticket.id,
            session_id: session.id,
          }),
        );
      } catch (error) {
        reply.code(409).send({
          error:
            error instanceof Error
              ? error.message
              : "Unable to start manual terminal takeover",
        });
      }
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId/terminal/restore-agent",
    { preHandler: commandRouteRateLimit(app) },
    async (request, reply) => {
      const session = store.getSession(request.params.sessionId);
      if (!session) {
        reply.code(404).send({ error: "Session not found" });
        return;
      }

      const ticket = store.getTicket(session.ticket_id);
      if (!ticket) {
        reply.code(404).send({ error: "Ticket not found" });
        return;
      }
      if (ticket.status !== "in_progress") {
        reply.code(409).send({
          error: "Only in-progress tickets can restore agent control",
        });
        return;
      }
      if (session.status !== "paused_user_control") {
        reply
          .code(409)
          .send({ error: "Session is not in manual terminal mode" });
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
        await executionRuntime.stopManualTerminal(session.id);

        const restoreInstruction =
          "Manual terminal control ended. Review the commands and edits made in the project shell, then continue the ticket from the existing worktree.";
        const resumeResult = store.resumeTicket(ticket.id, restoreInstruction);

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
          additionalInstruction: restoreInstruction,
        });

        reply.send(
          makeCommandAck(true, "Agent control restored for the session", {
            ticket_id: resumeResult.ticket.id,
            session_id: resumeResult.session.id,
          }),
        );
      } catch (error) {
        reply.code(409).send({
          error:
            error instanceof Error
              ? error.message
              : "Unable to restore agent control",
        });
      }
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId/checkpoint-response",
    async (request, reply) => {
      const input = parseBody(
        reply,
        checkpointResponseInputSchema,
        request.body,
      );
      if (!input) {
        return;
      }

      try {
        const activeSession = store.getSession(request.params.sessionId);
        if (!activeSession) {
          reply.code(404).send({ error: "Session not found" });
          return;
        }

        if (activeSession.plan_status === "awaiting_feedback") {
          const ticket = store.getTicket(activeSession.ticket_id);
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

          executionRuntime.assertProjectExecutionBackendAvailable(
            project,
            project.ticket_work_agent_adapter,
          );

          const approved = input.approved === true;
          const feedbackBody =
            input.body.trim().length > 0
              ? input.body
              : approved
                ? "Plan approved. Continue with implementation."
                : "Please revise the implementation plan.";

          const feedbackLogLine = approved
            ? `Plan approved by user:\n${feedbackBody}`
            : `Plan changes requested:\n${feedbackBody}`;
          const updatedPlanSession = store.updateSessionPlan(activeSession.id, {
            plan_status: approved ? "approved" : "drafting",
            plan_summary: approved ? activeSession.plan_summary : null,
            status: "awaiting_input",
            last_summary: approved
              ? "Plan approved. Starting implementation on the existing worktree."
              : "Plan changes requested. The agent will revise the implementation plan.",
          });

          if (!updatedPlanSession) {
            reply.code(404).send({ error: "Session not found" });
            return;
          }

          const sequence = store.appendSessionLog(
            activeSession.id,
            feedbackLogLine,
          );
          eventHub.publish(
            makeProtocolEvent(
              "session.output",
              "session",
              updatedPlanSession.id,
              {
                session_id: updatedPlanSession.id,
                attempt_id:
                  updatedPlanSession.current_attempt_id ??
                  activeSession.current_attempt_id,
                sequence,
                chunk: feedbackLogLine,
              },
            ),
          );

          const resumeResult = store.resumeTicket(ticket.id, feedbackBody);

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
            additionalInstruction: feedbackBody,
          });

          reply.send(
            makeCommandAck(
              true,
              approved
                ? "Plan approved and implementation resumed"
                : "Plan feedback recorded and planning resumed",
              {
                ticket_id: resumeResult.ticket.id,
                session_id: resumeResult.session.id,
              },
            ),
          );
          return;
        }

        const forwardedTo = executionRuntime.forwardInput(
          request.params.sessionId,
          input.approved === undefined
            ? input.body
            : `Checkpoint response (approved=${input.approved}):\n${input.body}`,
        );

        if (forwardedTo) {
          const session =
            store.updateSessionStatus(
              request.params.sessionId,
              forwardedTo === "agent" ? "running" : "paused_user_control",
              forwardedTo === "agent"
                ? "Checkpoint response was forwarded to the active agent session."
                : "Checkpoint response was forwarded to the active project terminal.",
            ) ?? store.getSession(request.params.sessionId);
          if (!session) {
            reply.code(404).send({ error: "Session not found" });
            return;
          }

          publishSessionUpdated(
            eventHub,
            session,
            executionRuntime.hasActiveExecution(session.id),
          );

          reply.send(
            makeCommandAck(
              true,
              "Checkpoint response forwarded to the active session",
              {
                session_id: session.id,
              },
            ),
          );
          return;
        }

        const session = store.addSessionInput(
          request.params.sessionId,
          `Checkpoint response (approved=${input.approved ?? false}):\n${input.body}`,
        );

        publishSessionUpdated(
          eventHub,
          session,
          executionRuntime.hasActiveExecution(session.id),
        );
        eventHub.publish(
          makeProtocolEvent("session.output", "session", session.id, {
            session_id: session.id,
            chunk: `Checkpoint response recorded:\n${input.body}`,
            sequence: store.getSessionLogs(session.id).length - 1,
          }),
        );

        reply.send(
          makeCommandAck(true, "Checkpoint response recorded", {
            session_id: session.id,
          }),
        );
      } catch (error) {
        reply.code(404).send({
          error:
            error instanceof Error
              ? error.message
              : "Unable to record checkpoint response",
        });
      }
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId/input",
    async (request, reply) => {
      const input = parseBody(reply, sessionInputSchema, request.body);
      if (!input) {
        return;
      }

      try {
        const forwardedTo = executionRuntime.forwardInput(
          request.params.sessionId,
          input.body,
        );

        if (forwardedTo) {
          const session =
            store.updateSessionStatus(
              request.params.sessionId,
              forwardedTo === "agent" ? "running" : "paused_user_control",
              forwardedTo === "agent"
                ? "Live input was forwarded to the active agent session."
                : "Manual terminal input was forwarded to the active project shell.",
            ) ?? store.getSession(request.params.sessionId);
          if (!session) {
            reply.code(404).send({ error: "Session not found" });
            return;
          }

          publishSessionUpdated(
            eventHub,
            session,
            executionRuntime.hasActiveExecution(session.id),
          );

          reply.send(
            makeCommandAck(
              true,
              "Session input forwarded to the active process",
              {
                session_id: session.id,
              },
            ),
          );
          return;
        }

        const session = store.addSessionInput(
          request.params.sessionId,
          input.body,
        );

        publishSessionUpdated(
          eventHub,
          session,
          executionRuntime.hasActiveExecution(session.id),
        );
        eventHub.publish(
          makeProtocolEvent("session.output", "session", session.id, {
            session_id: session.id,
            chunk: `User input recorded:\n${input.body}`,
            sequence: store.getSessionLogs(session.id).length - 1,
          }),
        );

        reply.send(
          makeCommandAck(true, "Session input recorded", {
            session_id: session.id,
          }),
        );
      } catch (error) {
        reply.code(404).send({
          error:
            error instanceof Error
              ? error.message
              : "Unable to record session input",
        });
      }
    },
  );
};
