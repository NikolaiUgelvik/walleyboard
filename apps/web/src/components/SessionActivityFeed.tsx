import { Badge, Code, Group, List, Stack, Text } from "@mantine/core";
import React from "react";
import type { ExecutionSession } from "../../../../packages/contracts/src/index.js";
import { agentLabel as agentLabelForAdapter } from "../features/walleyboard/shared.js";
import { MarkdownContent } from "./MarkdownContent.js";
import {
  fallbackSessionSummary,
  getRecentSessionActivities,
  parseExecutionSummary,
} from "./session-activity-model.js";

type SessionActivityFeedProps = {
  logs: string[];
  session: ExecutionSession;
};

function sessionAgentLabel(session: ExecutionSession): string {
  return agentLabelForAdapter(session.agent_adapter);
}

export { summarizeSessionActivity } from "./session-activity-model.js";

export function SessionActivityFeed({
  logs,
  session,
}: SessionActivityFeedProps) {
  const agentLabel = sessionAgentLabel(session);
  const visibleActivities = getRecentSessionActivities(logs, session);
  const parsedSummary = parseExecutionSummary(
    session.last_summary ?? fallbackSessionSummary(session),
  );
  const recentActivityHint = React.Children.only(
    <Text size="sm" c="dimmed">
      This view highlights notable {agentLabel} and system updates instead of
      showing the raw terminal transcript.
    </Text>,
  );

  return (
    <Stack gap="md">
      <Stack gap={4}>
        <Text fw={600}>Execution Summary</Text>
        {parsedSummary.overview ? (
          <Stack gap={2}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Outcome
            </Text>
            <MarkdownContent
              className="markdown-muted markdown-small"
              content={parsedSummary.overview}
            />
          </Stack>
        ) : null}
        {parsedSummary.commit ? (
          <Stack gap={2}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Commit
            </Text>
            <Group gap="xs" wrap="wrap">
              <Code>{parsedSummary.commit.hash}</Code>
              {parsedSummary.commit.message ? (
                <Text size="sm" c="dimmed">
                  {parsedSummary.commit.message}
                </Text>
              ) : null}
            </Group>
          </Stack>
        ) : null}
        {parsedSummary.validation ? (
          <Stack gap={2}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Validation
            </Text>
            {parsedSummary.validation.commands.length > 0 ? (
              <List size="sm" spacing={4}>
                {parsedSummary.validation.commands.map((command) => (
                  <List.Item key={command}>
                    <Code>{command}</Code>
                  </List.Item>
                ))}
              </List>
            ) : null}
            {parsedSummary.validation.note ? (
              <MarkdownContent
                className="markdown-muted markdown-small"
                content={parsedSummary.validation.note}
              />
            ) : null}
          </Stack>
        ) : null}
        {parsedSummary.risks.length > 0 ? (
          <Stack gap={2}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Remaining Risks
            </Text>
            {parsedSummary.risks.length === 1 ? (
              <MarkdownContent
                className="markdown-muted markdown-small"
                content={parsedSummary.risks[0] ?? ""}
              />
            ) : (
              <List size="sm" spacing={4}>
                {parsedSummary.risks.map((risk) => (
                  <List.Item key={risk}>
                    <MarkdownContent content={risk} />
                  </List.Item>
                ))}
              </List>
            )}
          </Stack>
        ) : null}
      </Stack>

      <Stack gap={4}>
        <Text fw={600}>Recent Activity</Text>
        {recentActivityHint}
        {visibleActivities.length === 0 ? (
          <Text size="sm" c="dimmed">
            No interpreted activity is available for this session yet.
          </Text>
        ) : (
          <Stack gap="xs">
            {visibleActivities.map((activity) => (
              <Group key={activity.key} align="flex-start" wrap="nowrap">
                <Badge color={activity.tone} variant="light" mt={2}>
                  {activity.label}
                </Badge>
                <div style={{ flex: 1 }}>
                  <MarkdownContent
                    className="markdown-small"
                    content={activity.detail}
                  />
                </div>
              </Group>
            ))}
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}
