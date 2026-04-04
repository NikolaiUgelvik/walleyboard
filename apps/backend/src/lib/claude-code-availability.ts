import type { Project } from "../../../../packages/contracts/src/index.js";

import type { ClaudeCodeAvailability } from "./agent-adapters/claude-code-runtime.js";

export type GetClaudeCodeAvailability = () => ClaudeCodeAvailability;

const claudeCodeAvailabilityCacheTtlMs = 60_000;

export function createClaudeCodeAvailabilityGetter(
  probe: GetClaudeCodeAvailability = () => ({
    available: false,
    detected_path: null,
    error: "Claude Code availability probe is not configured.",
  }),
): GetClaudeCodeAvailability {
  let cachedAvailability: ClaudeCodeAvailability | null = null;
  let cachedAt = 0;

  return () => {
    const now = Date.now();
    if (
      cachedAvailability === null ||
      now - cachedAt >= claudeCodeAvailabilityCacheTtlMs
    ) {
      cachedAvailability = probe();
      cachedAt = now;
    }

    return cachedAvailability;
  };
}

export function assertAgentAdapterAvailable(
  agentAdapter: Project["agent_adapter"],
  getClaudeCodeAvailability: GetClaudeCodeAvailability,
): void {
  if (agentAdapter !== "claude-code") {
    return;
  }

  const availability = getClaudeCodeAvailability();
  if (!availability.available) {
    throw new Error(
      availability.error ?? "Claude Code CLI is unavailable for this project.",
    );
  }
}
