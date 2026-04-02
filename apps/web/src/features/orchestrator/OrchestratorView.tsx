import { Box } from "@mantine/core";

import { BoardView } from "./BoardView.js";
import { InspectorPane } from "./InspectorPane.js";
import { OrchestratorModals } from "./OrchestratorModals.js";
import { ProjectRail } from "./ProjectRail.js";
import type { OrchestratorController } from "./use-orchestrator-controller.js";

export function OrchestratorView({
  controller,
}: {
  controller: OrchestratorController;
}) {
  return (
    <Box className="orchestrator-shell">
      <Box
        className={`orchestrator-layout${
          controller.inspectorVisible ? " orchestrator-layout--with-detail" : ""
        }`}
      >
        <ProjectRail controller={controller} />
        <BoardView controller={controller} />
        <InspectorPane controller={controller} />
      </Box>

      <OrchestratorModals controller={controller} />
    </Box>
  );
}
