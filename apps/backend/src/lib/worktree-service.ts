import { existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import type { Project, RepositoryConfig, TicketFrontmatter } from "@orchestrator/contracts";

import type { PreparedExecutionRuntime } from "./store.js";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function deriveWorkingBranch(ticket: TicketFrontmatter): string {
  return `codex/ticket-${ticket.id}-${slugify(ticket.title).slice(0, 24)}`;
}

function runGit(repoPath: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", repoPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown git execution failure";
    throw new Error(`Git command failed (${args.join(" ")}): ${message}`);
  }
}

function runGitAtRoot(args: string[]): string {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown git execution failure";
    throw new Error(`Git command failed (${args.join(" ")}): ${message}`);
  }
}

export function prepareWorktree(
  project: Project,
  repository: RepositoryConfig,
  ticket: TicketFrontmatter
): PreparedExecutionRuntime {
  if (ticket.working_branch) {
    throw new Error("Ticket already has a working branch");
  }

  const workingBranch = deriveWorkingBranch(ticket);
  const worktreeRoot = join(
    process.cwd(),
    ".local",
    "worktrees",
    project.slug,
    `ticket-${ticket.id}`
  );
  mkdirSync(join(process.cwd(), ".local", "worktrees", project.slug), {
    recursive: true
  });

  if (existsSync(worktreeRoot)) {
    throw new Error(`Worktree path already exists: ${worktreeRoot}`);
  }

  const targetBranch = repository.target_branch ?? ticket.target_branch;
  runGit(repository.path, ["rev-parse", "--is-inside-work-tree"]);
  runGit(repository.path, ["rev-parse", "--verify", targetBranch]);

  try {
    runGit(repository.path, [
      "worktree",
      "add",
      "-b",
      workingBranch,
      worktreeRoot,
      targetBranch
    ]);
  } catch (error) {
    if (existsSync(worktreeRoot)) {
      try {
        runGit(repository.path, ["worktree", "remove", "--force", worktreeRoot]);
      } catch {
        // Keep the original error. Cleanup failures can be handled manually.
      }
    }

    throw error;
  }

  const logs = [
    `Verified git repository: ${repository.path}`,
    `Checked out target branch: ${targetBranch}`,
    `Created git worktree: ${worktreeRoot}`
  ];

  return {
    workingBranch,
    worktreePath: worktreeRoot,
    logs
  };
}

export function removePreparedWorktree(
  repository: RepositoryConfig,
  worktreePath: string
): void {
  if (!existsSync(worktreePath)) {
    return;
  }

  runGit(repository.path, ["worktree", "remove", "--force", worktreePath]);
}

export function removeLocalBranch(
  repository: RepositoryConfig,
  branchName: string
): void {
  const existingBranch = runGit(repository.path, ["branch", "--list", branchName]);
  if (existingBranch.length === 0) {
    return;
  }

  runGit(repository.path, ["branch", "-D", branchName]);
}

function gitStatusPorcelain(repoPath: string): string {
  return runGit(repoPath, ["status", "--short"]);
}

export function mergeReviewedBranch(
  repository: RepositoryConfig,
  worktreePath: string,
  workingBranch: string,
  targetBranch: string
): { logs: string[]; targetHead: string } {
  if (!existsSync(worktreePath)) {
    throw new Error(`Worktree path does not exist: ${worktreePath}`);
  }

  const repoBranch = repoCurrentBranch(repository);
  if (repoBranch !== targetBranch) {
    throw new Error(
      `Repository checkout must be on ${targetBranch} before direct merge. Current branch: ${repoBranch}`
    );
  }

  const repoStatus = gitStatusPorcelain(repository.path);
  if (repoStatus.length > 0) {
    throw new Error("Repository checkout has uncommitted changes. Clean it before merging.");
  }

  const worktreeBranch = runGit(worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (worktreeBranch !== workingBranch) {
    throw new Error(
      `Ticket worktree is on ${worktreeBranch}, but ${workingBranch} was expected.`
    );
  }

  const worktreeStatus = gitStatusPorcelain(worktreePath);
  if (worktreeStatus.length > 0) {
    throw new Error("Ticket worktree has uncommitted changes. Commit or discard them first.");
  }

  try {
    runGit(worktreePath, ["rebase", targetBranch]);
  } catch (error) {
    try {
      runGit(worktreePath, ["rebase", "--abort"]);
    } catch {
      // Preserve the original failure for the caller.
    }

    throw error;
  }

  runGit(repository.path, ["merge", "--ff-only", workingBranch]);

  const targetHead = runGit(repository.path, ["rev-parse", "HEAD"]);
  const logs = [
    `Repository checkout verified on ${targetBranch}`,
    `Rebased ${workingBranch} onto ${targetBranch}`,
    `Fast-forward merged ${workingBranch} into ${targetBranch}`,
    `Target branch head is now ${targetHead}`
  ];

  return {
    logs,
    targetHead
  };
}

export function repoCurrentHead(repository: RepositoryConfig): string {
  return runGit(repository.path, ["rev-parse", "HEAD"]);
}

export function repoCurrentBranch(repository: RepositoryConfig): string {
  return runGit(repository.path, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

export function gitVersion(): string {
  return runGitAtRoot(["--version"]);
}
