import { ActionIcon, Box, Loader, Stack, Text } from "@mantine/core";
import { IconCopy } from "@tabler/icons-react";
import type {
  ExecutionAttempt,
  ExecutionSession,
  ReviewRun,
  StructuredEvent,
} from "../../../../packages/contracts/src/index.js";
import { formatTimestamp } from "../features/walleyboard/shared-utils.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { buildSessionTimeline } from "./session-activity-model.js";

export function SessionActivityTimeline({
  attempts,
  error,
  events,
  isLoading,
  logs,
  reviewRuns,
  session,
}: {
  attempts: ExecutionAttempt[];
  error: string | null;
  events: StructuredEvent[];
  isLoading: boolean;
  logs: string[];
  reviewRuns: ReviewRun[];
  session: ExecutionSession;
}) {
  const clipboardAvailable =
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.writeText === "function";
  const timelineEntries = buildSessionTimeline({
    attempts,
    events,
    logs,
    reviewRuns,
    session,
  });

  if (isLoading && timelineEntries.length === 0) {
    return <Loader size="sm" />;
  }

  if (error) {
    return (
      <Text size="sm" c="red">
        {error}
      </Text>
    );
  }

  if (timelineEntries.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        No timeline events are available for this ticket yet.
      </Text>
    );
  }

  return (
    <Stack className="session-timeline" gap="md">
      {timelineEntries.map((entry, index) => {
        const copyMarkdown = entry.copyMarkdown;

        return (
          <Box key={entry.key} className="session-timeline-item">
            <div className="session-timeline-rail" aria-hidden="true">
              <div className="session-timeline-dot" data-tone={entry.tone} />
              {index < timelineEntries.length - 1 ? (
                <div className="session-timeline-line" />
              ) : null}
            </div>
            <Box className="session-timeline-card" data-tone={entry.tone}>
              <div className="session-timeline-header">
                <Text className="session-timeline-kicker">{entry.kicker}</Text>
                <div className="session-timeline-meta">
                  <Text size="xs" c="dimmed">
                    {formatTimestamp(entry.occurredAt)}
                  </Text>
                  {clipboardAvailable && copyMarkdown ? (
                    <ActionIcon
                      aria-label="Copy raw prompt markdown"
                      color="gray"
                      size="sm"
                      title="Copy raw prompt markdown"
                      variant="subtle"
                      onClick={(event) => {
                        event.stopPropagation();
                        void navigator.clipboard.writeText(copyMarkdown);
                      }}
                    >
                      <IconCopy size={14} stroke={1.8} />
                    </ActionIcon>
                  ) : null}
                </div>
              </div>
              <Text className="session-timeline-title">{entry.title}</Text>
              {entry.detail ? (
                <MarkdownContent
                  className="markdown-small"
                  content={entry.detail}
                />
              ) : null}
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}
