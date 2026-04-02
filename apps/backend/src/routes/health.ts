import type { FastifyPluginAsync } from "fastify";

import type { DockerRuntimeManager } from "../lib/docker-runtime.js";
import { nowIso } from "../lib/time.js";

type HealthRouteOptions = {
  dockerRuntime: DockerRuntimeManager;
};

export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (
  app,
  { dockerRuntime },
) => {
  app.get("/health", async () => ({
    ok: true,
    service: "backend" as const,
    timestamp: nowIso(),
    docker: dockerRuntime.getHealth(),
  }));
};
