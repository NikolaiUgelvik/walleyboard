import { useEffect, useState } from "react";

import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";

import type { InspectorState } from "./shared-types.js";

export function useAgentReviewHistoryModalState(input: {
  inspectorKind: InspectorState["kind"];
  selectedSessionTicketStatus: TicketFrontmatter["status"] | null;
}) {
  const [agentReviewHistoryModalOpen, setAgentReviewHistoryModalOpen] =
    useState(false);

  useEffect(() => {
    if (
      input.inspectorKind !== "session" ||
      input.selectedSessionTicketStatus !== "review"
    ) {
      setAgentReviewHistoryModalOpen(false);
    }
  }, [input.inspectorKind, input.selectedSessionTicketStatus]);

  return {
    agentReviewHistoryModalOpen,
    closeAgentReviewHistoryModal() {
      setAgentReviewHistoryModalOpen(false);
    },
    openAgentReviewHistoryModal() {
      setAgentReviewHistoryModalOpen(true);
    },
  };
}
