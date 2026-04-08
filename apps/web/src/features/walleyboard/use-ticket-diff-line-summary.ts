import { useQueries } from "@tanstack/react-query";
import { useRef } from "react";
import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";

import { fetchJson } from "./shared-api.js";
import type { TicketWorkspaceSummaryResponse } from "./shared-types.js";

type DiffSummary = { additions: number; deletions: number; files: number };

function diffMapsEqual(
  a: Map<number, DiffSummary>,
  b: Map<number, DiffSummary>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [id, val] of a) {
    const other = b.get(id);
    if (
      !other ||
      other.additions !== val.additions ||
      other.deletions !== val.deletions ||
      other.files !== val.files
    ) {
      return false;
    }
  }
  return true;
}

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

export function useTicketDiffLineSummary(
  tickets: TicketFrontmatter[],
  visibleTicketIds?: Set<number>,
) {
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
      enabled:
        visibleTicketIds === undefined || visibleTicketIds.has(ticket.id),
    })),
  });

  const prevRef = useRef<Map<number, DiffSummary>>(new Map());

  const nextMap = new Map<number, DiffSummary>(
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
            ] as [number, DiffSummary],
          ]
        : [];
    }),
  );

  if (!diffMapsEqual(prevRef.current, nextMap)) {
    prevRef.current = nextMap;
  }

  return prevRef.current;
}
