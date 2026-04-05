import type { FastifyPluginAsync } from "fastify";

import { listConfiguredCodexMcpServers } from "../lib/agent-adapters/codex-config.js";
import type { DockerRuntime } from "../lib/docker-runtime.js";
import { nowIso } from "../lib/time.js";

type HealthRouteOptions = {
  dockerRuntime: DockerRuntime;
};

export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (
  app,
  { dockerRuntime },
) => {
  app.get("/health", async () => {
    const dockerHealth = dockerRuntime.getHealth();

    return {
      ok: true,
      service: "backend" as const,
      timestamp: nowIso(),
      codex_mcp_servers: listConfiguredCodexMcpServers(),
      docker: dockerHealth,
    };
  });
};
