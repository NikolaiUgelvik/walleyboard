import { existsSync } from "node:fs";
import type { FastifyPluginAsync } from "fastify";

import { resolveClaudeCliPath } from "../lib/agent-adapters/claude-code-adapter.js";
import type { DockerRuntime } from "../lib/docker-runtime.js";
import { nowIso } from "../lib/time.js";

type HealthRouteOptions = {
  dockerRuntime: DockerRuntime;
};

// Claude Code availability uses the same resolveClaudeCliPath() that the
// adapter uses at spawn time, so the health check and the runtime always
// agree on which binary is being invoked. The result is cached with a TTL
// so config changes are picked up without a backend restart.
const claudeCodeCacheTtlMs = 60_000;
let cachedClaudeCodeHealth: {
  available: boolean;
  configured_path: string | null;
  error: string | null;
} | null = null;
let cachedClaudeCodeHealthAt = 0;

function probeClaudeCodeAvailability(): {
  available: boolean;
  configured_path: string | null;
  error: string | null;
} {
  const cliPath = resolveClaudeCliPath();
  if (!existsSync(cliPath)) {
    return {
      available: false,
      configured_path: null,
      error:
        "Claude CLI not configured. Create ~/.walleyboard/claude-cli-path with the absolute path to the claude binary.",
    };
  }
  return { available: true, configured_path: cliPath, error: null };
}

function getClaudeCodeHealth(): {
  available: boolean;
  configured_path: string | null;
  error: string | null;
} {
  const now = Date.now();
  if (
    !cachedClaudeCodeHealth ||
    now - cachedClaudeCodeHealthAt >= claudeCodeCacheTtlMs
  ) {
    cachedClaudeCodeHealth = probeClaudeCodeAvailability();
    cachedClaudeCodeHealthAt = now;
  }
  return cachedClaudeCodeHealth;
}

export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (
  app,
  { dockerRuntime },
) => {
  app.get("/health", async () => ({
    ok: true,
    service: "backend" as const,
    timestamp: nowIso(),
    docker: dockerRuntime.getHealth(),
    claude_code: getClaudeCodeHealth(),
  }));
};
