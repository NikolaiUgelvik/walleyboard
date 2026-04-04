import { projectsTable } from "@walleyboard/db";
import { eq } from "drizzle-orm";
import type { Project } from "../../../../../packages/contracts/src/index.js";

import type { DraftRepository } from "./draft-repository.js";
import type { ProjectRepository } from "./project-repository.js";
import type { SqliteStoreContext } from "./shared.js";
import type { TicketRepository } from "./ticket-repository.js";

export class ProjectWorkflowService {
  constructor(
    private readonly context: SqliteStoreContext,
    private readonly projects: ProjectRepository,
    private readonly drafts: DraftRepository,
    private readonly tickets: TicketRepository,
  ) {}

  deleteProject(projectId: string): Project | undefined {
    const project = this.projects.getProject(projectId);
    if (!project) {
      return undefined;
    }

    for (const draft of this.drafts.listProjectDrafts(projectId)) {
      this.drafts.deleteDraft(draft.id);
    }

    for (const ticket of this.tickets.listProjectTickets(projectId, {
      includeArchived: true,
    })) {
      this.tickets.deleteTicket(ticket.id);
    }

    this.context.db
      .delete(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .run();

    return project;
  }
}
