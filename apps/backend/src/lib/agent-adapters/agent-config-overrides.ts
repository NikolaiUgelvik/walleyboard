import type {
  AgentAdapter,
  Project,
} from "../../../../../packages/contracts/src/index.js";
import { writeClaudeConfigOverrides } from "./claude-config.js";
import { writeCodexConfigOverride } from "./codex-config.js";

export function resolveProjectAgentConfigFileOverrides(
  adapterId: AgentAdapter,
  project: Project,
): Array<{ hostPath: string; relativePath: string }> {
  if (adapterId === "codex") {
    const overridePath = writeCodexConfigOverride(project);
    return overridePath
      ? [{ hostPath: overridePath, relativePath: "config.toml" }]
      : [];
  }

  if (adapterId === "claude-code") {
    return writeClaudeConfigOverrides(project);
  }

  return [];
}
