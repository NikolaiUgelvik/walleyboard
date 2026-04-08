import { Loader, Tabs, Text } from "@mantine/core";
import { useEffect, useState } from "react";

import type { WorkspaceTerminalContext } from "./shared-types.js";
import type { resolveWorkspaceTerminalPanelState } from "./workspace-modal-state.js";

export type WorkspaceTerminalComponentProps = {
  socketPath: string;
  surfaceLabel: "ticket" | "repository";
  worktreePath: string | null;
};

export type WorkspaceTerminalComponent = (
  props: WorkspaceTerminalComponentProps,
) => React.JSX.Element;

function RepositoryTabsTerminalContent({
  repositories,
  TerminalComponent,
  terminalInstanceKey,
}: {
  repositories: Extract<
    WorkspaceTerminalContext,
    { kind: "repository_tabs" }
  >["repositories"];
  TerminalComponent: WorkspaceTerminalComponent;
  terminalInstanceKey: number;
}) {
  const defaultRepository = repositories[0] ?? null;
  const [activeRepositoryId, setActiveRepositoryId] = useState(
    defaultRepository?.id ?? null,
  );
  const [visitedRepositoryIds, setVisitedRepositoryIds] = useState<string[]>(
    defaultRepository ? [defaultRepository.id] : [],
  );

  useEffect(() => {
    if (!defaultRepository) {
      setActiveRepositoryId(null);
      setVisitedRepositoryIds([]);
      return;
    }

    const repositoryIds = new Set(
      repositories.map((repository) => repository.id),
    );
    const nextActiveRepositoryId = repositoryIds.has(activeRepositoryId ?? "")
      ? activeRepositoryId
      : defaultRepository.id;

    if (nextActiveRepositoryId !== activeRepositoryId) {
      setActiveRepositoryId(nextActiveRepositoryId);
    }

    setVisitedRepositoryIds((current) => {
      const next = current.filter((id) => repositoryIds.has(id));
      if (nextActiveRepositoryId && !next.includes(nextActiveRepositoryId)) {
        next.push(nextActiveRepositoryId);
      }

      return next.length === current.length &&
        next.every((id, index) => id === current[index])
        ? current
        : next;
    });
  }, [activeRepositoryId, defaultRepository, repositories]);

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
        key={`${defaultRepository.socketPath}:${terminalInstanceKey}`}
        socketPath={defaultRepository.socketPath}
        surfaceLabel="repository"
        worktreePath={defaultRepository.worktreePath}
      />
    );
  }

  return (
    <Tabs
      value={activeRepositoryId}
      onChange={setActiveRepositoryId}
      styles={{
        root: {
          display: "flex",
          flexDirection: "column",
          height: "100%",
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

      <div
        style={{
          flex: 1,
          minHeight: 0,
          paddingTop: "var(--mantine-spacing-sm)",
        }}
      >
        {visitedRepositoryIds.map((repositoryId) => {
          const repository = repositories.find(
            (entry) => entry.id === repositoryId,
          );
          if (!repository) {
            return null;
          }

          return (
            <div
              key={repository.id}
              hidden={repository.id !== activeRepositoryId}
              style={{
                display:
                  repository.id === activeRepositoryId ? "block" : "none",
                height: "100%",
              }}
            >
              <TerminalComponent
                key={`${repository.socketPath}:${terminalInstanceKey}`}
                socketPath={repository.socketPath}
                surfaceLabel="repository"
                worktreePath={repository.worktreePath}
              />
            </div>
          );
        })}
      </div>
    </Tabs>
  );
}

export function WorkspaceTerminalContent({
  selectedSessionTicket,
  workspaceTerminalContext,
  workspaceTerminalPanelState,
  TerminalComponent,
  terminalInstanceKey,
}: {
  selectedSessionTicket: { id: number } | null;
  workspaceTerminalContext: WorkspaceTerminalContext | null;
  workspaceTerminalPanelState: ReturnType<
    typeof resolveWorkspaceTerminalPanelState
  >;
  TerminalComponent: WorkspaceTerminalComponent;
  terminalInstanceKey: number;
}) {
  if (workspaceTerminalContext?.kind === "repository_tabs") {
    return (
      <RepositoryTabsTerminalContent
        repositories={workspaceTerminalContext.repositories}
        TerminalComponent={TerminalComponent}
        terminalInstanceKey={terminalInstanceKey}
      />
    );
  }

  if (workspaceTerminalContext?.kind === "single") {
    return (
      <TerminalComponent
        key={`${workspaceTerminalContext.socketPath}:${terminalInstanceKey}`}
        socketPath={workspaceTerminalContext.socketPath}
        surfaceLabel={workspaceTerminalContext.surfaceLabel}
        worktreePath={workspaceTerminalContext.worktreePath}
      />
    );
  }

  if (workspaceTerminalPanelState.state === "ready" && selectedSessionTicket) {
    return (
      <TerminalComponent
        key={`/tickets/${selectedSessionTicket.id}/workspace/terminal:${terminalInstanceKey}`}
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
