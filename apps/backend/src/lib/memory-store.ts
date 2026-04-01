import type {
  CreateDraftInput,
  CreateProjectInput,
  DraftTicketState,
  ExecutionAttempt,
  ExecutionSession,
  Project,
  RepositoryConfig,
  RequestedChangeNote,
  ReviewPackage,
  StructuredEvent,
  TicketFrontmatter,
  TicketType
} from "@orchestrator/contracts";
import { nanoid } from "nanoid";

import { nowIso } from "./time.js";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export class MemoryStore {
  readonly #projects = new Map<string, Project>();
  readonly #repositories = new Map<string, RepositoryConfig>();
  readonly #drafts = new Map<string, DraftTicketState>();
  readonly #tickets = new Map<number, TicketFrontmatter>();
  readonly #sessions = new Map<string, ExecutionSession>();
  readonly #attempts = new Map<string, ExecutionAttempt[]>();
  readonly #events = new Map<string, StructuredEvent[]>();
  readonly #reviewPackages = new Map<number, ReviewPackage>();
  readonly #notes = new Map<string, RequestedChangeNote>();
  readonly #sessionLogs = new Map<string, string[]>();
  readonly #projectTicketCounters = new Map<string, number>();

  listProjects(): Project[] {
    return Array.from(this.#projects.values());
  }

  getProject(projectId: string): Project | undefined {
    return this.#projects.get(projectId);
  }

  createProject(input: CreateProjectInput): {
    project: Project;
    repository: RepositoryConfig;
  } {
    const timestamp = nowIso();
    const projectId = nanoid();
    const repositoryId = nanoid();

    const project: Project = {
      id: projectId,
      slug: input.slug,
      name: input.name,
      default_target_branch: input.default_target_branch ?? "main",
      max_concurrent_sessions: 1,
      created_at: timestamp,
      updated_at: timestamp
    };

    const repository: RepositoryConfig = {
      id: repositoryId,
      project_id: projectId,
      name: input.repository.name,
      path: input.repository.path,
      target_branch: input.repository.target_branch ?? project.default_target_branch,
      setup_hook: null,
      cleanup_hook: null,
      validation_profile: [],
      extra_env_allowlist: [],
      created_at: timestamp,
      updated_at: timestamp
    };

    this.#projects.set(project.id, project);
    this.#repositories.set(repository.id, repository);
    this.#projectTicketCounters.set(project.id, 0);

    return { project, repository };
  }

  listProjectRepositories(projectId: string): RepositoryConfig[] {
    return Array.from(this.#repositories.values()).filter(
      (repository) => repository.project_id === projectId
    );
  }

  listProjectDrafts(projectId: string): DraftTicketState[] {
    return Array.from(this.#drafts.values()).filter(
      (draft) => draft.project_id === projectId
    );
  }

  listProjectTickets(projectId: string): TicketFrontmatter[] {
    return Array.from(this.#tickets.values()).filter(
      (ticket) => ticket.project === projectId
    );
  }

  createDraft(input: CreateDraftInput): DraftTicketState {
    const project = this.getProject(input.project_id);
    if (!project) {
      throw new Error("Project not found");
    }

    const timestamp = nowIso();
    const firstRepository = this.listProjectRepositories(project.id)[0];

    const draft: DraftTicketState = {
      id: nanoid(),
      project_id: input.project_id,
      title_draft: input.title,
      description_draft: input.description,
      proposed_repo_id: firstRepository?.id ?? null,
      confirmed_repo_id: null,
      proposed_ticket_type: "feature",
      proposed_acceptance_criteria: [],
      wizard_status: "editing",
      split_proposal_summary: null,
      created_at: timestamp,
      updated_at: timestamp
    };

    this.#drafts.set(draft.id, draft);
    return draft;
  }

  getDraft(draftId: string): DraftTicketState | undefined {
    return this.#drafts.get(draftId);
  }

  refineDraft(draftId: string, instruction?: string): DraftTicketState {
    const draft = this.getDraft(draftId);
    if (!draft) {
      throw new Error("Draft not found");
    }

    const next: DraftTicketState = {
      ...draft,
      proposed_acceptance_criteria:
        draft.proposed_acceptance_criteria.length > 0
          ? draft.proposed_acceptance_criteria
          : [
              `Implement ${draft.title_draft}`,
              instruction
                ? `Account for refinement guidance: ${instruction}`
                : "Preserve the current user-facing workflow"
            ],
      wizard_status: "awaiting_confirmation",
      updated_at: nowIso()
    };

    this.#drafts.set(next.id, next);
    return next;
  }

  confirmDraft(
    draftId: string,
    input: {
      title: string;
      description: string;
      repo_id: string;
      ticket_type: TicketType;
      acceptance_criteria: string[];
      target_branch: string;
    }
  ): TicketFrontmatter {
    const draft = this.getDraft(draftId);
    if (!draft) {
      throw new Error("Draft not found");
    }

    const repository = this.#repositories.get(input.repo_id);
    if (!repository) {
      throw new Error("Repository not found");
    }

    const nextTicketId = (this.#projectTicketCounters.get(draft.project_id) ?? 0) + 1;
    this.#projectTicketCounters.set(draft.project_id, nextTicketId);

    const timestamp = nowIso();
    const ticket: TicketFrontmatter = {
      id: nextTicketId,
      project: draft.project_id,
      repo: repository.id,
      status: "ready",
      title: input.title,
      ticket_type: input.ticket_type,
      working_branch: null,
      target_branch: input.target_branch,
      linked_pr: null,
      session_id: null,
      created_at: timestamp,
      updated_at: timestamp
    };

    this.#tickets.set(ticket.id, ticket);
    this.#drafts.delete(draftId);

    this.recordTicketEvent(ticket.id, "ticket.created", {
      title: input.title,
      acceptance_criteria: input.acceptance_criteria,
      description: input.description
    });

    return ticket;
  }

  getTicket(ticketId: number): TicketFrontmatter | undefined {
    return this.#tickets.get(ticketId);
  }

  getReviewPackage(ticketId: number): ReviewPackage | undefined {
    return this.#reviewPackages.get(ticketId);
  }

  listSessionAttempts(sessionId: string): ExecutionAttempt[] {
    return this.#attempts.get(sessionId) ?? [];
  }

  getSession(sessionId: string): ExecutionSession | undefined {
    return this.#sessions.get(sessionId);
  }

  getSessionLogs(sessionId: string): string[] {
    return this.#sessionLogs.get(sessionId) ?? [];
  }

  getTicketEvents(ticketId: number): StructuredEvent[] {
    return this.#events.get(String(ticketId)) ?? [];
  }

  recordTicketEvent(
    ticketId: number,
    eventType: string,
    payload: Record<string, unknown>
  ): StructuredEvent {
    const event: StructuredEvent = {
      id: nanoid(),
      occurred_at: nowIso(),
      entity_type: "ticket",
      entity_id: String(ticketId),
      event_type: eventType,
      payload
    };

    const currentEvents = this.#events.get(String(ticketId)) ?? [];
    currentEvents.unshift(event);
    this.#events.set(String(ticketId), currentEvents);

    return event;
  }
}
