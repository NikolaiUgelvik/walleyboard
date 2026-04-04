import "./app-shell.css";

import { useWalleyBoardController } from "./features/walleyboard/use-walleyboard-controller.js";
import { WalleyBoardView } from "./features/walleyboard/WalleyBoardView.js";
import { createWalleyBoardViewState } from "./features/walleyboard/walleyboard-view-state.js";

export function App() {
  const controller = useWalleyBoardController();
  return <WalleyBoardView view={createWalleyBoardViewState(controller)} />;
}
