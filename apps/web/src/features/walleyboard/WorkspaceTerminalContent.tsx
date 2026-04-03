import { Loader, Tabs, Text } from "@mantine/core";

import type { WorkspaceTerminalContext } from "./shared.js";
import type { resolveWorkspaceTerminalPanelState } from "./workspace-modal-state.js";

export type WorkspaceTerminalComponentProps = {
  socketPath: string;
  surfaceLabel: "ticket" | "repository";
  worktreePath: string | null;
};

export type WorkspaceTerminalComponent = (
  props: WorkspaceTerminalComponentProps,
) => React.JSX.Element;

export function WorkspaceTerminalContent({
  selectedSessionTicket,
  workspaceTerminalContext,
  workspaceTerminalPanelState,
  TerminalComponent,
}: {
  selectedSessionTicket: { id: number } | null;
  workspaceTerminalContext: WorkspaceTerminalContext | null;
  workspaceTerminalPanelState: ReturnType<
    typeof resolveWorkspaceTerminalPanelState
  >;
  TerminalComponent: WorkspaceTerminalComponent;
}) {
  if (workspaceTerminalContext?.kind === "repository_tabs") {
    const repositories = workspaceTerminalContext.repositories;
    const defaultRepository = repositories[0] ?? null;
    if (!defaultRepository) {
      return (
        <Text size="sm" c="dimmed">
          This project does not have any configured repositories.
        </Text>
      );
    }

    if (repositories.length === 1) {
      return (
        <TerminalComponent
          key={defaultRepository.socketPath}
          socketPath={defaultRepository.socketPath}
          surfaceLabel="repository"
          worktreePath={defaultRepository.worktreePath}
        />
      );
    }

    return (
      <Tabs
        defaultValue={defaultRepository.id}
        styles={{
          root: {
            display: "flex",
            flexDirection: "column",
            height: "100%",
          },
          panel: {
            flex: 1,
            minHeight: 0,
            paddingTop: "var(--mantine-spacing-sm)",
          },
        }}
      >
        <Tabs.List>
          {repositories.map((repository) => (
            <Tabs.Tab key={repository.id} value={repository.id}>
              {repository.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>

        {repositories.map((repository) => (
          <Tabs.Panel key={repository.id} value={repository.id}>
            <TerminalComponent
              key={repository.socketPath}
              socketPath={repository.socketPath}
              surfaceLabel="repository"
              worktreePath={repository.worktreePath}
            />
          </Tabs.Panel>
        ))}
      </Tabs>
    );
  }

  if (workspaceTerminalContext?.kind === "single") {
    return (
      <TerminalComponent
        socketPath={workspaceTerminalContext.socketPath}
        surfaceLabel={workspaceTerminalContext.surfaceLabel}
        worktreePath={workspaceTerminalContext.worktreePath}
      />
    );
  }

  if (workspaceTerminalPanelState.state === "ready" && selectedSessionTicket) {
    return (
      <TerminalComponent
        socketPath={`/tickets/${selectedSessionTicket.id}/workspace/terminal`}
        surfaceLabel="ticket"
        worktreePath={workspaceTerminalPanelState.worktreePath}
      />
    );
  }

  if (workspaceTerminalPanelState.state === "loading") {
    return <Loader size="sm" />;
  }

  if (workspaceTerminalPanelState.state === "error") {
    return (
      <Text size="sm" c="red">
        {workspaceTerminalPanelState.error}
      </Text>
    );
  }

  if (workspaceTerminalPanelState.state === "missing_worktree") {
    return (
      <Text size="sm" c="dimmed">
        This ticket does not have a prepared worktree.
      </Text>
    );
  }

  return (
    <Text size="sm" c="dimmed">
      The workspace terminal is still being prepared.
    </Text>
  );
}
