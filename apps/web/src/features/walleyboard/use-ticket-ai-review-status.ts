import { useQueries } from "@tanstack/react-query";
import type {
  Project,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import { fetchOptionalJson } from "./shared-api.js";
import type { ReviewRunResponse } from "./shared-types.js";

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

function isReviewRunQueryResolvedForTicket(
  query: {
    data: ReviewRunResponse | null | undefined;
    status: "pending" | "error" | "success";
  },
  requireReviewRunRecord: boolean,
): boolean {
  if (query.status === "success") {
    return !requireReviewRunRecord || query.data?.review_run != null;
  }

  const reviewRun = query.data?.review_run ?? null;
  return (
    query.status === "error" &&
    reviewRun !== null &&
    reviewRun.status !== "running"
  );
}

export function deriveTicketAiReviewStatus(input: {
  automaticAgentReviewByProjectId?: ReadonlyMap<string, boolean>;
  reviewRunQueries: Array<{
    data: ReviewRunResponse | null | undefined;
    status: "pending" | "error" | "success";
  }>;
  reviewTickets: Array<TicketFrontmatter & { session_id: string }>;
}): TicketAiReviewStatus {
  const ticketAiReviewActiveById = new Map<number, boolean>();
  const ticketAiReviewResolvedById = new Map<number, boolean>();
  const automaticAgentReviewByProjectId =
    input.automaticAgentReviewByProjectId ?? new Map<string, boolean>();

  for (const [index, ticket] of input.reviewTickets.entries()) {
    const query = input.reviewRunQueries[index];
    const reviewRun = query?.data?.review_run ?? null;
    const requireReviewRunRecord =
      ticket.status === "review" &&
      automaticAgentReviewByProjectId.get(ticket.project) === true;

    ticketAiReviewActiveById.set(ticket.id, reviewRun?.status === "running");
    ticketAiReviewResolvedById.set(
      ticket.id,
      query !== undefined &&
        isReviewRunQueryResolvedForTicket(query, requireReviewRunRecord),
    );
  }

  return {
    ticketAiReviewActiveById,
    ticketAiReviewResolvedById,
    reviewRunQueriesSettled: input.reviewRunQueries.every((query, index) =>
      isReviewRunQueryResolvedForTicket(
        query,
        input.reviewTickets[index]?.status === "review" &&
          automaticAgentReviewByProjectId.get(
            input.reviewTickets[index]?.project ?? "",
          ) === true,
      ),
    ),
  };
}

export function useTicketAiReviewStatus(
  tickets: TicketFrontmatter[],
  projects: Project[],
): TicketAiReviewStatus {
  const reviewTickets = getTicketsWithAiReviewSessions(tickets);
  const automaticAgentReviewByProjectId = new Map(
    projects.map((project) => [project.id, project.automatic_agent_review]),
  );
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
    automaticAgentReviewByProjectId,
    reviewRunQueries,
    reviewTickets,
  });
}
