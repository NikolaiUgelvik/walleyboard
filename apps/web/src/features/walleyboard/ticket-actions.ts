import type {
  DraftTicketState,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";
import type { WalleyBoardMutations } from "./use-walleyboard-mutations.js";

export function createTicketActions(input: {
  isDraftRefinementActive: (draftId: string) => boolean;
  mutations: WalleyBoardMutations;
  selectedProjectId: string | null;
  visibleDrafts: DraftTicketState[];
}): {
  archiveDoneTickets: (ticketsToArchive: TicketFrontmatter[]) => void;
  archiveTicket: (ticket: TicketFrontmatter) => void;
  deleteTicket: (ticket: TicketFrontmatter) => void;
  editReadyTicket: (ticket: TicketFrontmatter) => void;
  moveTicketToReview: (ticket: TicketFrontmatter) => void;
  refineAllUnrefinedDrafts: () => void;
  restartTicketFromScratch: (
    ticket: TicketFrontmatter,
    reason?: string,
  ) => void;
  unrefinedDrafts: DraftTicketState[];
} {
  const {
    isDraftRefinementActive,
    mutations,
    selectedProjectId,
    visibleDrafts,
  } = input;

  const deleteTicket = (ticket: TicketFrontmatter): void => {
    const confirmed = window.confirm(
      `Delete ticket #${ticket.id}? This removes local ticket metadata and will try to clean up its worktree and branch.`,
    );
    if (!confirmed) {
      return;
    }

    mutations.deleteTicketMutation.mutate({
      ticketId: ticket.id,
      sessionId: ticket.session_id,
    });
  };

  const editReadyTicket = (ticket: TicketFrontmatter): void => {
    mutations.editReadyTicketMutation.mutate({ ticket });
  };

  const restartTicketFromScratch = (
    ticket: TicketFrontmatter,
    reason?: string,
  ): void => {
    const confirmed = window.confirm(
      `Restart ticket #${ticket.id} from scratch? This deletes the current worktree and local branch, then recreates them from ${ticket.target_branch}.`,
    );
    if (!confirmed) {
      return;
    }

    mutations.restartTicketMutation.mutate({
      ticketId: ticket.id,
      ...(reason && reason.trim().length > 0 ? { reason } : {}),
    });
  };

  const moveTicketToReview = (ticket: TicketFrontmatter): void => {
    mutations.moveToReviewMutation.mutate({
      ticketId: ticket.id,
    });
  };

  const archiveTicket = (ticket: TicketFrontmatter): void => {
    mutations.archiveTicketMutation.mutate({
      ticketId: ticket.id,
      projectId: ticket.project,
      sessionId: ticket.session_id,
    });
  };

  const archiveDoneTickets = (ticketsToArchive: TicketFrontmatter[]): void => {
    if (selectedProjectId === null || ticketsToArchive.length === 0) {
      return;
    }

    mutations.archiveDoneTicketsMutation.mutate({
      projectId: selectedProjectId,
      tickets: ticketsToArchive,
    });
  };

  const unrefinedDrafts = visibleDrafts.filter(
    (draft) =>
      draft.proposed_acceptance_criteria.length === 0 &&
      !isDraftRefinementActive(draft.id),
  );

  const refineAllUnrefinedDrafts = (): void => {
    for (const draft of unrefinedDrafts) {
      mutations.refineDraftMutation.mutate(draft.id);
    }
  };

  return {
    archiveDoneTickets,
    archiveTicket,
    deleteTicket,
    editReadyTicket,
    moveTicketToReview,
    refineAllUnrefinedDrafts,
    restartTicketFromScratch,
    unrefinedDrafts,
  };
}
