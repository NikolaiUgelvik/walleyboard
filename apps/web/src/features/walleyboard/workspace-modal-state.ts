import type { WorkspaceModalKind } from "./shared.js";

type TerminalSessionSnapshot = {
  worktree_path: string | null;
} | null;

export function resolveWorkspaceDiffPanelState(input: {
  ticketWorkspaceDiffQuery: {
    error: { message: string } | null;
    isError: boolean;
    isPending: boolean;
  };
}) {
  return {
    error: input.ticketWorkspaceDiffQuery.isError
      ? (input.ticketWorkspaceDiffQuery.error?.message ??
        "Unable to load the current diff")
      : null,
    isLoading: input.ticketWorkspaceDiffQuery.isPending,
  };
}

export function resolveWorkspaceTerminalPanelState(input: {
  selectedSessionTicket: { id: number } | null;
  selectedSessionTicketSession: TerminalSessionSnapshot;
  session: TerminalSessionSnapshot;
  sessionQuery: {
    isPending: boolean;
  };
}) {
  const terminalSession =
    input.selectedSessionTicketSession ?? input.session ?? null;

  if (!input.selectedSessionTicket) {
    return {
      state: "preparing" as const,
      worktreePath: null,
    };
  }

  if (terminalSession?.worktree_path) {
    return {
      state: "ready" as const,
      worktreePath: terminalSession.worktree_path,
    };
  }

  if (input.sessionQuery.isPending) {
    return {
      state: "loading" as const,
      worktreePath: null,
    };
  }

  return {
    state: "missing_worktree" as const,
    worktreePath: null,
  };
}

export function shouldKeepWorkspaceModalOpen(
  inspectorKind: "draft" | "hidden" | "new_draft" | "session",
  workspaceModal: WorkspaceModalKind | null,
): boolean {
  return inspectorKind === "session" || workspaceModal === "diff";
}

export function resolveSelectedWorkspaceTicketId(input: {
  workspaceModal: WorkspaceModalKind | null;
  workspaceTicketId: number | null;
  selectedSessionTicketId: number | null;
}): number | null {
  return input.workspaceModal === "diff"
    ? (input.workspaceTicketId ?? input.selectedSessionTicketId)
    : input.selectedSessionTicketId;
}
