import {
  Box,
  Button,
  Code,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";

import { MarkdownContent } from "../../components/MarkdownContent.js";
import { SessionActivityFeed } from "../../components/SessionActivityFeed.js";
import { TicketWorkspaceDiffPanel } from "../../components/TicketWorkspaceDiffPanel.js";
import { TicketWorkspaceTerminal } from "../../components/TicketWorkspaceTerminal.js";
import {
  agentAdapterOptions,
  buildRepositoryBranchOptions,
  executionBackendOptions,
  projectModelPresetOptions,
  reasoningEffortOptions,
  resolveRepositoryTargetBranch,
  reviewActionOptions,
  slugify,
} from "./shared.js";
import type { WalleyBoardController } from "./use-walleyboard-controller.js";
import { resolveWorkspaceDiffPanelState } from "./workspace-modal-state.js";

type WorkspaceModalContentController = Pick<
  WalleyBoardController,
  | "session"
  | "sessionLogs"
  | "sessionLogsQuery"
  | "sessionQuery"
  | "selectedSessionTicket"
  | "setTicketWorkspaceDiffLayout"
  | "ticketWorkspaceDiff"
  | "ticketWorkspaceDiffLayout"
  | "ticketWorkspaceDiffQuery"
  | "workspaceModal"
>;

export function WorkspaceModalContent({
  controller,
}: {
  controller: WorkspaceModalContentController;
}) {
  const workspaceDiffPanelState = resolveWorkspaceDiffPanelState({
    sessionQuery: controller.sessionQuery,
    ticketWorkspaceDiffQuery: controller.ticketWorkspaceDiffQuery,
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
        controller.selectedSessionTicket ? (
          <TicketWorkspaceTerminal
            ticketId={controller.selectedSessionTicket.id}
            worktreePath={controller.session?.worktree_path ?? null}
          />
        ) : (
          <Text size="sm" c="dimmed">
            The ticket worktree is still being prepared.
          </Text>
        )
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
  controller: WalleyBoardController;
}) {
  const projectOptionsProject = controller.projectOptionsProject;
  const workspaceModalTitle =
    controller.workspaceModal === "diff"
      ? "Worktree diff"
      : controller.workspaceModal === "terminal"
        ? "Worktree terminal"
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
                      <MarkdownContent content={ticket.title} inline />
                    </Box>
                    <Button
                      size="xs"
                      variant="light"
                      loading={
                        controller.restoreTicketMutation.isPending &&
                        controller.restoreTicketMutation.variables?.ticketId ===
                          ticket.id
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
                </Box>
              ))}
            </Stack>
          )}
        </Stack>
      </Modal>

      <Modal
        opened={projectOptionsProject !== null}
        onClose={controller.closeProjectOptionsModal}
        title={
          projectOptionsProject
            ? `Project options • ${projectOptionsProject.name}`
            : "Project options"
        }
        centered
        size="lg"
      >
        {projectOptionsProject ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              controller.saveProjectOptions();
            }}
          >
            <Stack gap="md">
              <Text size="sm" c="dimmed">
                Model overrides are optional. Default leaves the selected agent
                on its normal model selection path for this project.
              </Text>

              <Stack gap="xs">
                <Select
                  label="Agent CLI"
                  description="Choose which agent runtime this project uses for draft analysis and ticket work."
                  data={agentAdapterOptions.map((option) =>
                    option.value === "claude-code" &&
                    !controller.claudeCodeHealth?.available
                      ? {
                          ...option,
                          label: "Claude Code (not installed)",
                          disabled: true,
                        }
                      : option,
                  )}
                  value={controller.projectOptionsAgentAdapter}
                  onChange={(value) => {
                    if (value !== "codex" && value !== "claude-code") {
                      return;
                    }

                    controller.setProjectOptionsFormError(null);
                    controller.updateProjectMutation.reset();
                    controller.setProjectOptionsAgentAdapter(value);
                    if (value === "claude-code") {
                      controller.setProjectOptionsExecutionBackend("host");
                    }
                  }}
                />
              </Stack>

              {/* Docker is not supported for Claude Code. This UI guard is the
                  primary enforcement point - we intentionally skip server-side
                  cross-field validation since our threat model does not cover
                  users bypassing the UI via raw API calls. The runtime still
                  produces a clear error if the combination is somehow reached. */}
              <Stack gap="xs">
                <Text fw={600}>Execution backend</Text>
                <SegmentedControl
                  data={executionBackendOptions}
                  disabled={
                    controller.projectOptionsAgentAdapter === "claude-code"
                  }
                  value={
                    controller.projectOptionsAgentAdapter === "claude-code"
                      ? "host"
                      : controller.projectOptionsExecutionBackend
                  }
                  onChange={(value) => {
                    if (value !== "host" && value !== "docker") {
                      return;
                    }

                    controller.setProjectOptionsFormError(null);
                    controller.updateProjectMutation.reset();
                    controller.setProjectOptionsExecutionBackend(value);
                  }}
                />
                {controller.projectOptionsAgentAdapter === "claude-code" ? (
                  <Text size="sm" c="dimmed">
                    Docker execution is not yet supported for Claude Code.
                  </Text>
                ) : (
                  <Text size="sm" c="dimmed">
                    Docker runs ticket-scoped agent work inside a managed Ubuntu
                    container. The ticket-card worktree terminal and validation
                    still run on the host in this first version.
                  </Text>
                )}
                {controller.dockerHealth ? (
                  controller.dockerHealth.available ? (
                    <Text size="sm" c="dimmed">
                      Docker is available
                      {controller.dockerHealth.client_version
                        ? ` (client ${controller.dockerHealth.client_version})`
                        : ""}
                      {controller.dockerHealth.server_version
                        ? `, server ${controller.dockerHealth.server_version}`
                        : ""}
                      .
                    </Text>
                  ) : (
                    <Text size="sm" c="orange">
                      Docker is currently unavailable
                      {controller.dockerHealth.error
                        ? `: ${controller.dockerHealth.error}`
                        : "."}{" "}
                      You can still save Docker mode, but ticket start and
                      resume will be rejected until Docker is reachable again.
                    </Text>
                  )
                ) : controller.healthQuery.isError ? (
                  <Text size="sm" c="orange">
                    Docker status is unavailable because the backend health
                    check failed.
                  </Text>
                ) : null}
              </Stack>

              <Stack gap="sm">
                <Switch
                  label="Automatic agent review"
                  description="Automatically start the existing agent review flow when a ticket enters In review."
                  checked={controller.projectOptionsAutomaticAgentReview}
                  onChange={(event) => {
                    controller.setProjectOptionsFormError(null);
                    controller.updateProjectMutation.reset();
                    controller.setProjectOptionsAutomaticAgentReview(
                      event.currentTarget.checked,
                    );
                  }}
                />
              </Stack>

              <Stack gap="sm">
                <Text fw={600}>Default review action</Text>
                <SegmentedControl
                  data={reviewActionOptions}
                  value={controller.projectOptionsDefaultReviewAction}
                  onChange={(value) => {
                    if (value !== "direct_merge" && value !== "pull_request") {
                      return;
                    }

                    controller.setProjectOptionsFormError(null);
                    controller.updateProjectMutation.reset();
                    controller.setProjectOptionsDefaultReviewAction(value);
                  }}
                />
                <Text size="sm" c="dimmed">
                  New review tickets default to this action until a GitHub pull
                  request is linked. Once a PR exists, the card switches to
                  tracking that PR instead of offering duplicate review paths.
                </Text>
              </Stack>

              <Stack gap="sm">
                <Textarea
                  label="Pre-worktree command"
                  description="Runs inside each new worktree without blocking agent startup."
                  placeholder="npm install"
                  value={controller.projectOptionsPreWorktreeCommand}
                  onChange={(event) => {
                    controller.setProjectOptionsFormError(null);
                    controller.updateProjectMutation.reset();
                    controller.setProjectOptionsPreWorktreeCommand(
                      event.currentTarget.value,
                    );
                  }}
                  minRows={2}
                />
                <Textarea
                  label="Post-worktree command"
                  description="Runs inside the worktree before background teardown removes it."
                  placeholder="npm run cleanup"
                  value={controller.projectOptionsPostWorktreeCommand}
                  onChange={(event) => {
                    controller.setProjectOptionsFormError(null);
                    controller.updateProjectMutation.reset();
                    controller.setProjectOptionsPostWorktreeCommand(
                      event.currentTarget.value,
                    );
                  }}
                  minRows={2}
                />
              </Stack>

              <Stack gap="sm">
                <Select
                  label="Draft refining model"
                  description="Used for both Refine and Questions? draft analysis runs."
                  data={projectModelPresetOptions}
                  value={controller.projectOptionsDraftModelPreset}
                  onChange={(value) => {
                    if (!value) {
                      return;
                    }

                    controller.setProjectOptionsFormError(null);
                    controller.updateProjectMutation.reset();
                    controller.setProjectOptionsDraftModelPreset(
                      value as typeof controller.projectOptionsDraftModelPreset,
                    );
                  }}
                />
                {controller.projectOptionsDraftModelPreset === "custom" ? (
                  <TextInput
                    label="Custom draft model ID"
                    placeholder="gpt-5.3-spark"
                    value={controller.projectOptionsDraftModelCustom}
                    onChange={(event) => {
                      controller.setProjectOptionsFormError(null);
                      controller.updateProjectMutation.reset();
                      controller.setProjectOptionsDraftModelCustom(
                        event.currentTarget.value,
                      );
                    }}
                  />
                ) : null}
                <Select
                  label="Draft refining reasoning effort"
                  data={reasoningEffortOptions}
                  value={controller.projectOptionsDraftReasoningEffort}
                  onChange={(value) => {
                    if (!value) {
                      return;
                    }

                    controller.setProjectOptionsFormError(null);
                    controller.updateProjectMutation.reset();
                    controller.setProjectOptionsDraftReasoningEffort(
                      value as typeof controller.projectOptionsDraftReasoningEffort,
                    );
                  }}
                />
              </Stack>

              <Stack gap="sm">
                <Select
                  label="General ticket work model"
                  description="Used when the selected agent starts or resumes ticket implementation work."
                  data={projectModelPresetOptions}
                  value={controller.projectOptionsTicketModelPreset}
                  onChange={(value) => {
                    if (!value) {
                      return;
                    }

                    controller.setProjectOptionsFormError(null);
                    controller.updateProjectMutation.reset();
                    controller.setProjectOptionsTicketModelPreset(
                      value as typeof controller.projectOptionsTicketModelPreset,
                    );
                  }}
                />
                {controller.projectOptionsTicketModelPreset === "custom" ? (
                  <TextInput
                    label="Custom ticket work model ID"
                    placeholder="gpt-5.3-spark"
                    value={controller.projectOptionsTicketModelCustom}
                    onChange={(event) => {
                      controller.setProjectOptionsFormError(null);
                      controller.updateProjectMutation.reset();
                      controller.setProjectOptionsTicketModelCustom(
                        event.currentTarget.value,
                      );
                    }}
                  />
                ) : null}
                <Select
                  label="General ticket work reasoning effort"
                  data={reasoningEffortOptions}
                  value={controller.projectOptionsTicketReasoningEffort}
                  onChange={(value) => {
                    if (!value) {
                      return;
                    }

                    controller.setProjectOptionsFormError(null);
                    controller.updateProjectMutation.reset();
                    controller.setProjectOptionsTicketReasoningEffort(
                      value as typeof controller.projectOptionsTicketReasoningEffort,
                    );
                  }}
                />
              </Stack>

              <Stack gap="sm">
                <Group justify="space-between" align="flex-end">
                  <Box>
                    <Text fw={600}>Repository target branches</Text>
                    <Text size="sm" c="dimmed">
                      Fetched branch names are listed for each configured
                      repository. Refresh to retry branch retrieval before
                      saving.
                    </Text>
                  </Box>
                  <Button
                    type="button"
                    variant="light"
                    size="xs"
                    loading={controller.projectOptionsBranchesQuery.isFetching}
                    onClick={controller.refreshProjectOptionsBranches}
                  >
                    Refresh branches
                  </Button>
                </Group>

                {controller.projectOptionsRepositoriesQuery.isPending ? (
                  <Loader size="sm" />
                ) : controller.projectOptionsRepositoriesQuery.isError ? (
                  <Group justify="space-between" align="flex-start">
                    <Text size="sm" c="red">
                      {controller.projectOptionsRepositoriesQuery.error.message}
                    </Text>
                    <Button
                      type="button"
                      variant="subtle"
                      size="compact-sm"
                      onClick={controller.refreshProjectOptionsBranches}
                    >
                      Retry
                    </Button>
                  </Group>
                ) : controller.projectOptionsRepositories.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    No repositories are configured for this project.
                  </Text>
                ) : (
                  <Stack gap="sm">
                    {controller.projectOptionsRepositories.map((repository) => {
                      const currentTargetBranch = resolveRepositoryTargetBranch(
                        repository,
                        projectOptionsProject.default_target_branch,
                      );
                      const branchChoices =
                        controller.projectOptionsBranchesByRepositoryId.get(
                          repository.id,
                        );
                      const selectedTargetBranch =
                        controller.projectOptionsRepositoryTargetBranches[
                          repository.id
                        ] ??
                        (currentTargetBranch.length > 0
                          ? currentTargetBranch
                          : null);
                      const branchOptions = buildRepositoryBranchOptions(
                        branchChoices?.branches ?? [],
                        currentTargetBranch || null,
                      );

                      return (
                        <Box key={repository.id} className="detail-meta-card">
                          <Stack gap="xs">
                            <Group justify="space-between" align="flex-start">
                              <Box>
                                <Text fw={600}>{repository.name}</Text>
                                <Code>{repository.path}</Code>
                              </Box>
                              <Text size="sm" c="dimmed">
                                Current target branch:{" "}
                                {currentTargetBranch || "Not configured"}
                              </Text>
                            </Group>

                            <Select
                              label="Target branch"
                              placeholder={
                                branchChoices?.error
                                  ? "Refresh branches to retry"
                                  : controller.projectOptionsBranchesQuery
                                        .isPending ||
                                      controller.projectOptionsBranchesQuery
                                        .isFetching
                                    ? "Loading branches…"
                                    : "Select a branch"
                              }
                              data={branchOptions}
                              value={selectedTargetBranch}
                              searchable
                              nothingFoundMessage="No branches found"
                              disabled={
                                controller.projectOptionsBranchesQuery
                                  .isError ||
                                (branchChoices?.error !== null &&
                                  branchChoices?.error !== undefined) ||
                                (branchChoices === undefined &&
                                  controller.projectOptionsBranchesQuery
                                    .isPending) ||
                                branchOptions.length === 0
                              }
                              onChange={(value) => {
                                if (!value) {
                                  return;
                                }

                                controller.setProjectOptionsFormError(null);
                                controller.updateProjectMutation.reset();
                                controller.setProjectOptionsRepositoryTargetBranches(
                                  (current) => ({
                                    ...current,
                                    [repository.id]: value,
                                  }),
                                );
                              }}
                            />

                            {branchChoices?.error ? (
                              <Group justify="space-between" align="flex-start">
                                <Text size="sm" c="red">
                                  {branchChoices.error}
                                </Text>
                                <Button
                                  type="button"
                                  variant="subtle"
                                  size="compact-sm"
                                  onClick={
                                    controller.refreshProjectOptionsBranches
                                  }
                                >
                                  Retry
                                </Button>
                              </Group>
                            ) : null}
                          </Stack>
                        </Box>
                      );
                    })}
                  </Stack>
                )}

                {controller.projectOptionsBranchesQuery.isError ? (
                  <Group justify="space-between" align="flex-start">
                    <Text size="sm" c="red">
                      {controller.projectOptionsBranchesQuery.error.message}
                    </Text>
                    <Button
                      type="button"
                      variant="subtle"
                      size="compact-sm"
                      onClick={controller.refreshProjectOptionsBranches}
                    >
                      Retry
                    </Button>
                  </Group>
                ) : null}
              </Stack>

              {controller.projectOptionsFormError ? (
                <Text size="sm" c="red">
                  {controller.projectOptionsFormError}
                </Text>
              ) : null}
              {controller.updateProjectMutation.isError ? (
                <Text size="sm" c="red">
                  {controller.updateProjectMutation.error.message}
                </Text>
              ) : null}

              <Group justify="flex-end">
                <Button
                  type="submit"
                  loading={controller.updateProjectMutation.isPending}
                  disabled={!controller.projectOptionsDirty}
                >
                  Save Options
                </Button>
              </Group>

              <Box className="project-options-danger-zone">
                <Stack gap="sm">
                  <Text
                    size="xs"
                    tt="uppercase"
                    fw={700}
                    className="project-options-danger-kicker"
                  >
                    Danger zone
                  </Text>
                  <Text size="sm" className="project-options-danger-copy">
                    Delete this project to remove its drafts, tickets, sessions,
                    and walleyboard-managed local artifacts. The source
                    repository directory stays on disk.
                  </Text>
                  <TextInput
                    label={`Type ${projectOptionsProject.slug} to confirm`}
                    value={controller.projectDeleteConfirmText}
                    onChange={(event) => {
                      controller.deleteProjectMutation.reset();
                      controller.setProjectDeleteConfirmText(
                        event.currentTarget.value,
                      );
                    }}
                  />
                  {controller.deleteProjectMutation.isError ? (
                    <Text size="sm" c="red">
                      {controller.deleteProjectMutation.error.message}
                    </Text>
                  ) : null}
                  <Group justify="flex-end">
                    <Button
                      type="button"
                      color="red"
                      variant="light"
                      loading={controller.deleteProjectMutation.isPending}
                      disabled={!controller.canDeleteProject}
                      onClick={() =>
                        controller.deleteProjectMutation.mutate(
                          projectOptionsProject.id,
                        )
                      }
                    >
                      Delete Project
                    </Button>
                  </Group>
                </Stack>
              </Box>
            </Stack>
          </form>
        ) : null}
      </Modal>

      <Modal
        opened={controller.projectModalOpen}
        onClose={() => controller.setProjectModalOpen(false)}
        title="Create project"
        centered
        size="lg"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            controller.createProjectMutation.mutate({
              name: controller.projectName,
              repositoryPath: controller.repositoryPath,
              defaultTargetBranch: controller.defaultBranch,
              validationCommands: controller.validationCommandsText
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean),
            });
          }}
        >
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              One repository per project is still the intended MVP shape.
            </Text>
            <TextInput
              id="project-name"
              name="projectName"
              label="Project name"
              placeholder="example-repo"
              value={controller.projectName}
              onChange={(event) =>
                controller.setProjectName(event.currentTarget.value)
              }
              required
            />
            <TextInput
              id="repository-path"
              name="repositoryPath"
              label="Repository path"
              placeholder="/home/user/git/example-repo"
              value={controller.repositoryPath}
              onChange={(event) =>
                controller.setRepositoryPath(event.currentTarget.value)
              }
              required
            />
            <TextInput
              id="default-target-branch"
              name="defaultTargetBranch"
              label="Target branch"
              placeholder="main"
              value={controller.defaultBranch}
              onChange={(event) =>
                controller.setDefaultBranch(event.currentTarget.value)
              }
              required
            />
            <Textarea
              id="validation-commands"
              name="validationCommands"
              label="Validation commands"
              placeholder={"npm run test\nnpm run lint"}
              value={controller.validationCommandsText}
              onChange={(event) =>
                controller.setValidationCommandsText(event.currentTarget.value)
              }
              minRows={3}
            />
            {controller.createProjectMutation.isError ? (
              <Text size="sm" c="red">
                {controller.createProjectMutation.error.message}
              </Text>
            ) : null}
            <Group justify="space-between" align="center">
              <Text size="sm" c="dimmed">
                Slug:{" "}
                <Code>{slugify(controller.projectName || "project-name")}</Code>
              </Text>
              <Button
                type="submit"
                loading={controller.createProjectMutation.isPending}
              >
                Add Project
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}
