export function resolveWorkspaceDiffPanelState(input: {
  sessionQuery: {
    error: { message: string } | null;
    isError: boolean;
    isPending: boolean;
  };
  ticketWorkspaceDiffQuery: {
    error: { message: string } | null;
    isError: boolean;
    isPending: boolean;
  };
}) {
  return {
    error: input.sessionQuery.isError
      ? (input.sessionQuery.error?.message ??
        "Unable to load the current session")
      : input.ticketWorkspaceDiffQuery.isError
        ? (input.ticketWorkspaceDiffQuery.error?.message ??
          "Unable to load the current diff")
        : null,
    isLoading:
      !input.sessionQuery.isError &&
      (input.sessionQuery.isPending ||
        input.ticketWorkspaceDiffQuery.isPending),
  };
}
