import type { FastifyPluginAsync } from "fastify";

import {
  type ClaudeCodeAvailability,
  probeClaudeCodeAvailability as defaultProbeClaudeCodeAvailability,
} from "../lib/agent-adapters/claude-code-adapter.js";
import { listConfiguredCodexMcpServers } from "../lib/agent-adapters/codex-config.js";
import type { DockerRuntime } from "../lib/docker-runtime.js";
import { nowIso } from "../lib/time.js";

type HealthRouteOptions = {
  dockerRuntime: DockerRuntime;
  probeClaudeCodeAvailability?: () => ClaudeCodeAvailability;
};

const claudeCodeCacheTtlMs = 60_000;

export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (
  app,
  {
    dockerRuntime,
    probeClaudeCodeAvailability = defaultProbeClaudeCodeAvailability,
  },
) => {
  let cachedClaudeCodeHealth: ClaudeCodeAvailability | null = null;
  let cachedClaudeCodeHealthAt = 0;

  const getClaudeCodeHealth = (): ClaudeCodeAvailability => {
    const now = Date.now();
    if (
      cachedClaudeCodeHealth === null ||
      now - cachedClaudeCodeHealthAt >= claudeCodeCacheTtlMs
    ) {
      cachedClaudeCodeHealth = probeClaudeCodeAvailability();
      cachedClaudeCodeHealthAt = now;
    }

    return cachedClaudeCodeHealth;
  };

  app.get("/health", async () => {
    const dockerHealth = dockerRuntime.getHealth();

    return {
      ok: true,
      service: "backend" as const,
      timestamp: nowIso(),
      codex_mcp_servers: listConfiguredCodexMcpServers(),
      docker: dockerHealth,
      claude_code: getClaudeCodeHealth(),
    };
  });
};
