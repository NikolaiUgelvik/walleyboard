import "./app-shell.css";

import { WalleyBoardView } from "./features/walleyboard/WalleyBoardView.js";
import { useWalleyBoardController } from "./features/walleyboard/use-walleyboard-controller.js";

export function App() {
  const controller = useWalleyBoardController();
  return <WalleyBoardView controller={controller} />;
}
