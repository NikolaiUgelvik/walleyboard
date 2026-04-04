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
  TextInput,
  Title,
} from "@mantine/core";
import {
  IconActivityHeartbeat,
  IconBrowser,
  IconFileDiff,
  IconPlayerStop,
  IconTerminal2,
} from "@tabler/icons-react";
import type React from "react";
import type {
  ExecutionSession,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import { MarkdownContent } from "../../components/MarkdownContent.js";
import { SectionCard } from "../../components/SectionCard.js";
import { formatDraftStatusLabel } from "../../lib/draft-status.js";
import { getBoardTicketDescriptionPreview } from "../../lib/ticket-description-preview.js";
import {
  boardColumnMeta,
  boardColumns,
  ColorSchemeControl,
  describePullRequestStatus,
  hasActiveLinkedPullRequest,
  humanizeSessionStatus,
  humanizeTicketStatus,
  isStoppableSessionStatus,
  resolveReviewCardActions,
  sessionStatusColor,
  ticketStatusColor,
} from "./shared.js";
import type { WalleyBoardController } from "./use-walleyboard-controller.js";

function TicketMenu({
  controller,
  project,
  ticket,
  ticketSession,
}: {
  controller: WalleyBoardController;
  project: WalleyBoardController["selectedProject"];
  ticket: TicketFrontmatter;
  ticketSession: ExecutionSession | null;
}) {
  const canResume = ticketSession?.status === "interrupted";
  const canRestart = ticketSession?.status === "interrupted";
  const reviewActions = resolveReviewCardActions(project, ticket);
  const isResuming =
    controller.resumeTicketMutation.isPending &&
    controller.resumeTicketMutation.variables?.ticketId === ticket.id;
  const isRestarting =
    controller.restartTicketMutation.isPending &&
    controller.restartTicketMutation.variables?.ticketId === ticket.id;
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
              reviewActions.secondary.kind === "create_pr"
                ? isCreatingPullRequest
                : isMerging
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
}: {
  controller: WalleyBoardController;
  ticket: TicketFrontmatter;
}): React.JSX.Element {
  const ticketSession = ticket.session_id
    ? (controller.sessionById.get(ticket.session_id) ??
      (controller.session?.id === ticket.session_id
        ? controller.session
        : null))
    : null;
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
  const diffDisabled =
    ticket.session_id === null ||
    (!hasPreparedWorktree && ticket.status !== "done");
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
          aria-label="Open worktree diff"
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
        <ActionIcon
          aria-label={previewLabel}
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
            <IconBrowser size={16} />
          )}
        </ActionIcon>
        <ActionIcon
          aria-label="Open activity stream"
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
  controller: WalleyBoardController;
}): React.JSX.Element | null {
  if (!controller.selectedProject || !controller.selectedRepository) {
    return null;
  }

  const preview = controller.repositoryWorkspacePreview;
  const previewRunning = preview?.state === "ready";
  const previewBusy =
    preview?.state === "starting" || controller.repositoryPreviewActionPending;
  const previewLabel = previewRunning ? "Turn off dev server" : "Preview";

  return (
    <Stack gap={6} align="flex-end">
      <Button.Group>
        <Button
          aria-label={previewLabel}
          disabled={previewBusy}
          leftSection={
            previewBusy ? <Loader size={14} /> : <IconBrowser size={16} />
          }
          size="compact-sm"
          variant="light"
          onClick={controller.handleSelectedRepositoryPreviewAction}
        >
          {previewRunning ? "Stop Preview" : "Preview"}
        </Button>
        <Button
          aria-label="Open project terminal"
          disabled={controller.repositoryTerminalPending}
          leftSection={<IconTerminal2 size={16} />}
          size="compact-sm"
          variant="light"
          onClick={controller.openSelectedRepositoryWorkspaceTerminal}
        >
          Terminal
        </Button>
      </Button.Group>
      {controller.repositoryPreviewActionError ? (
        <Text size="sm" c="red">
          {controller.repositoryPreviewActionError}
        </Text>
      ) : preview?.error ? (
        <Text size="sm" c="red">
          {preview.error}
        </Text>
      ) : null}
    </Stack>
  );
}

export function BoardView({
  controller,
}: {
  controller: WalleyBoardController;
}) {
  return (
    <Box className="walleyboard-main">
      <Stack className="workbench-shell" gap="md">
        <Box className="workbench-header">
          <Group justify="space-between" align="flex-start">
            <Stack gap={6}>
              <Text className="rail-kicker">Project board</Text>
              <Title order={1} style={{ letterSpacing: "-0.05em" }}>
                {controller.selectedProject
                  ? controller.selectedProject.name
                  : "Select a project"}
              </Title>
              <Text size="sm" c="dimmed" maw={820}>
                {controller.selectedProject
                  ? `${controller.selectedRepository?.name ?? "Repository pending"} • ${controller.selectedRepository?.validation_profile.length ?? 0} validation command(s)`
                  : "Choose a project from the left rail to bring its drafts, tickets, and sessions into the board."}
              </Text>
            </Stack>
            <Stack gap="xs" align="flex-end">
              <ProjectWorkspaceActions controller={controller} />
              <ColorSchemeControl />
            </Stack>
          </Group>
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
              variant={controller.archiveModalOpen ? "filled" : "light"}
              radius="xl"
              onClick={controller.openArchiveModal}
            >
              Archive
            </Button>
            <Button
              disabled={!controller.selectedProject}
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
          <Box className="board-scroller">
            <Box className="board-grid">
              {boardColumns.map((column) => {
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
                        <Badge variant="outline">{columnCount}</Badge>
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
                                  controller.doneColumnTickets.length === 0 ||
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

                    <Box
                      className="board-column-stack"
                      onClick={controller.hideInspector}
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
                                    content={draft.description_draft}
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
                                    {draft.proposed_acceptance_criteria.length >
                                    0
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
                          const ticketSession =
                            ticket.session_id !== null
                              ? (controller.sessionById.get(
                                  ticket.session_id,
                                ) ?? null)
                              : null;
                          const canStop =
                            ticket.status === "in_progress" &&
                            ticketSession !== null &&
                            isStoppableSessionStatus(ticketSession.status);
                          const isSelected =
                            ticket.session_id !== null &&
                            ticket.session_id === controller.selectedSessionId;
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
                          const showEditError =
                            controller.editReadyTicketMutation.isError &&
                            controller.editReadyTicketMutation.variables?.ticket
                              .id === ticket.id;
                          const showMergeError =
                            controller.mergeTicketMutation.isError &&
                            controller.mergeTicketMutation.variables ===
                              ticket.id;
                          const showCreatePrError =
                            controller.createPullRequestMutation.isError &&
                            controller.createPullRequestMutation.variables ===
                              ticket.id;
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
                            (controller.startAgentReviewMutation.isPending &&
                              controller.startAgentReviewMutation.variables ===
                                ticket.id);
                          const diffLineSummary =
                            ticket.status === "in_progress" ||
                            ticket.status === "review"
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
                                <Group
                                  justify="space-between"
                                  align="flex-start"
                                >
                                  <Stack gap={2}>
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
                                    </Text>
                                  </Stack>
                                  <Group gap={6} align="center">
                                    {aiReviewActive ? (
                                      <Badge variant="light" color="violet">
                                        AI review in progress
                                      </Badge>
                                    ) : null}
                                    <Badge
                                      variant="light"
                                      color={ticketStatusColor(ticket.status)}
                                    >
                                      {humanizeTicketStatus(ticket.status)}
                                    </Badge>
                                    <TicketMenu
                                      controller={controller}
                                      project={controller.selectedProject}
                                      ticket={ticket}
                                      ticketSession={ticketSession}
                                    />
                                  </Group>
                                </Group>
                                {diffLineSummary ? (
                                  <Group gap={6} wrap="wrap">
                                    <Badge variant="outline" color="gray">
                                      {diffLineSummary.files}{" "}
                                      {diffLineSummary.files === 1
                                        ? "file changed"
                                        : "files changed"}
                                    </Badge>
                                    <Badge variant="outline" color="green">
                                      +{diffLineSummary.additions}
                                    </Badge>
                                    <Badge variant="outline" color="red">
                                      -{diffLineSummary.deletions}
                                    </Badge>
                                  </Group>
                                ) : null}
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
                                    <Badge
                                      variant="outline"
                                      color={
                                        ticket.linked_pr.state === "merged"
                                          ? "green"
                                          : ticket.linked_pr.review_status ===
                                              "changes_requested"
                                            ? "red"
                                            : ticket.linked_pr.review_status ===
                                                "approved"
                                              ? "green"
                                              : "blue"
                                      }
                                    >
                                      PR #{ticket.linked_pr.number}
                                    </Badge>
                                    <Text size="xs" c="dimmed">
                                      {describePullRequestStatus(
                                        ticket.linked_pr,
                                      )}
                                    </Text>
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
                                {ticketSession ? (
                                  <Group gap={8}>
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
                                    {ticketSession.status === "queued" ? (
                                      <Text size="xs" c="dimmed">
                                        Waiting for a running slot
                                      </Text>
                                    ) : null}
                                  </Group>
                                ) : null}
                                <TicketWorkspaceActions
                                  controller={controller}
                                  ticket={ticket}
                                />

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
                                {showEditError ? (
                                  <Text size="sm" c="red">
                                    {
                                      controller.editReadyTicketMutation.error
                                        ?.message
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
                                      controller.createPullRequestMutation.error
                                        ?.message
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
                                    const reviewActions =
                                      resolveReviewCardActions(
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
                                          size="xs"
                                          variant={
                                            primaryAction.kind === "open_pr"
                                              ? "light"
                                              : "filled"
                                          }
                                          loading={
                                            primaryAction.kind === "merge"
                                              ? controller.mergeTicketMutation
                                                  .isPending &&
                                                controller.mergeTicketMutation
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
                                              primaryAction.kind === "create_pr"
                                            ) {
                                              controller.createPullRequestMutation.mutate(
                                                ticket.id,
                                              );
                                              return;
                                            }

                                            if (
                                              primaryAction.kind ===
                                                "open_pr" &&
                                              hasActiveLinkedPullRequest(
                                                ticket.linked_pr,
                                              )
                                            ) {
                                              window.open(
                                                ticket.linked_pr.url,
                                                "_blank",
                                                "noopener,noreferrer",
                                              );
                                            }
                                          }}
                                        >
                                          {primaryAction.label}
                                        </Button>
                                      </Group>
                                    );
                                  })()
                                ) : ticket.session_id ? (
                                  <Group justify="flex-end" gap="xs">
                                    {canStop ? (
                                      <Button
                                        color="orange"
                                        variant="light"
                                        size="xs"
                                        loading={
                                          controller.stopTicketMutation
                                            .isPending &&
                                          controller.stopTicketMutation
                                            .variables?.ticketId === ticket.id
                                        }
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          controller.stopTicketMutation.mutate({
                                            ticketId: ticket.id,
                                          });
                                        }}
                                      >
                                        Stop
                                      </Button>
                                    ) : null}
                                  </Group>
                                ) : null}
                              </Stack>
                            </Box>
                          );
                        })
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}
      </Stack>
    </Box>
  );
}
