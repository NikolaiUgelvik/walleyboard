import { useState } from "react";
import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";

import { useTicketDiffLineSummary } from "./use-ticket-diff-line-summary.js";

export function useVisibleTicketDiffSummary(tickets: TicketFrontmatter[]) {
  const [visibleTicketIds, setVisibleTicketIds] = useState<Set<number>>(
    new Set(),
  );
  const ticketDiffLineSummaryByTicketId = useTicketDiffLineSummary(
    tickets,
    visibleTicketIds,
  );

  return { ticketDiffLineSummaryByTicketId, setVisibleTicketIds };
}
