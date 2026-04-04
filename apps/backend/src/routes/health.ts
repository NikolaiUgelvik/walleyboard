import type { FastifyPluginAsync } from "fastify";

import { listConfiguredCodexMcpServers } from "../lib/agent-adapters/codex-config.js";
import type { GetClaudeCodeAvailability } from "../lib/claude-code-availability.js";
import type { DockerRuntime } from "../lib/docker-runtime.js";
import { nowIso } from "../lib/time.js";

type HealthRouteOptions = {
  dockerRuntime: DockerRuntime;
  getClaudeCodeAvailability: GetClaudeCodeAvailability;
};

export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (
  app,
  { dockerRuntime, getClaudeCodeAvailability },
) => {
  app.get("/health", async () => {
    const dockerHealth = dockerRuntime.getHealth();

    return {
      ok: true,
      service: "backend" as const,
      timestamp: nowIso(),
      codex_mcp_servers: listConfiguredCodexMcpServers(),
      docker: dockerHealth,
      claude_code: getClaudeCodeAvailability(),
    };
  });
};
