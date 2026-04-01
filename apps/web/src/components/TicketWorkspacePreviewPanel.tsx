import { Box, Button, Code, Group, Loader, Stack, Text } from "@mantine/core";
import type { TicketWorkspacePreview } from "../../../../packages/contracts/src/index.js";

type TicketWorkspacePreviewPanelProps = {
  error?: string | null;
  isLoading: boolean;
  isStarting: boolean;
  onStart: () => void;
  preview: TicketWorkspacePreview | null;
  worktreePath: string | null;
};

export function TicketWorkspacePreviewPanel({
  error,
  isLoading,
  isStarting,
  onStart,
  preview,
  worktreePath,
}: TicketWorkspacePreviewPanelProps) {
  if (isLoading && !preview) {
    return (
      <Group justify="center" className="ticket-workspace-preview-shell">
        <Loader size="sm" />
      </Group>
    );
  }

  if (preview?.state === "ready" && preview.preview_url) {
    return (
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Text fw={600}>Live preview</Text>
            <Text size="sm" c="dimmed">
              Running from <Code>{worktreePath ?? "pending"}</Code>
            </Text>
          </Stack>
          <Button
            component="a"
            href={preview.preview_url}
            rel="noreferrer"
            target="_blank"
            variant="light"
          >
            Open in New Tab
          </Button>
        </Group>

        <Box className="ticket-workspace-preview-shell">
          <iframe
            className="ticket-workspace-preview-frame"
            src={preview.preview_url}
            title="Ticket workspace preview"
          />
        </Box>
      </Stack>
    );
  }

  return (
    <Stack gap="sm">
      <Stack gap={4}>
        <Text fw={600}>Project preview</Text>
        <Text size="sm" c="dimmed">
          Start the ticket worktree app and load it inline here.
        </Text>
        {worktreePath ? (
          <Text size="sm" c="dimmed">
            Working tree: <Code>{worktreePath}</Code>
          </Text>
        ) : null}
      </Stack>

      {preview?.error || error ? (
        <Text size="sm" c="red">
          {preview?.error ?? error}
        </Text>
      ) : null}

      {preview?.state === "starting" || isStarting ? (
        <Group gap="xs">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Starting the preview server.
          </Text>
        </Group>
      ) : (
        <Button onClick={onStart}>
          {preview?.state === "failed" ? "Retry Preview" : "Start Preview"}
        </Button>
      )}
    </Stack>
  );
}
