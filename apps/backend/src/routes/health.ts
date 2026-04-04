import { existsSync } from "node:fs";
import type { FastifyPluginAsync } from "fastify";

import { resolveClaudeConfigHome } from "../lib/agent-adapters/claude-code-adapter.js";
import { listConfiguredCodexMcpServers } from "../lib/agent-adapters/codex-config.js";
import type { DockerRuntime } from "../lib/docker-runtime.js";
import { nowIso } from "../lib/time.js";

type HealthRouteOptions = {
  dockerRuntime: DockerRuntime;
};

const claudeCodeCacheTtlMs = 60_000;
let cachedClaudeCodeHealth: {
  available: boolean;
  configured_path: string | null;
  error: string | null;
} | null = null;
let cachedClaudeCodeHealthAt = 0;
let cachedClaudeCodeDockerAvailable: boolean | null = null;
let cachedClaudeCodeConfigHome: string | null = null;

function probeClaudeCodeAvailability(dockerAvailable: boolean): {
  available: boolean;
  configured_path: string | null;
  error: string | null;
} {
  const configHome = resolveClaudeConfigHome();
  if (!dockerAvailable) {
    return {
      available: false,
      configured_path: existsSync(configHome) ? configHome : null,
      error: "Docker must be available before Claude Code can run.",
    };
  }

  if (!existsSync(configHome)) {
    return {
      available: false,
      configured_path: null,
      error:
        "Claude Code requires a host ~/.claude directory so WalleyBoard can mount your existing Claude configuration into Docker.",
    };
  }

  return {
    available: true,
    configured_path: configHome,
    error: null,
  };
}

function getClaudeCodeHealth(dockerAvailable: boolean): {
  available: boolean;
  configured_path: string | null;
  error: string | null;
} {
  const now = Date.now();
  const configHome = resolveClaudeConfigHome();
  if (
    !cachedClaudeCodeHealth ||
    now - cachedClaudeCodeHealthAt >= claudeCodeCacheTtlMs ||
    cachedClaudeCodeDockerAvailable !== dockerAvailable ||
    cachedClaudeCodeConfigHome !== configHome
  ) {
    cachedClaudeCodeHealth = probeClaudeCodeAvailability(dockerAvailable);
    cachedClaudeCodeHealthAt = now;
    cachedClaudeCodeDockerAvailable = dockerAvailable;
    cachedClaudeCodeConfigHome = configHome;
  }
  return cachedClaudeCodeHealth;
}

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
      claude_code: getClaudeCodeHealth(dockerHealth.available),
    };
  });
};
