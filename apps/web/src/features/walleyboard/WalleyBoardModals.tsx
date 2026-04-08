import { Box, Button, Group, Loader, Modal, Stack, Text } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { AgentReviewHistoryModal } from "../../components/AgentReviewHistoryModal.js";
import { MarkdownContent } from "../../components/MarkdownContent.js";
import { SessionActivityPanel } from "../../components/SessionActivityPanel.js";
import { TicketWorkspaceDiffPanel } from "../../components/TicketWorkspaceDiffPanel.js";
import { TicketWorkspaceTerminal } from "../../components/TicketWorkspaceTerminal.js";
import { ProjectConfigurationModals } from "./ProjectConfigurationModals.js";
import { WorkspaceTerminalContent } from "./WorkspaceTerminalContent.js";
import type { WalleyBoardModalsController } from "./walleyboard-view-state.js";
import {
  resolveWorkspaceDiffPanelState,
  resolveWorkspaceTerminalPanelState,
} from "./workspace-modal-state.js";

export function WorkspaceModalContent({
  controller,
  terminalInstanceKey,
}: {
  controller: WalleyBoardModalsController;
  terminalInstanceKey: number;
}) {
  const workspaceDiffPanelState = resolveWorkspaceDiffPanelState({
    ticketWorkspaceDiffQuery: controller.ticketWorkspaceDiffQuery,
  });
  const workspaceTerminalPanelState = resolveWorkspaceTerminalPanelState({
    selectedSessionTicket: controller.selectedSessionTicket,
    selectedSessionTicketSession: controller.selectedSessionTicketSession,
    session: controller.session,
    sessionQuery: controller.sessionQuery,
  });

  return (
    <Box
      className={
        controller.workspaceModal === "diff"
          ? "ticket-workspace-modal-body ticket-workspace-modal-body--diff"
          : "ticket-workspace-modal-body"
      }
    >
      {controller.workspaceModal === "diff" ? (
        <TicketWorkspaceDiffPanel
          diff={controller.ticketWorkspaceDiff}
          error={workspaceDiffPanelState.error}
          isLoading={workspaceDiffPanelState.isLoading}
          layout={controller.ticketWorkspaceDiffLayout}
          onLayoutChange={controller.setTicketWorkspaceDiffLayout}
        />
      ) : controller.workspaceModal === "terminal" ? (
        <WorkspaceTerminalContent
          selectedSessionTicket={controller.selectedSessionTicket}
          workspaceTerminalContext={controller.workspaceTerminalContext}
          workspaceTerminalPanelState={workspaceTerminalPanelState}
          TerminalComponent={TicketWorkspaceTerminal}
          terminalInstanceKey={terminalInstanceKey}
        />
      ) : controller.workspaceModal === "activity" ||
        controller.workspaceModal === "timeline" ? (
        controller.sessionQuery.isPending ||
        controller.sessionLogsQuery.isPending ? (
          <Loader size="sm" />
        ) : controller.sessionQuery.isError ? (
          <Text size="sm" c="red">
            {controller.sessionQuery.error.message}
          </Text>
        ) : controller.session ? (
          <SessionActivityPanel
            key={controller.session.id}
            attempts={controller.sessionAttempts}
            defaultTab={
              controller.workspaceModal === "timeline" ? "timeline" : undefined
            }
            logs={controller.sessionLogs}
            reviewRuns={controller.reviewRuns}
            session={controller.session}
            ticketEvents={controller.ticketEvents}
            timelineError={
              controller.sessionAttemptsQuery.isError
                ? controller.sessionAttemptsQuery.error.message
                : controller.ticketEventsQuery.isError
                  ? controller.ticketEventsQuery.error.message
                  : controller.reviewRunsQuery.isError
                    ? controller.reviewRunsQuery.error.message
                    : null
            }
            timelinePending={
              controller.sessionAttemptsQuery.isPending ||
              controller.ticketEventsQuery.isPending ||
              controller.reviewRunsQuery.isPending
            }
          />
        ) : (
          <Text size="sm" c="dimmed">
            Session details are not available yet.
          </Text>
        )
      ) : null}
    </Box>
  );
}

export function WalleyBoardModals({
  controller,
}: {
  controller: WalleyBoardModalsController;
}) {
  const [terminalInstanceKey, setTerminalInstanceKey] = useState(0);
  const wasTerminalOpenRef = useRef(false);
  const isTerminalOpen = controller.workspaceModal === "terminal";

  useEffect(() => {
    if (isTerminalOpen && !wasTerminalOpenRef.current) {
      setTerminalInstanceKey((current) => current + 1);
    }

    wasTerminalOpenRef.current = isTerminalOpen;
  }, [isTerminalOpen]);

  const workspaceModalTitle =
    controller.workspaceModal === "diff"
      ? "Ticket diff"
      : controller.workspaceModal === "terminal"
        ? controller.workspaceTerminalContext?.kind === "repository_tabs"
          ? "Project terminal"
          : "Terminal"
        : controller.workspaceModal === "activity" ||
            controller.workspaceModal === "timeline"
          ? "Activity stream"
          : "Workspace";

  return (
    <>
      <Modal
        opened={controller.workspaceModal !== null}
        onClose={controller.closeWorkspaceModal}
        keepMounted={false}
        title={workspaceModalTitle}
        centered
        size="90vw"
        styles={{
          content: {
            height: "90vh",
            maxHeight: "90vh",
            display: "flex",
            flexDirection: "column",
          },
          body: {
            flex: 1,
            minHeight: 0,
          },
        }}
      >
        <WorkspaceModalContent
          controller={controller}
          terminalInstanceKey={terminalInstanceKey}
        />
      </Modal>

      <Modal
        opened={controller.archiveModalOpen}
        onClose={controller.closeArchiveModal}
        title="Archived tickets"
        centered
        size="lg"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Restore completed tickets back to the active board.
          </Text>

          {controller.archiveActionFeedback ? (
            <Text size="sm" c={controller.archiveActionFeedback.tone}>
              {controller.archiveActionFeedback.message}
            </Text>
          ) : null}

          {controller.archivedTicketsQuery.isPending ? (
            <Loader size="sm" />
          ) : controller.archivedTicketsQuery.isError ? (
            <Text size="sm" c="red">
              {controller.archivedTicketsQuery.error.message}
            </Text>
          ) : (controller.archivedTicketsQuery.data?.tickets.length ?? 0) ===
            0 ? (
            <Text size="sm" c="dimmed">
              No archived tickets for this project.
            </Text>
          ) : (
            <Stack gap="sm">
              {controller.archivedTicketsQuery.data?.tickets.map((ticket) => (
                <Box key={ticket.id} className="detail-meta-card">
                  <Group
                    justify="space-between"
                    align="flex-start"
                    wrap="nowrap"
                  >
                    <Box style={{ flex: 1, fontWeight: 700, lineHeight: 1.35 }}>
                      <Text component="span" inherit>
                        #{ticket.id}{" "}
                      </Text>
                      <MarkdownContent
                        content={ticket.title}
                        inline
                        ticketReferences={ticket.ticket_references ?? []}
                      />
                    </Box>
                    <Group gap="xs" wrap="nowrap">
                      <Button
                        size="xs"
                        variant="default"
                        onClick={() =>
                          controller.openArchivedTicketDiff(ticket)
                        }
                      >
                        Diff
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        loading={
                          controller.restoreTicketMutation.isPending &&
                          controller.restoreTicketMutation.variables
                            ?.ticketId === ticket.id
                        }
                        onClick={() =>
                          controller.restoreTicketMutation.mutate({
                            ticketId: ticket.id,
                            projectId: ticket.project,
                          })
                        }
                      >
                        Restore
                      </Button>
                    </Group>
                  </Group>
                </Box>
              ))}
            </Stack>
          )}
        </Stack>
      </Modal>

      <AgentReviewHistoryModal
        opened={controller.agentReviewHistoryModalOpen}
        onClose={controller.closeAgentReviewHistoryModal}
        ticketId={controller.selectedSessionTicket?.id ?? null}
        reviewRuns={controller.reviewRuns}
        reviewRunsError={
          controller.reviewRunsQuery.isError
            ? controller.reviewRunsQuery.error.message
            : null
        }
        reviewRunsPending={controller.reviewRunsQuery.isPending}
      />

      <ProjectConfigurationModals controller={controller} />

      <Modal
        opened={controller.discardDraftConfirmOpen}
        onClose={controller.cancelDiscardDraft}
        title="Discard unsaved changes?"
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            You have unsaved changes in your draft. Are you sure you want to
            discard them?
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={controller.cancelDiscardDraft}>
              Keep Editing
            </Button>
            <Button color="red" onClick={controller.confirmDiscardDraft}>
              Discard
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
