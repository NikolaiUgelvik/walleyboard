import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import {
  resolveVitePreviewOptions,
  resolveViteServerOptions,
} from "./src/lib/vite-server-options.js";

export default defineConfig({
  plugins: [react()],
  preview: resolveVitePreviewOptions(process.env),
  server: resolveViteServerOptions(process.env),
});
