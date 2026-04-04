import { sql } from "drizzle-orm";
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
  stringifyJson,
} from "./shared.js";
import { resolveTicketReferences } from "./ticket-references.js";

export class DraftRepository {
  constructor(private readonly context: SqliteStoreContext) {}

  #mapDraftRow(row: Record<string, unknown>): DraftTicketState {
    return mapDraft(row, [
      ...resolveTicketReferences(this.context, [
        String(row.title_draft ?? ""),
        row.description_draft === null ? "" : String(row.description_draft),
      ]),
    ]);
  }

  listProjectDrafts(projectId: string): DraftTicketState[] {
    const rows = this.context.db.all<Record<string, unknown>>(sql`
      SELECT *
      FROM draft_ticket_states
      WHERE project_id = ${projectId}
      ORDER BY updated_at DESC
    `);
    return rows.map((row) => this.#mapDraftRow(row));
  }

  createDraft(input: CreateDraftInput): DraftTicketState {
    const projectExists = this.context.db.get<{ id: string }>(sql`
      SELECT id
      FROM projects
      WHERE id = ${input.project_id}
    `);
    if (!projectExists) {
      throw new Error("Project not found");
    }

    const firstRepository = this.context.db.get<Record<string, unknown>>(sql`
      SELECT *
      FROM repositories
      WHERE project_id = ${input.project_id}
      ORDER BY created_at ASC
      LIMIT 1
    `);
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

    this.context.db.run(sql`
      INSERT INTO draft_ticket_states (
        id, project_id, artifact_scope_id, title_draft, description_draft, proposed_repo_id, confirmed_repo_id,
        proposed_ticket_type, proposed_acceptance_criteria, wizard_status, split_proposal_summary,
        source_ticket_id, target_branch, created_at, updated_at
      ) VALUES (
        ${draftId},
        ${input.project_id},
        ${artifactScopeId},
        ${normalizeTitle(input.title)},
        ${preserveMarkdown(input.description)},
        ${firstRepository ? String(firstRepository.id) : null},
        ${null},
        ${proposedTicketType},
        ${stringifyJson(proposedAcceptanceCriteria)},
        ${"editing"},
        ${null},
        ${null},
        ${null},
        ${timestamp},
        ${timestamp}
      )
    `);

    return requireValue(
      this.getDraft(draftId),
      "Draft not found after creation",
    );
  }

  getDraft(draftId: string): DraftTicketState | undefined {
    const row = this.context.db.get<Record<string, unknown>>(sql`
      SELECT *
      FROM draft_ticket_states
      WHERE id = ${draftId}
    `);
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

    this.context.db.run(sql`
      UPDATE draft_ticket_states
      SET title_draft = ${title},
          description_draft = ${description},
          proposed_ticket_type = ${proposedTicketType},
          proposed_acceptance_criteria = ${stringifyJson(
            proposedAcceptanceCriteria,
          )},
          wizard_status = ${wizardStatus},
          split_proposal_summary = ${splitProposalSummary},
          updated_at = ${timestamp}
      WHERE id = ${draftId}
    `);

    return requireValue(this.getDraft(draftId), "Draft not found after update");
  }

  deleteDraft(draftId: string): DraftTicketState | undefined {
    const draft = this.getDraft(draftId);
    if (!draft) {
      return undefined;
    }

    this.context.db.run(sql`
      DELETE FROM structured_events
      WHERE entity_type = 'draft' AND entity_id = ${draftId}
    `);
    this.context.db.run(sql`
      DELETE FROM draft_ticket_states
      WHERE id = ${draftId}
    `);
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

    this.context.db.run(sql`
      UPDATE draft_ticket_states
      SET title_draft = ${title},
          description_draft = ${description},
          proposed_acceptance_criteria = ${stringifyJson(acceptanceCriteria)},
          wizard_status = ${"awaiting_confirmation"},
          updated_at = ${timestamp}
      WHERE id = ${draftId}
    `);

    return requireValue(
      this.getDraft(draftId),
      "Draft not found after refinement",
    );
  }
}
