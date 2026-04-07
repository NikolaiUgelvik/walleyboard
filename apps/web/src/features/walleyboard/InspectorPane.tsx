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
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import type React from "react";

import { AgentReviewPanel } from "../../components/AgentReviewPanel.js";
import { MarkdownCodeEditor } from "../../components/MarkdownCodeEditor.js";
import { MarkdownContent } from "../../components/MarkdownContent.js";
import { SectionCard } from "../../components/SectionCard.js";
import { summarizeSessionActivity } from "../../components/SessionActivityFeed.js";
import { buildPendingDraftEditorSync } from "../../lib/draft-editor-sync.js";
import { formatDraftStatusLabel } from "../../lib/draft-status.js";
import { PullRequestStatusBadge } from "./PullRequestStatusBadge.js";
import {
  agentLabel,
  DraftEventResultView,
  DraftQuestionsResultView,
  MarkdownListItems,
} from "./shared.js";
import { fetchJson } from "./shared-api.js";
import type { TicketReferencesResponse } from "./shared-types.js";
import {
  formatTimestamp,
  humanizeSessionStatus,
  humanizeTicketStatus,
  isStoppableSessionStatus,
  parseDraftEventMeta,
  resolveReviewCardActions,
  sessionStatusColor,
  ticketStatusColor,
} from "./shared-utils.js";
import type { InspectorPaneController } from "./walleyboard-view-state.js";

function projectAccentButtonClassName(
  variant: "default" | "filled" | "light" | "subtle",
): string {
  return `project-accent-button project-accent-button--${variant}`;
}

export function TicketWorkspaceSummaryRow({
  activitySummary,
  onOpenActivityStream,
}: {
  activitySummary: string | null;
  onOpenActivityStream: () => void;
}): React.JSX.Element {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    onOpenActivityStream();
  };

  return (
    <Stack gap="xs">
      <Text fw={700}>Ticket workspace</Text>
      <Box
        aria-label="Open activity stream"
        className="ticket-workspace-summary-row"
        onClick={onOpenActivityStream}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
      >
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={4} style={{ flex: 1 }}>
            <Text fw={600}>Activity summary</Text>
            <MarkdownContent
              className="markdown-muted markdown-small"
              content={
                activitySummary ??
                "No interpreted activity is available for this session yet."
              }
            />
          </Stack>
          <Badge variant="light" color="blue">
            Open stream
          </Badge>
        </Group>
      </Box>
    </Stack>
  );
}

function DraftEditorFields({
  controller,
}: {
  controller: InspectorPaneController;
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
      <MarkdownCodeEditor
        id="draft-description"
        label="Description"
        description="Markdown is stored literally. Paste a screenshot from the clipboard to insert a hosted image reference."
        onChange={controller.setDraftEditorDescription}
        searchTicketReferences={async (query) => {
          const projectId = controller.draftEditorProject?.id;
          if (!projectId) {
            return [];
          }

          const response = await fetchJson<TicketReferencesResponse>(
            `/projects/${projectId}/ticket-references?query=${encodeURIComponent(query)}`,
          );
          return response.ticket_references;
        }}
        uploadFile={controller.uploadDraftEditorImage}
        value={controller.draftEditorDescription}
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
  controller: InspectorPaneController;
}) {
  if (!controller.inspectorVisible) {
    return null;
  }

  const selectedDraft = controller.selectedDraft;
  const selectedSessionTicket = controller.selectedSessionTicket;
  const selectedSessionRepository =
    selectedSessionTicket === null
      ? null
      : (controller.repositories.find(
          (repository) => repository.id === selectedSessionTicket.repo,
        ) ?? null);
  const session = controller.session;
  const activitySummary =
    session === null
      ? null
      : summarizeSessionActivity(session, controller.sessionLogs);

  return (
    <Box className="walleyboard-detail">
      <Stack gap="md">
        {controller.inspectorState.kind === "new_draft" &&
        controller.draftEditorProject ? (
          <SectionCard
            title="New draft"
            description={`Work in the composer first. Save the draft directly, or let ${agentLabel(controller.draftEditorProject.agent_adapter)} create it automatically when you refine, ask questions, or create a ready ticket.`}
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
                      className={projectAccentButtonClassName("light")}
                      variant="light"
                      disabled={
                        !controller.draftEditorCanPersist ||
                        controller.createDraftMutation.isPending
                      }
                      loading={controller.pendingNewDraftAction === "save"}
                    >
                      Save Draft
                    </Button>
                    <Button
                      type="button"
                      className={projectAccentButtonClassName("light")}
                      variant="light"
                      disabled={
                        !controller.draftEditorCanPersist ||
                        controller.createDraftMutation.isPending ||
                        !controller.draftEditorRepository
                      }
                      loading={controller.pendingNewDraftAction === "refine"}
                      onClick={controller.handleRefineNewDraft}
                    >
                      Refine
                    </Button>
                    <Button
                      type="button"
                      className={projectAccentButtonClassName("light")}
                      variant="light"
                      disabled
                    >
                      Revert Refine
                    </Button>
                    <Button
                      type="button"
                      className={projectAccentButtonClassName("light")}
                      variant="light"
                      disabled={
                        !controller.draftEditorCanPersist ||
                        controller.createDraftMutation.isPending ||
                        !controller.draftEditorRepository
                      }
                      loading={controller.pendingNewDraftAction === "questions"}
                      onClick={controller.handleQuestionNewDraft}
                    >
                      Questions?
                    </Button>
                    <Button
                      type="button"
                      className={projectAccentButtonClassName("filled")}
                      disabled={
                        !controller.draftEditorCanPersist ||
                        !controller.draftEditorProject ||
                        !controller.draftEditorRepository ||
                        controller.createDraftMutation.isPending
                      }
                      loading={controller.pendingNewDraftAction === "confirm"}
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
            description={`Edit the draft directly, then use ${controller.selectedProject ? agentLabel(controller.selectedProject.agent_adapter) : "the agent"} to refine it or check feasibility.`}
          >
            <Stack gap="md">
              <Group justify="space-between" align="flex-start">
                <Stack gap={4}>
                  <Text className="rail-kicker">Draft</Text>
                  <Box style={{ fontWeight: 700 }}>
                    <MarkdownContent
                      content={controller.selectedDraft.title_draft}
                      inline
                      onTicketReferenceNavigate={
                        controller.navigateToTicketReference
                      }
                      ticketReferences={
                        controller.selectedDraft.ticket_references ?? []
                      }
                    />
                  </Box>
                </Stack>
                <Group gap="xs">
                  {controller.draftAnalysisActive ? (
                    <Badge variant="light" color="blue">
                      {controller.selectedProject
                        ? agentLabel(controller.selectedProject.agent_adapter)
                        : "Agent"}{" "}
                      running
                    </Badge>
                  ) : null}
                  <Badge variant="light" color="gray">
                    {formatDraftStatusLabel({
                      isRefining:
                        controller.isDraftRefinementActive(
                          controller.selectedDraft.id,
                        ) ||
                        (controller.refineDraftMutation.isPending &&
                          controller.refineDraftMutation.variables ===
                            controller.selectedDraft.id),
                      wizardStatus: controller.selectedDraft.wizard_status,
                    })}
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
                    className={projectAccentButtonClassName("light")}
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
                    className={projectAccentButtonClassName("light")}
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
                        buildPendingDraftEditorSync({
                          acceptanceCriteria:
                            controller.draftEditorAcceptanceCriteria,
                          description: controller.draftEditorDescription,
                          draftId: selectedDraft.id,
                          sourceUpdatedAt: selectedDraft.updated_at,
                          ticketType: controller.draftEditorTicketType,
                          title: controller.draftEditorTitle,
                        }),
                      );
                      controller.refineDraftMutation.mutate(selectedDraft.id);
                    }}
                  >
                    Refine
                  </Button>
                  <Button
                    className={projectAccentButtonClassName("light")}
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
                        buildPendingDraftEditorSync({
                          acceptanceCriteria:
                            controller.draftEditorAcceptanceCriteria,
                          description: controller.draftEditorDescription,
                          draftId: selectedDraft.id,
                          sourceUpdatedAt: selectedDraft.updated_at,
                          ticketType: controller.draftEditorTicketType,
                          title: controller.draftEditorTitle,
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
                    className={projectAccentButtonClassName("light")}
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
                    className={projectAccentButtonClassName("filled")}
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
          controller.selectedSessionId === null ? (
            <SectionCard
              title="Ticket session"
              description="Session details are not available yet."
            >
              <Text size="sm" c="dimmed">
                Session details are not available yet.
              </Text>
            </SectionCard>
          ) : controller.sessionQuery.isPending ||
            controller.sessionLogsQuery.isPending ? (
            <SectionCard
              title="Ticket session"
              description="Loading the current ticket session."
            >
              <Loader size="sm" />
            </SectionCard>
          ) : controller.sessionQuery.isError ? (
            <SectionCard
              title="Ticket session"
              description="The current ticket session could not be loaded."
            >
              <Text size="sm" c="red">
                {controller.sessionQuery.error.message}
              </Text>
            </SectionCard>
          ) : controller.session ? (
            <>
              <SectionCard>
                <Stack gap="md">
                  <Group justify="space-between" align="flex-start">
                    <Box style={{ flex: 1, fontWeight: 700 }}>
                      {controller.selectedSessionTicket ? (
                        <>
                          <Text component="span" inherit>
                            #{controller.selectedSessionTicket.id}{" "}
                          </Text>
                          <MarkdownContent
                            content={controller.selectedSessionTicket.title}
                            inline
                            onTicketReferenceNavigate={
                              controller.navigateToTicketReference
                            }
                            ticketReferences={
                              controller.selectedSessionTicket
                                .ticket_references ?? []
                            }
                          />
                        </>
                      ) : (
                        `Ticket #${controller.session.ticket_id}`
                      )}
                    </Box>
                    <Badge
                      variant="light"
                      color={sessionStatusColor(controller.session.status)}
                    >
                      {humanizeSessionStatus(controller.session.status)}
                    </Badge>
                  </Group>

                  {controller.selectedSessionTicket ? (
                    <Box className="detail-meta-grid">
                      <Box className="detail-meta-card">
                        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                          Repository
                        </Text>
                        <Text fw={700}>
                          {selectedSessionRepository?.name ?? "Pending"}
                        </Text>
                      </Box>
                      <Box className="detail-meta-card">
                        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                          Type
                        </Text>
                        <Text fw={700}>
                          {controller.selectedSessionTicket.ticket_type
                            .charAt(0)
                            .toUpperCase() +
                            controller.selectedSessionTicket.ticket_type.slice(
                              1,
                            )}
                        </Text>
                      </Box>
                      <Box className="detail-meta-card">
                        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                          Status
                        </Text>
                        <Badge
                          variant="light"
                          color={ticketStatusColor(
                            controller.selectedSessionTicket.status,
                          )}
                          style={{ alignSelf: "flex-start" }}
                        >
                          {humanizeTicketStatus(
                            controller.selectedSessionTicket.status,
                          )}
                        </Badge>
                      </Box>
                      {controller.selectedSessionTicket.linked_pr ? (
                        <Box className="detail-meta-card">
                          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                            Pull request
                          </Text>
                          <Group gap="xs" wrap="wrap">
                            <PullRequestStatusBadge
                              linkedPr={
                                controller.selectedSessionTicket.linked_pr
                              }
                            />
                            <Text
                              component="a"
                              href={
                                controller.selectedSessionTicket.linked_pr.url
                              }
                              target="_blank"
                              rel="noreferrer"
                              size="sm"
                            >
                              Open PR
                            </Text>
                          </Group>
                        </Box>
                      ) : null}
                    </Box>
                  ) : null}

                  {controller.selectedSessionTicket ? (
                    <Stack gap="xs">
                      <Text fw={700}>Ticket details</Text>
                      <MarkdownContent
                        className="markdown-muted markdown-small"
                        content={controller.selectedSessionTicket.description}
                        onTicketReferenceNavigate={
                          controller.navigateToTicketReference
                        }
                        ticketReferences={
                          controller.selectedSessionTicket.ticket_references ??
                          []
                        }
                      />
                      {controller.selectedSessionTicket.acceptance_criteria
                        .length > 0 ? (
                        <Stack gap={2}>
                          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                            Acceptance Criteria
                          </Text>
                          <MarkdownListItems
                            items={
                              controller.selectedSessionTicket
                                .acceptance_criteria
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
                                ?.ticketId ===
                                controller.selectedSessionTicket.id
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
                          controller.deleteTicketMutation.variables
                            ?.ticketId === controller.selectedSessionTicket.id
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

                  {controller.selectedSessionTicket ? (
                    <TicketWorkspaceSummaryRow
                      activitySummary={activitySummary}
                      onOpenActivityStream={() => {
                        if (!controller.selectedSessionTicket) {
                          return;
                        }

                        controller.openTicketWorkspaceModal(
                          controller.selectedSessionTicket,
                          "activity",
                        );
                      }}
                    />
                  ) : null}
                </Stack>
              </SectionCard>

              <SectionCard
                title="Session workflow"
                description="Review, planning, and resume controls stay in the inspector."
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
                        {controller.session.plan_status === "awaiting_feedback"
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
                          {controller.reviewPackage.validation_results.length}
                        </Text>
                        {controller.reviewPackage.validation_results.length >
                        0 ? (
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
                        {controller.reviewPackage.remaining_risks.length > 0 ? (
                          <Stack gap={2}>
                            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                              Remaining Risks
                            </Text>
                            <MarkdownListItems
                              items={controller.reviewPackage.remaining_risks}
                            />
                          </Stack>
                        ) : null}
                        <AgentReviewPanel
                          latestReviewRun={controller.latestReviewRun}
                          latestReviewRunPending={
                            controller.latestReviewRunQuery.isPending
                          }
                          onOpenHistory={controller.openAgentReviewHistoryModal}
                          onStart={() => {
                            if (!selectedSessionTicket) {
                              return;
                            }

                            controller.startAgentReviewMutation.mutate(
                              selectedSessionTicket.id,
                            );
                          }}
                          startError={
                            controller.startAgentReviewMutation.isError
                              ? controller.startAgentReviewMutation.error
                                  .message
                              : null
                          }
                          startPending={
                            controller.startAgentReviewMutation.isPending &&
                            controller.startAgentReviewMutation.variables ===
                              controller.selectedSessionTicket.id
                          }
                        />
                        {controller.mergeTicketMutation.isError ? (
                          <Text size="sm" c="red">
                            {controller.mergeTicketMutation.error.message}
                          </Text>
                        ) : null}
                        {controller.createPullRequestMutation.isError ? (
                          <Text size="sm" c="red">
                            {controller.createPullRequestMutation.error.message}
                          </Text>
                        ) : null}
                        {controller.requestChangesMutation.isError ? (
                          <Text size="sm" c="red">
                            {controller.requestChangesMutation.error.message}
                          </Text>
                        ) : null}
                        <Textarea
                          label="Requested changes"
                          placeholder={`Ask ${controller.selectedProject ? agentLabel(controller.selectedProject.agent_adapter) : "the agent"} to adjust the current review before you approve it.`}
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
                            className={projectAccentButtonClassName("light")}
                            variant="light"
                            loading={
                              controller.requestChangesMutation.isPending &&
                              controller.requestChangesMutation.variables
                                ?.ticketId ===
                                controller.selectedSessionTicket.id
                            }
                            disabled={
                              controller.requestedChangesBody.trim().length ===
                              0
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
                          {(() => {
                            const reviewActions = resolveReviewCardActions(
                              controller.selectedProject,
                              controller.selectedSessionTicket,
                            );
                            const aiReviewActive =
                              controller.latestReviewRun?.status === "running";

                            return [
                              reviewActions.primary,
                              reviewActions.secondary,
                            ]
                              .filter((action) => action !== null)
                              .map((action) => {
                                if (!action) {
                                  return null;
                                }

                                if (action.kind === "create_pr") {
                                  return (
                                    <Button
                                      key={action.kind}
                                      className={projectAccentButtonClassName(
                                        reviewActions.primary?.kind ===
                                          "create_pr"
                                          ? "filled"
                                          : "default",
                                      )}
                                      variant={
                                        reviewActions.primary?.kind ===
                                        "create_pr"
                                          ? "filled"
                                          : "default"
                                      }
                                      loading={
                                        controller.createPullRequestMutation
                                          .isPending &&
                                        controller.createPullRequestMutation
                                          .variables ===
                                          selectedSessionTicket?.id
                                      }
                                      disabled={aiReviewActive}
                                      onClick={() => {
                                        if (selectedSessionTicket) {
                                          controller.createPullRequestMutation.mutate(
                                            selectedSessionTicket.id,
                                          );
                                        }
                                      }}
                                    >
                                      {action.label}
                                    </Button>
                                  );
                                }

                                return (
                                  <Button
                                    key={action.kind}
                                    className={projectAccentButtonClassName(
                                      reviewActions.primary?.kind === "merge"
                                        ? "filled"
                                        : "default",
                                    )}
                                    variant={
                                      reviewActions.primary?.kind === "merge"
                                        ? "filled"
                                        : "default"
                                    }
                                    loading={
                                      controller.mergeTicketMutation
                                        .isPending &&
                                      controller.mergeTicketMutation
                                        .variables === selectedSessionTicket?.id
                                    }
                                    disabled={aiReviewActive}
                                    onClick={() => {
                                      if (selectedSessionTicket) {
                                        controller.mergeTicketMutation.mutate(
                                          selectedSessionTicket.id,
                                        );
                                      }
                                    }}
                                  >
                                    {action.label}
                                  </Button>
                                );
                              });
                          })()}
                        </Group>
                      </Stack>
                    ) : null
                  ) : null}

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
                            className={projectAccentButtonClassName("light")}
                            variant="light"
                            type="button"
                            disabled={
                              controller.planFeedbackBody.trim().length === 0
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
                            className={projectAccentButtonClassName("filled")}
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
                          placeholder={`Optional. Clarify what ${controller.selectedProject ? agentLabel(controller.selectedProject.agent_adapter) : "the agent"} should address on the next attempt.`}
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
                        controller.restartTicketMutation.variables?.ticketId ===
                          controller.selectedSessionTicket.id ? (
                          <Text size="sm" c="red">
                            {controller.restartTicketMutation.error.message}
                          </Text>
                        ) : null}
                        <Group justify="space-between">
                          <Button
                            className={projectAccentButtonClassName("subtle")}
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
                            loading={controller.sessionInputMutation.isPending}
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
                                  controller.restartTicketMutation.isPending &&
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
                              className={projectAccentButtonClassName("filled")}
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
                      Use the ticket card actions for diff, terminal, preview,
                      and the full interpreted activity stream.
                    </Text>
                  )}
                </Stack>
              </SectionCard>
            </>
          ) : (
            <SectionCard
              title="Ticket session"
              description="Session details are not available yet."
            >
              <Text size="sm" c="dimmed">
                Session details are not available yet.
              </Text>
            </SectionCard>
          )
        ) : null}
      </Stack>
    </Box>
  );
}
