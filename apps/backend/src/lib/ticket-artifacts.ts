import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

function removePathIfPresent(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }

  rmSync(path, { recursive: true, force: true });
  return path;
}

export function removeTicketArtifacts(
  projectSlug: string,
  ticketId: number,
  sessionId?: string | null,
): string[] {
  const removedPaths: string[] = [];

  const diffPath = join(
    process.cwd(),
    ".local",
    "review-packages",
    projectSlug,
    `ticket-${ticketId}.patch`,
  );
  const validationDir = join(
    process.cwd(),
    ".local",
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
    const summaryPath = join(
      process.cwd(),
      ".local",
      "codex-summaries",
      projectSlug,
      `ticket-${ticketId}-${sessionId}.txt`,
    );
    const maybeRemovedSummary = removePathIfPresent(summaryPath);
    if (maybeRemovedSummary) {
      removedPaths.push(maybeRemovedSummary);
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
    includeWorktrees
      ? join(process.cwd(), ".local", "worktrees", projectSlug)
      : null,
    join(process.cwd(), ".local", "review-packages", projectSlug),
    join(process.cwd(), ".local", "validation-logs", projectSlug),
    join(process.cwd(), ".local", "codex-summaries", projectSlug),
    join(process.cwd(), ".local", "draft-analyses", projectSlug),
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
