import { existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";

import { resolveWalleyBoardPath } from "./walleyboard-paths.js";

function removePathIfPresent(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }

  rmSync(path, { recursive: true, force: true });
  return path;
}

function artifactRoot(projectSlug: string): string {
  return resolveWalleyBoardPath("ticket-artifacts", projectSlug);
}

export function ensureTicketArtifactScopeDir(
  projectSlug: string,
  artifactScopeId: string,
): string {
  const path = join(artifactRoot(projectSlug), artifactScopeId);
  mkdirSync(path, { recursive: true });
  return path;
}

export function buildTicketArtifactFilePath(
  projectSlug: string,
  artifactScopeId: string,
  filename: string,
): string {
  return join(artifactRoot(projectSlug), artifactScopeId, filename);
}

export function isSafeArtifactFilename(filename: string): boolean {
  return (
    basename(filename) === filename &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename)
  );
}

export function isSafeArtifactScopeId(artifactScopeId: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(artifactScopeId);
}

export function removeTicketArtifactScope(
  projectSlug: string,
  artifactScopeId: string,
): string | null {
  return removePathIfPresent(join(artifactRoot(projectSlug), artifactScopeId));
}

export function removeTicketArtifacts(
  projectSlug: string,
  ticketId: number,
  sessionId?: string | null,
  artifactScopeId?: string | null,
): string[] {
  const removedPaths: string[] = [];

  const diffPath = join(
    resolveWalleyBoardPath(
      "review-packages",
      projectSlug,
      `ticket-${ticketId}.patch`,
    ),
  );
  const validationDir = resolveWalleyBoardPath(
    "validation-logs",
    projectSlug,
    `ticket-${ticketId}`,
  );

  const maybeRemovedDiff = removePathIfPresent(diffPath);
  if (maybeRemovedDiff) {
    removedPaths.push(maybeRemovedDiff);
  }

  const maybeRemovedValidationDir = removePathIfPresent(validationDir);
  if (maybeRemovedValidationDir) {
    removedPaths.push(maybeRemovedValidationDir);
  }

  if (sessionId) {
    const summaryPath = resolveWalleyBoardPath(
      "agent-summaries",
      projectSlug,
      `ticket-${ticketId}-${sessionId}.txt`,
    );
    const maybeRemovedSummary = removePathIfPresent(summaryPath);
    if (maybeRemovedSummary) {
      removedPaths.push(maybeRemovedSummary);
    }
  }

  if (artifactScopeId) {
    const maybeRemovedArtifactScope = removeTicketArtifactScope(
      projectSlug,
      artifactScopeId,
    );
    if (maybeRemovedArtifactScope) {
      removedPaths.push(maybeRemovedArtifactScope);
    }
  }

  return removedPaths;
}

export function removeProjectArtifacts(
  projectSlug: string,
  options?: { includeWorktrees?: boolean },
): string[] {
  const removedPaths: string[] = [];
  const includeWorktrees = options?.includeWorktrees ?? true;
  const paths = [
    includeWorktrees ? resolveWalleyBoardPath("worktrees", projectSlug) : null,
    resolveWalleyBoardPath("review-packages", projectSlug),
    resolveWalleyBoardPath("validation-logs", projectSlug),
    resolveWalleyBoardPath("agent-summaries", projectSlug),
    resolveWalleyBoardPath("draft-analyses", projectSlug),
    artifactRoot(projectSlug),
  ];

  for (const path of paths) {
    if (!path) {
      continue;
    }

    const removedPath = removePathIfPresent(path);
    if (removedPath) {
      removedPaths.push(removedPath);
    }
  }

  return removedPaths;
}
