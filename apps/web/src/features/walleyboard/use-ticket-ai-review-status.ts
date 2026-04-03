import { useQueries } from "@tanstack/react-query";
import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";

import { fetchOptionalJson, type ReviewRunResponse } from "./shared.js";

export function getTicketsWithAiReviewSessions(
  tickets: TicketFrontmatter[],
): Array<TicketFrontmatter & { session_id: string }> {
  return tickets.filter(
    (
      ticket,
    ): ticket is TicketFrontmatter & {
      session_id: string;
    } => ticket.session_id !== null,
  );
}

type TicketAiReviewStatus = {
  ticketAiReviewActiveById: Map<number, boolean>;
  ticketAiReviewResolvedById: Map<number, boolean>;
  reviewRunQueriesSettled: boolean;
};

function isReviewRunQueryResolved(query: {
  data: ReviewRunResponse | null | undefined;
  status: "pending" | "error" | "success";
}): boolean {
  if (query.status === "success") {
    return true;
  }

  const reviewRun = query.data?.review_run ?? null;
  return (
    query.status === "error" &&
    reviewRun !== null &&
    reviewRun.status !== "running"
  );
}

export function deriveTicketAiReviewStatus(input: {
  reviewRunQueries: Array<{
    data: ReviewRunResponse | null | undefined;
    status: "pending" | "error" | "success";
  }>;
  reviewTickets: Array<TicketFrontmatter & { session_id: string }>;
}): TicketAiReviewStatus {
  const ticketAiReviewActiveById = new Map<number, boolean>();
  const ticketAiReviewResolvedById = new Map<number, boolean>();

  for (const [index, ticket] of input.reviewTickets.entries()) {
    const query = input.reviewRunQueries[index];
    const reviewRun = query?.data?.review_run ?? null;

    ticketAiReviewActiveById.set(ticket.id, reviewRun?.status === "running");
    ticketAiReviewResolvedById.set(
      ticket.id,
      query !== undefined && isReviewRunQueryResolved(query),
    );
  }

  return {
    ticketAiReviewActiveById,
    ticketAiReviewResolvedById,
    reviewRunQueriesSettled: input.reviewRunQueries.every(
      isReviewRunQueryResolved,
    ),
  };
}

export function useTicketAiReviewStatus(
  tickets: TicketFrontmatter[],
): TicketAiReviewStatus {
  const reviewTickets = getTicketsWithAiReviewSessions(tickets);
  const reviewRunQueries = useQueries({
    queries: reviewTickets.map((ticket) => ({
      queryKey: ["tickets", ticket.id, "review-run"],
      queryFn: () =>
        fetchOptionalJson<ReviewRunResponse>(
          `/tickets/${ticket.id}/review-run`,
        ),
      refetchInterval: 2_000,
      retry: false,
    })),
  });

  return deriveTicketAiReviewStatus({
    reviewRunQueries,
    reviewTickets,
  });
}
