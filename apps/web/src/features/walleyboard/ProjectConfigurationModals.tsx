import {
  Box,
  Button,
  Code,
  Group,
  Loader,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";

import {
  executionBackendOptions,
  getModelPresetOptions,
  modelPlaceholder,
  ProjectAgentAdapterSelect,
  reasoningEffortOptions,
  reviewActionOptions,
} from "./shared.js";
import {
  buildRepositoryBranchOptions,
  resolveRepositoryTargetBranch,
  slugify,
} from "./shared-utils.js";
import type { WalleyBoardController } from "./use-walleyboard-controller.js";

export function ProjectConfigurationModals({
  controller,
}: {
  controller: WalleyBoardController;
}) {
  const projectOptionsProject = controller.projectOptionsProject;

  return (
    <>
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
                <TextInput
                  label="Project color"
                  description="Used for the compact rail tile accent."
                  type="color"
                  value={controller.projectOptionsColor}
                  onChange={(event) => {
                    controller.setProjectOptionsFormError(null);
                    controller.updateProjectMutation.reset();
                    controller.setProjectOptionsColor(
                      event.currentTarget.value.toUpperCase(),
                    );
                  }}
                />
                <ProjectAgentAdapterSelect
                  claudeCodeAvailable={Boolean(
                    controller.claudeCodeHealth?.available,
                  )}
                  value={controller.projectOptionsAgentAdapter}
                  onChange={(value) => {
                    controller.setProjectOptionsFormError(null);
                    controller.updateProjectMutation.reset();
                    controller.setProjectOptionsAgentAdapter(value);
                    controller.setProjectOptionsDraftModelPreset("default");
                    controller.setProjectOptionsTicketModelPreset("default");
                  }}
                />
              </Stack>

              <Stack gap="xs">
                <Text fw={600}>Execution backend</Text>
                <SegmentedControl
                  data={executionBackendOptions}
                  value={controller.projectOptionsExecutionBackend}
                  onChange={(value) => {
                    if (value !== "docker") {
                      return;
                    }

                    controller.setProjectOptionsFormError(null);
                    controller.updateProjectMutation.reset();
                    controller.setProjectOptionsExecutionBackend(value);
                  }}
                />
                <Text size="sm" c="dimmed">
                  Docker is required for ticket execution. WalleyBoard prepares
                  an isolated checkout and runs the ticket session inside the
                  managed runtime container.
                </Text>
                {controller.projectOptionsAgentAdapter === "claude-code" ? (
                  <Text size="sm" c="dimmed">
                    Claude Code does not currently provide a Docker execution
                    configuration in WalleyBoard, so Codex is the supported
                    adapter for ticket execution.
                  </Text>
                ) : null}
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
                      Ticket start and resume remain blocked until Docker is
                      reachable again.
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
                <Text fw={600}>Codex MCP servers</Text>
                {controller.projectOptionsAgentAdapter === "codex" ? (
                  controller.codexMcpServers.length === 0 ? (
                    <Text size="sm" c="dimmed">
                      No Codex MCP servers are configured in
                      `~/.codex/config.toml`.
                    </Text>
                  ) : (
                    <>
                      <Text size="sm" c="dimmed">
                        These toggles currently apply to Docker-backed Codex
                        runs by overlaying a filtered `config.toml` inside the
                        managed container. Host runs still use your normal
                        `~/.codex` configuration.
                      </Text>
                      {controller.codexMcpServers.map((server) => {
                        const enabled =
                          !controller.projectOptionsDisabledMcpServers.includes(
                            server,
                          );

                        return (
                          <Switch
                            key={server}
                            checked={enabled}
                            label={server}
                            onChange={(event) => {
                              controller.setProjectOptionsFormError(null);
                              controller.updateProjectMutation.reset();
                              const nextDisabledServers = event.currentTarget
                                .checked
                                ? controller.projectOptionsDisabledMcpServers.filter(
                                    (value) => value !== server,
                                  )
                                : [
                                    ...controller.projectOptionsDisabledMcpServers,
                                    server,
                                  ];

                              controller.setProjectOptionsDisabledMcpServers(
                                [...nextDisabledServers].sort((left, right) =>
                                  left.localeCompare(right),
                                ),
                              );
                            }}
                          />
                        );
                      })}
                    </>
                  )
                ) : (
                  <Text size="sm" c="dimmed">
                    MCP selection is currently only available for Codex
                    projects.
                  </Text>
                )}
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
                <NumberInput
                  label="Automatic AI review run limit"
                  description="When this many automatic review runs have been launched for a ticket, further review runs require a manual start."
                  min={1}
                  allowDecimal={false}
                  value={controller.projectOptionsAutomaticAgentReviewRunLimit}
                  onChange={(value) => {
                    if (
                      typeof value !== "number" ||
                      !Number.isFinite(value) ||
                      value < 1
                    ) {
                      return;
                    }

                    controller.setProjectOptionsFormError(null);
                    controller.updateProjectMutation.reset();
                    controller.setProjectOptionsAutomaticAgentReviewRunLimit(
                      Math.trunc(value),
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
                  label="Project preview start command"
                  description="Runs from the board header preview action. The command receives HOST, PORT, and VITE_API_URL environment variables."
                  placeholder="npm run dev -- --host $HOST --port $PORT"
                  value={controller.projectOptionsPreviewStartCommand}
                  onChange={(event) => {
                    controller.setProjectOptionsFormError(null);
                    controller.updateProjectMutation.reset();
                    controller.setProjectOptionsPreviewStartCommand(
                      event.currentTarget.value,
                    );
                  }}
                  minRows={2}
                />
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
                  data={getModelPresetOptions(
                    controller.projectOptionsAgentAdapter,
                  )}
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
                    placeholder={modelPlaceholder(
                      controller.projectOptionsAgentAdapter,
                    )}
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
                  data={getModelPresetOptions(
                    controller.projectOptionsAgentAdapter,
                  )}
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
                    placeholder={modelPlaceholder(
                      controller.projectOptionsAgentAdapter,
                    )}
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
              color: controller.projectColor,
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
              id="project-color"
              name="projectColor"
              label="Project color"
              description="Used for the compact rail tile accent."
              type="color"
              value={controller.projectColor}
              onChange={(event) =>
                controller.setProjectColor(
                  event.currentTarget.value.toUpperCase(),
                )
              }
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
