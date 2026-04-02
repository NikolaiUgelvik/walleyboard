import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";

import { MarkdownContent } from "../../components/MarkdownContent.js";
import { SectionCard } from "../../components/SectionCard.js";
import type { WalleyBoardController } from "./use-walleyboard-controller.js";

export function ProjectRail({
  controller,
}: {
  controller: WalleyBoardController;
}) {
  return (
    <Box className="walleyboard-rail">
      <Stack gap="md">
        <SectionCard title="Projects">
          {controller.projectsQuery.isPending ? (
            <Loader size="sm" />
          ) : controller.projectsQuery.isError ? (
            <Text c="red" size="sm">
              {controller.projectsQuery.error.message}
            </Text>
          ) : controller.projectsQuery.data.projects.length === 0 ? (
            <Stack gap="sm">
              <Text size="sm" c="dimmed">
                No projects yet. Create the first one below.
              </Text>
              <Button
                variant="light"
                onClick={() => controller.setProjectModalOpen(true)}
              >
                Create Project
              </Button>
            </Stack>
          ) : (
            <Stack gap="xs">
              {controller.projectsQuery.data.projects.map((project) => (
                <Group key={project.id} gap="xs" wrap="nowrap">
                  <Button
                    className="project-nav-button"
                    data-selected={
                      controller.selectedProjectId === project.id
                        ? "true"
                        : "false"
                    }
                    variant={
                      controller.selectedProjectId === project.id
                        ? "filled"
                        : "subtle"
                    }
                    justify="space-between"
                    style={{ flex: 1 }}
                    onClick={() => controller.selectProject(project.id)}
                  >
                    <span>{project.name}</span>
                  </Button>
                  <ActionIcon
                    aria-label={`Project options for ${project.name}`}
                    color="gray"
                    variant="subtle"
                    onClick={(event) => {
                      event.stopPropagation();
                      controller.openProjectOptions(project);
                    }}
                  >
                    ...
                  </ActionIcon>
                </Group>
              ))}
              <Button
                variant="light"
                onClick={() => controller.setProjectModalOpen(true)}
              >
                Create Project
              </Button>
            </Stack>
          )}
        </SectionCard>

        {controller.actionItems.length > 0 ? (
          <SectionCard title="Inbox">
            <Stack gap="xs">
              {controller.actionItems.map((item) => (
                <Box
                  key={item.key}
                  className="inbox-item"
                  data-tone={item.color}
                >
                  <Stack gap={6}>
                    <Group justify="space-between" align="flex-start">
                      <Text fw={700} size="sm" style={{ flex: 1 }}>
                        {item.title}
                      </Text>
                      <Badge variant="light" color="gray" size="xs">
                        {item.projectName}
                      </Badge>
                    </Group>
                    <MarkdownContent
                      className="markdown-muted markdown-small"
                      content={item.message}
                    />
                    <Group justify="flex-end">
                      <Button
                        variant="light"
                        size="xs"
                        onClick={() => {
                          controller.selectProject(item.projectId);
                          controller.setInspectorState({
                            kind: "session",
                            sessionId: item.sessionId,
                          });
                        }}
                      >
                        {item.actionLabel}
                      </Button>
                    </Group>
                  </Stack>
                </Box>
              ))}
            </Stack>
          </SectionCard>
        ) : null}
      </Stack>
    </Box>
  );
}
