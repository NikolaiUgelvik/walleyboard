import type {
  DraftTicketState,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import type { InspectorState } from "./shared-types.js";

export function shouldResetProjectOptionsSelection(input: {
  projectOptionsProjectId: string | null;
  projects: Array<{ id: string }>;
  projectsLoaded: boolean;
}): boolean {
  if (!input.projectsLoaded || input.projectOptionsProjectId === null) {
    return false;
  }

  return !input.projects.some(
    (project) => project.id === input.projectOptionsProjectId,
  );
}

export function resolveNextInspectorState(input: {
  drafts: DraftTicketState[];
  draftsLoaded: boolean;
  inspectorState: InspectorState;
  selectedProjectId: string | null;
  tickets: TicketFrontmatter[];
  ticketsLoaded: boolean;
}): InspectorState | null {
  const { inspectorState } = input;

  if (inspectorState.kind === "draft") {
    if (!input.draftsLoaded) {
      return null;
    }

    return input.drafts.some((draft) => draft.id === inspectorState.draftId)
      ? null
      : { kind: "hidden" };
  }

  if (inspectorState.kind === "session") {
    if (!input.ticketsLoaded) {
      return null;
    }

    return input.tickets.some(
      (ticket) => ticket.session_id === inspectorState.sessionId,
    )
      ? null
      : { kind: "hidden" };
  }

  if (inspectorState.kind === "new_draft" && input.selectedProjectId === null) {
    return { kind: "hidden" };
  }

  return null;
}
