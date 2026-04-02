import { Button, Group, List, Loader, Stack, Text } from "@mantine/core";

import type { ReviewRun } from "../../../../packages/contracts/src/index.js";

import { MarkdownContent } from "./MarkdownContent.js";

type AgentReviewPanelProps = {
  latestReviewRun: ReviewRun | null;
  latestReviewRunPending: boolean;
  onStart: () => void;
  startError: string | null;
  startPending: boolean;
};

export function AgentReviewPanel({
  latestReviewRun,
  latestReviewRunPending,
  onStart,
  startError,
  startPending,
}: AgentReviewPanelProps) {
  return (
    <Stack gap="xs">
      <Group justify="space-between" align="center">
        <Text fw={700}>Agent review</Text>
        <Button
          size="xs"
          variant="light"
          loading={startPending}
          disabled={latestReviewRun?.status === "running"}
          onClick={onStart}
        >
          {latestReviewRun?.status === "running"
            ? "Review running"
            : "Run agent review"}
        </Button>
      </Group>
      {latestReviewRunPending && !latestReviewRun ? <Loader size="sm" /> : null}
      {latestReviewRun ? (
        <Stack gap={4}>
          <Text size="sm" c="dimmed">
            Status: {latestReviewRun.status}
          </Text>
          {latestReviewRun.status === "running" ? (
            <Text size="sm" c="dimmed">
              A separate read-only review session is inspecting the current
              worktree.
            </Text>
          ) : null}
          {latestReviewRun.failure_message ? (
            <Text size="sm" c="red">
              {latestReviewRun.failure_message}
            </Text>
          ) : null}
          {latestReviewRun.report ? (
            <>
              <MarkdownContent
                className="markdown-muted markdown-small"
                content={latestReviewRun.report.summary}
              />
              {latestReviewRun.report.actionable_findings.length > 0 ? (
                <List size="sm" spacing={4}>
                  {latestReviewRun.report.actionable_findings.map((finding) => (
                    <List.Item
                      key={`${finding.severity}:${finding.category}:${finding.title}`}
                    >
                      [{finding.severity}] {finding.category}: {finding.title}.{" "}
                      {finding.details}
                    </List.Item>
                  ))}
                </List>
              ) : latestReviewRun.status === "completed" ? (
                <Text size="sm" c="dimmed">
                  No actionable findings were reported.
                </Text>
              ) : null}
            </>
          ) : null}
        </Stack>
      ) : (
        <Text size="sm" c="dimmed">
          No agent review run has been started yet.
        </Text>
      )}
      {startError ? (
        <Text size="sm" c="red">
          {startError}
        </Text>
      ) : null}
    </Stack>
  );
}
