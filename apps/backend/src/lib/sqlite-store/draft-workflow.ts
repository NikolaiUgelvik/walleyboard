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

    const repository = this.projects.getRepository(input.repo_id);
    if (!repository) {
      throw new Error("Repository not found");
    }

    const timestamp = nowIso();

    const insertTicket = this.context.db
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
        input.target_branch,
        null,
        null,
        timestamp,
        timestamp,
      );
    const ticketId = Number(insertTicket.lastInsertRowid);

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
}
