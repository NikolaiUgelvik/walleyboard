import { Box, Loader, Modal, Stack, Text } from "@mantine/core";

import type { ReviewRun } from "../../../../packages/contracts/src/index.js";

import { MarkdownContent } from "./MarkdownContent.js";

function reviewRunHeadline(reviewRun: ReviewRun): string {
  return `Run ${reviewRun.id} • ${reviewRun.created_at}`;
}

export function AgentReviewHistoryList({
  reviewRuns,
  reviewRunsPending,
  reviewRunsError,
}: {
  reviewRuns: ReviewRun[];
  reviewRunsPending: boolean;
  reviewRunsError: string | null;
}) {
  if (reviewRunsPending && reviewRuns.length === 0) {
    return <Loader size="sm" />;
  }

  if (reviewRunsError) {
    return (
      <Text size="sm" c="red">
        {reviewRunsError}
      </Text>
    );
  }

  if (reviewRuns.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        No agent review runs have been stored for this ticket yet.
      </Text>
    );
  }

  return (
    <Stack gap="sm">
      {reviewRuns.map((reviewRun, index) => (
        <Box key={reviewRun.id} className="detail-meta-card">
          <Stack gap={6}>
            <Text fw={700}>
              {index + 1}. {reviewRunHeadline(reviewRun)}
            </Text>
            <Text size="sm" c="dimmed">
              Status: {reviewRun.status}
            </Text>
            {reviewRun.status === "running" ? (
              <Text size="sm" c="dimmed">
                Review under processing.
              </Text>
            ) : null}
            {reviewRun.report ? (
              <MarkdownContent
                className="markdown-muted markdown-small"
                content={reviewRun.report.summary}
              />
            ) : reviewRun.status === "completed" ? (
              <Text size="sm" c="dimmed">
                No stored summary is available for this run.
              </Text>
            ) : null}
            {reviewRun.failure_message ? (
              <Text size="sm" c="red">
                {reviewRun.failure_message}
              </Text>
            ) : null}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}

export function AgentReviewHistoryModal({
  onClose,
  opened,
  reviewRuns,
  reviewRunsError,
  reviewRunsPending,
  ticketId,
}: {
  onClose: () => void;
  opened: boolean;
  reviewRuns: ReviewRun[];
  reviewRunsError: string | null;
  reviewRunsPending: boolean;
  ticketId: number | null;
}) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        ticketId === null
          ? "Agent review history"
          : `Agent review history • Ticket #${ticketId}`
      }
      centered
      size="lg"
    >
      <AgentReviewHistoryList
        reviewRuns={reviewRuns}
        reviewRunsPending={reviewRunsPending}
        reviewRunsError={reviewRunsError}
      />
    </Modal>
  );
}
