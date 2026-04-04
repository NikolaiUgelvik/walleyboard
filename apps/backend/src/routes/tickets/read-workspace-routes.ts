import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { FastifyInstance } from "fastify";

import type {
  ReviewPackage,
  TicketFrontmatter,
  TicketWorkspaceDiff,
} from "../../../../../packages/contracts/src/index.js";
import { resolveTargetBranch } from "../../lib/execution-runtime/helpers.js";
import { parsePositiveInt } from "../../lib/http.js";
import {
  commandRouteRateLimit,
  repositoryRouteRateLimit,
} from "../../lib/rate-limit.js";
import type { SessionPersistence, TicketPersistence } from "../../lib/store.js";
import {
  attachWorkspaceTerminalSocket,
  type TerminalSocket,
} from "../workspace-terminal-socket.js";
import type { TicketRouteDependencies } from "./shared.js";

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
    "/tickets/:ticketId/review-run",
    async (request, reply) => {
      const ticketId = parsePositiveInt(request.params.ticketId);
      if (!ticketId) {
        reply.code(400).send({ error: "Invalid ticket id" });
        return;
      }

      const reviewRun = store.getLatestReviewRun(ticketId);
      return { review_run: reviewRun ?? null };
    },
  );

  app.get<{ Params: { ticketId: string } }>(
    "/tickets/:ticketId/review-runs",
    async (request, reply) => {
      const ticketId = parsePositiveInt(request.params.ticketId);
      if (!ticketId) {
        reply.code(400).send({ error: "Invalid ticket id" });
        return;
      }

      return {
        review_runs: store.listReviewRuns(ticketId),
      };
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

      const sendPersistedWorkspaceDiff = () => {
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
      };

      if (ticket.status === "done") {
        return sendPersistedWorkspaceDiff();
      }

      if (ticket.session_id && ticket.working_branch) {
        const session = store.getSession(ticket.session_id);
        if (session?.worktree_path) {
          const repository = store.getRepository(ticket.repo);
          const effectiveTargetBranch = repository
            ? resolveTargetBranch(repository, ticket.target_branch)
            : ticket.target_branch;
          return {
            workspace_diff: ticketWorkspaceService.getDiff({
              targetBranch: effectiveTargetBranch,
              ticketId: ticket.id,
              workingBranch: ticket.working_branch,
              worktreePath: session.worktree_path,
            }),
          };
        }
      }

      return sendPersistedWorkspaceDiff();
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
}

function sendSocketError(socket: TerminalSocket, message: string): void {
  socket.send(
    JSON.stringify({
      type: "terminal.error",
      message,
    }),
  );
  socket.close();
}

export function handleTicketWorkspaceTerminalConnection(
  socket: TerminalSocket,
  rawTicketId: string,
  dependencies: {
    executionRuntime: TicketRouteDependencies["executionRuntime"];
    store: Pick<SessionPersistence, "getSession"> &
      Pick<TicketPersistence, "getTicket">;
  },
): void {
  const ticketId = parsePositiveInt(rawTicketId);
  if (!ticketId) {
    sendSocketError(socket, "Invalid ticket id");
    return;
  }

  const ticket = dependencies.store.getTicket(ticketId);
  if (!ticket) {
    sendSocketError(socket, "Ticket not found");
    return;
  }
  if (!ticket.session_id) {
    sendSocketError(socket, "Ticket has no prepared workspace yet");
    return;
  }

  const session = dependencies.store.getSession(ticket.session_id);
  if (!session?.worktree_path) {
    sendSocketError(socket, "Session has no prepared worktree");
    return;
  }

  attachWorkspaceTerminalSocket(socket, {
    sessionId: session.id,
    startWorkspaceTerminal: ({ sessionId, worktreePath }) =>
      dependencies.executionRuntime.startWorkspaceTerminal({
        sessionId,
        worktreePath,
      }),
    worktreePath: session.worktree_path,
  });
}
