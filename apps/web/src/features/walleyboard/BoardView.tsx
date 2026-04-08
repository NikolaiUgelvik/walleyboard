import {
  Box,
  Button,
  Group,
  Loader,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import type React from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { SectionCard } from "../../components/SectionCard.js";
import { BoardColumn } from "./board-column.js";
import { ProjectWorkspaceActions } from "./board-workspace-actions.js";
import { boardColumns, ColorSchemeControl } from "./shared.js";
import type { BoardViewController } from "./walleyboard-view-state.js";

export {
  ProjectWorkspaceActions,
  TicketWorkspaceActions,
} from "./board-workspace-actions.js";

function BoardHeader({ controller }: { controller: BoardViewController }) {
  if (controller.selectedProject) {
    return (
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
    );
  }

  return (
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
          Choose a project from the left rail to bring its drafts, tickets, and
          sessions into the board.
        </Text>
      </Stack>
      <ColorSchemeControl />
    </Group>
  );
}

function BoardToolbar({ controller }: { controller: BoardViewController }) {
  return (
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
          className={
            controller.archiveModalOpen
              ? "project-accent-button project-accent-button--filled"
              : "project-accent-button project-accent-button--light"
          }
          variant={controller.archiveModalOpen ? "filled" : "light"}
          radius="xl"
          onClick={controller.openArchiveModal}
        >
          Archive
        </Button>
        <Button
          disabled={!controller.selectedProject}
          className={
            controller.inspectorState.kind === "new_draft"
              ? "project-accent-button project-accent-button--filled"
              : "project-accent-button project-accent-button--light"
          }
          variant={
            controller.inspectorState.kind === "new_draft" ? "filled" : "light"
          }
          onClick={controller.openNewDraft}
        >
          New Draft
        </Button>
      </Box>
    </Box>
  );
}

function BoardPlaceholder({
  title,
  description,
  children,
}: {
  children: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <SectionCard title={title} description={description}>
      {children}
    </SectionCard>
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
          <BoardHeader controller={controller} />
        </Box>

        <BoardToolbar controller={controller} />

        {controller.archiveActionFeedback && !controller.archiveModalOpen ? (
          <Text size="sm" c={controller.archiveActionFeedback.tone}>
            {controller.archiveActionFeedback.message}
          </Text>
        ) : null}

        {!controller.selectedProject ? (
          <BoardPlaceholder
            title="Nothing selected"
            description="The board shell is ready. Pick a project from the left rail or create a new one to start using it."
          >
            <Text size="sm" c="dimmed">
              Projects anchor repositories, drafts, tickets, and execution
              sessions. Once a project is selected, the middle canvas becomes
              the working board and the right panel becomes the live inspector.
            </Text>
          </BoardPlaceholder>
        ) : controller.boardLoading ? (
          <BoardPlaceholder
            title="Loading board"
            description="Fetching drafts, tickets, and session summaries for the selected project."
          >
            <Loader size="sm" />
          </BoardPlaceholder>
        ) : controller.boardError ? (
          <BoardPlaceholder
            title="Board unavailable"
            description="The selected project could not be loaded into the board."
          >
            <Text c="red" size="sm">
              {controller.boardError}
            </Text>
          </BoardPlaceholder>
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
                  {boardColumns.map((column, columnIndex) => (
                    <BoardColumn
                      key={column}
                      column={column}
                      columnIndex={columnIndex}
                      controller={controller}
                      registerViewport={registerColumnViewport}
                    />
                  ))}
                </Box>
              </Box>
            </Box>
          </Box>
        )}
      </Stack>
    </Box>
  );
}
