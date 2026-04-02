import { useQuery } from "@tanstack/react-query";
import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";

import {
  fetchJson,
  fetchOptionalJson,
  type ReviewPackageResponse,
  type ReviewRunResponse,
  type TicketWorkspaceDiffResponse,
  type WorkspaceModalKind,
} from "./shared.js";

export function useTicketReviewQueries(input: {
  selectedSessionTicketId: number | null;
  selectedSessionTicketStatus: TicketFrontmatter["status"] | null;
  selectedWorkspaceTicketId: number | null;
  workspaceModal: WorkspaceModalKind | null;
}) {
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
    refetchInterval:
      input.selectedSessionTicketId !== null &&
      input.selectedSessionTicketStatus === "review"
        ? 2_000
        : false,
    retry: false,
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
    reviewPackageQuery,
    ticketWorkspaceDiffQuery,
  };
}
