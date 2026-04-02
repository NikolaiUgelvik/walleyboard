import {
  Badge,
  Box,
  Button,
  Code,
  Group,
  List,
  Loader,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";

import { MarkdownContent } from "../../components/MarkdownContent.js";
import { SectionCard } from "../../components/SectionCard.js";
import { SessionActivityFeed } from "../../components/SessionActivityFeed.js";
import { SessionTerminalPanel } from "../../components/SessionTerminalPanel.js";
import { TicketWorkspaceDiffPanel } from "../../components/TicketWorkspaceDiffPanel.js";
import { TicketWorkspacePreviewPanel } from "../../components/TicketWorkspacePreviewPanel.js";
import {
  DraftEventResultView,
  DraftQuestionsResultView,
  MarkdownListItems,
  formatTimestamp,
  humanizePlanStatus,
  humanizeSessionStatus,
  isStoppableSessionStatus,
  parseDraftEventMeta,
  sessionStatusColor,
} from "./shared.js";
import type { OrchestratorController } from "./use-orchestrator-controller.js";

function DraftEditorFields({
  controller,
}: {
  controller: OrchestratorController;
}) {
  return (
    <>
      <TextInput
        id="draft-title"
        name="draftTitle"
        label="Title"
        placeholder="Add saved preset layouts"
        value={controller.draftEditorTitle}
        onChange={(event) =>
          controller.setDraftEditorTitle(event.currentTarget.value)
        }
        required
      />
      <Textarea
        id="draft-description"
        label="Description"
        description="Markdown is stored literally. Paste a screenshot from the clipboard to insert a hosted image reference."
        placeholder="Users should be able to save and reuse receipt layout presets."
        value={controller.draftEditorDescription}
        onChange={(event) =>
          controller.setDraftEditorDescription(event.currentTarget.value)
        }
        onPaste={controller.handleDraftDescriptionTextareaPaste}
        autosize
        minRows={10}
        required
      />
      {controller.uploadDraftArtifactMutation.isPending ? (
        <Text size="sm" c="dimmed">
          Uploading pasted screenshot...
        </Text>
      ) : null}
      {controller.draftEditorUploadError ? (
        <Text size="sm" c="red">
          {controller.draftEditorUploadError}
        </Text>
      ) : null}
      <Select
        label="Ticket type"
        data={[
          { value: "feature", label: "Feature" },
          { value: "bugfix", label: "Bugfix" },
          { value: "chore", label: "Chore" },
          { value: "research", label: "Research" },
        ]}
        clearable
        value={controller.draftEditorTicketType}
        onChange={(value) => {
          if (
            value === null ||
            value === "feature" ||
            value === "bugfix" ||
            value === "chore" ||
            value === "research"
          ) {
            controller.setDraftEditorTicketType(value);
          }
        }}
      />
      <Textarea
        id="draft-acceptance-criteria"
        label="Acceptance criteria"
        description="One Markdown acceptance criterion per line."
        value={controller.draftEditorAcceptanceCriteria}
        onChange={(event) =>
          controller.setDraftEditorAcceptanceCriteria(event.currentTarget.value)
        }
        autosize
        minRows={10}
      />
    </>
  );
}

export function InspectorPane({
  controller,
}: {
  controller: OrchestratorController;
}) {
  if (!controller.inspectorVisible) {
    return null;
  }

  const selectedDraft = controller.selectedDraft;
  const selectedSessionTicket = controller.selectedSessionTicket;
  const session = controller.session;

  return (
    <Box className="orchestrator-detail">
      <Stack gap="md">
        {controller.inspectorState.kind === "new_draft" &&
        controller.draftEditorProject ? (
          <SectionCard
            title="New draft"
            description="Work in the composer first. Save the draft directly, or let Codex create it automatically when you refine, ask questions, or create a ready ticket."
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                controller.handleSaveNewDraft();
              }}
            >
              <Stack gap="md">
                <Group justify="space-between" align="flex-start">
                  <Stack gap={4}>
                    <Text className="rail-kicker">Draft</Text>
                    <Box style={{ fontWeight: 700 }}>
                      <MarkdownContent
                        content={
                          controller.draftEditorTitle.trim().length > 0
                            ? controller.draftEditorTitle
                            : "Unsaved draft"
                        }
                        inline
                      />
                    </Box>
                  </Stack>
                  <Badge variant="light" color="gray">
                    unsaved
                  </Badge>
                </Group>

                <Box className="detail-meta-grid">
                  <Box className="detail-meta-card">
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                      Repository
                    </Text>
                    <Text fw={700}>
                      {controller.draftEditorRepository?.name ?? "Unassigned"}
                    </Text>
                  </Box>
                  <Box className="detail-meta-card">
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                      Acceptance criteria
                    </Text>
                    <Text fw={700}>
                      {controller.draftEditorAcceptanceCriteriaLines.length}
                    </Text>
                  </Box>
                </Box>

                <DraftEditorFields controller={controller} />

                <Text size="sm" c="dimmed">
                  Refine, Questions, and Create Ready will save the draft
                  automatically before they continue.
                </Text>

                {controller.createDraftMutation.isError ? (
                  <Text size="sm" c="red">
                    {controller.createDraftMutation.error.message}
                  </Text>
                ) : null}

                <Group justify="space-between" align="flex-start">
                  <Button
                    type="button"
                    color="red"
                    variant="subtle"
                    onClick={controller.hideInspector}
                  >
                    Discard Draft
                  </Button>
                  <Group gap="xs" justify="flex-end">
                    <Button
                      type="submit"
                      variant="light"
                      disabled={
                        !controller.draftEditorCanPersist ||
                        controller.createDraftMutation.isPending
                      }
                      loading={
                        controller.createDraftMutation.isPending &&
                        controller.pendingNewDraftAction === "save"
                      }
                    >
                      Save Draft
                    </Button>
                    <Button
                      type="button"
                      variant="light"
                      disabled={
                        !controller.draftEditorCanPersist ||
                        controller.createDraftMutation.isPending ||
                        !controller.draftEditorRepository
                      }
                      loading={
                        controller.createDraftMutation.isPending &&
                        controller.pendingNewDraftAction === "refine"
                      }
                      onClick={controller.handleRefineNewDraft}
                    >
                      Refine
                    </Button>
                    <Button type="button" variant="light" disabled>
                      Revert Refine
                    </Button>
                    <Button
                      type="button"
                      variant="light"
                      disabled={
                        !controller.draftEditorCanPersist ||
                        controller.createDraftMutation.isPending ||
                        !controller.draftEditorRepository
                      }
                      loading={
                        controller.createDraftMutation.isPending &&
                        controller.pendingNewDraftAction === "questions"
                      }
                      onClick={controller.handleQuestionNewDraft}
                    >
                      Questions?
                    </Button>
                    <Button
                      type="button"
                      disabled={
                        !controller.draftEditorCanPersist ||
                        !controller.draftEditorProject ||
                        !controller.draftEditorRepository ||
                        controller.createDraftMutation.isPending
                      }
                      loading={
                        controller.createDraftMutation.isPending &&
                        controller.pendingNewDraftAction === "confirm"
                      }
                      onClick={controller.handleConfirmNewDraft}
                    >
                      Create Ready
                    </Button>
                  </Group>
                </Group>

                <Stack gap="xs">
                  <Text fw={700}>History</Text>
                  <Text size="sm" c="dimmed">
                    No refinement or feasibility runs yet.
                  </Text>
                </Stack>
              </Stack>
            </form>
          </SectionCard>
        ) : null}

        {controller.inspectorState.kind === "draft" &&
        controller.selectedDraft ? (
          <SectionCard
            title="Draft inspector"
            description="Edit the draft directly, then use Codex to refine it or check feasibility."
          >
            <Stack gap="md">
              <Group justify="space-between" align="flex-start">
                <Stack gap={4}>
                  <Text className="rail-kicker">Draft</Text>
                  <Box style={{ fontWeight: 700 }}>
                    <MarkdownContent
                      content={controller.selectedDraft.title_draft}
                      inline
                    />
                  </Box>
                </Stack>
                <Group gap="xs">
                  {controller.draftAnalysisActive ? (
                    <Badge variant="light" color="blue">
                      Codex running
                    </Badge>
                  ) : null}
                  <Badge variant="light" color="gray">
                    {controller.selectedDraft.wizard_status.replace(/_/g, " ")}
                  </Badge>
                </Group>
              </Group>

              <Box className="detail-meta-grid">
                <Box className="detail-meta-card">
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                    Repository
                  </Text>
                  <Text fw={700}>
                    {controller.selectedDraftRepository?.name ?? "Unassigned"}
                  </Text>
                </Box>
                <Box className="detail-meta-card">
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                    Acceptance criteria
                  </Text>
                  <Text fw={700}>
                    {
                      controller.selectedDraft.proposed_acceptance_criteria
                        .length
                    }
                  </Text>
                </Box>
              </Box>

              <DraftEditorFields controller={controller} />

              {controller.draftFormDirty ? (
                <Text size="sm" c="dimmed">
                  Save changes before refining, asking questions, or creating a
                  ready ticket.
                </Text>
              ) : null}

              {controller.saveDraftMutation.isError &&
              controller.saveDraftMutation.variables?.draftId ===
                controller.selectedDraft.id ? (
                <Text size="sm" c="red">
                  {controller.saveDraftMutation.error.message}
                </Text>
              ) : null}
              {controller.refineDraftMutation.isError &&
              controller.refineDraftMutation.variables ===
                controller.selectedDraft.id ? (
                <Text size="sm" c="red">
                  {controller.refineDraftMutation.error.message}
                </Text>
              ) : null}
              {controller.revertDraftRefineMutation.isError &&
              controller.revertDraftRefineMutation.variables ===
                controller.selectedDraft.id ? (
                <Text size="sm" c="red">
                  {controller.revertDraftRefineMutation.error.message}
                </Text>
              ) : null}
              {controller.questionDraftMutation.isError &&
              controller.questionDraftMutation.variables ===
                controller.selectedDraft.id ? (
                <Text size="sm" c="red">
                  {controller.questionDraftMutation.error.message}
                </Text>
              ) : null}
              {controller.confirmDraftMutation.isError &&
              controller.confirmDraftMutation.variables?.draftId ===
                controller.selectedDraft.id ? (
                <Text size="sm" c="red">
                  {controller.confirmDraftMutation.error.message}
                </Text>
              ) : null}
              {controller.deleteDraftMutation.isError &&
              controller.deleteDraftMutation.variables ===
                controller.selectedDraft.id ? (
                <Text size="sm" c="red">
                  {controller.deleteDraftMutation.error.message}
                </Text>
              ) : null}

              <Group justify="space-between" align="flex-start">
                <Button
                  color="red"
                  variant="subtle"
                  loading={
                    controller.deleteDraftMutation.isPending &&
                    controller.deleteDraftMutation.variables ===
                      selectedDraft?.id
                  }
                  onClick={() => {
                    if (!selectedDraft) {
                      return;
                    }

                    controller.deleteDraftMutation.mutate(selectedDraft.id);
                  }}
                >
                  Delete Draft
                </Button>
                <Group gap="xs" justify="flex-end">
                  <Button
                    variant="light"
                    disabled={
                      !controller.draftFormDirty ||
                      controller.draftAnalysisActive
                    }
                    loading={
                      controller.saveDraftMutation.isPending &&
                      controller.saveDraftMutation.variables?.draftId ===
                        selectedDraft?.id
                    }
                    onClick={() => {
                      if (!selectedDraft) {
                        return;
                      }

                      controller.saveDraftMutation.mutate({
                        draftId: selectedDraft.id,
                        titleDraft: controller.draftEditorTitle,
                        descriptionDraft: controller.draftEditorDescription,
                        proposedTicketType: controller.draftEditorTicketType,
                        proposedAcceptanceCriteria:
                          controller.draftEditorAcceptanceCriteriaLines,
                      });
                    }}
                  >
                    Save Changes
                  </Button>
                  <Button
                    variant="light"
                    disabled={
                      controller.draftFormDirty ||
                      controller.draftAnalysisActive ||
                      !controller.selectedDraftRepository
                    }
                    loading={
                      controller.refineDraftMutation.isPending &&
                      controller.refineDraftMutation.variables ===
                        selectedDraft?.id
                    }
                    onClick={() => {
                      if (!selectedDraft) {
                        return;
                      }

                      controller.setPendingDraftEditorSync(
                        controller.capturePendingDraftEditorSync({
                          draftId: selectedDraft.id,
                          sourceUpdatedAt: selectedDraft.updated_at,
                        }),
                      );
                      controller.refineDraftMutation.mutate(selectedDraft.id);
                    }}
                  >
                    Refine
                  </Button>
                  <Button
                    variant="light"
                    disabled={
                      controller.draftFormDirty ||
                      controller.draftAnalysisActive ||
                      !controller.latestRevertableRefineEvent
                    }
                    loading={
                      controller.revertDraftRefineMutation.isPending &&
                      controller.revertDraftRefineMutation.variables ===
                        selectedDraft?.id
                    }
                    onClick={() => {
                      if (!selectedDraft) {
                        return;
                      }

                      controller.setPendingDraftEditorSync(
                        controller.capturePendingDraftEditorSync({
                          draftId: selectedDraft.id,
                          sourceUpdatedAt: selectedDraft.updated_at,
                        }),
                      );
                      controller.revertDraftRefineMutation.mutate(
                        selectedDraft.id,
                      );
                    }}
                  >
                    Revert Refine
                  </Button>
                  <Button
                    variant="light"
                    disabled={
                      controller.draftFormDirty ||
                      controller.draftAnalysisActive ||
                      !controller.selectedDraftRepository
                    }
                    loading={
                      controller.questionDraftMutation.isPending &&
                      controller.questionDraftMutation.variables ===
                        selectedDraft?.id
                    }
                    onClick={() => {
                      if (!selectedDraft) {
                        return;
                      }

                      controller.questionDraftMutation.mutate(selectedDraft.id);
                    }}
                  >
                    Questions?
                  </Button>
                  <Button
                    disabled={
                      !controller.selectedDraftRepository ||
                      !controller.selectedProject ||
                      controller.draftFormDirty ||
                      controller.saveDraftMutation.isPending
                    }
                    loading={
                      controller.confirmDraftMutation.isPending &&
                      controller.confirmDraftMutation.variables?.draftId ===
                        selectedDraft?.id
                    }
                    onClick={() => {
                      if (
                        !selectedDraft ||
                        !controller.selectedDraftRepository ||
                        !controller.selectedProject
                      ) {
                        return;
                      }

                      controller.confirmDraftMutation.mutate({
                        draftId: selectedDraft.id,
                        title: controller.draftEditorTitle,
                        description: controller.draftEditorDescription,
                        ticketType: controller.draftEditorTicketType,
                        acceptanceCriteria:
                          controller.draftEditorAcceptanceCriteriaLines,
                        repository: controller.selectedDraftRepository,
                        project: controller.selectedProject,
                      });
                    }}
                  >
                    Create Ready
                  </Button>
                </Group>
              </Group>

              {controller.latestQuestionsResult ? (
                <Box className="detail-placeholder">
                  <DraftQuestionsResultView
                    result={controller.latestQuestionsResult}
                  />
                </Box>
              ) : null}

              <Stack gap="xs">
                <Text fw={700}>History</Text>
                {controller.draftEventsQuery.isPending ? (
                  <Loader size="sm" />
                ) : controller.draftEventsQuery.isError ? (
                  <Text size="sm" c="red">
                    {controller.draftEventsQuery.error.message}
                  </Text>
                ) : controller.draftEvents.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    No refinement or feasibility runs yet.
                  </Text>
                ) : (
                  controller.draftEvents.map((event) => {
                    const meta = parseDraftEventMeta(event);
                    if (!meta) {
                      return null;
                    }

                    return (
                      <Box key={event.id} className="detail-meta-card">
                        <details>
                          <summary>
                            {meta.operation === "refine"
                              ? "Refine"
                              : "Questions"}{" "}
                            • {meta.status} •{" "}
                            {formatTimestamp(event.occurred_at)} •{" "}
                            <MarkdownContent content={meta.summary} inline />
                          </summary>
                          <Stack gap="xs" mt="sm">
                            {meta.error ? (
                              <Box c="red">
                                <MarkdownContent
                                  className="markdown-small"
                                  content={meta.error}
                                />
                              </Box>
                            ) : null}
                            {meta.result ? (
                              <DraftEventResultView result={meta.result} />
                            ) : null}
                          </Stack>
                        </details>
                      </Box>
                    );
                  })
                )}
              </Stack>
            </Stack>
          </SectionCard>
        ) : null}

        {controller.inspectorState.kind === "session" ? (
          <SectionCard
            title="Ticket workspace"
            description="Diff, terminal, preview, and session activity live together here."
          >
            {controller.selectedSessionId === null ? (
              <Text size="sm" c="dimmed">
                Session details are not available yet.
              </Text>
            ) : controller.sessionQuery.isPending ||
              controller.sessionLogsQuery.isPending ? (
              <Loader size="sm" />
            ) : controller.sessionQuery.isError ? (
              <Text size="sm" c="red">
                {controller.sessionQuery.error.message}
              </Text>
            ) : controller.session ? (
              <Stack gap="md">
                <Group justify="space-between" align="flex-start">
                  <Stack gap={4}>
                    <Text className="rail-kicker">Execution</Text>
                    <Box style={{ fontWeight: 700 }}>
                      {controller.selectedSessionTicket ? (
                        <>
                          <Text component="span" inherit>
                            #{controller.selectedSessionTicket.id}{" "}
                          </Text>
                          <MarkdownContent
                            content={controller.selectedSessionTicket.title}
                            inline
                          />
                        </>
                      ) : (
                        `Ticket #${controller.session.ticket_id}`
                      )}
                    </Box>
                  </Stack>
                  <Badge
                    variant="light"
                    color={sessionStatusColor(controller.session.status)}
                  >
                    {humanizeSessionStatus(controller.session.status)}
                  </Badge>
                </Group>

                <Box className="detail-meta-grid">
                  <Box className="detail-meta-card">
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                      Session
                    </Text>
                    <Text fw={700}>{controller.session.id}</Text>
                  </Box>
                  <Box className="detail-meta-card">
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                      Planning
                    </Text>
                    <Text fw={700}>
                      {controller.session.planning_enabled
                        ? "Enabled"
                        : "Disabled"}
                    </Text>
                  </Box>
                  <Box className="detail-meta-card">
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                      Plan stage
                    </Text>
                    <Text fw={700}>
                      {humanizePlanStatus(controller.session.plan_status)}
                    </Text>
                  </Box>
                  <Box className="detail-meta-card">
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                      Branch
                    </Text>
                    <Text fw={700}>
                      {controller.selectedSessionTicket?.working_branch ??
                        "Pending"}
                    </Text>
                  </Box>
                  <Box className="detail-meta-card">
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                      Worktree
                    </Text>
                    <Text className="inline-code">
                      {controller.session.worktree_path ?? "Pending"}
                    </Text>
                  </Box>
                </Box>

                {controller.selectedSessionTicket ? (
                  <Stack gap="xs">
                    <Text fw={700}>Ticket details</Text>
                    <MarkdownContent
                      className="markdown-muted markdown-small"
                      content={controller.selectedSessionTicket.description}
                    />
                    {controller.selectedSessionTicket.acceptance_criteria
                      .length > 0 ? (
                      <Stack gap={2}>
                        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                          Acceptance Criteria
                        </Text>
                        <MarkdownListItems
                          items={
                            controller.selectedSessionTicket.acceptance_criteria
                          }
                        />
                      </Stack>
                    ) : null}
                  </Stack>
                ) : null}

                {controller.session.status === "queued" ? (
                  <Text size="sm" c="dimmed">
                    This ticket is in progress and waiting for one of the
                    project's running slots to open.
                  </Text>
                ) : null}

                {controller.selectedSessionTicket ? (
                  <Group justify="space-between">
                    <Group gap="xs">
                      {controller.selectedSessionTicket.status ===
                        "in_progress" &&
                      controller.selectedSessionTicketSession &&
                      isStoppableSessionStatus(
                        controller.selectedSessionTicketSession.status,
                      ) ? (
                        <Button
                          color="orange"
                          variant="light"
                          size="xs"
                          loading={
                            controller.stopTicketMutation.isPending &&
                            controller.stopTicketMutation.variables
                              ?.ticketId === controller.selectedSessionTicket.id
                          }
                          onClick={() => {
                            if (!selectedSessionTicket) {
                              return;
                            }

                            controller.stopTicketMutation.mutate({
                              ticketId: selectedSessionTicket.id,
                            });
                          }}
                        >
                          Stop Ticket
                        </Button>
                      ) : null}
                    </Group>
                    <Button
                      color="red"
                      variant="subtle"
                      size="xs"
                      loading={
                        controller.deleteTicketMutation.isPending &&
                        controller.deleteTicketMutation.variables?.ticketId ===
                          controller.selectedSessionTicket.id
                      }
                      onClick={() => {
                        if (!selectedSessionTicket) {
                          return;
                        }

                        controller.deleteTicket(selectedSessionTicket);
                      }}
                    >
                      Delete Ticket
                    </Button>
                  </Group>
                ) : null}

                {controller.stopTicketMutation.isError ? (
                  <Text size="sm" c="red">
                    {controller.stopTicketMutation.error.message}
                  </Text>
                ) : null}
                {controller.deleteTicketMutation.isError ? (
                  <Text size="sm" c="red">
                    {controller.deleteTicketMutation.error.message}
                  </Text>
                ) : null}

                <Tabs
                  className="ticket-workspace-tabs"
                  value={controller.ticketWorkspaceTab}
                  onChange={(value) =>
                    controller.setTicketWorkspaceTab(
                      value as "diff" | "terminal" | "preview" | "activity",
                    )
                  }
                >
                  <Tabs.List grow>
                    <Tabs.Tab value="diff">Diff</Tabs.Tab>
                    <Tabs.Tab value="terminal">Terminal</Tabs.Tab>
                    <Tabs.Tab value="preview">Preview</Tabs.Tab>
                    <Tabs.Tab value="activity">Activity</Tabs.Tab>
                  </Tabs.List>

                  <Tabs.Panel
                    className="ticket-workspace-tab-panel"
                    value="diff"
                  >
                    <TicketWorkspaceDiffPanel
                      diff={controller.ticketWorkspaceDiff}
                      error={
                        controller.ticketWorkspaceDiffQuery.isError
                          ? controller.ticketWorkspaceDiffQuery.error.message
                          : null
                      }
                      isLoading={controller.ticketWorkspaceDiffQuery.isPending}
                      layout={controller.ticketWorkspaceDiffLayout}
                      onLayoutChange={controller.setTicketWorkspaceDiffLayout}
                    />
                  </Tabs.Panel>

                  <Tabs.Panel
                    className="ticket-workspace-tab-panel"
                    value="terminal"
                  >
                    {controller.session.worktree_path ? (
                      <SessionTerminalPanel
                        canTakeOver={
                          controller.selectedSessionTicket?.status ===
                            "in_progress" &&
                          controller.session.status !== "paused_user_control"
                        }
                        session={controller.session}
                        logs={controller.sessionLogs}
                        command={controller.terminalCommand}
                        onCommandChange={controller.setTerminalCommand}
                        onSendCommand={() => {
                          if (!controller.selectedSessionId) {
                            return;
                          }

                          controller.terminalInputMutation.mutate({
                            sessionId: controller.selectedSessionId,
                            body: controller.terminalCommand,
                          });
                        }}
                        onTakeOver={() => {
                          if (!session) {
                            return;
                          }

                          controller.terminalTakeoverMutation.mutate(
                            session.id,
                          );
                        }}
                        onRestoreAgent={() => {
                          if (!session) {
                            return;
                          }

                          controller.terminalRestoreMutation.mutate(session.id);
                        }}
                        sendLoading={controller.terminalInputMutation.isPending}
                        takeOverLoading={
                          controller.terminalTakeoverMutation.isPending &&
                          controller.terminalTakeoverMutation.variables ===
                            session?.id
                        }
                        restoreLoading={
                          controller.terminalRestoreMutation.isPending
                        }
                        error={
                          controller.terminalInputMutation.isError
                            ? controller.terminalInputMutation.error.message
                            : controller.terminalTakeoverMutation.isError
                              ? controller.terminalTakeoverMutation.error
                                  .message
                              : controller.terminalRestoreMutation.isError
                                ? controller.terminalRestoreMutation.error
                                    .message
                                : null
                        }
                      />
                    ) : (
                      <Text size="sm" c="dimmed">
                        The ticket worktree is still being prepared.
                      </Text>
                    )}
                  </Tabs.Panel>

                  <Tabs.Panel
                    className="ticket-workspace-tab-panel"
                    value="preview"
                  >
                    <TicketWorkspacePreviewPanel
                      error={
                        controller.ticketWorkspacePreviewQuery.isError
                          ? controller.ticketWorkspacePreviewQuery.error.message
                          : controller.startTicketWorkspacePreviewMutation
                                .isError
                            ? controller.startTicketWorkspacePreviewMutation
                                .error.message
                            : null
                      }
                      isLoading={
                        controller.ticketWorkspacePreviewQuery.isPending
                      }
                      isStarting={
                        controller.startTicketWorkspacePreviewMutation.isPending
                      }
                      onStart={() => {
                        if (!controller.selectedSessionTicket) {
                          return;
                        }

                        controller.startTicketWorkspacePreviewMutation.mutate(
                          controller.selectedSessionTicket.id,
                        );
                      }}
                      preview={controller.ticketWorkspacePreview}
                      worktreePath={controller.session.worktree_path}
                    />
                  </Tabs.Panel>

                  <Tabs.Panel
                    className="ticket-workspace-tab-panel"
                    value="activity"
                  >
                    <Stack gap="md">
                      {controller.planFeedbackMutation.isError ? (
                        <Text size="sm" c="red">
                          {controller.planFeedbackMutation.error.message}
                        </Text>
                      ) : null}

                      {controller.session.plan_summary ? (
                        <Stack gap={4}>
                          <Text fw={700}>
                            {controller.session.plan_status ===
                            "awaiting_feedback"
                              ? "Plan awaiting feedback"
                              : "Latest plan"}
                          </Text>
                          <MarkdownContent
                            className="markdown-muted markdown-small"
                            content={controller.session.plan_summary}
                          />
                        </Stack>
                      ) : null}

                      {controller.selectedSessionTicket?.status === "review" ? (
                        controller.reviewPackageQuery.isPending ? (
                          <Loader size="sm" />
                        ) : controller.reviewPackage ? (
                          <Stack gap="sm">
                            <Text fw={700}>Review package</Text>
                            <Text size="sm" c="dimmed">
                              Diff artifact:{" "}
                              <Code>{controller.reviewPackage.diff_ref}</Code>
                            </Text>
                            <MarkdownContent
                              className="markdown-muted markdown-small"
                              content={controller.reviewPackage.change_summary}
                            />
                            <Text size="sm" c="dimmed">
                              Validation results:{" "}
                              {
                                controller.reviewPackage.validation_results
                                  .length
                              }
                            </Text>
                            {controller.reviewPackage.validation_results
                              .length > 0 ? (
                              <List size="sm" spacing={4}>
                                {controller.reviewPackage.validation_results.map(
                                  (result) => (
                                    <List.Item key={result.command_id}>
                                      {result.label}: {result.status}
                                    </List.Item>
                                  ),
                                )}
                              </List>
                            ) : null}
                            {controller.reviewPackage.remaining_risks.length >
                            0 ? (
                              <Stack gap={2}>
                                <Text
                                  size="xs"
                                  c="dimmed"
                                  tt="uppercase"
                                  fw={700}
                                >
                                  Remaining Risks
                                </Text>
                                <MarkdownListItems
                                  items={
                                    controller.reviewPackage.remaining_risks
                                  }
                                />
                              </Stack>
                            ) : null}
                            {controller.mergeTicketMutation.isError ? (
                              <Text size="sm" c="red">
                                {controller.mergeTicketMutation.error.message}
                              </Text>
                            ) : null}
                            {controller.requestChangesMutation.isError ? (
                              <Text size="sm" c="red">
                                {
                                  controller.requestChangesMutation.error
                                    .message
                                }
                              </Text>
                            ) : null}
                            <Textarea
                              label="Requested changes"
                              placeholder="Ask Codex to adjust the current review before you approve it."
                              value={controller.requestedChangesBody}
                              onChange={(event) =>
                                controller.setRequestedChangesBody(
                                  event.currentTarget.value,
                                )
                              }
                              minRows={3}
                            />
                            <Group justify="space-between">
                              <Button
                                variant="light"
                                loading={
                                  controller.requestChangesMutation.isPending &&
                                  controller.requestChangesMutation.variables
                                    ?.ticketId ===
                                    controller.selectedSessionTicket.id
                                }
                                disabled={
                                  controller.requestedChangesBody.trim()
                                    .length === 0
                                }
                                onClick={() => {
                                  if (!selectedSessionTicket) {
                                    return;
                                  }

                                  controller.requestChangesMutation.mutate({
                                    ticketId: selectedSessionTicket.id,
                                    body: controller.requestedChangesBody,
                                  });
                                }}
                              >
                                Request Changes
                              </Button>
                              <Button
                                loading={
                                  controller.mergeTicketMutation.isPending &&
                                  controller.mergeTicketMutation.variables ===
                                    controller.selectedSessionTicket.id
                                }
                                onClick={() => {
                                  if (!selectedSessionTicket) {
                                    return;
                                  }

                                  controller.mergeTicketMutation.mutate(
                                    selectedSessionTicket.id,
                                  );
                                }}
                              >
                                Merge to{" "}
                                {controller.selectedSessionTicket.target_branch}
                              </Button>
                            </Group>
                          </Stack>
                        ) : null
                      ) : null}

                      <SessionActivityFeed
                        logs={controller.sessionLogs}
                        session={controller.session}
                      />

                      {controller.selectedSessionTicket &&
                      controller.session.plan_status === "awaiting_feedback" ? (
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (!controller.selectedSessionId) {
                              return;
                            }

                            controller.planFeedbackMutation.mutate({
                              sessionId: controller.selectedSessionId,
                              approved: true,
                              body:
                                controller.planFeedbackBody.trim().length > 0
                                  ? controller.planFeedbackBody
                                  : "Plan approved. Continue with implementation.",
                            });
                          }}
                        >
                          <Stack gap="sm">
                            <Textarea
                              id="plan-feedback"
                              name="planFeedback"
                              label="Plan feedback"
                              placeholder="Add optional implementation guidance, or describe what should change in the plan."
                              value={controller.planFeedbackBody}
                              onChange={(event) =>
                                controller.setPlanFeedbackBody(
                                  event.currentTarget.value,
                                )
                              }
                              minRows={3}
                            />
                            <Group justify="space-between">
                              <Button
                                variant="light"
                                type="button"
                                disabled={
                                  controller.planFeedbackBody.trim().length ===
                                  0
                                }
                                loading={
                                  controller.planFeedbackMutation.isPending &&
                                  controller.planFeedbackMutation.variables
                                    ?.approved === false
                                }
                                onClick={() => {
                                  if (!controller.selectedSessionId) {
                                    return;
                                  }

                                  controller.planFeedbackMutation.mutate({
                                    sessionId: controller.selectedSessionId,
                                    approved: false,
                                    body: controller.planFeedbackBody,
                                  });
                                }}
                              >
                                Request Plan Changes
                              </Button>
                              <Button
                                type="submit"
                                loading={
                                  controller.planFeedbackMutation.isPending &&
                                  controller.planFeedbackMutation.variables
                                    ?.approved === true
                                }
                              >
                                Confirm Plan and Start
                              </Button>
                            </Group>
                          </Stack>
                        </form>
                      ) : controller.selectedSessionTicket &&
                        [
                          "awaiting_input",
                          "failed",
                          "interrupted",
                          "paused_checkpoint",
                        ].includes(controller.session.status) ? (
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (!selectedSessionTicket) {
                              return;
                            }

                            controller.resumeTicketMutation.mutate({
                              ticketId: selectedSessionTicket.id,
                              reason: controller.resumeReason,
                            });
                          }}
                        >
                          <Stack gap="sm">
                            <Textarea
                              id="next-attempt-guidance"
                              name="nextAttemptGuidance"
                              label="Next attempt guidance"
                              placeholder="Optional. Clarify what Codex should address on the next attempt."
                              value={controller.resumeReason}
                              onChange={(event) =>
                                controller.setResumeReason(
                                  event.currentTarget.value,
                                )
                              }
                              minRows={3}
                            />
                            {controller.resumeTicketMutation.isError ? (
                              <Text size="sm" c="red">
                                {controller.resumeTicketMutation.error.message}
                              </Text>
                            ) : null}
                            {controller.restartTicketMutation.isError &&
                            controller.restartTicketMutation.variables
                              ?.ticketId ===
                              controller.selectedSessionTicket.id ? (
                              <Text size="sm" c="red">
                                {controller.restartTicketMutation.error.message}
                              </Text>
                            ) : null}
                            <Group justify="space-between">
                              <Button
                                variant="subtle"
                                type="button"
                                onClick={() => {
                                  if (!controller.selectedSessionId) {
                                    return;
                                  }

                                  controller.sessionInputMutation.mutate({
                                    sessionId: controller.selectedSessionId,
                                    body:
                                      controller.resumeReason ||
                                      "Resume requested from the session view.",
                                  });
                                }}
                                loading={
                                  controller.sessionInputMutation.isPending
                                }
                              >
                                Record Note Only
                              </Button>
                              <Group gap="sm">
                                {controller.session.status === "interrupted" ? (
                                  <Button
                                    color="orange"
                                    variant="light"
                                    type="button"
                                    loading={
                                      controller.restartTicketMutation
                                        .isPending &&
                                      controller.restartTicketMutation.variables
                                        ?.ticketId ===
                                        controller.selectedSessionTicket.id
                                    }
                                    onClick={() => {
                                      if (!selectedSessionTicket) {
                                        return;
                                      }

                                      controller.restartTicketFromScratch(
                                        selectedSessionTicket,
                                        controller.resumeReason,
                                      );
                                    }}
                                  >
                                    Restart from Scratch
                                  </Button>
                                ) : null}
                                <Button
                                  type="submit"
                                  loading={
                                    controller.resumeTicketMutation.isPending
                                  }
                                >
                                  Resume Execution
                                </Button>
                              </Group>
                            </Group>
                          </Stack>
                        </form>
                      ) : (
                        <Text size="sm" c="dimmed">
                          Use this tab when a session is waiting on you, or move
                          to Terminal when direct work inside the ticket
                          worktree is faster than more prompting.
                        </Text>
                      )}
                    </Stack>
                  </Tabs.Panel>
                </Tabs>
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">
                Session details are not available yet.
              </Text>
            )}
          </SectionCard>
        ) : null}
      </Stack>
    </Box>
  );
}
