import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Menu,
  Stack,
  Text,
} from "@mantine/core";
import type React from "react";
import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";

import { MarkdownContent } from "../../components/MarkdownContent.js";
import { formatDraftStatusLabel } from "../../lib/draft-status.js";
import { getBoardTicketDescriptionPreview } from "../../lib/ticket-description-preview.js";
import {
  BoardColumnScrollArea,
  DraftMenu,
  TicketMenu,
  TicketWorkspaceActions,
} from "./board-workspace-actions.js";
import { PullRequestStatusBadge } from "./PullRequestStatusBadge.js";
import { boardColumnMeta, columnBadgeStyle } from "./shared.js";
import {
  humanizeSessionStatus,
  resolveReviewCardActions,
  sessionStatusColor,
} from "./shared-utils.js";
import { projectAccentButtonClassName } from "./view-helpers.js";
import type { BoardViewController } from "./walleyboard-view-state.js";

type BoardColumnName = "draft" | "ready" | "in_progress" | "review" | "done";

function BoardCardError({
  error,
}: {
  error: string | undefined;
}): React.JSX.Element | null {
  if (!error) {
    return null;
  }

  return (
    <Text size="sm" c="red">
      {error}
    </Text>
  );
}

function BoardDraftCard({
  controller,
  draft,
}: {
  controller: BoardViewController;
  draft: BoardViewController["visibleDrafts"][number];
}) {
  const repository =
    controller.repositories.find(
      (item) => item.id === (draft.confirmed_repo_id ?? draft.proposed_repo_id),
    ) ?? controller.selectedRepository;
  const isSelected = draft.id === controller.selectedDraftId;

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
        <Group justify="space-between" align="flex-start">
          <Box style={{ fontWeight: 700, lineHeight: 1.35 }}>
            <MarkdownContent
              content={draft.title_draft}
              inline
              onTicketReferenceNavigate={controller.navigateToTicketReference}
              ticketReferences={draft.ticket_references ?? []}
            />
          </Box>
          <Group gap="xs" wrap="nowrap">
            <Badge variant="light" color="gray">
              {formatDraftStatusLabel({
                isRefining: controller.isDraftRefinementActive(draft.id),
                wizardStatus: draft.wizard_status,
              })}
            </Badge>
            <DraftMenu controller={controller} draftId={draft.id} />
          </Group>
        </Group>
        <MarkdownContent
          className="markdown-muted markdown-small"
          content={getBoardTicketDescriptionPreview(draft.description_draft)}
          onTicketReferenceNavigate={controller.navigateToTicketReference}
          ticketReferences={draft.ticket_references ?? []}
        />
        <Text className="board-card-meta">
          Repository: {repository?.name ?? "unassigned"}
        </Text>
        <Text className="board-card-meta">
          {draft.proposed_acceptance_criteria.length > 0
            ? `${draft.proposed_acceptance_criteria.length} acceptance criteria ready`
            : "Run refinement to generate acceptance criteria"}
        </Text>
      </Stack>
    </Box>
  );
}

function BoardTicketCard({
  column,
  controller,
  ticket,
}: {
  column: BoardColumnName;
  controller: BoardViewController;
  ticket: TicketFrontmatter;
}) {
  const ticketSession = ticket.session_id
    ? (controller.sessionById.get(ticket.session_id) ??
      controller.session ??
      null)
    : null;
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
      key={ticket.id}
      id={`ticket-${ticket.id}`}
      tabIndex={-1}
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
            <Box style={{ fontWeight: 700, lineHeight: 1.35 }}>
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
                    style={{ color: "var(--mantine-color-green-6)" }}
                  >
                    +{diffLineSummary.additions}
                  </Box>{" "}
                  <Box
                    component="span"
                    style={{ color: "var(--mantine-color-red-6)" }}
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

        <BoardCardError
          error={
            showDeleteError
              ? controller.deleteTicketMutation.error?.message
              : undefined
          }
        />
        <BoardCardError
          error={
            showArchiveError
              ? controller.archiveTicketMutation.error?.message
              : undefined
          }
        />
        <BoardCardError
          error={
            showResumeError
              ? controller.resumeTicketMutation.error?.message
              : undefined
          }
        />
        <BoardCardError
          error={
            showRestartError
              ? controller.restartTicketMutation.error?.message
              : undefined
          }
        />
        <BoardCardError
          error={
            showStopError
              ? controller.stopTicketMutation.error?.message
              : undefined
          }
        />
        <BoardCardError
          error={
            showStopAiReviewError
              ? controller.stopAgentReviewMutation.error?.message
              : undefined
          }
        />
        <BoardCardError
          error={
            showEditError
              ? controller.editReadyTicketMutation.error?.message
              : undefined
          }
        />
        <BoardCardError
          error={
            showMergeError
              ? controller.mergeTicketMutation.error?.message
              : undefined
          }
        />
        <BoardCardError
          error={
            showCreatePrError
              ? controller.createPullRequestMutation.error?.message
              : undefined
          }
        />
        <BoardCardError
          error={
            showStartPlanError || showStartNowError
              ? controller.startTicketMutation.error?.message
              : undefined
          }
        />

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
            const aiReviewActiveNow =
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
                    aiReviewActiveNow &&
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

export function BoardColumn({
  column,
  columnIndex,
  controller,
  registerViewport,
}: {
  column: BoardColumnName;
  columnIndex: number;
  controller: BoardViewController;
  registerViewport: (
    columnIndex: number,
    viewport: HTMLDivElement | null,
  ) => void;
}) {
  const meta = boardColumnMeta[column];
  const columnCount =
    column === "draft"
      ? controller.visibleDrafts.length
      : controller.groupedTickets[column].length;

  return (
    <Box className="board-column">
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
              <Menu.Dropdown onClick={(event) => event.stopPropagation()}>
                <Menu.Item
                  onClick={(event) => {
                    event.stopPropagation();
                    controller.openNewDraft();
                  }}
                >
                  New
                </Menu.Item>
                <Menu.Item
                  disabled={controller.unrefinedDrafts.length === 0}
                  onClick={(event) => {
                    event.stopPropagation();
                    controller.refineAllUnrefinedDrafts();
                  }}
                >
                  Refine all
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
              <Menu.Dropdown onClick={(event) => event.stopPropagation()}>
                <Menu.Item
                  disabled={
                    controller.doneColumnTickets.length === 0 ||
                    controller.archiveDoneTicketsMutation.isPending
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    controller.archiveDoneTickets(controller.doneColumnTickets);
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
        registerViewport={registerViewport}
      >
        {column === "draft" ? (
          controller.visibleDrafts.length === 0 ? (
            <Box className="board-empty">{meta.empty}</Box>
          ) : (
            controller.visibleDrafts.map((draft) => (
              <BoardDraftCard
                key={draft.id}
                controller={controller}
                draft={draft}
              />
            ))
          )
        ) : controller.groupedTickets[column].length === 0 ? (
          <Box className="board-empty">{meta.empty}</Box>
        ) : (
          controller.groupedTickets[column].map((ticket) => (
            <BoardTicketCard
              key={ticket.id}
              column={column}
              controller={controller}
              ticket={ticket}
            />
          ))
        )}
      </BoardColumnScrollArea>
    </Box>
  );
}
