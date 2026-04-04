import { useQueries } from "@tanstack/react-query";
import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";

import { summarizeTicketWorkspaceDiff } from "../../lib/ticket-workspace-diff-summary.js";
import { fetchJson, type TicketWorkspaceDiffResponse } from "./shared.js";

export function useTicketDiffLineSummary(tickets: TicketFrontmatter[]) {
  const ticketsWithVisibleDiffSummary = tickets.filter(
    (
      ticket,
    ): ticket is TicketFrontmatter & {
      session_id: string;
    } =>
      ticket.session_id !== null &&
      (ticket.status === "in_progress" || ticket.status === "review"),
  );
  const ticketDiffSummaryQueries = useQueries({
    queries: ticketsWithVisibleDiffSummary.map((ticket) => ({
      queryKey: ["tickets", ticket.id, "workspace", "diff"],
      queryFn: () =>
        fetchJson<TicketWorkspaceDiffResponse>(
          `/tickets/${ticket.id}/workspace/diff`,
        ),
      retry: false,
    })),
  });

  return new Map(
    ticketDiffSummaryQueries.flatMap((query, index) => {
      const ticket = ticketsWithVisibleDiffSummary[index];
      const workspaceDiff = query.data?.workspace_diff;
      const summary =
        workspaceDiff === undefined
          ? null
          : summarizeTicketWorkspaceDiff(workspaceDiff);
      return ticket && summary ? [[ticket.id, summary]] : [];
    }),
  );
}
