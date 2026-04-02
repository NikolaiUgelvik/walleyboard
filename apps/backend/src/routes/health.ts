import { execFileSync } from "node:child_process";
import type { FastifyPluginAsync } from "fastify";

import type { DockerRuntimeManager } from "../lib/docker-runtime.js";
import { nowIso } from "../lib/time.js";

type HealthRouteOptions = {
  dockerRuntime: DockerRuntimeManager;
};

function getClaudeCodeHealth(): {
  available: boolean;
  version: string | null;
  error: string | null;
} {
  try {
    const version = execFileSync("claude", ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return { available: true, version, error: null };
  } catch (error) {
    return {
      available: false,
      version: null,
      error: error instanceof Error ? error.message : "claude CLI not found",
    };
  }
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
