import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Menu,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
// @ts-expect-error Tabler deep icon entrypoints do not ship declaration files.
import IconActivityHeartbeat from "@tabler/icons-react/dist/esm/icons/IconActivityHeartbeat.mjs";
// @ts-expect-error Tabler deep icon entrypoints do not ship declaration files.
import IconAlertCircle from "@tabler/icons-react/dist/esm/icons/IconAlertCircle.mjs";
// @ts-expect-error Tabler deep icon entrypoints do not ship declaration files.
import IconFileDiff from "@tabler/icons-react/dist/esm/icons/IconFileDiff.mjs";
// @ts-expect-error Tabler deep icon entrypoints do not ship declaration files.
import IconPlayerPlay from "@tabler/icons-react/dist/esm/icons/IconPlayerPlay.mjs";
// @ts-expect-error Tabler deep icon entrypoints do not ship declaration files.
import IconPlayerStop from "@tabler/icons-react/dist/esm/icons/IconPlayerStop.mjs";
// @ts-expect-error Tabler deep icon entrypoints do not ship declaration files.
import IconTerminal2 from "@tabler/icons-react/dist/esm/icons/IconTerminal2.mjs";
import type React from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  ExecutionSession,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import { MarkdownContent } from "../../components/MarkdownContent.js";
import { SectionCard } from "../../components/SectionCard.js";
import { formatDraftStatusLabel } from "../../lib/draft-status.js";
import { getBoardTicketDescriptionPreview } from "../../lib/ticket-description-preview.js";
import { PullRequestStatusBadge } from "./PullRequestStatusBadge.js";
import { boardColumnMeta, boardColumns, ColorSchemeControl } from "./shared.js";
import {
  humanizeSessionStatus,
  isStoppableSessionStatus,
  resolveReviewCardActions,
  sessionStatusColor,
} from "./shared-utils.js";
import type { BoardViewController } from "./walleyboard-view-state.js";

function projectAccentButtonClassName(
  variant: "default" | "filled" | "light" | "subtle",
): string {
  return `project-accent-button project-accent-button--${variant}`;
}

function resolveTicketSession(
  controller: BoardViewController,
  ticket: TicketFrontmatter,
): ExecutionSession | null {
  return ticket.session_id
    ? (controller.sessionById.get(ticket.session_id) ??
        (controller.session?.id === ticket.session_id
          ? controller.session
          : null))
    : null;
}

function TicketMenu({
  controller,
  project,
  ticket,
  ticketSession,
}: {
  controller: BoardViewController;
  project: BoardViewController["selectedProject"];
  ticket: TicketFrontmatter;
  ticketSession: ExecutionSession | null;
}) {
  const canResume = ticketSession?.status === "interrupted";
  const canRestart = ticketSession?.status === "interrupted";
  const aiReviewActive =
    controller.ticketAiReviewActiveById.get(ticket.id) === true;
  const canStop =
    ticket.status === "in_progress" &&
    ticketSession !== null &&
    isStoppableSessionStatus(ticketSession.status);
  const canStopAiReview = ticket.status === "review" && aiReviewActive;
  const reviewActions = resolveReviewCardActions(project, ticket);
  const isResuming =
    controller.resumeTicketMutation.isPending &&
    controller.resumeTicketMutation.variables?.ticketId === ticket.id;
  const isRestarting =
    controller.restartTicketMutation.isPending &&
    controller.restartTicketMutation.variables?.ticketId === ticket.id;
  const isStopping =
    controller.stopTicketMutation.isPending &&
    controller.stopTicketMutation.variables?.ticketId === ticket.id;
  const isStoppingAiReview =
    controller.stopAgentReviewMutation.isPending &&
    controller.stopAgentReviewMutation.variables === ticket.id;
  const isCreatingPullRequest =
    controller.createPullRequestMutation.isPending &&
    controller.createPullRequestMutation.variables === ticket.id;
  const isMerging =
    controller.mergeTicketMutation.isPending &&
    controller.mergeTicketMutation.variables === ticket.id;
  const isEditing =
    controller.editReadyTicketMutation.isPending &&
    controller.editReadyTicketMutation.variables?.ticket.id === ticket.id;

  return (
    <Menu withinPortal position="bottom-end">
      <Menu.Target>
        <ActionIcon
          aria-label={`More actions for ticket ${ticket.id}`}
          color="gray"
          variant="subtle"
          onClick={(event) => event.stopPropagation()}
        >
          ...
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(event) => event.stopPropagation()}>
        {reviewActions.secondary ? (
          <Menu.Item
            disabled={
              aiReviewActive ||
              (reviewActions.secondary.kind === "create_pr"
                ? isCreatingPullRequest
                : isMerging)
            }
            onClick={(event) => {
              event.stopPropagation();
              if (reviewActions.secondary?.kind === "create_pr") {
                controller.createPullRequestMutation.mutate(ticket.id);
                return;
              }

              if (reviewActions.secondary?.kind === "merge") {
                controller.mergeTicketMutation.mutate(ticket.id);
              }
            }}
          >
            {reviewActions.secondary.kind === "create_pr"
              ? isCreatingPullRequest
                ? "Creating pull request..."
                : reviewActions.secondary.label
              : isMerging
                ? "Merging..."
                : reviewActions.secondary.label}
          </Menu.Item>
        ) : null}
        {canStopAiReview ? (
          <Menu.Item
            color="orange"
            closeMenuOnClick={false}
            disabled={isStoppingAiReview}
            onClick={(event) => {
              event.stopPropagation();
              controller.stopAgentReviewMutation.mutate(ticket.id);
            }}
          >
            {isStoppingAiReview ? "Stopping AI review..." : "Stop AI review"}
          </Menu.Item>
        ) : null}
        {canStop ? (
          <Menu.Item
            color="orange"
            closeMenuOnClick={false}
            disabled={isStopping}
            onClick={(event) => {
              event.stopPropagation();
              controller.stopTicketMutation.mutate({
                ticketId: ticket.id,
              });
            }}
          >
            {isStopping ? "Stopping..." : "Stop"}
          </Menu.Item>
        ) : null}
        {canResume ? (
          <Menu.Item
            disabled={isResuming}
            onClick={(event) => {
              event.stopPropagation();
              controller.resumeTicketMutation.mutate({
                ticketId: ticket.id,
              });
            }}
          >
            {isResuming ? "Resuming..." : "Resume"}
          </Menu.Item>
        ) : null}
        {canRestart ? (
          <Menu.Item
            color="orange"
            disabled={isRestarting}
            onClick={(event) => {
              event.stopPropagation();
              controller.restartTicketFromScratch(ticket);
            }}
          >
            {isRestarting ? "Restarting..." : "Restart"}
          </Menu.Item>
        ) : null}
        {ticket.status === "ready" ? (
          <Menu.Item
            disabled={isEditing}
            onClick={(event) => {
              event.stopPropagation();
              controller.editReadyTicket(ticket);
            }}
          >
            {isEditing ? "Editing..." : "Edit"}
          </Menu.Item>
        ) : null}
        {ticket.status === "done" ? (
          <Menu.Item
            onClick={(event) => {
              event.stopPropagation();
              controller.archiveTicket(ticket);
            }}
          >
            Archive
          </Menu.Item>
        ) : null}
        <Menu.Item
          color="red"
          onClick={(event) => {
            event.stopPropagation();
            controller.deleteTicket(ticket);
          }}
        >
          Delete
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

function BoardColumnScrollArea({
  children,
  columnIndex,
  onClick,
  registerViewport,
}: {
  children: React.ReactNode;
  columnIndex: number;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  registerViewport: (
    columnIndex: number,
    viewport: HTMLDivElement | null,
  ) => void;
}) {
  const handleViewportRef = useCallback(
    (viewport: HTMLDivElement | null) => {
      registerViewport(columnIndex, viewport);
    },
    [columnIndex, registerViewport],
  );

  return (
    <ScrollArea
      className="board-column-stack"
      onClick={onClick}
      type="never"
      viewportProps={{
        style: {
          overflowX: "hidden",
          overflowY: "hidden",
        },
      }}
      viewportRef={handleViewportRef}
    >
      <Stack className="board-column-content" gap="xs">
        {children}
      </Stack>
    </ScrollArea>
  );
}

export function TicketWorkspaceActions({
  controller,
  ticket,
  diffLineSummary,
}: {
  controller: BoardViewController;
  ticket: TicketFrontmatter;
  diffLineSummary?: {
    additions: number;
    deletions: number;
  } | null;
}): React.JSX.Element {
  const ticketSession = resolveTicketSession(controller, ticket);
  const ticketSessionSummaryState = ticket.session_id
    ? (controller.sessionSummaryStateById.get(ticket.session_id) ?? null)
    : null;
  const preview = controller.ticketWorkspacePreviewByTicketId.get(ticket.id);
  const previewRunning = preview?.state === "ready";
  const previewBusy =
    preview?.state === "starting" ||
    (controller.startTicketWorkspacePreviewMutation.isPending &&
      controller.startTicketWorkspacePreviewMutation.variables === ticket.id) ||
    (controller.stopTicketWorkspacePreviewMutation.isPending &&
      controller.stopTicketWorkspacePreviewMutation.variables === ticket.id);
  const previewError =
    controller.previewActionErrorByTicketId[ticket.id] ?? preview?.error;
  const hasPreparedWorktree = ticketSession?.worktree_path != null;
  const hasChanges =
    diffLineSummary != null &&
    (diffLineSummary.additions > 0 || diffLineSummary.deletions > 0);
  const diffDisabled =
    ticket.session_id === null ||
    (!hasPreparedWorktree && ticket.status !== "done") ||
    !hasChanges;
  const terminalWorktreeUnavailable =
    ticket.session_id === null ||
    (!hasPreparedWorktree &&
      ticketSessionSummaryState !== null &&
      !ticketSessionSummaryState.isPending &&
      !ticketSessionSummaryState.isError);
  const terminalDisabled = terminalWorktreeUnavailable;
  const previewDisabled = !hasPreparedWorktree || previewBusy;
  const activityDisabled = ticket.session_id == null;
  const previewLabel = previewRunning ? "Turn off dev server" : "Preview";
  const terminalTitle = terminalDisabled
    ? "Terminal unavailable until this ticket has a prepared worktree"
    : ticketSessionSummaryState?.isPending && !hasPreparedWorktree
      ? "Terminal status is still loading"
      : ticketSessionSummaryState?.isError && !hasPreparedWorktree
        ? "Terminal status could not be loaded. Open to view the error."
        : "Terminal";

  return (
    <Stack gap={6}>
      <ActionIcon.Group className="ticket-workspace-action-group">
        <ActionIcon
          aria-label={previewLabel}
          className="project-accent-action"
          disabled={previewDisabled}
          title={previewLabel}
          variant="light"
          onClick={(event) => {
            event.stopPropagation();
            controller.handleTicketPreviewAction(ticket);
          }}
        >
          {previewBusy ? (
            <Loader size={14} />
          ) : previewRunning ? (
            <IconPlayerStop size={16} />
          ) : (
            <IconPlayerPlay size={16} />
          )}
        </ActionIcon>
        <ActionIcon
          aria-label="Open activity stream"
          className="project-accent-action"
          disabled={activityDisabled}
          title="Activity"
          variant="light"
          onClick={(event) => {
            event.stopPropagation();
            controller.openTicketWorkspaceModal(ticket, "activity");
          }}
        >
          <IconActivityHeartbeat size={16} />
        </ActionIcon>
        <ActionIcon
          aria-label="Open worktree diff"
          className="project-accent-action"
          disabled={diffDisabled}
          title="Diff"
          variant="light"
          onClick={(event) => {
            event.stopPropagation();
            controller.openTicketWorkspaceModal(ticket, "diff");
          }}
        >
          <IconFileDiff size={16} />
        </ActionIcon>
        <ActionIcon
          aria-label="Open worktree terminal"
          className="project-accent-action"
          disabled={terminalDisabled}
          title={terminalTitle}
          variant="light"
          onClick={(event) => {
            event.stopPropagation();
            controller.openTicketWorkspaceModal(ticket, "terminal");
          }}
        >
          <IconTerminal2 size={16} />
        </ActionIcon>
      </ActionIcon.Group>
      {previewError ? (
        <Text size="sm" c="red">
          {previewError}
        </Text>
      ) : null}
    </Stack>
  );
}

export function ProjectWorkspaceActions({
  controller,
}: {
  controller: BoardViewController;
}): React.JSX.Element | null {
  if (!controller.selectedProject || !controller.selectedRepository) {
    return null;
  }

  const preview = controller.repositoryWorkspacePreview;
  const previewRunning = preview?.state === "ready";
  const previewBusy =
    preview?.state === "starting" || controller.repositoryPreviewActionPending;
  const previewError =
    controller.repositoryPreviewActionError ?? preview?.error ?? null;
  const previewLabel = previewRunning ? "Turn off dev server" : "Preview";

  return (
    <Box className="project-workspace-actions">
      <Button.Group className="project-workspace-action-group">
        <Button
          aria-label={previewLabel}
          className={`${projectAccentButtonClassName("light")} project-workspace-action-button`}
          disabled={previewBusy}
          leftSection={
            previewBusy ? (
              <Loader size={14} />
            ) : previewError ? (
              <IconAlertCircle size={16} />
            ) : previewRunning ? (
              <IconPlayerStop size={16} />
            ) : (
              <IconPlayerPlay size={16} />
            )
          }
          size="compact-sm"
          title={previewError ?? previewLabel}
          variant="light"
          onClick={controller.handleSelectedRepositoryPreviewAction}
        >
          <span className="project-workspace-action-label">{previewLabel}</span>
        </Button>
        <Button
          aria-label="Open project terminal"
          className={`${projectAccentButtonClassName("light")} project-workspace-action-button`}
          disabled={controller.repositoryTerminalPending}
          leftSection={<IconTerminal2 size={16} />}
          size="compact-sm"
          variant="light"
          onClick={controller.openSelectedRepositoryWorkspaceTerminal}
        >
          <span className="project-workspace-action-label">Terminal</span>
        </Button>
      </Button.Group>
    </Box>
  );
}

export function BoardView({ controller }: { controller: BoardViewController }) {
  const boardLayoutKey = [
    controller.visibleDrafts.map((draft) => draft.id).join(","),
    ...boardColumns.map((column) =>
      column === "draft"
        ? ""
        : controller.groupedTickets[column]
            .map((ticket) => ticket.id)
            .join(","),
    ),
  ].join("|");
  const columnViewportRefs = useRef<Array<HTMLDivElement | null>>([]);
  const boardScrollerRef = useRef<HTMLDivElement | null>(null);
  const [boardScrollContentHeight, setBoardScrollContentHeight] = useState(0);
  const [boardViewportHeight, setBoardViewportHeight] = useState(0);

  const syncColumnScrollTop = useCallback((scrollTop: number) => {
    const viewports = columnViewportRefs.current.filter(
      (viewport): viewport is HTMLDivElement => viewport !== null,
    );

    for (const viewport of viewports) {
      if (Math.abs(viewport.scrollTop - scrollTop) < 1) {
        continue;
      }

      viewport.scrollTop = scrollTop;
    }
  }, []);

  const updateBoardScrollMetrics = useCallback(() => {
    const boardScroller = boardScrollerRef.current;
    if (!boardScroller) {
      return;
    }

    const viewports = columnViewportRefs.current.filter(
      (viewport): viewport is HTMLDivElement => viewport !== null,
    );
    const maxColumnScrollTop = viewports.reduce((currentMax, viewport) => {
      const viewportOverflow = viewport.scrollHeight - viewport.clientHeight;
      const normalizedViewportOverflow =
        viewportOverflow > 4 ? viewportOverflow : 0;

      return Math.max(currentMax, normalizedViewportOverflow);
    }, 0);
    const scrollerStyles = window.getComputedStyle(boardScroller);
    const scrollerPaddingTop = Number.parseFloat(scrollerStyles.paddingTop);
    const scrollerPaddingBottom = Number.parseFloat(
      scrollerStyles.paddingBottom,
    );
    const effectiveScrollerPaddingTop = Number.isFinite(scrollerPaddingTop)
      ? scrollerPaddingTop
      : 0;
    const effectiveScrollerPaddingBottom = Number.isFinite(
      scrollerPaddingBottom,
    )
      ? scrollerPaddingBottom
      : 0;
    const scrollerViewportHeight = Math.max(
      0,
      boardScroller.clientHeight -
        effectiveScrollerPaddingTop -
        effectiveScrollerPaddingBottom,
    );
    const nextBoardScrollContentHeight = Math.max(
      scrollerViewportHeight,
      scrollerViewportHeight + maxColumnScrollTop,
    );

    setBoardScrollContentHeight((currentHeight) =>
      currentHeight === nextBoardScrollContentHeight
        ? currentHeight
        : nextBoardScrollContentHeight,
    );
    setBoardViewportHeight((currentHeight) =>
      currentHeight === scrollerViewportHeight
        ? currentHeight
        : scrollerViewportHeight,
    );

    const maxScrollTop = Math.max(0, maxColumnScrollTop);
    const clampedScrollTop = Math.min(boardScroller.scrollTop, maxScrollTop);
    if (boardScroller.scrollTop !== clampedScrollTop) {
      boardScroller.scrollTop = clampedScrollTop;
    }

    syncColumnScrollTop(clampedScrollTop);
  }, [syncColumnScrollTop]);

  useLayoutEffect(() => {
    void boardLayoutKey;
    updateBoardScrollMetrics();
  }, [boardLayoutKey, updateBoardScrollMetrics]);

  useEffect(() => {
    void boardLayoutKey;
    const boardScroller = boardScrollerRef.current;
    if (!boardScroller || typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      updateBoardScrollMetrics();
    });

    resizeObserver.observe(boardScroller);
    for (const viewport of columnViewportRefs.current) {
      if (!viewport) {
        continue;
      }

      resizeObserver.observe(viewport);
      const content = viewport.firstElementChild;
      if (content instanceof HTMLElement) {
        resizeObserver.observe(content);
      }
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [boardLayoutKey, updateBoardScrollMetrics]);

  const registerColumnViewport = useCallback(
    (columnIndex: number, viewport: HTMLDivElement | null) => {
      columnViewportRefs.current[columnIndex] = viewport;
    },
    [],
  );

  const handleBoardScrollerScroll = useCallback<
    React.UIEventHandler<HTMLDivElement>
  >(
    (event) => {
      syncColumnScrollTop(event.currentTarget.scrollTop);
    },
    [syncColumnScrollTop],
  );

  return (
    <Box className="walleyboard-main">
      <Stack className="workbench-shell" gap="md">
        <Box className="workbench-header">
          {controller.selectedProject ? (
            <Group
              className="workbench-header-row workbench-header-row--selected"
              justify="space-between"
              align="center"
              wrap="nowrap"
            >
              <Box className="workbench-header-title">
                <Title
                  order={1}
                  style={{
                    letterSpacing: "-0.05em",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {controller.selectedProject.name}
                </Title>
              </Box>
              <Group
                className="workbench-header-controls"
                gap="xs"
                align="center"
                wrap="nowrap"
              >
                <ColorSchemeControl />
                <ProjectWorkspaceActions controller={controller} />
              </Group>
            </Group>
          ) : (
            <Group
              className="workbench-header-row"
              justify="space-between"
              align="flex-start"
              wrap="nowrap"
            >
              <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
                <Title order={1} style={{ letterSpacing: "-0.05em" }}>
                  Select a project
                </Title>
                <Text size="sm" c="dimmed" maw={820}>
                  Choose a project from the left rail to bring its drafts,
                  tickets, and sessions into the board.
                </Text>
              </Stack>
              <ColorSchemeControl />
            </Group>
          )}
        </Box>

        <Box className="workbench-toolbar">
          <Box className="toolbar-group">
            {boardColumns.map((column) => {
              const count =
                column === "draft"
                  ? controller.visibleDrafts.length
                  : controller.groupedTickets[column].length;
              const meta = boardColumnMeta[column];
              return (
                <Badge
                  key={column}
                  variant="light"
                  size="lg"
                  style={{
                    background: `${meta.accent}14`,
                    color: meta.accent,
                    border: `1px solid ${meta.accent}22`,
                  }}
                >
                  {meta.label} {count}
                </Badge>
              );
            })}
          </Box>
          <Box className="toolbar-group">
            <TextInput
              className="board-search"
              placeholder="Search tickets and drafts..."
              value={controller.boardSearch}
              onChange={(event) =>
                controller.setBoardSearch(event.currentTarget.value)
              }
            />
            <Button
              disabled={!controller.selectedProject}
              className={projectAccentButtonClassName(
                controller.archiveModalOpen ? "filled" : "light",
              )}
              variant={controller.archiveModalOpen ? "filled" : "light"}
              radius="xl"
              onClick={controller.openArchiveModal}
            >
              Archive
            </Button>
            <Button
              disabled={!controller.selectedProject}
              className={projectAccentButtonClassName(
                controller.inspectorState.kind === "new_draft"
                  ? "filled"
                  : "light",
              )}
              variant={
                controller.inspectorState.kind === "new_draft"
                  ? "filled"
                  : "light"
              }
              onClick={controller.openNewDraft}
            >
              New Draft
            </Button>
          </Box>
        </Box>

        {controller.archiveActionFeedback && !controller.archiveModalOpen ? (
          <Text size="sm" c={controller.archiveActionFeedback.tone}>
            {controller.archiveActionFeedback.message}
          </Text>
        ) : null}

        {!controller.selectedProject ? (
          <SectionCard
            title="Nothing selected"
            description="The board shell is ready. Pick a project from the left rail or create a new one to start using it."
          >
            <Text size="sm" c="dimmed">
              Projects anchor repositories, drafts, tickets, and execution
              sessions. Once a project is selected, the middle canvas becomes
              the working board and the right panel becomes the live inspector.
            </Text>
          </SectionCard>
        ) : controller.boardLoading ? (
          <SectionCard
            title="Loading board"
            description="Fetching drafts, tickets, and session summaries for the selected project."
          >
            <Loader size="sm" />
          </SectionCard>
        ) : controller.boardError ? (
          <SectionCard
            title="Board unavailable"
            description="The selected project could not be loaded into the board."
          >
            <Text c="red" size="sm">
              {controller.boardError}
            </Text>
          </SectionCard>
        ) : (
          <Box className="board-scroll-shell">
            <Box
              className="board-scroller"
              ref={boardScrollerRef}
              onScroll={handleBoardScrollerScroll}
            >
              <Box
                className="board-scroll-inner"
                style={{
                  height: Math.max(
                    boardScrollContentHeight,
                    boardViewportHeight,
                  ),
                }}
              >
                <Box
                  className="board-grid"
                  style={
                    boardViewportHeight > 0
                      ? { height: boardViewportHeight }
                      : undefined
                  }
                >
                  {boardColumns.map((column, columnIndex) => {
                    const meta = boardColumnMeta[column];
                    const columnCount =
                      column === "draft"
                        ? controller.visibleDrafts.length
                        : controller.groupedTickets[column].length;

                    return (
                      <Box key={column} className="board-column">
                        <Box className="board-column-header">
                          <Box className="board-column-title">
                            <Box
                              className="board-column-dot"
                              style={{ background: meta.accent }}
                            />
                            <Text fw={700}>{meta.label}</Text>
                          </Box>
                          <Group gap="xs">
                            <Badge
                              variant="light"
                              size="lg"
                              style={{
                                background: `${meta.accent}14`,
                                color: meta.accent,
                                border: `1px solid ${meta.accent}22`,
                              }}
                            >
                              {columnCount}
                            </Badge>
                            {column === "draft" ? (
                              <Menu withinPortal position="bottom-end">
                                <Menu.Target>
                                  <ActionIcon
                                    aria-label="Draft column actions"
                                    color="gray"
                                    variant="subtle"
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    ...
                                  </ActionIcon>
                                </Menu.Target>
                                <Menu.Dropdown
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <Menu.Item
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      controller.openNewDraft();
                                    }}
                                  >
                                    New
                                  </Menu.Item>
                                </Menu.Dropdown>
                              </Menu>
                            ) : null}
                            {column === "done" ? (
                              <Menu withinPortal position="bottom-end">
                                <Menu.Target>
                                  <ActionIcon
                                    aria-label="Done column actions"
                                    color="gray"
                                    variant="subtle"
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    ...
                                  </ActionIcon>
                                </Menu.Target>
                                <Menu.Dropdown
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <Menu.Item
                                    disabled={
                                      controller.doneColumnTickets.length ===
                                        0 ||
                                      controller.archiveDoneTicketsMutation
                                        .isPending
                                    }
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      controller.archiveDoneTickets(
                                        controller.doneColumnTickets,
                                      );
                                    }}
                                  >
                                    Archive all
                                  </Menu.Item>
                                </Menu.Dropdown>
                              </Menu>
                            ) : null}
                          </Group>
                        </Box>

                        <BoardColumnScrollArea
                          columnIndex={columnIndex}
                          onClick={controller.hideInspector}
                          registerViewport={registerColumnViewport}
                        >
                          {column === "draft" ? (
                            controller.visibleDrafts.length === 0 ? (
                              <Box className="board-empty">{meta.empty}</Box>
                            ) : (
                              controller.visibleDrafts.map((draft) => {
                                const repository =
                                  controller.repositories.find(
                                    (item) =>
                                      item.id ===
                                      (draft.confirmed_repo_id ??
                                        draft.proposed_repo_id),
                                  ) ?? controller.selectedRepository;
                                const isSelected =
                                  draft.id === controller.selectedDraftId;

                                return (
                                  <Box
                                    key={draft.id}
                                    className={`board-card board-card-clickable${isSelected ? " board-card-selected" : ""}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      controller.openDraft(draft.id);
                                    }}
                                  >
                                    <Stack gap="xs">
                                      <Group
                                        justify="space-between"
                                        align="flex-start"
                                      >
                                        <Box
                                          style={{
                                            fontWeight: 700,
                                            lineHeight: 1.35,
                                          }}
                                        >
                                          <MarkdownContent
                                            content={draft.title_draft}
                                            inline
                                            onTicketReferenceNavigate={
                                              controller.navigateToTicketReference
                                            }
                                            ticketReferences={
                                              draft.ticket_references ?? []
                                            }
                                          />
                                        </Box>
                                        <Badge variant="light" color="gray">
                                          {formatDraftStatusLabel({
                                            isRefining:
                                              controller.isDraftRefinementActive(
                                                draft.id,
                                              ),
                                            wizardStatus: draft.wizard_status,
                                          })}
                                        </Badge>
                                      </Group>
                                      <MarkdownContent
                                        className="markdown-muted markdown-small"
                                        content={getBoardTicketDescriptionPreview(
                                          draft.description_draft,
                                        )}
                                        onTicketReferenceNavigate={
                                          controller.navigateToTicketReference
                                        }
                                        ticketReferences={
                                          draft.ticket_references ?? []
                                        }
                                      />
                                      <Text className="board-card-meta">
                                        Repository:{" "}
                                        {repository?.name ?? "unassigned"}
                                      </Text>
                                      <Text className="board-card-meta">
                                        {draft.proposed_acceptance_criteria
                                          .length > 0
                                          ? `${draft.proposed_acceptance_criteria.length} acceptance criteria ready`
                                          : "Run refinement to generate acceptance criteria"}
                                      </Text>
                                    </Stack>
                                  </Box>
                                );
                              })
                            )
                          ) : controller.groupedTickets[column].length === 0 ? (
                            <Box className="board-empty">{meta.empty}</Box>
                          ) : (
                            controller.groupedTickets[column].map((ticket) => {
                              const ticketSession = resolveTicketSession(
                                controller,
                                ticket,
                              );
                              const isSelected =
                                ticket.session_id !== null &&
                                ticket.session_id ===
                                  controller.selectedSessionId;
                              const showDeleteError =
                                controller.deleteTicketMutation.isError &&
                                controller.deleteTicketMutation.variables
                                  ?.ticketId === ticket.id;
                              const showArchiveError =
                                controller.archiveTicketMutation.isError &&
                                controller.archiveTicketMutation.variables
                                  ?.ticketId === ticket.id;
                              const showResumeError =
                                controller.resumeTicketMutation.isError &&
                                controller.resumeTicketMutation.variables
                                  ?.ticketId === ticket.id;
                              const showRestartError =
                                controller.restartTicketMutation.isError &&
                                controller.restartTicketMutation.variables
                                  ?.ticketId === ticket.id;
                              const showStopError =
                                controller.stopTicketMutation.isError &&
                                controller.stopTicketMutation.variables
                                  ?.ticketId === ticket.id;
                              const showStopAiReviewError =
                                controller.stopAgentReviewMutation.isError &&
                                controller.stopAgentReviewMutation.variables ===
                                  ticket.id;
                              const showEditError =
                                controller.editReadyTicketMutation.isError &&
                                controller.editReadyTicketMutation.variables
                                  ?.ticket.id === ticket.id;
                              const showMergeError =
                                controller.mergeTicketMutation.isError &&
                                controller.mergeTicketMutation.variables ===
                                  ticket.id;
                              const showCreatePrError =
                                controller.createPullRequestMutation.isError &&
                                controller.createPullRequestMutation
                                  .variables === ticket.id;
                              const showStartPlanError =
                                controller.startTicketMutation.isError &&
                                controller.startTicketMutation.variables
                                  ?.ticketId === ticket.id &&
                                controller.startTicketMutation.variables
                                  .planningEnabled;
                              const showStartNowError =
                                controller.startTicketMutation.isError &&
                                controller.startTicketMutation.variables
                                  ?.ticketId === ticket.id &&
                                !controller.startTicketMutation.variables
                                  .planningEnabled;
                              const aiReviewActive =
                                controller.ticketAiReviewActiveById.get(
                                  ticket.id,
                                ) ??
                                (controller.startAgentReviewMutation
                                  .isPending &&
                                  controller.startAgentReviewMutation
                                    .variables === ticket.id);
                              const diffLineSummary =
                                ticket.status === "in_progress" ||
                                ticket.status === "review" ||
                                ticket.status === "done"
                                  ? (controller.ticketDiffLineSummaryByTicketId?.get(
                                      ticket.id,
                                    ) ?? null)
                                  : null;

                              return (
                                <Box
                                  key={ticket.id}
                                  id={`ticket-${ticket.id}`}
                                  tabIndex={-1}
                                  className={`board-card${isSelected ? " board-card-selected" : ""}${ticket.session_id ? " board-card-clickable" : ""}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    controller.openTicketSession(ticket);
                                  }}
                                >
                                  <Stack gap="xs">
                                    <Box
                                      className="board-card-header"
                                      style={{
                                        alignItems: "flex-start",
                                        display: "flex",
                                        gap: 8,
                                      }}
                                    >
                                      <Stack
                                        className="board-card-header-main"
                                        gap={2}
                                        style={{ flex: 1, minWidth: 0 }}
                                      >
                                        <Box
                                          style={{
                                            fontWeight: 700,
                                            lineHeight: 1.35,
                                          }}
                                        >
                                          <Text component="span" inherit>
                                            #{ticket.id}{" "}
                                          </Text>
                                          <MarkdownContent
                                            content={ticket.title}
                                            inline
                                            onTicketReferenceNavigate={
                                              controller.navigateToTicketReference
                                            }
                                            ticketReferences={
                                              ticket.ticket_references ?? []
                                            }
                                          />
                                        </Box>
                                        <Text className="board-card-meta">
                                          {ticket.ticket_type} •{" "}
                                          {ticket.target_branch}
                                          {diffLineSummary ? (
                                            <>
                                              {" • "}
                                              <Box
                                                component="span"
                                                style={{
                                                  color:
                                                    "var(--mantine-color-green-6)",
                                                }}
                                              >
                                                +{diffLineSummary.additions}
                                              </Box>{" "}
                                              <Box
                                                component="span"
                                                style={{
                                                  color:
                                                    "var(--mantine-color-red-6)",
                                                }}
                                              >
                                                -{diffLineSummary.deletions}
                                              </Box>
                                            </>
                                          ) : null}
                                        </Text>
                                        <TicketWorkspaceActions
                                          controller={controller}
                                          ticket={ticket}
                                          diffLineSummary={diffLineSummary}
                                        />
                                      </Stack>
                                      <Box
                                        className="board-card-header-menu"
                                        style={{ flex: "0 0 auto" }}
                                      >
                                        <TicketMenu
                                          controller={controller}
                                          project={controller.selectedProject}
                                          ticket={ticket}
                                          ticketSession={ticketSession}
                                        />
                                      </Box>
                                    </Box>
                                    {aiReviewActive ? (
                                      <Group
                                        className="board-card-ai-review"
                                        gap={6}
                                        wrap="wrap"
                                      >
                                        <Badge variant="light" color="violet">
                                          AI review in progress
                                        </Badge>
                                      </Group>
                                    ) : null}
                                    <Group gap={6} wrap="wrap">
                                      {ticketSession &&
                                      ticketSession.status !== "completed" ? (
                                        <Badge
                                          variant="outline"
                                          color={sessionStatusColor(
                                            ticketSession.status,
                                          )}
                                        >
                                          {humanizeSessionStatus(
                                            ticketSession.status,
                                          )}
                                        </Badge>
                                      ) : null}
                                    </Group>
                                    <MarkdownContent
                                      className="markdown-muted markdown-small"
                                      content={getBoardTicketDescriptionPreview(
                                        ticket.description,
                                      )}
                                      onTicketReferenceNavigate={
                                        controller.navigateToTicketReference
                                      }
                                      ticketReferences={
                                        ticket.ticket_references ?? []
                                      }
                                    />
                                    {ticket.linked_pr ? (
                                      <Group gap={8} wrap="wrap">
                                        <PullRequestStatusBadge
                                          linkedPr={ticket.linked_pr}
                                        />
                                        <Text
                                          component="a"
                                          href={ticket.linked_pr.url}
                                          target="_blank"
                                          rel="noreferrer"
                                          size="xs"
                                          c="blue"
                                          onClick={(event) =>
                                            event.stopPropagation()
                                          }
                                        >
                                          Open PR
                                        </Text>
                                      </Group>
                                    ) : null}
                                    {ticketSession?.status === "queued" ? (
                                      <Text size="xs" c="dimmed">
                                        Waiting for a running slot
                                      </Text>
                                    ) : null}

                                    {showDeleteError ? (
                                      <Text size="sm" c="red">
                                        {
                                          controller.deleteTicketMutation.error
                                            ?.message
                                        }
                                      </Text>
                                    ) : null}
                                    {showArchiveError ? (
                                      <Text size="sm" c="red">
                                        {
                                          controller.archiveTicketMutation.error
                                            ?.message
                                        }
                                      </Text>
                                    ) : null}
                                    {showResumeError ? (
                                      <Text size="sm" c="red">
                                        {
                                          controller.resumeTicketMutation.error
                                            ?.message
                                        }
                                      </Text>
                                    ) : null}
                                    {showRestartError ? (
                                      <Text size="sm" c="red">
                                        {
                                          controller.restartTicketMutation.error
                                            ?.message
                                        }
                                      </Text>
                                    ) : null}
                                    {showStopError ? (
                                      <Text size="sm" c="red">
                                        {
                                          controller.stopTicketMutation.error
                                            ?.message
                                        }
                                      </Text>
                                    ) : null}
                                    {showStopAiReviewError ? (
                                      <Text size="sm" c="red">
                                        {
                                          controller.stopAgentReviewMutation
                                            .error?.message
                                        }
                                      </Text>
                                    ) : null}
                                    {showEditError ? (
                                      <Text size="sm" c="red">
                                        {
                                          controller.editReadyTicketMutation
                                            .error?.message
                                        }
                                      </Text>
                                    ) : null}
                                    {showMergeError ? (
                                      <Text size="sm" c="red">
                                        {
                                          controller.mergeTicketMutation.error
                                            ?.message
                                        }
                                      </Text>
                                    ) : null}
                                    {showCreatePrError ? (
                                      <Text size="sm" c="red">
                                        {
                                          controller.createPullRequestMutation
                                            .error?.message
                                        }
                                      </Text>
                                    ) : null}
                                    {showStartPlanError || showStartNowError ? (
                                      <Text size="sm" c="red">
                                        {
                                          controller.startTicketMutation.error
                                            ?.message
                                        }
                                      </Text>
                                    ) : null}

                                    {column === "ready" ? (
                                      <Group
                                        justify="flex-end"
                                        align="flex-end"
                                        gap="xs"
                                      >
                                        <Group gap="xs">
                                          <Button
                                            className={projectAccentButtonClassName(
                                              "light",
                                            )}
                                            variant="light"
                                            size="xs"
                                            loading={
                                              controller.startTicketMutation
                                                .isPending &&
                                              controller.startTicketMutation
                                                .variables?.ticketId ===
                                                ticket.id &&
                                              controller.startTicketMutation
                                                .variables.planningEnabled
                                            }
                                            onClick={() =>
                                              controller.startTicketMutation.mutate(
                                                {
                                                  ticketId: ticket.id,
                                                  planningEnabled: true,
                                                },
                                              )
                                            }
                                          >
                                            Start with Plan
                                          </Button>
                                          <Button
                                            className={projectAccentButtonClassName(
                                              "filled",
                                            )}
                                            size="xs"
                                            loading={
                                              controller.startTicketMutation
                                                .isPending &&
                                              controller.startTicketMutation
                                                .variables?.ticketId ===
                                                ticket.id &&
                                              !controller.startTicketMutation
                                                .variables.planningEnabled
                                            }
                                            onClick={() =>
                                              controller.startTicketMutation.mutate(
                                                {
                                                  ticketId: ticket.id,
                                                  planningEnabled: false,
                                                },
                                              )
                                            }
                                          >
                                            Start Now
                                          </Button>
                                        </Group>
                                      </Group>
                                    ) : column === "review" ? (
                                      (() => {
                                        const aiReviewActive =
                                          controller.ticketAiReviewActiveById.get(
                                            ticket.id,
                                          ) === true;
                                        const reviewActions =
                                          resolveReviewCardActions(
                                            controller.selectedProject,
                                            ticket,
                                          );
                                        const primaryAction =
                                          reviewActions.primary;
                                        if (!primaryAction) {
                                          return null;
                                        }

                                        return (
                                          <Group justify="flex-end" gap="xs">
                                            <Button
                                              className={projectAccentButtonClassName(
                                                "filled",
                                              )}
                                              size="xs"
                                              variant="filled"
                                              loading={
                                                primaryAction.kind === "merge"
                                                  ? controller
                                                      .mergeTicketMutation
                                                      .isPending &&
                                                    controller
                                                      .mergeTicketMutation
                                                      .variables === ticket.id
                                                  : primaryAction.kind ===
                                                      "create_pr"
                                                    ? controller
                                                        .createPullRequestMutation
                                                        .isPending &&
                                                      controller
                                                        .createPullRequestMutation
                                                        .variables === ticket.id
                                                    : false
                                              }
                                              disabled={
                                                aiReviewActive &&
                                                (primaryAction.kind ===
                                                  "merge" ||
                                                  primaryAction.kind ===
                                                    "create_pr")
                                              }
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                if (
                                                  primaryAction.kind === "merge"
                                                ) {
                                                  controller.mergeTicketMutation.mutate(
                                                    ticket.id,
                                                  );
                                                  return;
                                                }

                                                if (
                                                  primaryAction.kind ===
                                                  "create_pr"
                                                ) {
                                                  controller.createPullRequestMutation.mutate(
                                                    ticket.id,
                                                  );
                                                }
                                              }}
                                            >
                                              {primaryAction.label}
                                            </Button>
                                          </Group>
                                        );
                                      })()
                                    ) : null}
                                  </Stack>
                                </Box>
                              );
                            })
                          )}
                        </BoardColumnScrollArea>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            </Box>
          </Box>
        )}
      </Stack>
    </Box>
  );
}
