import type { FastifyPluginAsync } from "fastify";

import {
  confirmDraftInputSchema,
  createDraftInputSchema,
  refineDraftInputSchema,
  updateDraftInputSchema,
} from "@orchestrator/contracts";

import { makeCommandAck } from "../lib/command-ack.js";
import { type EventHub, makeProtocolEvent } from "../lib/event-hub.js";
import type { ExecutionRuntime } from "../lib/execution-runtime.js";
import { parseBody } from "../lib/http.js";
import type { Store } from "../lib/store.js";

type DraftRouteOptions = {
  eventHub: EventHub;
  executionRuntime: ExecutionRuntime;
  store: Store;
};

function resolveDraftContext(store: Store, draftId: string) {
  const draft = store.getDraft(draftId);
  if (!draft) {
    throw new Error("Draft not found");
  }

  const project = store.getProject(draft.project_id);
  if (!project) {
    throw new Error("Project not found");
  }

  const repositories = store.listProjectRepositories(project.id);
  const repositoryId =
    draft.confirmed_repo_id ?? draft.proposed_repo_id ?? repositories[0]?.id;
  const repository = repositoryId
    ? store.getRepository(repositoryId)
    : undefined;
  if (!repository) {
    throw new Error("Repository not found");
  }

  return {
    draft,
    project,
    repository,
  };
}

export const draftRoutes: FastifyPluginAsync<DraftRouteOptions> = async (
  app,
  { eventHub, executionRuntime, store },
) => {
  app.post("/drafts", async (request, reply) => {
    const input = parseBody(reply, createDraftInputSchema, request.body);
    if (!input) {
      return;
    }

    try {
      const draft = store.createDraft(input);

      eventHub.publish(
        makeProtocolEvent("draft.updated", "draft", draft.id, {
          draft,
        }),
      );

      reply.code(201).send(
        makeCommandAck(true, "Draft created", {
          draft_id: draft.id,
        }),
      );
    } catch (error) {
      reply.code(404).send({
        error:
          error instanceof Error ? error.message : "Unable to create draft",
      });
    }
  });

  app.get<{ Params: { draftId: string } }>(
    "/drafts/:draftId/events",
    async (request, reply) => {
      const draft = store.getDraft(request.params.draftId);
      if (!draft) {
        reply.code(404).send({
          error: "Draft not found",
        });
        return;
      }

      reply.send({
        events: store.getDraftEvents(request.params.draftId),
        active_run: executionRuntime.hasActiveDraftRun(request.params.draftId),
      });
    },
  );

  app.patch<{ Params: { draftId: string } }>(
    "/drafts/:draftId",
    async (request, reply) => {
      const input = parseBody(reply, updateDraftInputSchema, request.body);
      if (!input) {
        return;
      }

      try {
        const draft = store.updateDraft(request.params.draftId, input);

        eventHub.publish(
          makeProtocolEvent("draft.updated", "draft", draft.id, {
            draft,
          }),
        );

        reply.send(
          makeCommandAck(true, "Draft updated", {
            draft_id: draft.id,
            project_id: draft.project_id,
          }),
        );
      } catch (error) {
        reply.code(404).send({
          error:
            error instanceof Error ? error.message : "Unable to update draft",
        });
      }
    },
  );

  app.post<{ Params: { draftId: string } }>(
    "/drafts/:draftId/delete",
    async (request, reply) => {
      try {
        const draft = store.deleteDraft(request.params.draftId);

        if (!draft) {
          reply.code(404).send({
            error: "Draft not found",
          });
          return;
        }

        eventHub.publish(
          makeProtocolEvent("draft.deleted", "draft", draft.id, {
            draft_id: draft.id,
            project_id: draft.project_id,
          }),
        );

        reply.send(
          makeCommandAck(true, "Draft deleted", {
            draft_id: draft.id,
            project_id: draft.project_id,
          }),
        );
      } catch (error) {
        reply.code(404).send({
          error:
            error instanceof Error ? error.message : "Unable to delete draft",
        });
      }
    },
  );

  app.post<{ Params: { draftId: string } }>(
    "/drafts/:draftId/refine",
    async (request, reply) => {
      const input = parseBody(reply, refineDraftInputSchema, request.body);
      if (!input) {
        return;
      }

      try {
        const { draft, project, repository } = resolveDraftContext(
          store,
          request.params.draftId,
        );
        if (executionRuntime.hasActiveDraftRun(draft.id)) {
          reply.code(409).send({
            error: "Draft analysis already running",
          });
          return;
        }

        executionRuntime.runDraftRefinement({
          draft,
          project,
          repository,
          instruction: input.instruction,
        });

        reply.send(
          makeCommandAck(true, "Draft refinement started", {
            draft_id: draft.id,
            project_id: project.id,
            repo_id: repository.id,
          }),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to refine draft";
        reply
          .code(message === "Draft analysis already running" ? 409 : 404)
          .send({
            error: message,
          });
      }
    },
  );

  app.post<{ Params: { draftId: string } }>(
    "/drafts/:draftId/questions",
    async (request, reply) => {
      const input = parseBody(reply, refineDraftInputSchema, request.body);
      if (!input) {
        return;
      }

      try {
        const { draft, project, repository } = resolveDraftContext(
          store,
          request.params.draftId,
        );
        if (executionRuntime.hasActiveDraftRun(draft.id)) {
          reply.code(409).send({
            error: "Draft analysis already running",
          });
          return;
        }

        executionRuntime.runDraftFeasibility({
          draft,
          project,
          repository,
          instruction: input.instruction,
        });

        reply.send(
          makeCommandAck(true, "Draft feasibility check started", {
            draft_id: draft.id,
            project_id: project.id,
            repo_id: repository.id,
          }),
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to start draft feasibility check";
        reply
          .code(message === "Draft analysis already running" ? 409 : 404)
          .send({
            error: message,
          });
      }
    },
  );

  app.post<{ Params: { draftId: string } }>(
    "/drafts/:draftId/confirm",
    async (request, reply) => {
      const input = parseBody(reply, confirmDraftInputSchema, request.body);
      if (!input) {
        return;
      }

      try {
        const ticket = store.confirmDraft(request.params.draftId, input);

        eventHub.publish(
          makeProtocolEvent("draft.ready", "draft", request.params.draftId, {
            draft_id: request.params.draftId,
            ticket_id: ticket.id,
          }),
        );
        eventHub.publish(
          makeProtocolEvent("ticket.updated", "ticket", String(ticket.id), {
            ticket,
          }),
        );

        reply.send(
          makeCommandAck(true, "Draft promoted to ready ticket", {
            ticket_id: ticket.id,
          }),
        );
      } catch (error) {
        reply.code(404).send({
          error:
            error instanceof Error ? error.message : "Unable to confirm draft",
        });
      }
    },
  );
};
