import {
  ActionIcon,
  Badge,
  Box,
  Loader,
  Popover,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { IconBellRinging2, IconPlus, IconSettings } from "@tabler/icons-react";
import { type CSSProperties, type ReactNode, useState } from "react";

import { MarkdownContent } from "../../components/MarkdownContent.js";
import {
  deriveProjectInitials,
  normalizeProjectColor,
} from "./shared-utils.js";
import type { WalleyBoardController } from "./use-walleyboard-controller.js";

function normalizeProjectTileSource(name: string): string {
  const source = name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .join("")
    .toUpperCase();

  return source.length > 0 ? source : "PROJECT";
}

function deriveProjectTileLabels(
  projects: Array<{ id: string; name: string }>,
): Map<string, string> {
  const groups = new Map<string, Array<{ id: string; source: string }>>();

  for (const project of projects) {
    const initials = deriveProjectInitials(project.name);
    const existing = groups.get(initials) ?? [];
    existing.push({
      id: project.id,
      source: normalizeProjectTileSource(project.name),
    });
    groups.set(initials, existing);
  }

  const labels = new Map<string, string>();

  for (const [initials, group] of groups) {
    if (group.length === 1) {
      const project = group[0];
      if (project) {
        labels.set(project.id, initials);
      }
      continue;
    }

    let resolved = false;
    for (let length = 3; length <= 4; length += 1) {
      const prefixes = group.map((project) => project.source.slice(0, length));
      if (new Set(prefixes).size === group.length) {
        group.forEach((project, index) => {
          labels.set(project.id, prefixes[index] ?? initials);
        });
        resolved = true;
        break;
      }
    }

    if (resolved) {
      continue;
    }

    group.forEach((project, index) => {
      labels.set(project.id, `${initials}${index + 1}`.slice(0, 4));
    });
  }

  return labels;
}

function ProjectTile({
  active = false,
  attention = false,
  ariaLabel,
  children,
  color,
  onClick,
  title,
}: {
  active?: boolean;
  attention?: boolean;
  ariaLabel: string;
  children: ReactNode;
  color: string;
  onClick: () => void;
  title?: string;
}) {
  return (
    <UnstyledButton
      aria-label={ariaLabel}
      className="project-tile"
      data-active={active ? "true" : "false"}
      data-attention={attention ? "true" : "false"}
      title={title}
      style={
        {
          "--project-tile-color": normalizeProjectColor(color),
        } as CSSProperties
      }
      onClick={onClick}
    >
      {children}
    </UnstyledButton>
  );
}

export function ProjectRail({
  controller,
}: {
  controller: WalleyBoardController;
}) {
  const [inboxOpen, setInboxOpen] = useState(false);
  const projects = controller.projectsQuery.data?.projects ?? [];
  const projectTileLabels = deriveProjectTileLabels(projects);
  const inboxItemCount = controller.actionItems.length;
  const unreadInboxItemCount = controller.unreadActionItemCount;
  const hasInboxItems = inboxItemCount > 0;
  const hasUnreadInboxItems = unreadInboxItemCount > 0;
  const inboxAriaLabel = hasInboxItems
    ? `Open notifications, ${inboxItemCount} actionable notification ${
        inboxItemCount === 1 ? "item" : "items"
      }`
    : "Open notifications";
  const notificationTileColor = hasUnreadInboxItems ? "#D97706" : "#64748B";
  const createProjectTileColor = "#64748B";

  return (
    <Box className="walleyboard-rail">
      <Stack gap={8} align="center">
        <Popover
          opened={inboxOpen}
          onChange={setInboxOpen}
          position="right-start"
          shadow="md"
          withinPortal
        >
          <Popover.Target>
            <Box className="project-tile-shell">
              <ProjectTile
                ariaLabel={inboxAriaLabel}
                attention={hasUnreadInboxItems}
                color={notificationTileColor}
                onClick={() => setInboxOpen((current) => !current)}
              >
                <IconBellRinging2 size={22} stroke={1.8} />
              </ProjectTile>
              {hasInboxItems ? (
                <span
                  className="project-tile-badge"
                  data-unread={hasUnreadInboxItems ? "true" : "false"}
                >
                  {inboxItemCount}
                </span>
              ) : null}
            </Box>
          </Popover.Target>

          <Popover.Dropdown className="project-inbox-popover">
            <Stack gap="xs">
              <Text fw={700} size="sm">
                Notifications
              </Text>
              {hasInboxItems ? (
                controller.actionItems.map((item) => (
                  <UnstyledButton
                    key={item.key}
                    className="project-inbox-item"
                    data-tone={item.color}
                    style={
                      {
                        "--project-inbox-accent": normalizeProjectColor(
                          item.projectColor,
                        ),
                      } as CSSProperties
                    }
                    onClick={() => {
                      setInboxOpen(false);
                      controller.openInboxItem(item);
                    }}
                  >
                    <Stack gap={6}>
                      <Box>
                        <Text fw={700} size="sm">
                          {item.title}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {item.projectName}
                        </Text>
                      </Box>
                      <MarkdownContent
                        className="markdown-muted markdown-small"
                        content={item.message}
                      />
                      <Badge
                        variant="light"
                        color={item.color === "yellow" ? "yellow" : "blue"}
                        size="sm"
                        style={{ alignSelf: "flex-start" }}
                      >
                        {item.actionLabel}
                      </Badge>
                    </Stack>
                  </UnstyledButton>
                ))
              ) : (
                <Text size="sm" c="dimmed">
                  No actionable notifications.
                </Text>
              )}
            </Stack>
          </Popover.Dropdown>
        </Popover>

        <Box className="project-rail-projects">
          {controller.projectsQuery.isPending ? (
            <Loader size="sm" />
          ) : controller.projectsQuery.isError ? (
            <Text c="red" size="xs" ta="center">
              {controller.projectsQuery.error.message}
            </Text>
          ) : (
            <>
              {projects.length === 0 ? (
                <Text size="xs" c="dimmed" ta="center">
                  No projects yet.
                </Text>
              ) : null}

              <Stack gap={6} className="project-tile-stack">
                {projects.map((project) => (
                  <Box key={project.id} className="project-tile-shell">
                    <ProjectTile
                      active={controller.selectedProjectId === project.id}
                      ariaLabel={`Open project ${project.name}`}
                      color={project.color}
                      onClick={() => controller.selectProject(project.id)}
                      title={project.name}
                    >
                      <span
                        className="project-tile-label"
                        data-length={String(
                          (projectTileLabels.get(project.id) ?? "").length,
                        )}
                      >
                        {projectTileLabels.get(project.id)}
                      </span>
                    </ProjectTile>
                    <ActionIcon
                      aria-label={`Project options for ${project.name}`}
                      className="project-tile-options"
                      color="gray"
                      size="xs"
                      variant="subtle"
                      onClick={(event) => {
                        event.stopPropagation();
                        controller.openProjectOptions(project);
                      }}
                    >
                      <IconSettings size={14} stroke={1.8} />
                    </ActionIcon>
                  </Box>
                ))}
              </Stack>
            </>
          )}
        </Box>

        <Box className="project-rail-create">
          <ProjectTile
            ariaLabel="Create project"
            color={createProjectTileColor}
            onClick={controller.openProjectModal}
          >
            <IconPlus size={22} stroke={1.8} />
          </ProjectTile>
        </Box>
      </Stack>
    </Box>
  );
}
