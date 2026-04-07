import { useCallback, useRef, useState } from "react";
import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";

import { useTicketDiffLineSummary } from "./use-ticket-diff-line-summary.js";

function mergeColumnSets(columnMap: Map<string, Set<number>>): Set<number> {
  const merged = new Set<number>();
  for (const ids of columnMap.values()) {
    for (const id of ids) {
      merged.add(id);
    }
  }
  return merged;
}

export function useVisibleTicketDiffSummary(tickets: TicketFrontmatter[]) {
  const columnMapRef = useRef<Map<string, Set<number>>>(new Map());
  const [visibleTicketIds, setVisibleTicketIds] = useState<
    Set<number> | undefined
  >(undefined);
  const ticketDiffLineSummaryByTicketId = useTicketDiffLineSummary(
    tickets,
    visibleTicketIds,
  );

  const updateVisibleTicketIds = useCallback(
    (column: string, columnVisibleIds: Set<number>) => {
      columnMapRef.current.set(column, columnVisibleIds);
      setVisibleTicketIds(mergeColumnSets(columnMapRef.current));
    },
    [],
  );

  return { ticketDiffLineSummaryByTicketId, updateVisibleTicketIds };
}
