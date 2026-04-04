import { Box } from "@mantine/core";
import type { CSSProperties } from "react";

import { BoardView } from "./BoardView.js";
import { InspectorPane } from "./InspectorPane.js";
import { ProjectRail } from "./ProjectRail.js";
import { resolveProjectAccentVariables } from "./shared-utils.js";
import { WalleyBoardModals } from "./WalleyBoardModals.js";
import type { WalleyBoardViewState } from "./walleyboard-view-state.js";

export function WalleyBoardView({ view }: { view: WalleyBoardViewState }) {
  const projectAccentStyle = view.shell.selectedProject
    ? (resolveProjectAccentVariables(
        view.shell.selectedProject.color,
      ) as CSSProperties)
    : undefined;

  return (
    <Box
      className="walleyboard-shell"
      data-project-selected={view.shell.selectedProject ? "true" : "false"}
      style={projectAccentStyle}
    >
      <Box
        className={`walleyboard-layout${
          view.shell.inspectorVisible ? " walleyboard-layout--with-detail" : ""
        }`}
      >
        <ProjectRail controller={view.projectRail} />
        <BoardView controller={view.boardView} />
        <InspectorPane controller={view.inspectorPane} />
      </Box>

      <WalleyBoardModals controller={view.modals} />
    </Box>
  );
}
