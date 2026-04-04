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

export function resolveDockerManagedOutputPath(input: {
  agentLabel: string;
  outputPath: string;
  worktreePath: string;
}): string {
  const worktreeOutputPath = resolveMountedPath(
    input.outputPath,
    input.worktreePath,
    dockerWorkspacePath,
  );
  if (worktreeOutputPath) {
    return worktreeOutputPath;
  }

  const walleyBoardOutputPath = resolveMountedPath(
    input.outputPath,
    resolveWalleyBoardHome(),
    dockerWalleyBoardHomePath,
  );
  if (walleyBoardOutputPath) {
    return walleyBoardOutputPath;
  }

  throw new Error(
    `Docker-backed ${input.agentLabel} runs must write output inside the mounted worktree or WalleyBoard home.`,
  );
}
