import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

import type {
  ExecutionAttempt,
  ExecutionSession,
  PullRequestRef,
  ReviewPackage,
  ReviewRun,
  StructuredEvent,
  TicketFrontmatter,
} from "../../../../packages/contracts/src/index.js";
import type { PullRequestActionFailure } from "./github-action-failures.js";
import type {
  GraphQlCheckRunAnnotationNode,
  GraphQlCheckRunContextNode,
  GraphQlStatusContextNode,
} from "./github-pull-request-service-types.js";
import type { GitHubPullRequestPersistence } from "./store.js";
import { nowIso } from "./time.js";
export type GitHubRepositoryIdentity = {
  owner: string;
  name: string;
  remoteName: string;
  remoteUrl?: string;
  pushUrl?: string;
};

export type PullRequestSnapshot = {
  owner: string;
  repo: string;
  number: number;
  url: string;
  headBranch: string;
  baseBranch: string;
  state: PullRequestRef["state"];
  reviewStatus: PullRequestRef["review_status"];
  headSha: string | null;
  changesRequestedBy: string | null;
  mergeable: string | null;
  mergeStateStatus: string | null;
  actionFailures: PullRequestActionFailure[];
};

type PullRequestTimelineContext = {
  attempts: ExecutionAttempt[];
  patch: string;
  reviewRuns: ReviewRun[];
  sessionLogs: string[];
  ticketEvents: StructuredEvent[];
};

const ghCommandTimeoutMs = 30_000;
const gitCommandTimeoutMs = 15_000;
const commandMaxBufferBytes = 10 * 1024 * 1024;

type ExecFileError = Error & {
  code?: number | string | null;
  killed?: boolean;
  signal?: string | null;
  stderr?: string | Buffer;
  stdout?: string | Buffer;
};

async function execFileText(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    timeoutMs: number;
  },
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        encoding: "utf8",
        maxBuffer: commandMaxBufferBytes,
        timeout: options.timeoutMs,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout.trim());
          return;
        }

        const execError = error as ExecFileError;
        const stdoutText =
          typeof execError.stdout === "string"
            ? execError.stdout.trim()
            : (execError.stdout?.toString("utf8").trim() ?? stdout.trim());
        const stderrText =
          typeof execError.stderr === "string"
            ? execError.stderr.trim()
            : (execError.stderr?.toString("utf8").trim() ?? stderr.trim());
        const detail =
          stderrText || stdoutText || execError.message || "Command failed";
        const timeoutDetail = execError.killed
          ? ` timed out after ${options.timeoutMs}ms`
          : "";

        reject(
          new Error(
            `${command} ${args.join(" ")} failed${timeoutDetail}: ${detail}`,
          ),
        );
      },
    );
  });
}

export async function defaultRunGhCommand(
  args: string[],
  cwd: string,
): Promise<string> {
  try {
    return await execFileText("gh", args, {
      cwd,
      timeoutMs: ghCommandTimeoutMs,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "GitHub CLI command failed";
    throw new Error(`gh ${args.join(" ")} failed: ${message}`);
  }
}

export async function runGit(
  repoPath: string,
  args: string[],
): Promise<string> {
  try {
    return await execFileText("git", ["-C", repoPath, ...args], {
      timeoutMs: gitCommandTimeoutMs,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "git command failed";
    throw new Error(`git -C ${repoPath} ${args.join(" ")} failed: ${message}`);
  }
}

async function gitRefExists(
  repoPath: string,
  refName: string,
): Promise<boolean> {
  try {
    await runGit(repoPath, ["show-ref", "--verify", "--quiet", refName]);
    return true;
  } catch {
    return false;
  }
}

function parseGitHubRemote(url: string): {
  owner: string;
  name: string;
} | null {
  const trimmed = url.trim();
  const sshMatch = trimmed.match(
    /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/,
  );
  if (sshMatch) {
    return {
      owner: sshMatch[1] ?? "",
      name: sshMatch[2] ?? "",
    };
  }

  const httpsMatch = trimmed.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/,
  );
  if (httpsMatch) {
    return {
      owner: httpsMatch[1] ?? "",
      name: httpsMatch[2] ?? "",
    };
  }

  return null;
}

export async function resolvePullRequestBaseBranch(
  repoPath: string,
  targetBranch: string,
): Promise<string> {
  if (await gitRefExists(repoPath, `refs/remotes/${targetBranch}`)) {
    const segments = targetBranch.split("/");
    const remoteName = segments[0] ?? "";
    const branchSegments = segments.slice(1);
    if (remoteName.length > 0 && branchSegments.length > 0) {
      return branchSegments.join("/");
    }
  }

  return targetBranch;
}

async function listGitRemoteNames(repoPath: string): Promise<string[]> {
  const output = await runGit(repoPath, ["remote"]);
  if (output.length === 0) {
    return [];
  }

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function findGitHubRepositoryIdentity(
  repoPath: string,
): Promise<GitHubRepositoryIdentity | null> {
  const remoteNames = await listGitRemoteNames(repoPath);

  for (const remoteName of [
    "origin",
    ...remoteNames.filter((remote) => remote !== "origin"),
  ]) {
    const remoteUrl = await runGit(repoPath, ["remote", "get-url", remoteName]);
    const pushUrl = await runGit(repoPath, [
      "remote",
      "get-url",
      "--push",
      remoteName,
    ]);
    const identity = parseGitHubRemote(remoteUrl) ?? parseGitHubRemote(pushUrl);
    if (!identity) {
      continue;
    }

    return {
      owner: identity.owner,
      name: identity.name,
      remoteName,
      remoteUrl,
      pushUrl,
    };
  }

  return null;
}

export async function resolveGitHubRepositoryIdentity(
  repoPath: string,
  fallbackRepoPath?: string,
): Promise<GitHubRepositoryIdentity> {
  const primaryIdentity = await findGitHubRepositoryIdentity(repoPath);
  if (primaryIdentity) {
    return primaryIdentity;
  }

  if (fallbackRepoPath && fallbackRepoPath !== repoPath) {
    const fallbackIdentity =
      await findGitHubRepositoryIdentity(fallbackRepoPath);
    if (fallbackIdentity) {
      return fallbackIdentity;
    }
  }

  throw new Error(
    "Repository does not have a GitHub remote. Add a GitHub remote before creating or monitoring pull requests.",
  );
}

export async function syncGitRemote(
  sourceRepoPath: string,
  targetRepoPath: string,
  remote: GitHubRepositoryIdentity,
): Promise<void> {
  if (sourceRepoPath === targetRepoPath) {
    return;
  }
  if (!remote.remoteUrl || !remote.pushUrl) {
    throw new Error(
      "GitHub remote synchronization requires both fetch and push URLs.",
    );
  }

  const targetRemotes = new Set(await listGitRemoteNames(targetRepoPath));
  if (targetRemotes.has(remote.remoteName)) {
    await runGit(targetRepoPath, [
      "remote",
      "set-url",
      remote.remoteName,
      remote.remoteUrl,
    ]);
  } else {
    await runGit(targetRepoPath, [
      "remote",
      "add",
      remote.remoteName,
      remote.remoteUrl,
    ]);
  }

  await runGit(targetRepoPath, [
    "remote",
    "set-url",
    "--push",
    remote.remoteName,
    remote.pushUrl,
  ]);
}

export function mapPullRequestState(value: unknown): PullRequestRef["state"] {
  switch (value) {
    case "OPEN":
      return "open";
    case "CLOSED":
      return "closed";
    case "MERGED":
      return "merged";
    default:
      return "unknown";
  }
}

export function mapReviewStatus(
  value: unknown,
): PullRequestRef["review_status"] {
  switch (value) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "REVIEW_REQUIRED":
      return "pending";
    default:
      return "unknown";
  }
}

export function parsePullRequestUrl(value: string): {
  owner: string;
  repo: string;
  number: number;
} {
  const match = value
    .trim()
    .match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/);
  if (!match) {
    throw new Error("GitHub CLI did not return a pull request URL");
  }

  return {
    owner: match[1] ?? "",
    repo: match[2] ?? "",
    number: Number.parseInt(match[3] ?? "", 10),
  };
}

export function isActiveLinkedPullRequest(
  linkedPr: TicketFrontmatter["linked_pr"],
): linkedPr is PullRequestRef {
  return (
    linkedPr !== null &&
    linkedPr.state !== "merged" &&
    linkedPr.state !== "closed"
  );
}

export function buildPullRequestBody(
  ticket: TicketFrontmatter,
  reviewPackage: ReviewPackage,
): string {
  const lines = [
    `WalleyBoard ticket #${ticket.id}`,
    "",
    reviewPackage.change_summary,
  ];

  if (ticket.acceptance_criteria.length > 0) {
    lines.push("", "Acceptance criteria:");
    for (const criterion of ticket.acceptance_criteria) {
      lines.push(`- ${criterion}`);
    }
  }

  if (reviewPackage.validation_results.length > 0) {
    lines.push("", "Validation:");
    for (const result of reviewPackage.validation_results) {
      lines.push(`- ${result.label}: ${result.status}`);
    }
  }

  if (reviewPackage.remaining_risks.length > 0) {
    lines.push("", "Remaining risks:");
    for (const risk of reviewPackage.remaining_risks) {
      lines.push(`- ${risk}`);
    }
  }

  return lines.join("\n");
}

function readReviewPackagePatch(reviewPackage: ReviewPackage): string {
  if (!isAbsolute(reviewPackage.diff_ref)) {
    throw new Error("Stored review diff artifact path is invalid");
  }

  if (!existsSync(reviewPackage.diff_ref)) {
    throw new Error("Stored review diff artifact is no longer available");
  }

  return readFileSync(reviewPackage.diff_ref, "utf8");
}

export function collectPullRequestTimelineContext(
  store: GitHubPullRequestPersistence,
  ticket: TicketFrontmatter,
  session: ExecutionSession,
  reviewPackage: ReviewPackage,
): PullRequestTimelineContext {
  return {
    attempts: store.listSessionAttempts(session.id),
    patch: readReviewPackagePatch(reviewPackage),
    reviewRuns: store.listReviewRuns(ticket.id),
    sessionLogs: store.getSessionLogs(session.id),
    ticketEvents: store.getTicketEvents(ticket.id),
  };
}

export function buildLinkedPullRequestRef(
  snapshot: PullRequestSnapshot,
  existing: PullRequestRef | null,
  overrides: Partial<PullRequestRef> = {},
): PullRequestRef {
  return {
    provider: "github",
    repo_owner: snapshot.owner,
    repo_name: snapshot.repo,
    number: snapshot.number,
    url: snapshot.url,
    head_branch: snapshot.headBranch,
    base_branch: snapshot.baseBranch,
    state: snapshot.state,
    review_status: snapshot.reviewStatus,
    head_sha: snapshot.headSha,
    changes_requested_by:
      snapshot.reviewStatus === "changes_requested"
        ? snapshot.changesRequestedBy
        : (existing?.changes_requested_by ?? null),
    last_changes_requested_head_sha:
      existing?.last_changes_requested_head_sha ?? null,
    last_reconciled_at: nowIso(),
    ...overrides,
  };
}

export function buildSnapshotFingerprint(
  snapshot: PullRequestSnapshot,
): string {
  return [
    snapshot.state,
    snapshot.reviewStatus,
    snapshot.headSha ?? "",
    snapshot.changesRequestedBy ?? "",
    snapshot.mergeable ?? "",
    snapshot.mergeStateStatus ?? "",
    snapshot.actionFailures
      .map((failure) =>
        [
          failure.kind,
          failure.name,
          failure.state ?? "",
          failure.conclusion ?? "",
        ].join(":"),
      )
      .join(","),
  ].join("|");
}

export function isMergeConflictBlocked(snapshot: PullRequestSnapshot): boolean {
  return (
    snapshot.mergeable === "CONFLICTING" ||
    snapshot.mergeStateStatus === "DIRTY"
  );
}

export function isActionFailureBlocked(snapshot: PullRequestSnapshot): boolean {
  return snapshot.actionFailures.length > 0;
}

export function buildMergeConflictNote(
  snapshot: PullRequestSnapshot,
  requestedChangesBody: string | null = null,
  actionFailuresBody: string | null = null,
): string {
  const lines = [
    `GitHub reported pull request #${snapshot.number} as conflict-blocked.`,
    `Head branch: ${snapshot.headBranch}`,
    `Base branch: ${snapshot.baseBranch}`,
  ];

  if (snapshot.mergeable) {
    lines.push(`mergeable: ${snapshot.mergeable}`);
  }
  if (snapshot.mergeStateStatus) {
    lines.push(`mergeStateStatus: ${snapshot.mergeStateStatus}`);
  }

  if (requestedChangesBody) {
    lines.push("", "Latest requested changes:", requestedChangesBody);
  }

  if (actionFailuresBody) {
    lines.push("", "Latest action failures:", actionFailuresBody);
  }

  lines.push(
    "Resume this ticket on the preserved worktree, resolve the merge conflicts, and push the repaired branch back to GitHub.",
  );

  return lines.join("\n");
}

export function buildMergeConflictResumeReason(
  snapshot: PullRequestSnapshot,
): string {
  return `GitHub marked pull request #${snapshot.number} as conflict-blocked. Resolve the merge conflicts in the preserved worktree and continue the same branch.`;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function extractActionFailures(
  commitsNode: Record<string, unknown> | null | undefined,
): PullRequestActionFailure[] {
  const commitNodes =
    commitsNode &&
    typeof commitsNode === "object" &&
    "nodes" in commitsNode &&
    Array.isArray((commitsNode as { nodes?: unknown }).nodes)
      ? (((commitsNode as { nodes?: unknown }).nodes ?? []) as Array<Record<
          string,
          unknown
        > | null>)
      : [];
  const latestCommit = commitNodes[0];
  const commit =
    latestCommit &&
    typeof latestCommit === "object" &&
    "commit" in latestCommit &&
    latestCommit.commit &&
    typeof latestCommit.commit === "object"
      ? (latestCommit.commit as Record<string, unknown>)
      : null;
  const rollup =
    commit &&
    "statusCheckRollup" in commit &&
    commit.statusCheckRollup &&
    typeof commit.statusCheckRollup === "object"
      ? (commit.statusCheckRollup as Record<string, unknown>)
      : null;
  const contextsNode =
    rollup &&
    "contexts" in rollup &&
    rollup.contexts &&
    typeof rollup.contexts === "object"
      ? (rollup.contexts as Record<string, unknown>)
      : null;
  const contexts =
    contextsNode &&
    "nodes" in contextsNode &&
    Array.isArray((contextsNode as { nodes?: unknown }).nodes)
      ? (((contextsNode as { nodes?: unknown }).nodes ?? []) as Array<
          GraphQlCheckRunContextNode | GraphQlStatusContextNode | null
        >)
      : [];
  const failures: PullRequestActionFailure[] = [];
  const failingConclusions = new Set([
    "FAILURE",
    "CANCELLED",
    "TIMED_OUT",
    "ACTION_REQUIRED",
    "STARTUP_FAILURE",
    "STALE",
  ]);

  for (const context of contexts) {
    if (!context || typeof context !== "object") {
      continue;
    }

    const typename =
      typeof context.__typename === "string" ? context.__typename : null;
    if (typename === "CheckRun") {
      const checkRun = context as NonNullable<GraphQlCheckRunContextNode>;
      const status = stringValue(checkRun.status);
      const conclusion = stringValue(checkRun.conclusion);
      if (
        status !== "COMPLETED" ||
        conclusion === null ||
        !failingConclusions.has(conclusion)
      ) {
        continue;
      }

      const annotationsNode =
        checkRun.annotations &&
        typeof checkRun.annotations === "object" &&
        "nodes" in checkRun.annotations &&
        Array.isArray((checkRun.annotations as { nodes?: unknown }).nodes)
          ? (((checkRun.annotations as { nodes?: unknown }).nodes ??
              []) as Array<GraphQlCheckRunAnnotationNode | null>)
          : [];

      failures.push({
        kind: "check_run",
        name: stringValue(checkRun.name) ?? "Unnamed check run",
        state: status,
        conclusion,
        detailsUrl: stringValue(checkRun.detailsUrl),
        summary: stringValue(checkRun.summary),
        text: stringValue(checkRun.text),
        description: null,
        targetUrl: null,
        annotations: annotationsNode
          .filter(
            (annotation): annotation is NonNullable<typeof annotation> =>
              annotation !== null && typeof annotation === "object",
          )
          .map((annotation) => ({
            title: stringValue(annotation.title),
            path: stringValue(annotation.path),
            startLine: numberValue(annotation.location?.start?.line),
            endLine: numberValue(annotation.location?.end?.line),
            startColumn: numberValue(annotation.location?.start?.column),
            endColumn: numberValue(annotation.location?.end?.column),
            message: stringValue(annotation.message),
            rawDetails: stringValue(annotation.rawDetails),
          })),
      });
      continue;
    }

    if (typename === "StatusContext") {
      const statusContext = context as NonNullable<GraphQlStatusContextNode>;
      const state = stringValue(statusContext.state);
      if (state !== "ERROR" && state !== "FAILURE") {
        continue;
      }

      failures.push({
        kind: "status_context",
        name: stringValue(statusContext.context) ?? "Unnamed status context",
        state,
        conclusion: null,
        detailsUrl: stringValue(statusContext.targetUrl),
        summary: null,
        text: null,
        description: stringValue(statusContext.description),
        targetUrl: stringValue(statusContext.targetUrl),
        annotations: [],
      });
    }
  }

  return failures;
}
