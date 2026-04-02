import "./app-shell.css";

import { OrchestratorView } from "./features/orchestrator/OrchestratorView.js";
import { useOrchestratorController } from "./features/orchestrator/use-orchestrator-controller.js";

export function App() {
  const controller = useOrchestratorController();
  return <OrchestratorView controller={controller} />;
}
