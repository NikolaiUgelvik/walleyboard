import { isAbsolute, join, relative } from "node:path";

import {
  dockerWalleyBoardHomePath,
  dockerWorkspacePath,
} from "../docker-runtime.js";
import { resolveWalleyBoardHome } from "../walleyboard-paths.js";

function resolveMountedPath(
  outputPath: string,
  hostRoot: string,
  dockerRoot: string,
): string | null {
  const relativePath = relative(hostRoot, outputPath);
  if (
    relativePath.length === 0 ||
    relativePath === "." ||
    relativePath.startsWith("..") ||
    relativePath.includes("../") ||
    isAbsolute(relativePath)
  ) {
    return null;
  }

  return join(dockerRoot, relativePath);
}

export function resolveDockerMountedPath(input: {
  hostPath: string;
  worktreePath: string;
}): string | null {
  const worktreePath = resolveMountedPath(
    input.hostPath,
    input.worktreePath,
    dockerWorkspacePath,
  );
  if (worktreePath) {
    return worktreePath;
  }

  return resolveMountedPath(
    input.hostPath,
    resolveWalleyBoardHome(),
    dockerWalleyBoardHomePath,
  );
}

export function resolveDockerManagedOutputPath(input: {
  agentLabel: string;
  outputPath: string;
  worktreePath: string;
}): string {
  const mountedPath = resolveDockerMountedPath({
    hostPath: input.outputPath,
    worktreePath: input.worktreePath,
  });
  if (mountedPath) {
    return mountedPath;
  }

  throw new Error(
    `Docker-backed ${input.agentLabel} runs must write output inside the mounted worktree or WalleyBoard home.`,
  );
}
