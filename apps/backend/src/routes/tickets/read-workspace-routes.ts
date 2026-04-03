import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { FastifyInstance } from "fastify";

import type {
  ReviewPackage,
  TicketFrontmatter,
  TicketWorkspaceDiff,
} from "../../../../../packages/contracts/src/index.js";
import { parsePositiveInt } from "../../lib/http.js";
import {
  commandRouteRateLimit,
  repositoryRouteRateLimit,
} from "../../lib/rate-limit.js";
import type { TicketRouteDependencies } from "./shared.js";

type TerminalInputMessage = {
  type: "terminal.input";
  data: string;
};

type TerminalResizeMessage = {
  type: "terminal.resize";
  cols: number;
  rows: number;
};

function isTerminalInputMessage(value: unknown): value is TerminalInputMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return record.type === "terminal.input" && typeof record.data === "string";
}

function isTerminalResizeMessage(
  value: unknown,
): value is TerminalResizeMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    record.type === "terminal.resize" &&
    typeof record.cols === "number" &&
    Number.isFinite(record.cols) &&
    record.cols > 0 &&
    typeof record.rows === "number" &&
    Number.isFinite(record.rows) &&
    record.rows > 0
  );
}

function readPersistedWorkspaceDiff(
  ticket: TicketFrontmatter,
  reviewPackage: ReviewPackage,
): TicketWorkspaceDiff {
  if (!isAbsolute(reviewPackage.diff_ref)) {
    throw new Error("Stored review diff artifact path is invalid");
  }

  if (!existsSync(reviewPackage.diff_ref)) {
    throw new Error("Stored review diff artifact is no longer available");
  }

  return {
    ticket_id: ticket.id,
    source: "review_artifact" as const,
    target_branch: ticket.target_branch,
    working_branch: ticket.working_branch,
    worktree_path: null,
    artifact_path: reviewPackage.diff_ref,
    patch: readFileSync(reviewPackage.diff_ref, "utf8"),
    generated_at: reviewPackage.created_at,
  };
}

export function registerTicketReadWorkspaceRoutes(
  app: FastifyInstance,
  { executionRuntime, store, ticketWorkspaceService }: TicketRouteDependencies,
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
    "/tickets/:ticketId/review-run",
    async (request, reply) => {
      const ticketId = parsePositiveInt(request.params.ticketId);
      if (!ticketId) {
        reply.code(400).send({ error: "Invalid ticket id" });
        return;
      }

      const reviewRun = store.getLatestReviewRun(ticketId);
      if (!reviewRun) {
        reply.code(404).send({ error: "Review run not found" });
        return;
      }

      return { review_run: reviewRun };
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
    { preHandler: repositoryRouteRateLimit(app) },
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

      if (ticket.session_id && ticket.working_branch) {
        const session = store.getSession(ticket.session_id);
        if (session?.worktree_path) {
          return {
            workspace_diff: ticketWorkspaceService.getDiff({
              targetBranch: ticket.target_branch,
              ticketId: ticket.id,
              workingBranch: ticket.working_branch,
              worktreePath: session.worktree_path,
            }),
          };
        }
      }

      const reviewPackage = store.getReviewPackage(ticketId);
      if (!reviewPackage) {
        reply.code(409).send({ error: "Ticket has no diff available yet" });
        return;
      }

      try {
        return {
          workspace_diff: readPersistedWorkspaceDiff(ticket, reviewPackage),
        };
      } catch (error) {
        reply.code(409).send({
          error:
            error instanceof Error
              ? error.message
              : "Unable to load the stored review diff",
        });
      }
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
    "/tickets/:ticketId/workspace/preview/stop",
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

      await ticketWorkspaceService.stopPreviewAndWait(ticket.id);
      reply.send({
        preview: ticketWorkspaceService.getPreview(ticket.id),
      });
    },
  );

  app.get<{ Params: { ticketId: string } }>(
    "/tickets/:ticketId/workspace/terminal",
    { websocket: true },
    (socket, request) => {
      const ticketId = parsePositiveInt(request.params.ticketId);
      if (!ticketId) {
        socket.send(
          JSON.stringify({
            type: "terminal.error",
            message: "Invalid ticket id",
          }),
        );
        socket.close();
        return;
      }

      const ticket = store.getTicket(ticketId);
      if (!ticket) {
        socket.send(
          JSON.stringify({
            type: "terminal.error",
            message: "Ticket not found",
          }),
        );
        socket.close();
        return;
      }
      if (!ticket.session_id) {
        socket.send(
          JSON.stringify({
            type: "terminal.error",
            message: "Ticket has no prepared workspace yet",
          }),
        );
        socket.close();
        return;
      }

      const session = store.getSession(ticket.session_id);
      if (!session?.worktree_path) {
        socket.send(
          JSON.stringify({
            type: "terminal.error",
            message: "Session has no prepared worktree",
          }),
        );
        socket.close();
        return;
      }

      let terminal: ReturnType<typeof executionRuntime.startWorkspaceTerminal>;
      try {
        terminal = executionRuntime.startWorkspaceTerminal({
          sessionId: session.id,
          worktreePath: session.worktree_path,
        });
      } catch (error) {
        socket.send(
          JSON.stringify({
            type: "terminal.error",
            message:
              error instanceof Error
                ? error.message
                : "Workspace terminal failed to start",
          }),
        );
        socket.close();
        return;
      }

      terminal.onData((data) => {
        socket.send(
          JSON.stringify({
            type: "terminal.output",
            data,
          }),
        );
      });

      terminal.onExit(({ exitCode, signal }) => {
        socket.send(
          JSON.stringify({
            type: "terminal.exit",
            exit_code: exitCode,
            signal,
          }),
        );
        socket.close();
      });

      socket.on("message", (rawMessage: unknown) => {
        try {
          const message = JSON.parse(String(rawMessage)) as unknown;

          if (isTerminalInputMessage(message)) {
            if (message.data.length > 0) {
              terminal.write(message.data);
            }
            return;
          }

          if (isTerminalResizeMessage(message)) {
            terminal.resize(
              Math.max(1, Math.floor(message.cols)),
              Math.max(1, Math.floor(message.rows)),
            );
          }
        } catch {
          socket.send(
            JSON.stringify({
              type: "terminal.error",
              message: "Unable to parse terminal message",
            }),
          );
        }
      });

      socket.on("close", () => {
        terminal.kill();
      });
    },
  );
}
