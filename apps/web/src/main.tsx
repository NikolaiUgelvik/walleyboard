import "@mantine/core/styles.css";

import {
  MantineProvider,
  createTheme,
  localStorageColorSchemeManager,
} from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";

const queryClient = new QueryClient();
const colorSchemeManager = localStorageColorSchemeManager({
  key: "orchestrator-color-scheme",
});
const theme = createTheme({
  primaryColor: "orange",
  defaultRadius: "md",
  fontFamily: "'IBM Plex Sans', 'Avenir Next', 'Segoe UI', sans-serif",
  fontFamilyMonospace: "'IBM Plex Mono', 'SFMono-Regular', monospace",
  headings: {
    fontFamily: "'IBM Plex Sans', 'Avenir Next', 'Segoe UI', sans-serif",
  },
  colors: {
    slate: [
      "#f7f8f9",
      "#eef0f3",
      "#d9dee4",
      "#bcc6d2",
      "#9aaaae",
      "#7a8594",
      "#5f6b7c",
      "#475263",
      "#2f3949",
      "#182230",
    ],
  },
  primaryShade: 6,
});
const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <QueryClientProvider client={queryClient}>
    <MantineProvider
      theme={theme}
      colorSchemeManager={colorSchemeManager}
      defaultColorScheme="auto"
    >
      <App />
    </MantineProvider>
  </QueryClientProvider>,
);
