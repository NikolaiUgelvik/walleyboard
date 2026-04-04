import type { Dispatch, SetStateAction } from "react";

import type {
  ExecutionSession,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";
import type {
  InspectorState,
  WorkspaceModalKind,
  WorkspaceTerminalContext,
} from "./shared-types.js";
import { focusElementById } from "./shared-utils.js";

export function createWorkspaceModalControls(input: {
  initializeNewDraftEditor: (projectId: string | null) => void;
  selectedProjectId: string | null;
  session: ExecutionSession | null;
  sessionById: Map<string, ExecutionSession>;
  setInspectorState: Dispatch<SetStateAction<InspectorState>>;
  setWorkspaceModal: Dispatch<SetStateAction<WorkspaceModalKind | null>>;
  setWorkspaceTerminalContext: Dispatch<
    SetStateAction<WorkspaceTerminalContext | null>
  >;
  setWorkspaceTicket: Dispatch<SetStateAction<TicketFrontmatter | null>>;
}) {
  const openNewDraft = (): void => {
    input.initializeNewDraftEditor(input.selectedProjectId);
    input.setWorkspaceModal(null);
    input.setWorkspaceTicket(null);
    input.setWorkspaceTerminalContext(null);
    input.setInspectorState({ kind: "new_draft" });
    window.requestAnimationFrame(() => focusElementById("draft-title"));
  };

  const hideInspector = (): void => {
    input.setWorkspaceModal(null);
    input.setWorkspaceTicket(null);
    input.setWorkspaceTerminalContext(null);
    input.setInspectorState({ kind: "hidden" });
  };

  const openTicketSession = (ticket: TicketFrontmatter): void => {
    if (!ticket.session_id) {
      return;
    }

    input.setInspectorState({ kind: "session", sessionId: ticket.session_id });
  };

  const openTicketWorkspaceModal = (
    ticket: TicketFrontmatter,
    modal: WorkspaceModalKind,
  ): void => {
    if (modal === "diff") {
      input.setWorkspaceTicket(ticket);
      input.setWorkspaceTerminalContext(null);
      input.setWorkspaceModal("diff");
      if (ticket.session_id) {
        openTicketSession(ticket);
      }
      return;
    }

    if (!ticket.session_id) {
      return;
    }

    input.setWorkspaceTerminalContext(
      modal === "terminal"
        ? {
            kind: "single",
            id: `ticket-${ticket.id}`,
            label: `Ticket #${ticket.id}`,
            socketPath: `/tickets/${ticket.id}/workspace/terminal`,
            surfaceLabel: "ticket",
            worktreePath:
              input.sessionById.get(ticket.session_id)?.worktree_path ??
              (input.session?.id === ticket.session_id
                ? input.session.worktree_path
                : null),
          }
        : null,
    );
    input.setWorkspaceTicket(null);
    openTicketSession(ticket);
    input.setWorkspaceModal(modal);
  };

  const closeWorkspaceModal = (): void => {
    input.setWorkspaceModal(null);
    input.setWorkspaceTicket(null);
    input.setWorkspaceTerminalContext(null);
  };

  const openArchivedTicketDiff = (ticket: TicketFrontmatter): void => {
    input.setWorkspaceTicket(ticket);
    input.setWorkspaceModal("diff");
  };

  const openDraft = (draftId: string): void => {
    input.setWorkspaceModal(null);
    input.setWorkspaceTicket(null);
    input.setWorkspaceTerminalContext(null);
    input.setInspectorState({ kind: "draft", draftId });
  };

  return {
    closeWorkspaceModal,
    hideInspector,
    openArchivedTicketDiff,
    openDraft,
    openNewDraft,
    openTicketSession,
    openTicketWorkspaceModal,
  };
}
