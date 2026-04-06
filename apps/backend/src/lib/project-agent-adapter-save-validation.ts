import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import type { Project } from "../../../../packages/contracts/src/index.js";

import { resolveClaudeConfigHome } from "./agent-adapters/claude-code-runtime.js";
import { resolveCodexConfigHome } from "./agent-adapters/codex-config.js";

type ProjectAgentAdapterSaveValidationDependencies = {
  existsSyncImpl?: typeof existsSync;
  locateCommandPath?: (command: string) => string | null;
  resolveConfigHomePath?: (agentAdapter: Project["agent_adapter"]) => string;
};

type AdapterSaveRequirement = {
  command: string;
  label: string;
};

const adapterSaveRequirements: Record<
  Project["agent_adapter"],
  AdapterSaveRequirement
> = {
  codex: {
    command: "codex",
    label: "Codex CLI",
  },
  "claude-code": {
    command: "claude",
    label: "Claude Code CLI",
  },
};

function resolveProjectAgentAdapterConfigHome(
  agentAdapter: Project["agent_adapter"],
): string {
  return agentAdapter === "claude-code"
    ? resolveClaudeConfigHome()
    : resolveCodexConfigHome();
}

function detectCommandPath(command: string): string | null {
  const result = spawnSync("bash", ["-lc", `command -v ${command}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return (
    result.stdout
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? null
  );
}

export function assertProjectAgentAdapterSaveAvailable(
  agentAdapter: Project["agent_adapter"],
  dependencies: ProjectAgentAdapterSaveValidationDependencies = {},
): void {
  const {
    existsSyncImpl = existsSync,
    locateCommandPath = detectCommandPath,
    resolveConfigHomePath = resolveProjectAgentAdapterConfigHome,
  } = dependencies;
  const requirement = adapterSaveRequirements[agentAdapter];
  const configHomePath = resolveConfigHomePath(agentAdapter);

  if (!existsSyncImpl(configHomePath)) {
    throw new Error(
      `${requirement.label} is unavailable on this machine: config directory ${configHomePath} does not exist.`,
    );
  }

  const detectedPath = locateCommandPath(requirement.command);
  if (!detectedPath) {
    throw new Error(
      `${requirement.label} is unavailable on this machine: \`${requirement.command}\` was not found in PATH.`,
    );
  }
}
