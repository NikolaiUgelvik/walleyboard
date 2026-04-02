import type { DraftTicketState } from "../../../../packages/contracts/src/index.js";

function humanizeDraftWizardStatus(
  status: DraftTicketState["wizard_status"],
): string {
  switch (status) {
    case "editing":
      return "Editing";
    case "awaiting_confirmation":
      return "Awaiting confirmation";
    case "ready_to_create":
      return "Ready to create";
  }
}

export function formatDraftStatusLabel(input: {
  isRefining: boolean;
  wizardStatus: DraftTicketState["wizard_status"];
}): string {
  if (input.isRefining) {
    return "Refining...";
  }

  return humanizeDraftWizardStatus(input.wizardStatus);
}
