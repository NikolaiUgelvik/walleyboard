import { execFile, execFileSync, spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";

import type {
  Project,
  RepositoryConfig,
  TicketFrontmatter,
} from "../../../../packages/contracts/src/index.js";

import { runObservedOperation } from "./backend-observability.js";
import { resolveTargetBranch } from "./execution-runtime/helpers.js";
import type { PreparedExecutionRuntime } from "./store.js";
import { resolveWalleyBoardPath } from "./walleyboard-paths.js";
import {
  GitCommandError,
  type RemoteTrackingRef,
  refreshTargetBranch,
  refreshTargetBranchAsync,
  syncTargetBranchIntoWorktree,
} from "./worktree-target-branch.js";

const worktreeCommandShell = "bash";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function branchPrefixForAdapter(adapter: string): string {
  if (adapter === "claude-code") {
    return "claude";
  }
  return "codex";
}

function deriveWorkingBranch(
  ticket: TicketFrontmatter,
  agentAdapter: string,
): string {
  return `${branchPrefixForAdapter(agentAdapter)}/ticket-${ticket.id}-${slugify(ticket.title).slice(0, 24)}`;
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
  recoveryKind: "conflicts" | "target_branch_advanced";
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
  return runObservedOperation(
    "worktree.git",
    {
      command: args.join(" "),
      repoPath,
    },
    () => {
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
    },
  );
}

function runGitAtRoot(args: string[]): string {
  return runObservedOperation(
    "worktree.git-root",
    {
      command: args.join(" "),
    },
    () => {
      try {
        return execFileSync("git", args, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }).trim();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown git execution failure";
        throw new Error(`Git command failed (${args.join(" ")}): ${message}`);
      }
    },
  );
}

async function runGitAsync(repoPath: string, args: string[]): Promise<string> {
  return await runObservedOperation(
    "worktree.git",
    {
      command: args.join(" "),
      repoPath,
    },
    async () => {
      try {
        return (
          await new Promise<string>((resolve, reject) => {
            execFile(
              "git",
              ["-C", repoPath, ...args],
              { encoding: "utf8" },
              (error, stdout, stderr) => {
                if (!error) {
                  resolve(stdout.trim());
                  return;
                }

                const gitError = error as GitExecError;
                if (
                  typeof (error as { code?: unknown }).code === "number" &&
                  gitError.status === undefined
                ) {
                  gitError.status = (error as { code: number }).code;
                }
                gitError.stdout = stdout;
                gitError.stderr = stderr;
                reject(gitError);
              },
            );
          })
        ).trim();
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
    },
  );
}

async function runGitAtRootAsync(args: string[]): Promise<string> {
  return await runObservedOperation(
    "worktree.git-root",
    {
      command: args.join(" "),
    },
    async () => {
      try {
        return (
          await new Promise<string>((resolve, reject) => {
            execFile("git", args, { encoding: "utf8" }, (error, stdout) => {
              if (!error) {
                resolve(stdout.trim());
                return;
              }

              reject(error);
            });
          })
        ).trim();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown git execution failure";
        throw new Error(`Git command failed (${args.join(" ")}): ${message}`);
      }
    },
  );
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

function hasMeaningfulContent(
  value: string | null | undefined,
): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function fetchRepositoryBranches(
  repository: RepositoryConfig,
): string[] {
  runGit(repository.path, ["rev-parse", "--is-inside-work-tree"]);
  const output = runGit(repository.path, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
    "refs/remotes",
  ]);
  const branches = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.endsWith("/HEAD"));

  return [...new Set(branches)].sort((left, right) =>
    left.localeCompare(right),
  );
}

function tryRemoveWorktreeRoot(worktreePath: string): void {
  try {
    rmdirSync(dirname(worktreePath));
  } catch {
    // Ignore missing or non-empty project worktree roots.
  }
}

function isSelfContainedWorkspace(worktreePath: string): boolean {
  const gitPath = join(worktreePath, ".git");
  return existsSync(gitPath) && lstatSync(gitPath).isDirectory();
}

function removeStandaloneWorkspace(worktreePath: string): void {
  rmSync(worktreePath, { recursive: true, force: true });
  tryRemoveWorktreeRoot(worktreePath);
}

function copyGitIdentity(sourceRepoPath: string, workspacePath: string): void {
  let userName = "";
  let userEmail = "";

  try {
    userName = runGit(sourceRepoPath, ["config", "--get", "user.name"]);
  } catch {
    userName = "";
  }

  try {
    userEmail = runGit(sourceRepoPath, ["config", "--get", "user.email"]);
  } catch {
    userEmail = "";
  }

  if (userName.length > 0) {
    runGit(workspacePath, ["config", "user.name", userName]);
  }

  if (userEmail.length > 0) {
    runGit(workspacePath, ["config", "user.email", userEmail]);
  }
}

async function copyGitIdentityAsync(
  sourceRepoPath: string,
  workspacePath: string,
): Promise<void> {
  let userName = "";
  let userEmail = "";

  try {
    userName = await runGitAsync(sourceRepoPath, [
      "config",
      "--get",
      "user.name",
    ]);
  } catch {
    userName = "";
  }

  try {
    userEmail = await runGitAsync(sourceRepoPath, [
      "config",
      "--get",
      "user.email",
    ]);
  } catch {
    userEmail = "";
  }

  if (userName.length > 0) {
    await runGitAsync(workspacePath, ["config", "user.name", userName]);
  }

  if (userEmail.length > 0) {
    await runGitAsync(workspacePath, ["config", "user.email", userEmail]);
  }
}

function addWorkspaceExclude(workspacePath: string, pattern: string): void {
  const excludePath = join(workspacePath, ".git", "info", "exclude");
  const existing = existsSync(excludePath)
    ? readFileSync(excludePath, "utf8")
    : "";

  if (existing.split("\n").some((line) => line.trim() === pattern)) {
    return;
  }

  appendFileSync(
    excludePath,
    `${existing.length > 0 && !existing.endsWith("\n") ? "\n" : ""}${pattern}\n`,
    "utf8",
  );
}

export function runPreWorktreeCommand(
  worktreePath: string,
  command: string | null | undefined,
): { started: boolean; done: Promise<void> } {
  const normalizedCommand = normalizeOptionalCommand(command);
  if (!normalizedCommand || !existsSync(worktreePath)) {
    return { started: false, done: Promise.resolve() };
  }

  const child = spawn(worktreeCommandShell, ["-lc", normalizedCommand], {
    cwd: worktreePath,
    env: process.env,
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  const done = new Promise<void>((resolve) => {
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });

  return { started: true, done };
}

export type PreparedWorktreeRemovalResult = {
  status: "removed" | "scheduled";
};

export type ImmediateWorktreeResetResult = {
  warnings: string[];
};

export function prepareWorktree(
  project: Project,
  repository: RepositoryConfig,
  ticket: TicketFrontmatter,
): PreparedExecutionRuntime {
  if (ticket.working_branch) {
    throw new Error("Ticket already has a working branch");
  }

  const workingBranch = deriveWorkingBranch(
    ticket,
    project.ticket_work_agent_adapter,
  );
  const projectWorktreeRoot = resolveWalleyBoardPath("worktrees", project.slug);
  const worktreeRoot = join(projectWorktreeRoot, `ticket-${ticket.id}`);
  mkdirSync(projectWorktreeRoot, { recursive: true });

  if (existsSync(worktreeRoot)) {
    throw new Error(`Worktree path already exists: ${worktreeRoot}`);
  }

  const targetBranch = resolveTargetBranch(repository, ticket.target_branch);
  runGit(repository.path, ["rev-parse", "--is-inside-work-tree"]);
  const refreshedTarget = refreshTargetBranch({
    repositoryPath: repository.path,
    repository,
    runGit,
    targetBranch,
  });

  try {
    runGitAtRoot([
      "clone",
      "--quiet",
      "--no-hardlinks",
      "--branch",
      refreshedTarget.mergeBackBranch,
      repository.path,
      worktreeRoot,
    ]);
    copyGitIdentity(repository.path, worktreeRoot);
    runGit(worktreeRoot, ["checkout", "-b", workingBranch]);
    addWorkspaceExclude(worktreeRoot, ".walleyboard/");
  } catch (error) {
    if (existsSync(worktreeRoot)) {
      removeStandaloneWorkspace(worktreeRoot);
    }

    throw error;
  }

  const logs = [
    `Verified git repository: ${repository.path}`,
    ...refreshedTarget.logs,
    `Cloned isolated repository checkout: ${worktreeRoot}`,
    `Created working branch ${workingBranch} from ${refreshedTarget.mergeBackBranch}`,
  ];

  return {
    workingBranch,
    worktreePath: worktreeRoot,
    logs,
  };
}

export async function prepareWorktreeAsync(
  project: Project,
  repository: RepositoryConfig,
  ticket: TicketFrontmatter,
): Promise<PreparedExecutionRuntime> {
  if (ticket.working_branch) {
    throw new Error("Ticket already has a working branch");
  }

  const workingBranch = deriveWorkingBranch(
    ticket,
    project.ticket_work_agent_adapter,
  );
  const projectWorktreeRoot = resolveWalleyBoardPath("worktrees", project.slug);
  const worktreeRoot = join(projectWorktreeRoot, `ticket-${ticket.id}`);
  mkdirSync(projectWorktreeRoot, { recursive: true });

  if (existsSync(worktreeRoot)) {
    throw new Error(`Worktree path already exists: ${worktreeRoot}`);
  }

  const targetBranch = resolveTargetBranch(repository, ticket.target_branch);
  await runGitAsync(repository.path, ["rev-parse", "--is-inside-work-tree"]);
  const refreshedTarget = await refreshTargetBranchAsync({
    repositoryPath: repository.path,
    repository,
    runGitAsync,
    targetBranch,
  });

  try {
    await runGitAtRootAsync([
      "clone",
      "--quiet",
      "--no-hardlinks",
      "--branch",
      refreshedTarget.mergeBackBranch,
      repository.path,
      worktreeRoot,
    ]);
    await copyGitIdentityAsync(repository.path, worktreeRoot);
    await runGitAsync(worktreeRoot, ["checkout", "-b", workingBranch]);
    addWorkspaceExclude(worktreeRoot, ".walleyboard/");
  } catch (error) {
    if (existsSync(worktreeRoot)) {
      removeStandaloneWorkspace(worktreeRoot);
    }

    throw error;
  }

  const logs = [
    `Verified git repository: ${repository.path}`,
    ...refreshedTarget.logs,
    `Cloned isolated repository checkout: ${worktreeRoot}`,
    `Created working branch ${workingBranch} from ${refreshedTarget.mergeBackBranch}`,
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
  const selfContainedWorkspace = isSelfContainedWorkspace(worktreePath);
  if (normalizedCommand) {
    const child = spawn(
      worktreeCommandShell,
      [
        "-lc",
        selfContainedWorkspace
          ? 'cd "$1" && bash -lc "$2"; status=$?; rm -rf "$1"; parent_dir=$(dirname "$1"); rmdir "$parent_dir" 2>/dev/null || true; exit $status'
          : 'cd "$1" && bash -lc "$2"; status=$?; git -C "$3" worktree remove --force "$1"; removal_status=$?; if [ $removal_status -eq 0 ] && [ -n "$4" ]; then git -C "$3" branch -D "$4" >/dev/null 2>&1 || true; fi; parent_dir=$(dirname "$1"); rmdir "$parent_dir" 2>/dev/null || true; exit $status',
        worktreeCommandShell,
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

  if (selfContainedWorkspace) {
    removeStandaloneWorkspace(worktreePath);
    return { status: "removed" };
  }

  runGit(repository.path, ["worktree", "remove", "--force", worktreePath]);
  tryRemoveWorktreeRoot(worktreePath);
  return { status: "removed" };
}

export function resetPreparedWorktreeImmediately(
  repository: RepositoryConfig,
  worktreePath: string | null | undefined,
  workingBranch?: string | null,
  postWorktreeCommand?: string | null,
): ImmediateWorktreeResetResult {
  const warnings: string[] = [];
  const normalizedCommand = normalizeOptionalCommand(postWorktreeCommand);
  const normalizedWorktreePath = hasMeaningfulContent(worktreePath)
    ? worktreePath
    : null;

  if (
    normalizedCommand &&
    normalizedWorktreePath &&
    existsSync(normalizedWorktreePath)
  ) {
    try {
      execFileSync(worktreeCommandShell, ["-lc", normalizedCommand], {
        cwd: normalizedWorktreePath,
        encoding: "utf8",
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown post-worktree failure";
      warnings.push(`Post-worktree command failed: ${message}`);
    }
  }

  if (normalizedWorktreePath && existsSync(normalizedWorktreePath)) {
    if (isSelfContainedWorkspace(normalizedWorktreePath)) {
      removeStandaloneWorkspace(normalizedWorktreePath);
    } else {
      runGit(repository.path, [
        "worktree",
        "remove",
        "--force",
        normalizedWorktreePath,
      ]);
      tryRemoveWorktreeRoot(normalizedWorktreePath);
    }
  }

  if (
    hasMeaningfulContent(workingBranch) &&
    (!normalizedWorktreePath ||
      !isSelfContainedWorkspace(normalizedWorktreePath))
  ) {
    removeLocalBranch(repository, workingBranch);
  }

  return { warnings };
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

function branchContainsRef(
  repoPath: string,
  ancestorRef: string,
  branchRef: string,
): boolean {
  try {
    runGit(repoPath, ["merge-base", "--is-ancestor", ancestorRef, branchRef]);
    return true;
  } catch (error) {
    if (error instanceof GitCommandError && error.exitCode === 1) {
      return false;
    }

    throw error;
  }
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

function pushTargetBranch(
  repositoryPath: string,
  localBranchName: string,
  remoteTrackingRef: RemoteTrackingRef | null,
  targetHead: string,
): string[] {
  if (!remoteTrackingRef) {
    return [
      `No push remote is configured for ${localBranchName}; leaving the merged target branch local only.`,
    ];
  }

  try {
    runGit(repositoryPath, [
      "push",
      "--quiet",
      remoteTrackingRef.remoteName,
      `${localBranchName}:refs/heads/${remoteTrackingRef.branchName}`,
    ]);
  } catch (error) {
    if (error instanceof GitCommandError) {
      throw new Error(
        `Merged ${localBranchName} locally, but pushing to ${remoteTrackingRef.refName} failed. Resolve the repository state and push ${localBranchName} manually or retry the merge flow. ${error.message}`,
      );
    }

    throw error;
  }

  return [
    `Pushed ${localBranchName} to ${remoteTrackingRef.refName}`,
    `Target branch head ${targetHead} is now on ${remoteTrackingRef.refName}`,
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
  syncRef: string,
  targetBranch: string,
  resolveConflicts: MergeReviewedBranchOptions["resolveConflicts"] | undefined,
  conflictRecoveryAlreadyUsed: boolean,
): Promise<{ logs: string[]; usedConflictResolution: boolean }> {
  const logs: string[] = [];

  try {
    runGit(worktreePath, ["rebase", syncRef]);
    logs.push(`Rebased ${workingBranch} onto ${syncRef}`);
    return {
      logs,
      usedConflictResolution: false,
    };
  } catch (error) {
    const conflictedFiles = findConflictedFiles(worktreePath);
    const conflictStage = isMergeInProgress(worktreePath) ? "merge" : "rebase";
    if (conflictedFiles.length === 0) {
      throw error;
    }

    logs.push(
      `${conflictStage === "rebase" ? "Rebase" : "Merge"} reported conflicts in ${formatFileList(
        conflictedFiles,
      )}`,
    );

    if (!resolveConflicts) {
      throw new AutomaticMergeRecoveryError(
        conflictRecoveryAlreadyUsed
          ? "Direct merge hit additional conflicts after the automatic recovery attempt."
          : "Direct merge hit conflicts in the ticket worktree.",
        {
          logs,
          note: conflictRecoveryAlreadyUsed
            ? `Additional ${conflictStage} conflicts remain in ${formatFileList(
                conflictedFiles,
              )} after the automatic recovery attempt. Continue from the existing worktree and branch.`
            : `Direct merge hit ${conflictStage} conflicts in ${formatFileList(
                conflictedFiles,
              )}. Continue from the existing worktree and branch.`,
        },
      );
    }

    const resolution = await resolveConflicts({
      worktreePath,
      workingBranch,
      targetBranch,
      recoveryKind: "conflicts",
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
    return {
      logs,
      usedConflictResolution: true,
    };
  }
}

async function attemptTargetBranchCatchupWithRecovery(
  worktreePath: string,
  workingBranch: string,
  targetBranch: string,
  targetSyncRef: string,
  resolveConflicts: MergeReviewedBranchOptions["resolveConflicts"] | undefined,
  failureMessage: string,
): Promise<{ logs: string[] }> {
  const logs: string[] = [];

  try {
    runGit(worktreePath, ["merge", "--no-edit", targetSyncRef]);
    logs.push(
      `Merged refreshed ${targetBranch} changes from ${targetSyncRef} into ${workingBranch} inside the ticket worktree`,
    );
  } catch (error) {
    const conflictedFiles = findConflictedFiles(worktreePath);
    if (conflictedFiles.length === 0) {
      throw error;
    }

    logs.push(
      `Merging refreshed ${targetBranch} into ${workingBranch} reported conflicts in ${formatFileList(
        conflictedFiles,
      )}`,
    );

    if (!resolveConflicts) {
      throw new AutomaticMergeRecoveryError(
        "Direct merge could not keep up with target-branch updates.",
        {
          logs,
          note: `The target branch ${targetBranch} kept advancing while merging ${workingBranch}. Continue from the existing worktree and branch.`,
        },
      );
    }

    const resolution = await resolveConflicts({
      worktreePath,
      workingBranch,
      targetBranch,
      recoveryKind: "target_branch_advanced",
      stage: "merge",
      failureMessage,
      conflictedFiles,
    });
    logs.push(...resolution.logs);

    if (!resolution.resolved) {
      throw new AutomaticMergeRecoveryError(
        "Automatic merge recovery could not update the ticket branch to the latest target branch.",
        {
          logs,
          note:
            resolution.note ??
            `Automatic merge recovery could not update ${workingBranch} with the latest ${targetBranch} changes.`,
        },
      );
    }
  }

  if (isRebaseInProgress(worktreePath) || isMergeInProgress(worktreePath)) {
    throw new AutomaticMergeRecoveryError(
      "Automatic merge recovery did not finish updating the ticket branch.",
      {
        logs,
        note: "Automatic merge recovery stopped before the ticket branch finished integrating the latest target-branch changes.",
      },
    );
  }

  const worktreeStatus = gitStatusPorcelain(worktreePath);
  if (worktreeStatus.length > 0) {
    throw new AutomaticMergeRecoveryError(
      "Automatic merge recovery left additional worktree changes after updating the ticket branch.",
      {
        logs,
        note: "Automatic merge recovery left extra worktree changes after updating the ticket branch with the latest target-branch changes.",
      },
    );
  }

  const worktreeBranch = runGit(worktreePath, [
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ]);
  if (worktreeBranch !== workingBranch) {
    throw new AutomaticMergeRecoveryError(
      "Automatic merge recovery changed the ticket worktree branch unexpectedly.",
      {
        logs,
        note: `Automatic merge recovery left the worktree on ${worktreeBranch} instead of ${workingBranch}.`,
      },
    );
  }

  logs.push(
    `Updated ${workingBranch} with the latest ${targetBranch} changes in the ticket worktree`,
  );
  return { logs };
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

  const logs = [`Ticket worktree verified on ${workingBranch}`];
  const maxMergeAttempts = 2;
  let conflictRecoveryUsed = false;
  let targetAdvanceRecoveryUsed = false;
  let skipRebaseOnNextAttempt = false;
  let attempt = 1;

  while (attempt <= maxMergeAttempts) {
    const refreshedTarget = refreshTargetBranch({
      repositoryPath: repository.path,
      repository,
      runGit,
      targetBranch,
    });
    logs.push(...refreshedTarget.logs);
    const worktreeTarget = syncTargetBranchIntoWorktree({
      isSelfContainedWorkspace,
      refreshedTarget,
      repositoryPath: repository.path,
      runGit,
      workingBranch,
      worktreePath,
    });
    logs.push(...worktreeTarget.logs);

    let rebaseResult: {
      logs: string[];
      usedConflictResolution: boolean;
    };
    if (
      skipRebaseOnNextAttempt &&
      branchContainsRef(worktreePath, worktreeTarget.syncRef, workingBranch)
    ) {
      rebaseResult = {
        logs: [
          `${workingBranch} already includes the refreshed ${worktreeTarget.syncRef} head. Skipping rebase before retrying the final merge.`,
        ],
        usedConflictResolution: false,
      };
      skipRebaseOnNextAttempt = false;
    } else {
      skipRebaseOnNextAttempt = false;
      try {
        rebaseResult = await attemptRebaseWithRecovery(
          worktreePath,
          workingBranch,
          worktreeTarget.syncRef,
          targetBranch,
          conflictRecoveryUsed ? undefined : options.resolveConflicts,
          conflictRecoveryUsed,
        );
      } catch (error) {
        if (error instanceof AutomaticMergeRecoveryError) {
          throw new AutomaticMergeRecoveryError(error.message, {
            logs: [...logs, ...error.logs],
            note: error.note,
          });
        }

        throw error;
      }
    }
    logs.push(...rebaseResult.logs);
    if (rebaseResult.usedConflictResolution) {
      conflictRecoveryUsed = true;
    }

    const repoStatus = gitStatusPorcelain(repository.path);
    if (repoStatus.length > 0) {
      throw new Error(
        "Repository checkout has uncommitted changes. Clean it before merging.",
      );
    }

    const repoBranch = repoCurrentBranch(repository);
    if (repoBranch !== refreshedTarget.mergeBackBranch) {
      runGit(repository.path, ["checkout", refreshedTarget.mergeBackBranch]);
      logs.push(
        `Checked out ${refreshedTarget.mergeBackBranch} in ${repository.path} for the final fast-forward merge`,
      );
    }

    try {
      if (isSelfContainedWorkspace(worktreePath)) {
        const importedRef = `refs/walleyboard/${workingBranch.replace(/[^A-Za-z0-9/_-]+/g, "-")}`;
        try {
          runGit(repository.path, [
            "fetch",
            "--quiet",
            worktreePath,
            `${workingBranch}:${importedRef}`,
          ]);
          const importedHead = runGit(repository.path, [
            "rev-parse",
            importedRef,
          ]);
          runGit(repository.path, ["merge", "--ff-only", importedHead]);
          logs.push(
            `Imported ${workingBranch} from the isolated ticket checkout for the final fast-forward merge`,
          );
        } finally {
          try {
            runGit(repository.path, ["update-ref", "-d", importedRef]);
          } catch {
            // Ignore temporary ref cleanup failures.
          }
        }
      } else {
        runGit(repository.path, ["merge", "--ff-only", workingBranch]);
      }
      const targetHead = runGit(repository.path, ["rev-parse", "HEAD"]);
      logs.push(
        `Fast-forward merged ${workingBranch} into ${refreshedTarget.mergeBackBranch}`,
      );
      logs.push(`Target branch head is now ${targetHead}`);
      logs.push(
        ...pushTargetBranch(
          repository.path,
          refreshedTarget.mergeBackBranch,
          refreshedTarget.remoteTrackingRef,
          targetHead,
        ),
      );
      return {
        logs,
        targetHead,
      };
    } catch (error) {
      if (
        isFastForwardFailure(error) &&
        attempt < maxMergeAttempts &&
        !conflictRecoveryUsed &&
        !targetAdvanceRecoveryUsed
      ) {
        logs.push(
          `${refreshedTarget.mergeBackBranch} advanced during direct merge. Refreshing the ticket worktree and retrying the merge flow.`,
        );
        attempt += 1;
        continue;
      }

      if (isFastForwardFailure(error)) {
        if (!targetAdvanceRecoveryUsed) {
          const refreshedTargetAfterAdvance = refreshTargetBranch({
            repositoryPath: repository.path,
            repository,
            runGit,
            targetBranch,
          });
          logs.push(...refreshedTargetAfterAdvance.logs);
          const worktreeTargetAfterAdvance = syncTargetBranchIntoWorktree({
            isSelfContainedWorkspace,
            refreshedTarget: refreshedTargetAfterAdvance,
            repositoryPath: repository.path,
            runGit,
            workingBranch,
            worktreePath,
          });
          logs.push(...worktreeTargetAfterAdvance.logs);
          const recovery = await attemptTargetBranchCatchupWithRecovery(
            worktreePath,
            workingBranch,
            targetBranch,
            worktreeTargetAfterAdvance.syncRef,
            options.resolveConflicts,
            error instanceof Error
              ? error.message
              : `Direct merge could not keep up with ${refreshedTarget.mergeBackBranch}`,
          );
          logs.push(...recovery.logs);
          logs.push(
            `Retrying the final merge after updating ${workingBranch} with the latest ${refreshedTarget.mergeBackBranch} changes.`,
          );
          targetAdvanceRecoveryUsed = true;
          skipRebaseOnNextAttempt = true;
          attempt = 1;
          continue;
        }

        throw new AutomaticMergeRecoveryError(
          "Automatic merge recovery could not keep up with target-branch updates after updating the ticket branch.",
          {
            logs,
            note: `Automatic merge recovery could not complete because ${refreshedTarget.mergeBackBranch} kept advancing even after the ticket branch was updated in the worktree.`,
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
