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
import IconAlertCircle from "@tabler/icons-react/dist/esm/icons/IconAlertCircle.mjs";
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

import { MarkdownContent } from "../../components/MarkdownContent.js";
import { SectionCard } from "../../components/SectionCard.js";
import { formatDraftStatusLabel } from "../../lib/draft-status.js";
import { getBoardTicketDescriptionPreview } from "../../lib/ticket-description-preview.js";
import {
  boardColumnMeta,
  boardColumns,
  ColorSchemeControl,
  columnBadgeStyle,
} from "./shared.js";
import {
  projectAccentButtonClassName,
  VirtualizedTicketList,
} from "./VirtualizedTicketList.js";
import type { BoardViewController } from "./walleyboard-view-state.js";

export { TicketWorkspaceActions } from "./VirtualizedTicketList.js";

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
                              style={columnBadgeStyle(meta.accent)}
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
                            <VirtualizedTicketList
                              tickets={controller.groupedTickets[column]}
                              column={column}
                              controller={controller}
                              onVisibleTicketIdsChange={
                                controller.setVisibleTicketIds
                              }
                            />
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
