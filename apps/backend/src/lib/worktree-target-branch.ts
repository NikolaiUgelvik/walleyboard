import type { RepositoryConfig } from "../../../../packages/contracts/src/index.js";

type RunGit = (repoPath: string, args: string[]) => string;
type RunGitAsync = (repoPath: string, args: string[]) => Promise<string>;

export class GitCommandError extends Error {
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

export type RemoteTrackingRef = {
  refName: string;
  remoteName: string;
  branchName: string;
};

type NormalizedTargetBranch = {
  configuredName: string;
  localBranchName: string;
  remoteTrackingRef: RemoteTrackingRef | null;
};

export type RefreshedTargetBranch = {
  logs: string[];
  syncRef: string;
  mergeBackBranch: string;
  remoteTrackingRef: RemoteTrackingRef | null;
};

export type WorktreeSyncedTargetBranch = {
  logs: string[];
  syncRef: string;
};

function gitRefExists(repoPath: string, ref: string, runGit: RunGit): boolean {
  try {
    runGit(repoPath, ["show-ref", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

function resolveRemoteTrackingRef(
  repoPath: string,
  refName: string,
  runGit: RunGit,
): RemoteTrackingRef | null {
  if (!gitRefExists(repoPath, `refs/remotes/${refName}`, runGit)) {
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

function localBranchExists(
  repoPath: string,
  branchName: string,
  runGit: RunGit,
): boolean {
  return gitRefExists(repoPath, `refs/heads/${branchName}`, runGit);
}

function resolveBranchUpstream(
  repoPath: string,
  branchName: string,
  runGit: RunGit,
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

function normalizeTargetBranch(
  repoPath: string,
  targetBranch: string,
  runGit: RunGit,
): NormalizedTargetBranch {
  const configuredRemoteTrackingRef = resolveRemoteTrackingRef(
    repoPath,
    targetBranch,
    runGit,
  );
  if (configuredRemoteTrackingRef) {
    if (
      !localBranchExists(
        repoPath,
        configuredRemoteTrackingRef.branchName,
        runGit,
      )
    ) {
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

  if (!localBranchExists(repoPath, targetBranch, runGit)) {
    throw new Error(
      `Configured target branch ${targetBranch} is not available as a local branch. Create or fetch it, then try again.`,
    );
  }

  const upstream = resolveBranchUpstream(repoPath, targetBranch, runGit);
  return {
    configuredName: targetBranch,
    localBranchName: targetBranch,
    remoteTrackingRef: upstream
      ? resolveRemoteTrackingRef(repoPath, upstream, runGit)
      : null,
  };
}

async function gitRefExistsAsync(
  repoPath: string,
  ref: string,
  runGitAsync: RunGitAsync,
): Promise<boolean> {
  try {
    await runGitAsync(repoPath, ["show-ref", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

async function resolveRemoteTrackingRefAsync(
  repoPath: string,
  refName: string,
  runGitAsync: RunGitAsync,
): Promise<RemoteTrackingRef | null> {
  if (
    !(await gitRefExistsAsync(repoPath, `refs/remotes/${refName}`, runGitAsync))
  ) {
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

async function localBranchExistsAsync(
  repoPath: string,
  branchName: string,
  runGitAsync: RunGitAsync,
): Promise<boolean> {
  return await gitRefExistsAsync(
    repoPath,
    `refs/heads/${branchName}`,
    runGitAsync,
  );
}

async function resolveBranchUpstreamAsync(
  repoPath: string,
  branchName: string,
  runGitAsync: RunGitAsync,
): Promise<string | null> {
  try {
    const upstream = await runGitAsync(repoPath, [
      "rev-parse",
      "--abbrev-ref",
      `${branchName}@{upstream}`,
    ]);
    return upstream.length > 0 ? upstream : null;
  } catch {
    return null;
  }
}

async function normalizeTargetBranchAsync(
  repoPath: string,
  targetBranch: string,
  runGitAsync: RunGitAsync,
): Promise<NormalizedTargetBranch> {
  const configuredRemoteTrackingRef = await resolveRemoteTrackingRefAsync(
    repoPath,
    targetBranch,
    runGitAsync,
  );
  if (configuredRemoteTrackingRef) {
    if (
      !(await localBranchExistsAsync(
        repoPath,
        configuredRemoteTrackingRef.branchName,
        runGitAsync,
      ))
    ) {
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

  if (!(await localBranchExistsAsync(repoPath, targetBranch, runGitAsync))) {
    throw new Error(
      `Configured target branch ${targetBranch} is not available as a local branch. Create or fetch it, then try again.`,
    );
  }

  const upstream = await resolveBranchUpstreamAsync(
    repoPath,
    targetBranch,
    runGitAsync,
  );
  return {
    configuredName: targetBranch,
    localBranchName: targetBranch,
    remoteTrackingRef: upstream
      ? await resolveRemoteTrackingRefAsync(repoPath, upstream, runGitAsync)
      : null,
  };
}

export function refreshTargetBranch(input: {
  repositoryPath: string;
  repository: RepositoryConfig;
  targetBranch: string;
  runGit: RunGit;
}): RefreshedTargetBranch {
  const normalizedTarget = normalizeTargetBranch(
    input.repository.path,
    input.targetBranch,
    input.runGit,
  );
  const logs: string[] = [];

  if (normalizedTarget.configuredName !== normalizedTarget.localBranchName) {
    logs.push(
      `Configured target branch ${normalizedTarget.configuredName} resolves to local branch ${normalizedTarget.localBranchName} for local git operations`,
    );
  }

  const repoStatus = input.runGit(input.repositoryPath, ["status", "--short"]);
  if (repoStatus.length > 0) {
    throw new Error(
      `Cannot update target branch ${normalizedTarget.localBranchName} before continuing because ${input.repositoryPath} has uncommitted changes. Resolve the repository state and try again.`,
    );
  }

  const currentBranch = input.runGit(input.repositoryPath, [
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ]);
  if (currentBranch !== normalizedTarget.localBranchName) {
    input.runGit(input.repositoryPath, [
      "checkout",
      normalizedTarget.localBranchName,
    ]);
    logs.push(
      `Checked out ${normalizedTarget.localBranchName} in ${input.repositoryPath}`,
    );
  }

  if (!normalizedTarget.remoteTrackingRef) {
    const refreshedHead = input.runGit(input.repositoryPath, [
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
    input.runGit(input.repositoryPath, [
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

  const refreshedHead = input.runGit(input.repositoryPath, [
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

export async function refreshTargetBranchAsync(input: {
  repositoryPath: string;
  repository: RepositoryConfig;
  targetBranch: string;
  runGitAsync: RunGitAsync;
}): Promise<RefreshedTargetBranch> {
  const normalizedTarget = await normalizeTargetBranchAsync(
    input.repository.path,
    input.targetBranch,
    input.runGitAsync,
  );
  const logs: string[] = [];

  if (normalizedTarget.configuredName !== normalizedTarget.localBranchName) {
    logs.push(
      `Configured target branch ${normalizedTarget.configuredName} resolves to local branch ${normalizedTarget.localBranchName} for local git operations`,
    );
  }

  const repoStatus = await input.runGitAsync(input.repositoryPath, [
    "status",
    "--short",
  ]);
  if (repoStatus.length > 0) {
    throw new Error(
      `Cannot update target branch ${normalizedTarget.localBranchName} before continuing because ${input.repositoryPath} has uncommitted changes. Resolve the repository state and try again.`,
    );
  }

  const currentBranch = await input.runGitAsync(input.repositoryPath, [
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ]);
  if (currentBranch !== normalizedTarget.localBranchName) {
    await input.runGitAsync(input.repositoryPath, [
      "checkout",
      normalizedTarget.localBranchName,
    ]);
    logs.push(
      `Checked out ${normalizedTarget.localBranchName} in ${input.repositoryPath}`,
    );
  }

  if (!normalizedTarget.remoteTrackingRef) {
    const refreshedHead = await input.runGitAsync(input.repositoryPath, [
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
    await input.runGitAsync(input.repositoryPath, [
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

  const refreshedHead = await input.runGitAsync(input.repositoryPath, [
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

export function syncTargetBranchIntoWorktree(input: {
  isSelfContainedWorkspace: (worktreePath: string) => boolean;
  refreshedTarget: RefreshedTargetBranch;
  repositoryPath: string;
  runGit: RunGit;
  workingBranch: string;
  worktreePath: string;
}): WorktreeSyncedTargetBranch {
  if (!input.isSelfContainedWorkspace(input.worktreePath)) {
    return {
      logs: [],
      syncRef: input.refreshedTarget.syncRef,
    };
  }

  const importedRef = `refs/walleyboard/merge-target/${input.workingBranch.replace(/[^A-Za-z0-9/_-]+/g, "-")}`;
  input.runGit(input.worktreePath, [
    "fetch",
    "--quiet",
    input.repositoryPath,
    `+${input.refreshedTarget.mergeBackBranch}:${importedRef}`,
  ]);
  const importedHead = input.runGit(input.worktreePath, [
    "rev-parse",
    importedRef,
  ]);

  return {
    logs: [
      `Imported refreshed ${input.refreshedTarget.mergeBackBranch} into ${input.worktreePath} as ${importedRef}`,
      `Worktree target sync ref after import: ${importedHead}`,
    ],
    syncRef: importedRef,
  };
}
