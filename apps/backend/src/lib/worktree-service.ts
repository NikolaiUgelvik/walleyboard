import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmdirSync } from "node:fs";
import { dirname, join } from "node:path";

import type {
  Project,
  RepositoryConfig,
  TicketFrontmatter,
} from "../../../../packages/contracts/src/index.js";

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

type GitExecError = Error & {
  status?: number | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
};

export type MergeConflictResolutionInput = {
  worktreePath: string;
  workingBranch: string;
  targetBranch: string;
  stage: "rebase" | "merge";
  failureMessage: string;
  conflictedFiles: string[];
};

export type MergeConflictResolutionResult = {
  resolved: boolean;
  logs: string[];
  note?: string;
};

export type MergeReviewedBranchOptions = {
  resolveConflicts?:
    | ((
        input: MergeConflictResolutionInput,
      ) =>
        | MergeConflictResolutionResult
        | Promise<MergeConflictResolutionResult>)
    | undefined;
};

class GitCommandError extends Error {
  readonly args: string[];
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;

  constructor(
    args: string[],
    message: string,
    options?: {
      exitCode?: number | null;
      stdout?: string;
      stderr?: string;
    },
  ) {
    super(message);
    this.name = "GitCommandError";
    this.args = args;
    this.exitCode = options?.exitCode ?? null;
    this.stdout = options?.stdout ?? "";
    this.stderr = options?.stderr ?? "";
  }
}

export class AutomaticMergeRecoveryError extends Error {
  readonly logs: string[];
  readonly note: string;

  constructor(message: string, options: { logs: string[]; note: string }) {
    super(message);
    this.name = "AutomaticMergeRecoveryError";
    this.logs = options.logs;
    this.note = options.note;
  }
}

function runGit(repoPath: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", repoPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const gitError = error as GitExecError;
    const stdout =
      typeof gitError.stdout === "string"
        ? gitError.stdout.trim()
        : (gitError.stdout?.toString("utf8").trim() ?? "");
    const stderr =
      typeof gitError.stderr === "string"
        ? gitError.stderr.trim()
        : (gitError.stderr?.toString("utf8").trim() ?? "");
    const detail =
      stderr || stdout || gitError.message || "Unknown git failure";
    throw new GitCommandError(
      args,
      `Git command failed (${args.join(" ")}): ${detail}`,
      {
        exitCode: gitError.status ?? null,
        stdout,
        stderr,
      },
    );
  }
}

function runGitAtRoot(args: string[]): string {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown git execution failure";
    throw new Error(`Git command failed (${args.join(" ")}): ${message}`);
  }
}

function normalizeOptionalCommand(
  command: string | null | undefined,
): string | null {
  if (typeof command !== "string") {
    return command ?? null;
  }

  const trimmed = command.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function tryRemoveWorktreeRoot(worktreePath: string): void {
  try {
    rmdirSync(dirname(worktreePath));
  } catch {
    // Ignore missing or non-empty project worktree roots.
  }
}

export function runPreWorktreeCommand(
  worktreePath: string,
  command: string | null | undefined,
): boolean {
  const normalizedCommand = normalizeOptionalCommand(command);
  if (!normalizedCommand || !existsSync(worktreePath)) {
    return false;
  }

  const child = spawn("sh", ["-lc", normalizedCommand], {
    cwd: worktreePath,
    env: process.env,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return true;
}

export type PreparedWorktreeRemovalResult = {
  status: "removed" | "scheduled";
};

export function prepareWorktree(
  project: Project,
  repository: RepositoryConfig,
  ticket: TicketFrontmatter,
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
    `ticket-${ticket.id}`,
  );
  mkdirSync(join(process.cwd(), ".local", "worktrees", project.slug), {
    recursive: true,
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
      targetBranch,
    ]);
  } catch (error) {
    if (existsSync(worktreeRoot)) {
      try {
        runGit(repository.path, [
          "worktree",
          "remove",
          "--force",
          worktreeRoot,
        ]);
      } catch {
        // Keep the original error. Cleanup failures can be handled manually.
      }
    }

    throw error;
  }

  const logs = [
    `Verified git repository: ${repository.path}`,
    `Checked out target branch: ${targetBranch}`,
    `Created git worktree: ${worktreeRoot}`,
  ];

  return {
    workingBranch,
    worktreePath: worktreeRoot,
    logs,
  };
}

export function removePreparedWorktree(
  repository: RepositoryConfig,
  worktreePath: string,
  postWorktreeCommand?: string | null,
  workingBranch?: string | null,
): PreparedWorktreeRemovalResult {
  if (!existsSync(worktreePath)) {
    return { status: "removed" };
  }

  const normalizedCommand = normalizeOptionalCommand(postWorktreeCommand);
  if (normalizedCommand) {
    const child = spawn(
      "sh",
      [
        "-lc",
        'cd "$1" && sh -lc "$2"; status=$?; git -C "$3" worktree remove --force "$1"; removal_status=$?; if [ $removal_status -eq 0 ] && [ -n "$4" ]; then git -C "$3" branch -D "$4" >/dev/null 2>&1 || true; fi; parent_dir=$(dirname "$1"); rmdir "$parent_dir" 2>/dev/null || true; exit $status',
        "sh",
        worktreePath,
        normalizedCommand,
        repository.path,
        workingBranch ?? "",
      ],
      {
        detached: true,
        stdio: "ignore",
      },
    );
    child.unref();
    return { status: "scheduled" };
  }

  runGit(repository.path, ["worktree", "remove", "--force", worktreePath]);
  tryRemoveWorktreeRoot(worktreePath);
  return { status: "removed" };
}

export function removeLocalBranch(
  repository: RepositoryConfig,
  branchName: string,
): void {
  const existingBranch = runGit(repository.path, [
    "branch",
    "--list",
    branchName,
  ]);
  if (existingBranch.length === 0) {
    return;
  }

  runGit(repository.path, ["branch", "-D", branchName]);
}

function gitStatusPorcelain(repoPath: string): string {
  return runGit(repoPath, ["status", "--short"]);
}

function formatFileList(files: string[]): string {
  return files.length > 0 ? files.join(", ") : "unknown files";
}

function findConflictedFiles(repoPath: string): string[] {
  const output = runGit(repoPath, ["diff", "--name-only", "--diff-filter=U"]);
  if (output.length === 0) {
    return [];
  }

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function isRebaseInProgress(repoPath: string): boolean {
  return (
    existsSync(runGit(repoPath, ["rev-parse", "--git-path", "rebase-merge"])) ||
    existsSync(runGit(repoPath, ["rev-parse", "--git-path", "rebase-apply"]))
  );
}

function isMergeInProgress(repoPath: string): boolean {
  return existsSync(
    runGit(repoPath, ["rev-parse", "--git-path", "MERGE_HEAD"]),
  );
}

function resolveBranchUpstream(
  repoPath: string,
  branchName: string,
): string | null {
  try {
    const upstream = runGit(repoPath, [
      "rev-parse",
      "--abbrev-ref",
      `${branchName}@{upstream}`,
    ]);
    return upstream.length > 0 ? upstream : null;
  } catch {
    return null;
  }
}

function refreshTargetBranch(
  repository: RepositoryConfig,
  targetBranch: string,
): string[] {
  const upstream = resolveBranchUpstream(repository.path, targetBranch);
  if (!upstream) {
    return [
      `No upstream is configured for ${targetBranch}; using the current local branch head.`,
    ];
  }

  runGit(repository.path, ["pull", "--ff-only"]);
  const refreshedHead = runGit(repository.path, ["rev-parse", "HEAD"]);
  return [
    `Refreshed ${targetBranch} from ${upstream}`,
    `Target branch head after refresh: ${refreshedHead}`,
  ];
}

function isFastForwardFailure(error: unknown): boolean {
  if (!(error instanceof GitCommandError)) {
    return false;
  }

  const detail =
    `${error.stderr}\n${error.stdout}\n${error.message}`.toLowerCase();
  return detail.includes("not possible to fast-forward");
}

async function attemptRebaseWithRecovery(
  worktreePath: string,
  workingBranch: string,
  targetBranch: string,
  resolveConflicts: MergeReviewedBranchOptions["resolveConflicts"] | undefined,
): Promise<string[]> {
  const logs: string[] = [];

  try {
    runGit(worktreePath, ["rebase", targetBranch]);
    logs.push(`Rebased ${workingBranch} onto ${targetBranch}`);
    return logs;
  } catch (error) {
    const conflictedFiles = findConflictedFiles(worktreePath);
    const conflictStage = isMergeInProgress(worktreePath) ? "merge" : "rebase";
    if (conflictedFiles.length === 0 || !resolveConflicts) {
      throw error;
    }

    logs.push(
      `${conflictStage === "rebase" ? "Rebase" : "Merge"} reported conflicts in ${formatFileList(
        conflictedFiles,
      )}`,
    );

    const resolution = await resolveConflicts({
      worktreePath,
      workingBranch,
      targetBranch,
      stage: conflictStage,
      failureMessage:
        error instanceof Error ? error.message : "Git conflict recovery failed",
      conflictedFiles,
    });
    logs.push(...resolution.logs);

    if (!resolution.resolved) {
      throw new AutomaticMergeRecoveryError(
        "Automatic merge recovery could not resolve the reported conflicts.",
        {
          logs,
          note:
            resolution.note ??
            `Automatic merge recovery could not resolve the ${conflictStage} conflicts in ${formatFileList(
              conflictedFiles,
            )}.`,
        },
      );
    }

    const remainingConflicts = findConflictedFiles(worktreePath);
    if (remainingConflicts.length > 0) {
      throw new AutomaticMergeRecoveryError(
        "Automatic merge recovery left unresolved conflicts in the ticket worktree.",
        {
          logs,
          note: `Automatic merge recovery left unresolved conflicts in ${formatFileList(
            remainingConflicts,
          )}.`,
        },
      );
    }

    if (isRebaseInProgress(worktreePath) || isMergeInProgress(worktreePath)) {
      throw new AutomaticMergeRecoveryError(
        "Automatic merge recovery did not finish the in-progress git operation.",
        {
          logs,
          note: "Automatic merge recovery stopped before the in-progress rebase or merge completed.",
        },
      );
    }

    const worktreeStatus = gitStatusPorcelain(worktreePath);
    if (worktreeStatus.length > 0) {
      throw new AutomaticMergeRecoveryError(
        "Automatic merge recovery left additional worktree changes after conflict resolution.",
        {
          logs,
          note: "Automatic merge recovery left extra worktree changes after resolving conflicts.",
        },
      );
    }

    logs.push(
      `Resolved ${conflictStage} conflicts automatically and completed the git operation`,
    );
    return logs;
  }
}

export async function mergeReviewedBranch(
  repository: RepositoryConfig,
  worktreePath: string,
  workingBranch: string,
  targetBranch: string,
  options: MergeReviewedBranchOptions = {},
): Promise<{ logs: string[]; targetHead: string }> {
  if (!existsSync(worktreePath)) {
    throw new Error(`Worktree path does not exist: ${worktreePath}`);
  }

  const repoBranch = repoCurrentBranch(repository);
  if (repoBranch !== targetBranch) {
    throw new Error(
      `Repository checkout must be on ${targetBranch} before direct merge. Current branch: ${repoBranch}`,
    );
  }

  const repoStatus = gitStatusPorcelain(repository.path);
  if (repoStatus.length > 0) {
    throw new Error(
      "Repository checkout has uncommitted changes. Clean it before merging.",
    );
  }

  const worktreeBranch = runGit(worktreePath, [
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ]);
  if (worktreeBranch !== workingBranch) {
    throw new Error(
      `Ticket worktree is on ${worktreeBranch}, but ${workingBranch} was expected.`,
    );
  }

  const worktreeStatus = gitStatusPorcelain(worktreePath);
  if (worktreeStatus.length > 0) {
    throw new Error(
      "Ticket worktree has uncommitted changes. Commit or discard them first.",
    );
  }

  const logs = [`Repository checkout verified on ${targetBranch}`];
  const maxMergeAttempts = 2;

  for (let attempt = 1; attempt <= maxMergeAttempts; attempt += 1) {
    logs.push(...refreshTargetBranch(repository, targetBranch));
    logs.push(
      ...(await attemptRebaseWithRecovery(
        worktreePath,
        workingBranch,
        targetBranch,
        options.resolveConflicts,
      )),
    );

    try {
      runGit(repository.path, ["merge", "--ff-only", workingBranch]);
      const targetHead = runGit(repository.path, ["rev-parse", "HEAD"]);
      logs.push(`Fast-forward merged ${workingBranch} into ${targetBranch}`);
      logs.push(`Target branch head is now ${targetHead}`);
      return {
        logs,
        targetHead,
      };
    } catch (error) {
      if (isFastForwardFailure(error) && attempt < maxMergeAttempts) {
        logs.push(
          `${targetBranch} advanced during direct merge. Refreshing and retrying the rebase/merge flow.`,
        );
        continue;
      }

      if (isFastForwardFailure(error)) {
        throw new AutomaticMergeRecoveryError(
          "Automatic merge recovery could not keep up with target-branch updates.",
          {
            logs,
            note: `Automatic merge recovery could not complete because ${targetBranch} kept advancing during the direct-merge retry.`,
          },
        );
      }

      throw error;
    }
  }

  throw new AutomaticMergeRecoveryError(
    "Automatic merge recovery exhausted its retry budget without merging the ticket.",
    {
      logs,
      note: `Automatic merge recovery exhausted its retry budget while merging ${workingBranch} into ${targetBranch}.`,
    },
  );
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
