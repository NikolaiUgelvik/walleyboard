import { useQueries } from "@tanstack/react-query";
import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";

import { fetchJson } from "./shared-api.js";
import type { TicketWorkspaceSummaryResponse } from "./shared-types.js";

export function getTicketsWithVisibleDiffSummary(
  tickets: TicketFrontmatter[],
): TicketFrontmatter[] {
  return tickets.filter(
    (ticket) =>
      ticket.status === "done" ||
      (ticket.session_id !== null &&
        (ticket.status === "in_progress" || ticket.status === "review")),
  );
}

export function useTicketDiffLineSummary(tickets: TicketFrontmatter[]) {
  const ticketsWithVisibleDiffSummary =
    getTicketsWithVisibleDiffSummary(tickets);
  const ticketDiffSummaryQueries = useQueries({
    queries: ticketsWithVisibleDiffSummary.map((ticket) => ({
      queryKey: ["tickets", ticket.id, "workspace", "summary"],
      queryFn: () =>
        fetchJson<TicketWorkspaceSummaryResponse>(
          `/tickets/${ticket.id}/workspace/summary`,
        ),
      retry: false,
    })),
  });

  return new Map(
    ticketDiffSummaryQueries.flatMap((query, index) => {
      const ticket = ticketsWithVisibleDiffSummary[index];
      const workspaceSummary = query.data?.workspace_summary;
      return ticket && workspaceSummary
        ? [
            [
              ticket.id,
              {
                additions: workspaceSummary.added_lines,
                deletions: workspaceSummary.removed_lines,
                files: workspaceSummary.files_changed,
              },
            ],
          ]
        : [];
    }),
  );
}
