import { Box } from "@mantine/core";

import { BoardView } from "./BoardView.js";
import { InspectorPane } from "./InspectorPane.js";
import { ProjectRail } from "./ProjectRail.js";
import type { WalleyBoardController } from "./use-walleyboard-controller.js";
import { WalleyBoardModals } from "./WalleyBoardModals.js";

export function WalleyBoardView({
  controller,
}: {
  controller: WalleyBoardController;
}) {
  return (
    <Box className="walleyboard-shell">
      <Box
        className={`walleyboard-layout${
          controller.inspectorVisible ? " walleyboard-layout--with-detail" : ""
        }`}
      >
        <ProjectRail controller={controller} />
        <BoardView controller={controller} />
        <InspectorPane controller={controller} />
      </Box>

      <WalleyBoardModals controller={controller} />
    </Box>
  );
}
