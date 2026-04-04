import { draftTicketStatesTable, ticketsTable } from "@walleyboard/db";
import { eq } from "drizzle-orm";
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
    const insertTicket = this.context.db
      .insert(ticketsTable)
      .values({
        ...(reopenedTicketId === null ? {} : { id: reopenedTicketId }),
        projectId: draft.project_id,
        repoId: input.repo_id,
        artifactScopeId: draft.artifact_scope_id,
        status: "ready",
        title: normalizeTitle(input.title),
        description: preserveMarkdown(input.description),
        ticketType: input.ticket_type,
        acceptanceCriteria: preserveMarkdownList(input.acceptance_criteria),
        workingBranch: null,
        targetBranch,
        linkedPr: null,
        sessionId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    const ticketId = reopenedTicketId ?? Number(insertTicket.lastInsertRowid);

    this.context.db
      .delete(draftTicketStatesTable)
      .where(eq(draftTicketStatesTable.id, draftId))
      .run();

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
      .insert(draftTicketStatesTable)
      .values({
        id: draftId,
        projectId: ticket.project,
        artifactScopeId: ticket.artifact_scope_id,
        titleDraft: normalizeTitle(ticket.title),
        descriptionDraft: preserveMarkdown(ticket.description),
        proposedRepoId: ticket.repo,
        confirmedRepoId: ticket.repo,
        proposedTicketType: ticket.ticket_type,
        proposedAcceptanceCriteria: preserveMarkdownList(
          ticket.acceptance_criteria,
        ),
        wizardStatus: "editing",
        splitProposalSummary: null,
        sourceTicketId: ticket.id,
        targetBranch: ticket.target_branch,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

    this.tickets.deleteTicket(ticketId);

    return requireValue(
      this.drafts.getDraft(draftId),
      "Draft not found after reopening ready ticket",
    );
  }
}
