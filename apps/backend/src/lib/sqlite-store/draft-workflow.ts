import { nanoid } from "nanoid";
import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";

import type { ConfirmDraftInput } from "../store.js";
import { nowIso } from "../time.js";
import type { DraftRepository } from "./draft-repository.js";
import type { EventRepository } from "./event-repository.js";
import type { ProjectRepository } from "./project-repository.js";
import {
  normalizeTitle,
  preserveMarkdown,
  preserveMarkdownList,
  requireValue,
  type SqliteStoreContext,
  stringifyJson,
} from "./shared.js";
import { validateTicketReferences } from "./ticket-references.js";
import type { TicketRepository } from "./ticket-repository.js";

export class DraftWorkflowService {
  constructor(
    private readonly context: SqliteStoreContext,
    private readonly drafts: DraftRepository,
    private readonly projects: ProjectRepository,
    private readonly tickets: TicketRepository,
    private readonly events: EventRepository,
  ) {}

  confirmDraft(draftId: string, input: ConfirmDraftInput): TicketFrontmatter {
    const draft = this.drafts.getDraft(draftId);
    if (!draft) {
      throw new Error("Draft not found");
    }

    validateTicketReferences(this.context, [input.title, input.description]);

    const repository = this.projects.getRepository(input.repo_id);
    if (!repository) {
      throw new Error("Repository not found");
    }

    const timestamp = nowIso();
    const targetBranch = draft.target_branch ?? input.target_branch;
    const reopenedTicketId = draft.source_ticket_id ?? null;
    const insertTicket =
      reopenedTicketId === null
        ? this.context.db
            .prepare(
              `
                INSERT INTO tickets (
                  project_id, repo_id, artifact_scope_id, status, title, description, ticket_type,
                  acceptance_criteria, working_branch, target_branch, linked_pr,
                  session_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `,
            )
            .run(
              draft.project_id,
              input.repo_id,
              draft.artifact_scope_id,
              "ready",
              normalizeTitle(input.title),
              preserveMarkdown(input.description),
              input.ticket_type,
              stringifyJson(preserveMarkdownList(input.acceptance_criteria)),
              null,
              targetBranch,
              null,
              null,
              timestamp,
              timestamp,
            )
        : this.context.db
            .prepare(
              `
                INSERT INTO tickets (
                  id, project_id, repo_id, artifact_scope_id, status, title, description, ticket_type,
                  acceptance_criteria, working_branch, target_branch, linked_pr,
                  session_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `,
            )
            .run(
              reopenedTicketId,
              draft.project_id,
              input.repo_id,
              draft.artifact_scope_id,
              "ready",
              normalizeTitle(input.title),
              preserveMarkdown(input.description),
              input.ticket_type,
              stringifyJson(preserveMarkdownList(input.acceptance_criteria)),
              null,
              targetBranch,
              null,
              null,
              timestamp,
              timestamp,
            );
    const ticketId = reopenedTicketId ?? Number(insertTicket.lastInsertRowid);

    this.context.db
      .prepare("DELETE FROM draft_ticket_states WHERE id = ?")
      .run(draftId);

    this.events.recordTicketEvent(ticketId, "ticket.created", {
      title: normalizeTitle(input.title),
      description: preserveMarkdown(input.description),
      acceptance_criteria: preserveMarkdownList(input.acceptance_criteria),
    });

    return requireValue(
      this.tickets.getTicket(ticketId),
      "Ticket not found after creation",
    );
  }

  editReadyTicket(ticketId: number) {
    const ticket = this.tickets.getTicket(ticketId);
    if (!ticket) {
      throw new Error("Ticket not found");
    }

    if (ticket.status !== "ready") {
      throw new Error("Only ready tickets can be edited");
    }

    const timestamp = nowIso();
    const draftId = nanoid();

    this.context.db
      .prepare(
        `
          INSERT INTO draft_ticket_states (
            id, project_id, artifact_scope_id, title_draft, description_draft, proposed_repo_id, confirmed_repo_id,
            proposed_ticket_type, proposed_acceptance_criteria, wizard_status, split_proposal_summary,
            source_ticket_id, target_branch, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        draftId,
        ticket.project,
        ticket.artifact_scope_id,
        normalizeTitle(ticket.title),
        preserveMarkdown(ticket.description),
        ticket.repo,
        ticket.repo,
        ticket.ticket_type,
        stringifyJson(preserveMarkdownList(ticket.acceptance_criteria)),
        "editing",
        null,
        ticket.id,
        ticket.target_branch,
        timestamp,
        timestamp,
      );

    this.tickets.deleteTicket(ticketId);

    return requireValue(
      this.drafts.getDraft(draftId),
      "Draft not found after reopening ready ticket",
    );
  }
}
