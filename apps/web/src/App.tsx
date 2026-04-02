import "./app-shell.css";

import { useWalleyBoardController } from "./features/walleyboard/use-walleyboard-controller.js";
import { WalleyBoardView } from "./features/walleyboard/WalleyBoardView.js";

export function App() {
  const controller = useWalleyBoardController();
  return <WalleyBoardView controller={controller} />;
}
