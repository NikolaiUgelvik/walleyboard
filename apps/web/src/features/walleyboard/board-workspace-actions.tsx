import {
  ActionIcon,
  Button,
  Loader,
  Menu,
  ScrollArea,
  Stack,
  Text,
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
// @ts-expect-error Tabler deep icon entrypoints do not ship declaration files.
import IconTimelineEventText from "@tabler/icons-react/dist/esm/icons/IconTimelineEventText.mjs";
import type React from "react";
import { useCallback } from "react";
import type {
  ExecutionSession,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";
import {
  isStoppableSessionStatus,
  resolveReviewCardActions,
} from "./shared-utils.js";
import { projectAccentButtonClassName } from "./view-helpers.js";
import type { BoardViewController } from "./walleyboard-view-state.js";

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

export function TicketMenu({
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
  const isMovingToReview =
    controller.moveToReviewMutation.isPending &&
    controller.moveToReviewMutation.variables?.ticketId === ticket.id;
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
        {ticket.status === "in_progress" ? (
          <Menu.Item
            disabled={isMovingToReview}
            onClick={(event) => {
              event.stopPropagation();
              controller.moveTicketToReview(ticket);
            }}
          >
            {isMovingToReview ? "Moving to review..." : "Move to Review"}
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

export function DraftMenu({
  controller,
  draftId,
}: {
  controller: BoardViewController;
  draftId: string;
}) {
  const isDeleting =
    controller.deleteDraftMutation.isPending &&
    controller.deleteDraftMutation.variables === draftId;

  return (
    <Menu withinPortal position="bottom-end">
      <Menu.Target>
        <ActionIcon
          aria-label={`More actions for draft ${draftId}`}
          color="gray"
          variant="subtle"
          disabled={isDeleting}
          onClick={(event) => event.stopPropagation()}
        >
          {isDeleting ? "Deleting..." : "..."}
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(event) => event.stopPropagation()}>
        <Menu.Item
          color="red"
          disabled={isDeleting}
          onClick={(event) => {
            event.stopPropagation();
            controller.deleteDraftMutation.mutate(draftId);
          }}
        >
          Delete
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

export function BoardColumnScrollArea({
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
          aria-label="Open activity timeline"
          className="project-accent-action"
          disabled={activityDisabled}
          title="Timeline"
          variant="light"
          onClick={(event) => {
            event.stopPropagation();
            controller.openTicketWorkspaceModal(ticket, "timeline");
          }}
        >
          <IconTimelineEventText size={16} />
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
  );
}
