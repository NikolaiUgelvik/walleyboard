import { useQueries } from "@tanstack/react-query";
import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";

import { fetchOptionalJson, type ReviewRunResponse } from "./shared.js";

export function useTicketAiReviewStatus(
  tickets: TicketFrontmatter[],
): Map<number, boolean> {
  const reviewTickets = tickets.filter((ticket) => ticket.status === "review");
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
