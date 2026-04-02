import type { WorkspaceModalKind } from "./shared.js";

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
