import { Box, Stack } from "@mantine/core";

import { summarizeSessionActivity } from "../../components/SessionActivityFeed.js";
import {
  DraftInspectorSection,
  NewDraftInspectorSection,
  SessionInspectorSection,
  TicketInspectorSection,
} from "./inspector-pane-sections.js";
import type { InspectorPaneController } from "./walleyboard-view-state.js";

export { TicketWorkspaceSummaryRow } from "./inspector-pane-sections.js";

export function InspectorPane({
  controller,
}: {
  controller: InspectorPaneController;
}) {
  if (!controller.inspectorVisible) {
    return null;
  }

  const session = controller.session;
  const activitySummary =
    session === null
      ? null
      : summarizeSessionActivity(session, controller.sessionLogs);

  return (
    <Box className="walleyboard-detail">
      <Stack gap="md">
        {controller.inspectorState.kind === "new_draft" ? (
          <NewDraftInspectorSection controller={controller} />
        ) : null}
        {controller.inspectorState.kind === "draft" ? (
          <DraftInspectorSection controller={controller} />
        ) : null}
        {controller.inspectorState.kind === "session" ? (
          <SessionInspectorSection
            activitySummary={activitySummary}
            controller={controller}
          />
        ) : null}
        {controller.inspectorState.kind === "ticket" ? (
          <TicketInspectorSection controller={controller} />
        ) : null}
      </Stack>
    </Box>
  );
}
