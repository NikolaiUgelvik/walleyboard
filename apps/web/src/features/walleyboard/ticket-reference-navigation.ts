import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";

import { focusElementById } from "./shared-utils.js";

export function navigateToTicketReference(input: {
  globalTickets: TicketFrontmatter[];
  selectProject: (projectId: string | null) => void;
  selectedProjectId: string | null;
  setBoardSearch: (value: string) => void;
  setInspectorState: (state: { kind: "session"; sessionId: string }) => void;
  ticketId: number;
  tickets: TicketFrontmatter[];
}): void {
  const referencedTicket =
    input.globalTickets.find((ticket) => ticket.id === input.ticketId) ??
    input.tickets.find((ticket) => ticket.id === input.ticketId) ??
    null;
  if (!referencedTicket) {
    return;
  }

  input.setBoardSearch("");
  if (referencedTicket.project !== input.selectedProjectId) {
    input.selectProject(referencedTicket.project);
  }
  if (referencedTicket.session_id) {
    input.setInspectorState({
      kind: "session",
      sessionId: referencedTicket.session_id,
    });
  }

  if (typeof window === "undefined") {
    focusElementById(`ticket-${input.ticketId}`);
    return;
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      focusElementById(`ticket-${input.ticketId}`);
    });
  });
}
