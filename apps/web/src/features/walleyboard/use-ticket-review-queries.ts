import { useQuery } from "@tanstack/react-query";
import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";

import { fetchJson, fetchOptionalJson } from "./shared-api.js";
import type {
  ReviewPackageResponse,
  ReviewRunResponse,
  ReviewRunsResponse,
  SessionAttemptsResponse,
  TicketEventsResponse,
  TicketWorkspaceDiffResponse,
  WorkspaceModalKind,
} from "./shared-types.js";

export function useTicketReviewQueries(input: {
  selectedSessionId: string | null;
  selectedSessionTicketId: number | null;
  selectedSessionTicketStatus: TicketFrontmatter["status"] | null;
  selectedWorkspaceTicketId: number | null;
  workspaceModal: WorkspaceModalKind | null;
}) {
  const activityModalOpen = input.workspaceModal === "activity";

  const reviewPackageQuery = useQuery({
    queryKey: ["tickets", input.selectedSessionTicketId, "review-package"],
    queryFn: () =>
      fetchJson<ReviewPackageResponse>(
        `/tickets/${input.selectedSessionTicketId}/review-package`,
      ),
    enabled:
      input.selectedSessionTicketId !== null &&
      input.selectedSessionTicketStatus === "review",
  });

  const latestReviewRunQuery = useQuery({
    queryKey: ["tickets", input.selectedSessionTicketId, "review-run"],
    queryFn: () =>
      fetchOptionalJson<ReviewRunResponse>(
        `/tickets/${input.selectedSessionTicketId}/review-run`,
      ),
    enabled:
      input.selectedSessionTicketId !== null &&
      input.selectedSessionTicketStatus === "review",
    retry: false,
  });

  const reviewRunsQuery = useQuery({
    queryKey: ["tickets", input.selectedSessionTicketId, "review-runs"],
    queryFn: () =>
      fetchJson<ReviewRunsResponse>(
        `/tickets/${input.selectedSessionTicketId}/review-runs`,
      ),
    enabled:
      input.selectedSessionTicketId !== null &&
      (input.selectedSessionTicketStatus === "review" || activityModalOpen),
  });

  const sessionAttemptsQuery = useQuery({
    queryKey: ["sessions", input.selectedSessionId, "attempts"],
    queryFn: () =>
      fetchJson<SessionAttemptsResponse>(
        `/sessions/${input.selectedSessionId}/attempts`,
      ),
    enabled: activityModalOpen && input.selectedSessionId !== null,
  });

  const ticketEventsQuery = useQuery({
    queryKey: ["tickets", input.selectedSessionTicketId, "events"],
    queryFn: () =>
      fetchJson<TicketEventsResponse>(
        `/tickets/${input.selectedSessionTicketId}/events`,
      ),
    enabled: activityModalOpen && input.selectedSessionTicketId !== null,
  });

  const ticketWorkspaceDiffQuery = useQuery({
    queryKey: ["tickets", input.selectedWorkspaceTicketId, "workspace", "diff"],
    queryFn: () =>
      fetchJson<TicketWorkspaceDiffResponse>(
        `/tickets/${input.selectedWorkspaceTicketId}/workspace/diff`,
      ),
    enabled:
      input.workspaceModal === "diff" &&
      input.selectedWorkspaceTicketId !== null,
    retry: false,
  });

  return {
    latestReviewRunQuery,
    reviewRunsQuery,
    reviewPackageQuery,
    sessionAttemptsQuery,
    ticketWorkspaceDiffQuery,
    ticketEventsQuery,
  };
}
