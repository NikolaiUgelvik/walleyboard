import { execFileSync, spawn } from "node:child_process";
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

import { resolveTargetBranch } from "./execution-runtime/helpers.js";
import type { PreparedExecutionRuntime } from "./store.js";
import { resolveWalleyBoardPath } from "./walleyboard-paths.js";

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

function hasMeaningfulContent(
  value: string | null | undefined,
): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function listGitRemotes(repoPath: string): string[] {
  const output = runGit(repoPath, ["remote"]);
  if (output.length === 0) {
    return [];
  }

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function fetchRepositoryBranches(
  repository: RepositoryConfig,
): string[] {
  runGit(repository.path, ["rev-parse", "--is-inside-work-tree"]);

  if (listGitRemotes(repository.path).length > 0) {
    runGit(repository.path, ["fetch", "--all", "--prune", "--quiet"]);
  }

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

  const workingBranch = deriveWorkingBranch(ticket, project.agent_adapter);
  const projectWorktreeRoot = resolveWalleyBoardPath("worktrees", project.slug);
  const worktreeRoot = join(projectWorktreeRoot, `ticket-${ticket.id}`);
  mkdirSync(projectWorktreeRoot, { recursive: true });

  if (existsSync(worktreeRoot)) {
    throw new Error(`Worktree path already exists: ${worktreeRoot}`);
  }

  const targetBranch = resolveTargetBranch(repository, ticket.target_branch);
  runGit(repository.path, ["rev-parse", "--is-inside-work-tree"]);
  const refreshedTarget = refreshTargetBranch(
    repository.path,
    repository,
    targetBranch,
  );

  if (project.execution_backend === "docker") {
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

  try {
    runGit(repository.path, [
      "worktree",
      "add",
      "-b",
      workingBranch,
      worktreeRoot,
      refreshedTarget.syncRef,
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
    ...refreshedTarget.logs,
    `Checked out target branch: ${refreshedTarget.syncRef}`,
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
  const selfContainedWorkspace = isSelfContainedWorkspace(worktreePath);
  if (normalizedCommand) {
    const child = spawn(
      "sh",
      [
        "-lc",
        selfContainedWorkspace
          ? 'cd "$1" && sh -lc "$2"; status=$?; rm -rf "$1"; parent_dir=$(dirname "$1"); rmdir "$parent_dir" 2>/dev/null || true; exit $status'
          : 'cd "$1" && sh -lc "$2"; status=$?; git -C "$3" worktree remove --force "$1"; removal_status=$?; if [ $removal_status -eq 0 ] && [ -n "$4" ]; then git -C "$3" branch -D "$4" >/dev/null 2>&1 || true; fi; parent_dir=$(dirname "$1"); rmdir "$parent_dir" 2>/dev/null || true; exit $status',
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
      execFileSync("sh", ["-lc", normalizedCommand], {
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

function gitRefExists(repoPath: string, ref: string): boolean {
  try {
    runGit(repoPath, ["show-ref", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

type RemoteTrackingRef = {
  refName: string;
  remoteName: string;
  branchName: string;
};

type NormalizedTargetBranch = {
  configuredName: string;
  localBranchName: string;
  remoteTrackingRef: RemoteTrackingRef | null;
};

function resolveRemoteTrackingRef(
  repoPath: string,
  refName: string,
): RemoteTrackingRef | null {
  if (!gitRefExists(repoPath, `refs/remotes/${refName}`)) {
    return null;
  }

  const refSegments = refName.split("/");
  const remoteName = refSegments[0];
  const branchSegments = refSegments.slice(1);
  if (!remoteName || branchSegments.length === 0) {
    return null;
  }

  return {
    refName,
    remoteName,
    branchName: branchSegments.join("/"),
  };
}

function localBranchExists(repoPath: string, branchName: string): boolean {
  return gitRefExists(repoPath, `refs/heads/${branchName}`);
}

function normalizeTargetBranch(
  repoPath: string,
  targetBranch: string,
): NormalizedTargetBranch {
  const configuredRemoteTrackingRef = resolveRemoteTrackingRef(
    repoPath,
    targetBranch,
  );
  if (configuredRemoteTrackingRef) {
    if (!localBranchExists(repoPath, configuredRemoteTrackingRef.branchName)) {
      throw new Error(
        `Configured target branch ${targetBranch} resolves to local branch ${configuredRemoteTrackingRef.branchName}, but that local branch does not exist. Create or fetch it, then try again.`,
      );
    }

    return {
      configuredName: targetBranch,
      localBranchName: configuredRemoteTrackingRef.branchName,
      remoteTrackingRef: configuredRemoteTrackingRef,
    };
  }

  if (!localBranchExists(repoPath, targetBranch)) {
    throw new Error(
      `Configured target branch ${targetBranch} is not available as a local branch. Create or fetch it, then try again.`,
    );
  }

  const upstream = resolveBranchUpstream(repoPath, targetBranch);
  return {
    configuredName: targetBranch,
    localBranchName: targetBranch,
    remoteTrackingRef: upstream
      ? resolveRemoteTrackingRef(repoPath, upstream)
      : null,
  };
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

type RefreshedTargetBranch = {
  logs: string[];
  syncRef: string;
  mergeBackBranch: string;
  remoteTrackingRef: RemoteTrackingRef | null;
};

function refreshTargetBranch(
  repositoryPath: string,
  repository: RepositoryConfig,
  targetBranch: string,
): RefreshedTargetBranch {
  const normalizedTarget = normalizeTargetBranch(repository.path, targetBranch);
  const logs: string[] = [];

  if (normalizedTarget.configuredName !== normalizedTarget.localBranchName) {
    logs.push(
      `Configured target branch ${normalizedTarget.configuredName} resolves to local branch ${normalizedTarget.localBranchName} for local git operations`,
    );
  }

  const repoStatus = gitStatusPorcelain(repositoryPath);
  if (repoStatus.length > 0) {
    throw new Error(
      `Cannot update target branch ${normalizedTarget.localBranchName} before continuing because ${repositoryPath} has uncommitted changes. Resolve the repository state and try again.`,
    );
  }

  const currentBranch = runGit(repositoryPath, [
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ]);
  if (currentBranch !== normalizedTarget.localBranchName) {
    runGit(repositoryPath, ["checkout", normalizedTarget.localBranchName]);
    logs.push(
      `Checked out ${normalizedTarget.localBranchName} in ${repositoryPath}`,
    );
  }

  if (!normalizedTarget.remoteTrackingRef) {
    const refreshedHead = runGit(repositoryPath, [
      "rev-parse",
      normalizedTarget.localBranchName,
    ]);
    return {
      logs: [
        ...logs,
        `No upstream is configured for ${normalizedTarget.localBranchName}; using the current local branch head.`,
        `Target branch sync ref after refresh: ${refreshedHead}`,
      ],
      syncRef: normalizedTarget.localBranchName,
      mergeBackBranch: normalizedTarget.localBranchName,
      remoteTrackingRef: null,
    };
  }

  try {
    runGit(repositoryPath, [
      "pull",
      "--ff-only",
      "--quiet",
      normalizedTarget.remoteTrackingRef.remoteName,
      normalizedTarget.remoteTrackingRef.branchName,
    ]);
  } catch (error) {
    if (error instanceof GitCommandError) {
      throw new Error(
        `Unable to update target branch ${normalizedTarget.localBranchName} from ${normalizedTarget.remoteTrackingRef.refName}. Resolve the repository state and try again. ${error.message}`,
      );
    }

    throw error;
  }

  const refreshedHead = runGit(repositoryPath, [
    "rev-parse",
    normalizedTarget.localBranchName,
  ]);
  return {
    logs: [
      ...logs,
      `Pulled ${normalizedTarget.localBranchName} from ${normalizedTarget.remoteTrackingRef.refName}`,
      `Target branch sync ref after refresh: ${refreshedHead}`,
    ],
    syncRef: normalizedTarget.localBranchName,
    mergeBackBranch: normalizedTarget.localBranchName,
    remoteTrackingRef: normalizedTarget.remoteTrackingRef,
  };
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

  for (let attempt = 1; attempt <= maxMergeAttempts; attempt += 1) {
    const refreshedTarget = refreshTargetBranch(
      repository.path,
      repository,
      targetBranch,
    );
    logs.push(...refreshedTarget.logs);

    let rebaseResult: {
      logs: string[];
      usedConflictResolution: boolean;
    };
    try {
      rebaseResult = await attemptRebaseWithRecovery(
        worktreePath,
        workingBranch,
        refreshedTarget.syncRef,
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
      if (isFastForwardFailure(error) && attempt < maxMergeAttempts) {
        logs.push(
          `${refreshedTarget.mergeBackBranch} advanced during direct merge. Refreshing the ticket worktree and retrying the merge flow.`,
        );
        continue;
      }

      if (isFastForwardFailure(error)) {
        throw new AutomaticMergeRecoveryError(
          "Automatic merge recovery could not keep up with target-branch updates.",
          {
            logs,
            note: `Automatic merge recovery could not complete because ${refreshedTarget.mergeBackBranch} kept advancing during the direct-merge retry.`,
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
