import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import {
  resolveVitePreviewOptions,
  resolveViteServerOptions,
} from "./src/lib/vite-server-options.js";

export default defineConfig({
  plugins: [react()],
  preview: resolveVitePreviewOptions(process.env),
  resolve: {
    alias: {
      "@mantine/core": fileURLToPath(
        new URL("./node_modules/@mantine/core", import.meta.url),
      ),
      "@mantine/hooks": fileURLToPath(
        new URL("./node_modules/@mantine/hooks", import.meta.url),
      ),
    },
  },
  server: resolveViteServerOptions(process.env),
});
