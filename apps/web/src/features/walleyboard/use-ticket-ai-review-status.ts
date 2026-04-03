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

export function useTicketAiReviewStatus(
  tickets: TicketFrontmatter[],
): Map<number, boolean> {
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

  return new Map(
    reviewTickets.map((ticket, index) => [
      ticket.id,
      reviewRunQueries[index]?.data?.review_run?.status === "running",
    ]),
  );
}
