import type { FastifyPluginAsync } from "fastify";

import {
  confirmDraftInputSchema,
  createDraftInputSchema,
  draftTicketStateSchema,
  refineDraftInputSchema,
  updateDraftInputSchema,
} from "../../../../packages/contracts/src/index.js";
import type {
  DraftTicketState,
  StructuredEvent,
} from "../../../../packages/contracts/src/index.js";

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

function parseDraftSnapshot(value: unknown): DraftTicketState | null {
  const parsed = draftTicketStateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseEventRunId(event: StructuredEvent): string | null {
  return typeof event.payload.run_id === "string" ? event.payload.run_id : null;
}

function parseRevertedRunId(event: StructuredEvent): string | null {
  return typeof event.payload.reverted_run_id === "string"
    ? event.payload.reverted_run_id
    : null;
}

function findLatestRevertableRefineEvent(
  events: StructuredEvent[],
): StructuredEvent | null {
  const latestCompletedRefine =
    events.find((event) => event.event_type === "draft.refine.completed") ??
    null;
  if (!latestCompletedRefine) {
    return null;
  }

  const runId = parseEventRunId(latestCompletedRefine);
  const beforeDraft = parseDraftSnapshot(
    latestCompletedRefine.payload.before_draft,
  );
  if (!runId || !beforeDraft) {
    return null;
  }

  const alreadyReverted = events.some(
    (event) =>
      event.event_type === "draft.refine.reverted" &&
      parseRevertedRunId(event) === runId,
  );
  return alreadyReverted ? null : latestCompletedRefine;
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
    "/drafts/:draftId/refine/revert",
    async (request, reply) => {
      try {
        const draft = store.getDraft(request.params.draftId);
        if (!draft) {
          throw new Error("Draft not found");
        }

        if (executionRuntime.hasActiveDraftRun(draft.id)) {
          throw new Error("Draft analysis already running");
        }

        const refineEvent = findLatestRevertableRefineEvent(
          store.getDraftEvents(draft.id),
        );
        const revertedRunId = refineEvent ? parseEventRunId(refineEvent) : null;
        const beforeDraft = refineEvent
          ? parseDraftSnapshot(refineEvent.payload.before_draft)
          : null;
        if (!refineEvent || !revertedRunId || !beforeDraft) {
          throw new Error("No revertable draft refinement found");
        }

        const restoredDraft = store.updateDraft(draft.id, {
          title_draft: beforeDraft.title_draft,
          description_draft: beforeDraft.description_draft,
          proposed_ticket_type: beforeDraft.proposed_ticket_type,
          proposed_acceptance_criteria:
            beforeDraft.proposed_acceptance_criteria,
          split_proposal_summary: beforeDraft.split_proposal_summary,
          wizard_status: beforeDraft.wizard_status,
        });

        const revertedEvent = store.recordDraftEvent(
          draft.id,
          "draft.refine.reverted",
          {
            operation: "refine",
            status: "reverted",
            reverted_run_id: revertedRunId,
            reverted_event_id: refineEvent.id,
            summary: "Restored the draft to its pre-refine snapshot.",
            before_draft: draft,
            after_draft: restoredDraft,
            result: {
              reverted_run_id: revertedRunId,
              restored_draft: restoredDraft,
            },
          },
        );

        eventHub.publish(
          makeProtocolEvent("draft.updated", "draft", restoredDraft.id, {
            draft: restoredDraft,
          }),
        );
        eventHub.publish(
          makeProtocolEvent(
            "structured_event.created",
            revertedEvent.entity_type,
            revertedEvent.entity_id,
            {
              structured_event: revertedEvent,
            },
          ),
        );

        reply.send(
          makeCommandAck(true, "Draft refinement reverted", {
            draft_id: restoredDraft.id,
            project_id: restoredDraft.project_id,
          }),
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to revert draft refinement";
        reply
          .code(
            message === "Draft analysis already running" ||
              message === "No revertable draft refinement found"
              ? 409
              : 404,
          )
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
