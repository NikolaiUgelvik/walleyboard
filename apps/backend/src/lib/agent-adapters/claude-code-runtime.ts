import { homedir } from "node:os";
import { join } from "node:path";

export const claudeCodeDockerSpec = {
  imageTag: "walleyboard/codex-runtime:ubuntu-24.04-node-24",
  dockerfilePath: "apps/backend/docker/codex-runtime.Dockerfile",
  homePath: "/home/codex",
  configMountPath: "/home/codex/.claude",
} as const;

export type ClaudeCodeAvailability = {
  available: boolean;
  detected_path: string | null;
  error: string | null;
};

export function resolveClaudeConfigHome(): string {
  return join(homedir(), ".claude");
}
