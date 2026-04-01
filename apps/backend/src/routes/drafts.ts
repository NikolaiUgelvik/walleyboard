import type { FastifyPluginAsync } from "fastify";

import {
  confirmDraftInputSchema,
  createDraftInputSchema,
  refineDraftInputSchema
} from "@orchestrator/contracts";

import { makeCommandAck } from "../lib/command-ack.js";
import { type EventHub, makeProtocolEvent } from "../lib/event-hub.js";
import { parseBody } from "../lib/http.js";
import type { Store } from "../lib/store.js";

type DraftRouteOptions = {
  eventHub: EventHub;
  store: Store;
};

export const draftRoutes: FastifyPluginAsync<DraftRouteOptions> = async (
  app,
  { eventHub, store }
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
          draft
        })
      );

      reply.code(201).send(
        makeCommandAck(true, "Draft created", {
          draft_id: draft.id
        })
      );
    } catch (error) {
      reply.code(404).send({
        error: error instanceof Error ? error.message : "Unable to create draft"
      });
    }
  });

  app.post<{ Params: { draftId: string } }>(
    "/drafts/:draftId/delete",
    async (request, reply) => {
      try {
        const draft = store.deleteDraft(request.params.draftId);

        if (!draft) {
          reply.code(404).send({
            error: "Draft not found"
          });
          return;
        }

        eventHub.publish(
          makeProtocolEvent("draft.deleted", "draft", draft.id, {
            draft_id: draft.id,
            project_id: draft.project_id
          })
        );

        reply.send(
          makeCommandAck(true, "Draft deleted", {
            draft_id: draft.id,
            project_id: draft.project_id
          })
        );
      } catch (error) {
        reply.code(404).send({
          error: error instanceof Error ? error.message : "Unable to delete draft"
        });
      }
    }
  );

  app.post<{ Params: { draftId: string } }>(
    "/drafts/:draftId/refine",
    async (request, reply) => {
      const input = parseBody(reply, refineDraftInputSchema, request.body);
      if (!input) {
        return;
      }

      try {
        const draft = store.refineDraft(request.params.draftId, input.instruction);

        eventHub.publish(
          makeProtocolEvent("draft.updated", "draft", draft.id, {
            draft
          })
        );

        reply.send(
          makeCommandAck(true, "Draft refinement updated", {
            draft_id: draft.id
          })
        );
      } catch (error) {
        reply.code(404).send({
          error: error instanceof Error ? error.message : "Unable to refine draft"
        });
      }
    }
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
            ticket_id: ticket.id
          })
        );
        eventHub.publish(
          makeProtocolEvent("ticket.updated", "ticket", String(ticket.id), {
            ticket
          })
        );

        reply.send(
          makeCommandAck(true, "Draft promoted to ready ticket", {
            ticket_id: ticket.id
          })
        );
      } catch (error) {
        reply.code(404).send({
          error: error instanceof Error ? error.message : "Unable to confirm draft"
        });
      }
    }
  );
};
