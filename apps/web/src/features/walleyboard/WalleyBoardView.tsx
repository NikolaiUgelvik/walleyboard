import { Box } from "@mantine/core";
import type { CSSProperties } from "react";

import { BoardView } from "./BoardView.js";
import { InspectorPane } from "./InspectorPane.js";
import { ProjectRail } from "./ProjectRail.js";
import { resolveProjectAccentVariables } from "./shared-utils.js";
import type { WalleyBoardController } from "./use-walleyboard-controller.js";
import { WalleyBoardModals } from "./WalleyBoardModals.js";

export function WalleyBoardView({
  controller,
}: {
  controller: WalleyBoardController;
}) {
  const projectAccentStyle = controller.selectedProject
    ? (resolveProjectAccentVariables(
        controller.selectedProject.color,
      ) as CSSProperties)
    : undefined;

  return (
    <Box
      className="walleyboard-shell"
      data-project-selected={controller.selectedProject ? "true" : "false"}
      style={projectAccentStyle}
    >
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
