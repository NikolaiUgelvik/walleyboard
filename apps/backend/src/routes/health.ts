import type { FastifyPluginAsync } from "fastify";

import { nowIso } from "../lib/time.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => ({
    ok: true,
    service: "backend" as const,
    timestamp: nowIso(),
  }));
};
