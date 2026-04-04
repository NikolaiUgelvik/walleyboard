import { existsSync } from "node:fs";

import { runGit } from "./helpers.js";

export type WorktreeRecoveryState = {
  conflictedFiles: string[];
  failureMessage: string;
  stage: "rebase" | "merge";
};

export function inspectWorktreeRecoveryState(
  worktreePath: string,
): WorktreeRecoveryState | null {
  try {
    const conflictedFiles = runGit(worktreePath, [
      "diff",
      "--name-only",
      "--diff-filter=U",
    ])
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const mergeHeadPath = runGit(worktreePath, [
      "rev-parse",
      "--git-path",
      "MERGE_HEAD",
    ]);
    const rebaseMergePath = runGit(worktreePath, [
      "rev-parse",
      "--git-path",
      "rebase-merge",
    ]);
    const rebaseApplyPath = runGit(worktreePath, [
      "rev-parse",
      "--git-path",
      "rebase-apply",
    ]);
    const currentBranch = runGit(worktreePath, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]);
    const mergeInProgress = existsSync(mergeHeadPath);
    const rebaseInProgress =
      existsSync(rebaseMergePath) || existsSync(rebaseApplyPath);
    const detachedHead = currentBranch === "HEAD";

    if (!mergeInProgress && !rebaseInProgress && conflictedFiles.length === 0) {
      return null;
    }

    const stage = rebaseInProgress ? "rebase" : "merge";
    const failureMessage = rebaseInProgress
      ? "Resume detected an unfinished git rebase in the preserved worktree."
      : mergeInProgress
        ? "Resume detected an unfinished git merge in the preserved worktree."
        : detachedHead
          ? "Resume detected unresolved git conflicts in a detached worktree."
          : "Resume detected unresolved git conflicts in the preserved worktree.";

    return {
      conflictedFiles,
      failureMessage,
      stage,
    };
  } catch {
    return null;
  }
}
