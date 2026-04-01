import type { FastifyPluginAsync } from "fastify";

import {
  checkpointResponseInputSchema,
  sessionInputSchema
} from "@orchestrator/contracts";

import { makeCommandAck } from "../lib/command-ack.js";
import { makeProtocolEvent, type EventHub } from "../lib/event-hub.js";
import type { ExecutionRuntime } from "../lib/execution-runtime.js";
import { parseBody } from "../lib/http.js";
import type { Store } from "../lib/store.js";

type SessionRouteOptions = {
  eventHub: EventHub;
  executionRuntime: ExecutionRuntime;
  store: Store;
};

export const sessionRoutes: FastifyPluginAsync<SessionRouteOptions> = async (
  app,
  { eventHub, executionRuntime, store }
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
        reply.code(409).send({ error: "Only in-progress tickets support manual terminal takeover" });
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
              `Manual terminal attached in ${session.worktree_path}. Run direct project commands here, then restore the agent when you're ready to continue.`
            ) ?? session;

          eventHub.publish(
            makeProtocolEvent("session.updated", "session", existingSession.id, {
              session: existingSession
            })
          );

          reply.send(
            makeCommandAck(true, "Manual terminal is already attached", {
              ticket_id: ticket.id,
              session_id: session.id
            })
          );
          return;
        }

        const hadActiveExecution = executionRuntime.hasActiveExecution(session.id);
        if (hadActiveExecution) {
          await executionRuntime.stopExecution(
            session.id,
            "Manual terminal takeover requested."
          );
        }

        if (
          session.current_attempt_id &&
          ["queued", "running", "paused_checkpoint", "awaiting_input"].includes(session.status)
        ) {
          store.updateExecutionAttempt(session.current_attempt_id, {
            status: "interrupted",
            end_reason: "manual_terminal_takeover"
          });
        }

        executionRuntime.startManualTerminal({
          sessionId: session.id,
          worktreePath: session.worktree_path,
          attemptId: session.current_attempt_id
        });

        const updatedSession =
          store.updateSessionStatus(
            session.id,
            "paused_user_control",
            `Manual terminal attached in ${session.worktree_path}. Run direct project commands here, then restore the agent when you're ready to continue.`
          ) ?? session;

        eventHub.publish(
          makeProtocolEvent("session.updated", "session", updatedSession.id, {
            session: updatedSession
          })
        );

        reply.send(
          makeCommandAck(true, "Manual terminal takeover started", {
            ticket_id: ticket.id,
            session_id: session.id
          })
        );
      } catch (error) {
        reply.code(409).send({
          error:
            error instanceof Error ? error.message : "Unable to start manual terminal takeover"
        });
      }
    }
  );

  app.post<{ Params: { sessionId: string } }>(
    "/sessions/:sessionId/terminal/restore-agent",
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
        reply.code(409).send({ error: "Only in-progress tickets can restore agent control" });
        return;
      }
      if (session.status !== "paused_user_control") {
        reply.code(409).send({ error: "Session is not in manual terminal mode" });
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
        await executionRuntime.stopManualTerminal(session.id);

        const restoreInstruction =
          "Manual terminal control ended. Review the commands and edits made in the project shell, then continue the ticket from the existing worktree.";
        const resumeResult = store.resumeTicket(ticket.id, restoreInstruction);

        eventHub.publish(
          makeProtocolEvent("ticket.updated", "ticket", String(resumeResult.ticket.id), {
            ticket: resumeResult.ticket
          })
        );
        eventHub.publish(
          makeProtocolEvent("session.updated", "session", resumeResult.session.id, {
            session: resumeResult.session
          })
        );
        resumeResult.logs.forEach((logLine, index) => {
          eventHub.publish(
            makeProtocolEvent("session.output", "session", resumeResult.session.id, {
              session_id: resumeResult.session.id,
              attempt_id: resumeResult.attempt.id,
              sequence:
                store.getSessionLogs(resumeResult.session.id).length -
                resumeResult.logs.length +
                index,
              chunk: logLine
            })
          );
        });

        executionRuntime.startExecution({
          project,
          repository,
          ticket: resumeResult.ticket,
          session: resumeResult.session,
          additionalInstruction: restoreInstruction
        });

        reply.send(
          makeCommandAck(true, "Agent control restored for the session", {
            ticket_id: resumeResult.ticket.id,
            session_id: resumeResult.session.id
          })
        );
      } catch (error) {
        reply.code(409).send({
          error:
            error instanceof Error ? error.message : "Unable to restore agent control"
        });
      }
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
        const forwardedTo = executionRuntime.forwardInput(
          request.params.sessionId,
          input.approved === undefined
            ? input.body
            : `Checkpoint response (approved=${input.approved}): ${input.body}`
        );

        if (forwardedTo) {
          const session =
            store.updateSessionStatus(
              request.params.sessionId,
              forwardedTo === "agent" ? "running" : "paused_user_control",
              forwardedTo === "agent"
                ? "Checkpoint response was forwarded to the active Codex session."
                : "Checkpoint response was forwarded to the active project terminal."
            ) ?? store.getSession(request.params.sessionId);
          if (!session) {
            reply.code(404).send({ error: "Session not found" });
            return;
          }

          eventHub.publish(
            makeProtocolEvent("session.updated", "session", session.id, {
              session
            })
          );

          reply.send(
            makeCommandAck(true, "Checkpoint response forwarded to the active session", {
              session_id: session.id
            })
          );
          return;
        }

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
        const forwardedTo = executionRuntime.forwardInput(request.params.sessionId, input.body);

        if (forwardedTo) {
          const session =
            store.updateSessionStatus(
              request.params.sessionId,
              forwardedTo === "agent" ? "running" : "paused_user_control",
              forwardedTo === "agent"
                ? "Live input was forwarded to the active Codex session."
                : "Manual terminal input was forwarded to the active project shell."
            ) ?? store.getSession(request.params.sessionId);
          if (!session) {
            reply.code(404).send({ error: "Session not found" });
            return;
          }

          eventHub.publish(
            makeProtocolEvent("session.updated", "session", session.id, {
              session
            })
          );

          reply.send(
            makeCommandAck(true, "Session input forwarded to the active process", {
              session_id: session.id
            })
          );
          return;
        }

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
