import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Menu,
  Stack,
  Text,
} from "@mantine/core";
// @ts-expect-error Tabler deep icon entrypoints do not ship declaration files.
import IconActivityHeartbeat from "@tabler/icons-react/dist/esm/icons/IconActivityHeartbeat.mjs";
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
import type {
  ExecutionSession,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import { MarkdownContent } from "../../components/MarkdownContent.js";
import { getBoardTicketDescriptionPreview } from "../../lib/ticket-description-preview.js";
import { PullRequestStatusBadge } from "./PullRequestStatusBadge.js";
import {
  humanizeSessionStatus,
  isStoppableSessionStatus,
  resolveReviewCardActions,
  sessionStatusColor,
} from "./shared-utils.js";
import type { BoardViewController } from "./walleyboard-view-state.js";

export function projectAccentButtonClassName(
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

export const ESTIMATED_CARD_HEIGHT = 140;

export function TicketCard({
  controller,
  ticket,
  column,
}: {
  controller: BoardViewController;
  ticket: TicketFrontmatter;
  column: string;
}) {
  const ticketSession = resolveTicketSession(controller, ticket);
  const isSelected =
    (ticket.session_id !== null &&
      ticket.session_id === controller.selectedSessionId) ||
    ticket.id === controller.selectedTicketId;
  const showDeleteError =
    controller.deleteTicketMutation.isError &&
    controller.deleteTicketMutation.variables?.ticketId === ticket.id;
  const showArchiveError =
    controller.archiveTicketMutation.isError &&
    controller.archiveTicketMutation.variables?.ticketId === ticket.id;
  const showResumeError =
    controller.resumeTicketMutation.isError &&
    controller.resumeTicketMutation.variables?.ticketId === ticket.id;
  const showRestartError =
    controller.restartTicketMutation.isError &&
    controller.restartTicketMutation.variables?.ticketId === ticket.id;
  const showStopError =
    controller.stopTicketMutation.isError &&
    controller.stopTicketMutation.variables?.ticketId === ticket.id;
  const showStopAiReviewError =
    controller.stopAgentReviewMutation.isError &&
    controller.stopAgentReviewMutation.variables === ticket.id;
  const showEditError =
    controller.editReadyTicketMutation.isError &&
    controller.editReadyTicketMutation.variables?.ticket.id === ticket.id;
  const showMergeError =
    controller.mergeTicketMutation.isError &&
    controller.mergeTicketMutation.variables === ticket.id;
  const showCreatePrError =
    controller.createPullRequestMutation.isError &&
    controller.createPullRequestMutation.variables === ticket.id;
  const showStartPlanError =
    controller.startTicketMutation.isError &&
    controller.startTicketMutation.variables?.ticketId === ticket.id &&
    controller.startTicketMutation.variables.planningEnabled;
  const showStartNowError =
    controller.startTicketMutation.isError &&
    controller.startTicketMutation.variables?.ticketId === ticket.id &&
    !controller.startTicketMutation.variables.planningEnabled;
  const aiReviewActive =
    controller.ticketAiReviewActiveById.get(ticket.id) ??
    (controller.startAgentReviewMutation.isPending &&
      controller.startAgentReviewMutation.variables === ticket.id);
  const diffLineSummary =
    ticket.status === "in_progress" ||
    ticket.status === "review" ||
    ticket.status === "done"
      ? (controller.ticketDiffLineSummaryByTicketId?.get(ticket.id) ?? null)
      : null;

  return (
    <Box
      className={`board-card${isSelected ? " board-card-selected" : ""}${ticket.session_id || ticket.status === "ready" ? " board-card-clickable" : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        if (ticket.status === "ready") {
          controller.openTicket(ticket);
        } else {
          controller.openTicketSession(ticket);
        }
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
                onTicketReferenceNavigate={controller.navigateToTicketReference}
                ticketReferences={ticket.ticket_references ?? []}
              />
            </Box>
            <Text className="board-card-meta">
              {ticket.ticket_type} • {ticket.target_branch}
              {diffLineSummary ? (
                <>
                  {" • "}
                  <Box
                    component="span"
                    style={{
                      color: "var(--mantine-color-green-6)",
                    }}
                  >
                    +{diffLineSummary.additions}
                  </Box>{" "}
                  <Box
                    component="span"
                    style={{
                      color: "var(--mantine-color-red-6)",
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
          <Box className="board-card-header-menu" style={{ flex: "0 0 auto" }}>
            <TicketMenu
              controller={controller}
              project={controller.selectedProject}
              ticket={ticket}
              ticketSession={ticketSession}
            />
          </Box>
        </Box>
        {aiReviewActive ? (
          <Group className="board-card-ai-review" gap={6} wrap="wrap">
            <Badge variant="light" color="violet">
              AI review in progress
            </Badge>
          </Group>
        ) : null}
        <Group gap={6} wrap="wrap">
          {ticketSession && ticketSession.status !== "completed" ? (
            <Badge
              variant="outline"
              color={sessionStatusColor(ticketSession.status)}
            >
              {humanizeSessionStatus(ticketSession.status)}
            </Badge>
          ) : null}
        </Group>
        <MarkdownContent
          className="markdown-muted markdown-small"
          content={getBoardTicketDescriptionPreview(ticket.description)}
          onTicketReferenceNavigate={controller.navigateToTicketReference}
          ticketReferences={ticket.ticket_references ?? []}
        />
        {ticket.linked_pr ? (
          <Group gap={8} wrap="wrap">
            <PullRequestStatusBadge linkedPr={ticket.linked_pr} />
            <Text
              component="a"
              href={ticket.linked_pr.url}
              target="_blank"
              rel="noreferrer"
              size="xs"
              c="blue"
              onClick={(event) => event.stopPropagation()}
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
            {controller.deleteTicketMutation.error?.message}
          </Text>
        ) : null}
        {showArchiveError ? (
          <Text size="sm" c="red">
            {controller.archiveTicketMutation.error?.message}
          </Text>
        ) : null}
        {showResumeError ? (
          <Text size="sm" c="red">
            {controller.resumeTicketMutation.error?.message}
          </Text>
        ) : null}
        {showRestartError ? (
          <Text size="sm" c="red">
            {controller.restartTicketMutation.error?.message}
          </Text>
        ) : null}
        {showStopError ? (
          <Text size="sm" c="red">
            {controller.stopTicketMutation.error?.message}
          </Text>
        ) : null}
        {showStopAiReviewError ? (
          <Text size="sm" c="red">
            {controller.stopAgentReviewMutation.error?.message}
          </Text>
        ) : null}
        {showEditError ? (
          <Text size="sm" c="red">
            {controller.editReadyTicketMutation.error?.message}
          </Text>
        ) : null}
        {showMergeError ? (
          <Text size="sm" c="red">
            {controller.mergeTicketMutation.error?.message}
          </Text>
        ) : null}
        {showCreatePrError ? (
          <Text size="sm" c="red">
            {controller.createPullRequestMutation.error?.message}
          </Text>
        ) : null}
        {showStartPlanError || showStartNowError ? (
          <Text size="sm" c="red">
            {controller.startTicketMutation.error?.message}
          </Text>
        ) : null}

        {column === "ready" ? (
          <Group justify="flex-end" align="flex-end" gap="xs">
            <Group gap="xs">
              <Button
                className={projectAccentButtonClassName("light")}
                variant="light"
                size="xs"
                loading={
                  controller.startTicketMutation.isPending &&
                  controller.startTicketMutation.variables?.ticketId ===
                    ticket.id &&
                  controller.startTicketMutation.variables.planningEnabled
                }
                onClick={() =>
                  controller.startTicketMutation.mutate({
                    ticketId: ticket.id,
                    planningEnabled: true,
                  })
                }
              >
                Start with Plan
              </Button>
              <Button
                className={projectAccentButtonClassName("filled")}
                size="xs"
                loading={
                  controller.startTicketMutation.isPending &&
                  controller.startTicketMutation.variables?.ticketId ===
                    ticket.id &&
                  !controller.startTicketMutation.variables.planningEnabled
                }
                onClick={() =>
                  controller.startTicketMutation.mutate({
                    ticketId: ticket.id,
                    planningEnabled: false,
                  })
                }
              >
                Start Now
              </Button>
            </Group>
          </Group>
        ) : column === "review" ? (
          (() => {
            const reviewAiReviewActive =
              controller.ticketAiReviewActiveById.get(ticket.id) === true;
            const reviewActions = resolveReviewCardActions(
              controller.selectedProject,
              ticket,
            );
            const primaryAction = reviewActions.primary;
            if (!primaryAction) {
              return null;
            }

            return (
              <Group justify="flex-end" gap="xs">
                <Button
                  className={projectAccentButtonClassName("filled")}
                  size="xs"
                  variant="filled"
                  loading={
                    primaryAction.kind === "merge"
                      ? controller.mergeTicketMutation.isPending &&
                        controller.mergeTicketMutation.variables === ticket.id
                      : primaryAction.kind === "create_pr"
                        ? controller.createPullRequestMutation.isPending &&
                          controller.createPullRequestMutation.variables ===
                            ticket.id
                        : false
                  }
                  disabled={
                    reviewAiReviewActive &&
                    (primaryAction.kind === "merge" ||
                      primaryAction.kind === "create_pr")
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    if (primaryAction.kind === "merge") {
                      controller.mergeTicketMutation.mutate(ticket.id);
                      return;
                    }

                    if (primaryAction.kind === "create_pr") {
                      controller.createPullRequestMutation.mutate(ticket.id);
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
}
