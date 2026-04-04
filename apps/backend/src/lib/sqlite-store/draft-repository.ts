import {
  draftTicketStatesTable,
  projectsTable,
  repositoriesTable,
  structuredEventsTable,
} from "@walleyboard/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  CreateDraftInput,
  DraftTicketState,
} from "../../../../../packages/contracts/src/index.js";

import type { UpdateDraftRecordInput } from "../store.js";
import { nowIso } from "../time.js";
import {
  deriveAcceptanceCriteria,
  hasMeaningfulContent,
  mapDraft,
  normalizeTitle,
  preserveMarkdown,
  preserveMarkdownList,
  requireValue,
  type SqliteStoreContext,
} from "./shared.js";
import { resolveTicketReferences } from "./ticket-references.js";

export class DraftRepository {
  constructor(private readonly context: SqliteStoreContext) {}

  #mapDraftRow(row: Record<string, unknown>): DraftTicketState {
    const title =
      row.title_draft === undefined ? row.titleDraft : row.title_draft;
    const description =
      row.description_draft === undefined
        ? row.descriptionDraft
        : row.description_draft;

    return mapDraft(row, [
      ...resolveTicketReferences(this.context, [
        String(title ?? ""),
        description === null || description === undefined
          ? ""
          : String(description),
      ]),
    ]);
  }

  listProjectDrafts(projectId: string): DraftTicketState[] {
    const rows = this.context.db
      .select()
      .from(draftTicketStatesTable)
      .where(eq(draftTicketStatesTable.projectId, projectId))
      .orderBy(desc(draftTicketStatesTable.updatedAt))
      .all();
    return rows.map((row) => this.#mapDraftRow(row));
  }

  createDraft(input: CreateDraftInput): DraftTicketState {
    const projectExists = this.context.db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.id, input.project_id))
      .get();
    if (!projectExists) {
      throw new Error("Project not found");
    }

    const firstRepository = this.context.db
      .select()
      .from(repositoriesTable)
      .where(eq(repositoriesTable.projectId, input.project_id))
      .orderBy(asc(repositoriesTable.createdAt))
      .get();
    const proposedTicketType =
      input.proposed_ticket_type === undefined
        ? "feature"
        : input.proposed_ticket_type;
    const proposedAcceptanceCriteria = (
      input.proposed_acceptance_criteria ?? []
    ).filter((criterion) => hasMeaningfulContent(criterion));
    const timestamp = nowIso();
    const draftId = nanoid();
    const artifactScopeId = input.artifact_scope_id ?? nanoid();

    this.context.db
      .insert(draftTicketStatesTable)
      .values({
        id: draftId,
        projectId: input.project_id,
        artifactScopeId,
        titleDraft: normalizeTitle(input.title),
        descriptionDraft: preserveMarkdown(input.description),
        proposedRepoId: firstRepository?.id ?? null,
        confirmedRepoId: null,
        proposedTicketType,
        proposedAcceptanceCriteria,
        wizardStatus: "editing",
        splitProposalSummary: null,
        sourceTicketId: null,
        targetBranch: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

    return requireValue(
      this.getDraft(draftId),
      "Draft not found after creation",
    );
  }

  getDraft(draftId: string): DraftTicketState | undefined {
    const row = this.context.db
      .select()
      .from(draftTicketStatesTable)
      .where(eq(draftTicketStatesTable.id, draftId))
      .get();
    return row ? this.#mapDraftRow(row) : undefined;
  }

  updateDraft(
    draftId: string,
    input: UpdateDraftRecordInput,
  ): DraftTicketState {
    const draft = this.getDraft(draftId);
    if (!draft) {
      throw new Error("Draft not found");
    }

    const title = normalizeTitle(input.title_draft ?? draft.title_draft);
    const description = preserveMarkdown(
      input.description_draft ?? draft.description_draft,
    );
    const proposedTicketType =
      input.proposed_ticket_type === undefined
        ? draft.proposed_ticket_type
        : input.proposed_ticket_type;
    const proposedAcceptanceCriteria =
      input.proposed_acceptance_criteria === undefined
        ? draft.proposed_acceptance_criteria
        : preserveMarkdownList(input.proposed_acceptance_criteria);
    const splitProposalSummary =
      input.split_proposal_summary === undefined
        ? draft.split_proposal_summary
        : input.split_proposal_summary;
    const wizardStatus = input.wizard_status ?? draft.wizard_status;
    const timestamp = nowIso();

    this.context.db
      .update(draftTicketStatesTable)
      .set({
        titleDraft: title,
        descriptionDraft: description,
        proposedTicketType,
        proposedAcceptanceCriteria,
        wizardStatus,
        splitProposalSummary,
        updatedAt: timestamp,
      })
      .where(eq(draftTicketStatesTable.id, draftId))
      .run();

    return requireValue(this.getDraft(draftId), "Draft not found after update");
  }

  deleteDraft(draftId: string): DraftTicketState | undefined {
    const draft = this.getDraft(draftId);
    if (!draft) {
      return undefined;
    }

    this.context.db
      .delete(structuredEventsTable)
      .where(
        and(
          eq(structuredEventsTable.entityType, "draft"),
          eq(structuredEventsTable.entityId, draftId),
        ),
      )
      .run();
    this.context.db
      .delete(draftTicketStatesTable)
      .where(eq(draftTicketStatesTable.id, draftId))
      .run();
    return draft;
  }

  refineDraft(draftId: string, instruction?: string): DraftTicketState {
    const draft = this.getDraft(draftId);
    if (!draft) {
      throw new Error("Draft not found");
    }

    const title = normalizeTitle(draft.title_draft);
    const description = preserveMarkdown(draft.description_draft);
    const acceptanceCriteria = deriveAcceptanceCriteria(
      title,
      description,
      instruction,
    );
    const timestamp = nowIso();

    this.context.db
      .update(draftTicketStatesTable)
      .set({
        titleDraft: title,
        descriptionDraft: description,
        proposedAcceptanceCriteria: acceptanceCriteria,
        wizardStatus: "awaiting_confirmation",
        updatedAt: timestamp,
      })
      .where(eq(draftTicketStatesTable.id, draftId))
      .run();

    return requireValue(
      this.getDraft(draftId),
      "Draft not found after refinement",
    );
  }
}
