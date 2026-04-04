import { Box, Button, Group, Loader, Modal, Stack, Text } from "@mantine/core";
import { AgentReviewHistoryModal } from "../../components/AgentReviewHistoryModal.js";
import { MarkdownContent } from "../../components/MarkdownContent.js";
import { SessionActivityFeed } from "../../components/SessionActivityFeed.js";
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
}: {
  controller: WalleyBoardModalsController;
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
    <Box className="ticket-workspace-modal-body">
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
        />
      ) : controller.workspaceModal === "activity" ? (
        controller.sessionQuery.isPending ||
        controller.sessionLogsQuery.isPending ? (
          <Loader size="sm" />
        ) : controller.sessionQuery.isError ? (
          <Text size="sm" c="red">
            {controller.sessionQuery.error.message}
          </Text>
        ) : controller.session ? (
          <SessionActivityFeed
            logs={controller.sessionLogs}
            session={controller.session}
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
  const workspaceModalTitle =
    controller.workspaceModal === "diff"
      ? "Ticket diff"
      : controller.workspaceModal === "terminal"
        ? controller.workspaceTerminalContext?.kind === "repository_tabs"
          ? "Project terminal"
          : "Terminal"
        : controller.workspaceModal === "activity"
          ? "Activity stream"
          : "Workspace";

  return (
    <>
      <Modal
        opened={controller.workspaceModal !== null}
        onClose={controller.closeWorkspaceModal}
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
        <WorkspaceModalContent controller={controller} />
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
    </>
  );
}
