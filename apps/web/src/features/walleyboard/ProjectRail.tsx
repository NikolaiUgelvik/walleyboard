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
import { IconBellRinging2, IconDots, IconPlus } from "@tabler/icons-react";
import { type CSSProperties, type ReactNode, useState } from "react";

import { MarkdownContent } from "../../components/MarkdownContent.js";
import {
  deriveProjectInitials,
  normalizeProjectColor,
} from "./shared-utils.js";
import type { WalleyBoardController } from "./use-walleyboard-controller.js";

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
  const hasInboxItems = controller.actionItems.length > 0;

  return (
    <Box className="walleyboard-rail">
      <Stack gap="sm" align="center">
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
                ariaLabel="Open inbox"
                attention={hasInboxItems}
                color={hasInboxItems ? "#D97706" : "#64748B"}
                onClick={() => setInboxOpen((current) => !current)}
              >
                <IconBellRinging2 size={22} stroke={1.8} />
              </ProjectTile>
              {hasInboxItems ? (
                <span className="project-tile-badge">
                  {Math.min(controller.actionItems.length, 9)}
                </span>
              ) : null}
            </Box>
          </Popover.Target>

          <Popover.Dropdown className="project-inbox-popover">
            <Stack gap="xs">
              <Text fw={700} size="sm">
                Inbox
              </Text>
              {hasInboxItems ? (
                controller.actionItems.map((item) => (
                  <UnstyledButton
                    key={item.key}
                    className="project-inbox-item"
                    data-tone={item.color}
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
                  No actionable inbox items.
                </Text>
              )}
            </Stack>
          </Popover.Dropdown>
        </Popover>

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

            <Stack gap="xs" className="project-tile-stack">
              {projects.map((project) => (
                <Box key={project.id} className="project-tile-shell">
                  <ProjectTile
                    active={controller.selectedProjectId === project.id}
                    ariaLabel={`Open project ${project.name}`}
                    color={project.color ?? "#2563EB"}
                    onClick={() => controller.selectProject(project.id)}
                    title={project.name}
                  >
                    <span className="project-tile-label">
                      {deriveProjectInitials(project.name)}
                    </span>
                  </ProjectTile>
                  <ActionIcon
                    aria-label={`Project options for ${project.name}`}
                    className="project-tile-options"
                    color="gray"
                    size="sm"
                    variant="subtle"
                    onClick={(event) => {
                      event.stopPropagation();
                      controller.openProjectOptions(project);
                    }}
                  >
                    <IconDots size={14} stroke={1.8} />
                  </ActionIcon>
                </Box>
              ))}
            </Stack>
          </>
        )}

        <ProjectTile
          ariaLabel="Create project"
          color="#2563EB"
          onClick={() => controller.setProjectModalOpen(true)}
        >
          <IconPlus size={22} stroke={1.8} />
        </ProjectTile>
      </Stack>
    </Box>
  );
}
