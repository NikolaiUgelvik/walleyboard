import { execFile } from "node:child_process";

import type {
  ExecutionSession,
  Project,
  PullRequestRef,
  RepositoryConfig,
  ReviewPackage,
  TicketFrontmatter,
} from "../../../../packages/contracts/src/index.js";

import { makeProtocolEvent } from "./event-hub.js";
import { resolveTargetBranch } from "./execution-runtime/helpers.js";
import {
  publishSessionOutput,
  publishSessionUpdated,
  publishTicketUpdated,
  shouldPublishPreExecutionSessionUpdate,
} from "./execution-runtime/publishers.js";
import type {
  DetailedRequestedChanges,
  GraphQlDiscussionCommentNode,
  GraphQlReviewNode,
  PullRequestSchedule,
  ReviewRouteDependencies,
} from "./github-pull-request-service-types.js";
import {
  buildRequestedChangesBody,
  extractLatestRequestedChangesReview,
} from "./github-requested-changes.js";
import { assertAiReviewNotRunning } from "./review-run-guard.js";
import type { GitHubPullRequestPersistence } from "./store.js";
import { nowIso } from "./time.js";
import {
  removeLocalBranch,
  removePreparedWorktree,
} from "./worktree-service.js";

type PullRequestSyncInput = {
  project: Project;
  repository: RepositoryConfig;
  reviewPackage: ReviewPackage;
  session: ExecutionSession;
  ticket: TicketFrontmatter;
};

type RunGhCommand = (args: string[], cwd: string) => Promise<string> | string;

type GitHubRepositoryIdentity = {
  owner: string;
  name: string;
  remoteName: string;
  remoteUrl?: string;
  pushUrl?: string;
};

type PullRequestSnapshot = {
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
};

const basePollIntervalMs = 10 * 60 * 1_000;
const maxPollIntervalMs = 60 * 60 * 1_000;
const schedulerIntervalMs = 60 * 1_000;
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

async function defaultRunGhCommand(
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

async function runGit(repoPath: string, args: string[]): Promise<string> {
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

async function resolvePullRequestBaseBranch(
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

async function resolveGitHubRepositoryIdentity(
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

async function syncGitRemote(
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

function mapPullRequestState(value: unknown): PullRequestRef["state"] {
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

function mapReviewStatus(value: unknown): PullRequestRef["review_status"] {
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

function parsePullRequestUrl(value: string): {
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

function isActiveLinkedPullRequest(
  linkedPr: TicketFrontmatter["linked_pr"],
): linkedPr is PullRequestRef {
  return (
    linkedPr !== null &&
    linkedPr.state !== "merged" &&
    linkedPr.state !== "closed"
  );
}

function buildPullRequestBody(
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

function buildLinkedPullRequestRef(
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

function buildSnapshotFingerprint(snapshot: PullRequestSnapshot): string {
  return [
    snapshot.state,
    snapshot.reviewStatus,
    snapshot.headSha ?? "",
    snapshot.changesRequestedBy ?? "",
  ].join("|");
}

function projectTicketPairs(store: GitHubPullRequestPersistence): Array<{
  project: Project;
  ticket: TicketFrontmatter;
}> {
  return store.listProjects().flatMap((project) =>
    store.listProjectTickets(project.id).map((ticket) => ({
      project,
      ticket,
    })),
  );
}

export class GitHubPullRequestService {
  readonly #dependencies: ReviewRouteDependencies;
  readonly #runGhCommand: RunGhCommand;
  readonly #schedules = new Map<number, PullRequestSchedule>();
  #backgroundReconcileInFlight = false;
  #timer: NodeJS.Timeout | null = null;

  constructor(
    dependencies: ReviewRouteDependencies,
    options?: {
      runGhCommand?: RunGhCommand;
    },
  ) {
    this.#dependencies = dependencies;
    this.#runGhCommand = options?.runGhCommand ?? defaultRunGhCommand;
  }

  start(): void {
    if (this.#timer) {
      return;
    }

    this.#timer = setInterval(() => {
      void this.#runBackgroundReconcile();
    }, schedulerIntervalMs);
  }

  stop(): void {
    if (!this.#timer) {
      return;
    }

    clearInterval(this.#timer);
    this.#timer = null;
  }

  async createPullRequest(ticketId: number): Promise<TicketFrontmatter> {
    const ticket = this.#requireTicket(ticketId);
    const session = this.#requireSession(ticket);
    const reviewPackage = this.#requireReviewPackage(ticketId);
    const repository = this.#requireRepository(ticket.repo);

    if (ticket.status !== "review") {
      throw new Error("Only review tickets can create pull requests");
    }
    if (!ticket.working_branch) {
      throw new Error("Ticket is missing a working branch");
    }
    if (!session.worktree_path) {
      throw new Error("Session has no prepared worktree");
    }
    if (isActiveLinkedPullRequest(ticket.linked_pr)) {
      throw new Error("Ticket already has an active linked pull request");
    }
    assertAiReviewNotRunning(this.#dependencies.store, ticketId);

    const githubRepository = await resolveGitHubRepositoryIdentity(
      session.worktree_path,
      repository.path,
    );
    const baseBranch = await resolvePullRequestBaseBranch(
      repository.path,
      resolveTargetBranch(repository, ticket.target_branch),
    );
    await syncGitRemote(
      repository.path,
      session.worktree_path,
      githubRepository,
    );
    await runGit(session.worktree_path, [
      "push",
      "--set-upstream",
      githubRepository.remoteName,
      ticket.working_branch,
    ]);

    const prUrl = await this.#runGhCommand(
      [
        "pr",
        "create",
        "--repo",
        `${githubRepository.owner}/${githubRepository.name}`,
        "--base",
        baseBranch,
        "--head",
        ticket.working_branch,
        "--title",
        ticket.title,
        "--body",
        buildPullRequestBody(ticket, reviewPackage),
      ],
      session.worktree_path,
    );
    const parsedUrl = parsePullRequestUrl(prUrl);
    const snapshot = await this.#fetchPullRequestSnapshot(
      session.worktree_path,
      {
        owner: parsedUrl.owner,
        name: parsedUrl.repo,
        remoteName: githubRepository.remoteName,
      },
      parsedUrl.number,
    );
    const linkedPr = buildLinkedPullRequestRef(snapshot, ticket.linked_pr);
    const updatedTicket = this.#dependencies.store.updateTicketLinkedPr(
      ticket.id,
      linkedPr,
    );

    this.#dependencies.store.recordTicketEvent(
      ticket.id,
      "pull_request.created",
      {
        ticket_id: ticket.id,
        number: linkedPr.number,
        url: linkedPr.url,
        head_branch: linkedPr.head_branch,
        base_branch: linkedPr.base_branch,
      },
    );
    this.#publishSessionOutput(
      session.id,
      session.current_attempt_id ?? session.id,
      `Created GitHub pull request #${linkedPr.number}: ${linkedPr.url}`,
    );
    publishTicketUpdated(this.#dependencies.eventHub, updatedTicket);
    this.#resetSchedule(ticket.id);

    return this.#requireTicket(ticket.id);
  }

  async reconcileTicket(ticketId: number): Promise<TicketFrontmatter> {
    const ticket = this.#requireTicket(ticketId);
    if (!ticket.linked_pr) {
      throw new Error("Ticket does not have a linked pull request");
    }

    await this.#reconcileTickets([ticket], true);
    return this.#requireTicket(ticketId);
  }

  async reconcileDuePullRequests(): Promise<void> {
    const dueTickets = projectTicketPairs(this.#dependencies.store)
      .map(({ ticket }) => ticket)
      .filter(
        (ticket) =>
          ticket.status === "review" &&
          isActiveLinkedPullRequest(ticket.linked_pr),
      )
      .filter((ticket) => this.#isTicketDue(ticket.id));

    if (dueTickets.length === 0) {
      return;
    }

    await this.#reconcileTickets(dueTickets, false);
  }

  async handleReviewReady(input: PullRequestSyncInput): Promise<void> {
    const linkedPr = input.ticket.linked_pr;
    if (!isActiveLinkedPullRequest(linkedPr) || !input.session.worktree_path) {
      return;
    }

    const currentHead = await runGit(input.session.worktree_path, [
      "rev-parse",
      "HEAD",
    ]);
    const needsPush = currentHead !== linkedPr.head_sha;
    const needsReviewRequest =
      typeof linkedPr.changes_requested_by === "string" &&
      linkedPr.changes_requested_by.length > 0;

    if (!needsPush && !needsReviewRequest) {
      return;
    }

    const githubRepository = await resolveGitHubRepositoryIdentity(
      input.session.worktree_path,
      input.repository.path,
    );
    await syncGitRemote(
      input.repository.path,
      input.session.worktree_path,
      githubRepository,
    );

    if (needsPush) {
      try {
        await runGit(input.session.worktree_path, [
          "push",
          githubRepository.remoteName,
          linkedPr.head_branch,
        ]);
        this.#publishSessionOutput(
          input.session.id,
          input.session.current_attempt_id ?? input.session.id,
          `Pushed follow-up commits to ${githubRepository.remoteName}/${linkedPr.head_branch}`,
        );
      } catch (error) {
        this.#publishSessionOutput(
          input.session.id,
          input.session.current_attempt_id ?? input.session.id,
          `[pull request sync warning] ${
            error instanceof Error
              ? error.message
              : "Unable to push follow-up commits"
          }`,
        );
        return;
      }
    }

    let reviewRequestSucceeded = false;
    if (needsReviewRequest) {
      try {
        await this.#runGhCommand(
          [
            "pr",
            "edit",
            String(linkedPr.number),
            "--repo",
            `${linkedPr.repo_owner}/${linkedPr.repo_name}`,
            "--add-reviewer",
            linkedPr.changes_requested_by ?? "",
          ],
          input.session.worktree_path,
        );
        reviewRequestSucceeded = true;
        this.#publishSessionOutput(
          input.session.id,
          input.session.current_attempt_id ?? input.session.id,
          `Re-requested review from @${linkedPr.changes_requested_by}`,
        );
      } catch (error) {
        this.#publishSessionOutput(
          input.session.id,
          input.session.current_attempt_id ?? input.session.id,
          `[pull request sync warning] ${
            error instanceof Error
              ? error.message
              : "Unable to re-request GitHub review"
          }`,
        );
      }
    }

    const snapshot = await this.#fetchPullRequestSnapshot(
      input.session.worktree_path,
      {
        owner: linkedPr.repo_owner,
        name: linkedPr.repo_name,
        remoteName: githubRepository.remoteName,
      },
      linkedPr.number,
    );
    const updatedTicket = this.#dependencies.store.updateTicketLinkedPr(
      input.ticket.id,
      buildLinkedPullRequestRef(snapshot, linkedPr, {
        head_sha: currentHead,
        review_status: reviewRequestSucceeded
          ? "pending"
          : snapshot.reviewStatus,
        changes_requested_by: reviewRequestSucceeded
          ? null
          : linkedPr.changes_requested_by,
      }),
    );
    publishTicketUpdated(this.#dependencies.eventHub, updatedTicket);
    this.#resetSchedule(input.ticket.id);
  }

  async #reconcileTickets(
    tickets: TicketFrontmatter[],
    manual: boolean,
  ): Promise<void> {
    const batches = new Map<string, TicketFrontmatter[]>();

    for (const ticket of tickets) {
      const linkedPr = ticket.linked_pr;
      if (!isActiveLinkedPullRequest(linkedPr)) {
        this.#clearSchedule(ticket.id);
        continue;
      }

      const key = `${linkedPr.repo_owner}/${linkedPr.repo_name}`;
      const existing = batches.get(key);
      if (existing) {
        existing.push(ticket);
      } else {
        batches.set(key, [ticket]);
      }
    }

    for (const batch of batches.values()) {
      await this.#reconcileRepositoryBatch(batch, manual);
    }
  }

  async #reconcileRepositoryBatch(
    tickets: TicketFrontmatter[],
    manual: boolean,
  ): Promise<void> {
    const firstTicket = tickets[0];
    if (!firstTicket) {
      return;
    }

    const firstLinkedPr = firstTicket.linked_pr;
    if (!isActiveLinkedPullRequest(firstLinkedPr)) {
      return;
    }

    const repository = this.#requireRepository(firstTicket.repo);
    const session = firstTicket.session_id
      ? this.#dependencies.store.getSession(firstTicket.session_id)
      : null;
    const cwd = session?.worktree_path ?? repository.path;
    const githubRepository = await resolveGitHubRepositoryIdentity(
      cwd,
      repository.path,
    );
    const snapshots = await this.#fetchPullRequestSnapshots(
      cwd,
      {
        owner: firstLinkedPr.repo_owner,
        name: firstLinkedPr.repo_name,
        remoteName: githubRepository.remoteName,
      },
      tickets.flatMap((ticket) =>
        ticket.linked_pr ? [ticket.linked_pr.number] : [],
      ),
    );

    for (const ticket of tickets) {
      const linkedPr = ticket.linked_pr;
      if (!isActiveLinkedPullRequest(linkedPr)) {
        this.#clearSchedule(ticket.id);
        continue;
      }

      const snapshot = snapshots.get(linkedPr.number);
      if (!snapshot) {
        continue;
      }

      await this.#reconcileSingleTicket(ticket, snapshot, manual);
    }
  }

  async #reconcileSingleTicket(
    ticket: TicketFrontmatter,
    snapshot: PullRequestSnapshot,
    manual: boolean,
  ): Promise<void> {
    const existingLinkedPr = ticket.linked_pr;
    if (!existingLinkedPr) {
      this.#clearSchedule(ticket.id);
      return;
    }

    if (snapshot.state === "merged") {
      await this.#handleMergedPullRequest(ticket, snapshot);
      return;
    }

    if (
      snapshot.reviewStatus === "changes_requested" &&
      snapshot.headSha &&
      existingLinkedPr.last_changes_requested_head_sha !== snapshot.headSha
    ) {
      await this.#handleRequestedChanges(ticket, snapshot);
      return;
    }

    const updatedTicket = this.#dependencies.store.updateTicketLinkedPr(
      ticket.id,
      buildLinkedPullRequestRef(snapshot, existingLinkedPr, {
        changes_requested_by:
          snapshot.reviewStatus === "changes_requested"
            ? snapshot.changesRequestedBy
            : existingLinkedPr.changes_requested_by,
      }),
    );
    publishTicketUpdated(this.#dependencies.eventHub, updatedTicket);
    this.#advanceSchedule(
      ticket.id,
      buildSnapshotFingerprint(snapshot),
      manual,
    );
  }

  async #handleMergedPullRequest(
    ticket: TicketFrontmatter,
    snapshot: PullRequestSnapshot,
  ): Promise<void> {
    const session = this.#requireSession(ticket);
    const project = this.#requireProject(ticket.project);
    const repository = this.#requireRepository(ticket.repo);
    const attemptId = session.current_attempt_id ?? session.id;
    const cleanupWarnings: string[] = [];
    const logLines = [
      `GitHub pull request #${snapshot.number} was merged: ${snapshot.url}`,
    ];
    let deferredWorktreeCleanup = false;
    let skipLocalBranchCleanup = false;
    let workspaceRetired = false;

    try {
      await this.#dependencies.ticketWorkspaceService.stopPreviewAndWait(
        ticket.id,
      );
    } catch (error) {
      cleanupWarnings.push(
        error instanceof Error
          ? error.message
          : "Unable to stop preview before cleanup",
      );
    }

    if (session.worktree_path) {
      try {
        this.#dependencies.executionRuntime.closeWorkspaceTerminals(
          session.id,
          "This workspace terminal closed because the ticket worktree was cleaned up after merge.",
        );
        const worktreeRemoval = removePreparedWorktree(
          repository,
          session.worktree_path,
          project.post_worktree_command,
          ticket.working_branch ?? undefined,
        );
        if (worktreeRemoval.status === "scheduled") {
          deferredWorktreeCleanup = true;
          skipLocalBranchCleanup = true;
        }
        workspaceRetired = true;
        logLines.push(
          worktreeRemoval.status === "scheduled"
            ? `Scheduled worktree removal for ${session.worktree_path} after the post-worktree command finishes`
            : `Removed worktree ${session.worktree_path}`,
        );
      } catch (error) {
        cleanupWarnings.push(
          error instanceof Error ? error.message : "Unable to remove worktree",
        );
      }
    }

    if (!skipLocalBranchCleanup && ticket.working_branch) {
      try {
        removeLocalBranch(repository, ticket.working_branch);
        logLines.push(`Deleted local branch ${ticket.working_branch}`);
      } catch (error) {
        cleanupWarnings.push(
          error instanceof Error
            ? error.message
            : "Unable to delete local branch",
        );
      }
    }

    const doneTicket = this.#dependencies.store.updateTicketStatus(
      ticket.id,
      "done",
    );
    const finalTicket = this.#dependencies.store.updateTicketLinkedPr(
      ticket.id,
      buildLinkedPullRequestRef(snapshot, ticket.linked_pr, {
        state: "merged",
        changes_requested_by: null,
      }),
    );
    const summary =
      cleanupWarnings.length === 0
        ? deferredWorktreeCleanup
          ? `GitHub merged ${ticket.working_branch ?? "the review branch"}. Worktree cleanup is continuing in the background.`
          : `GitHub merged ${ticket.working_branch ?? "the review branch"} and local cleanup finished.`
        : `GitHub merged ${ticket.working_branch ?? "the review branch"}, but cleanup needs attention: ${cleanupWarnings.join(
            " | ",
          )}`;
    const completedSession = this.#dependencies.store.updateSessionStatus(
      session.id,
      "completed",
      summary,
    );
    const finalSession =
      workspaceRetired && completedSession
        ? (this.#dependencies.store.updateSessionWorktreePath(
            session.id,
            null,
          ) ?? completedSession)
        : completedSession;

    this.#dependencies.store.recordTicketEvent(
      ticket.id,
      "pull_request.merged",
      {
        ticket_id: ticket.id,
        number: snapshot.number,
        url: snapshot.url,
        cleanup_warnings: cleanupWarnings,
      },
    );

    for (const line of [
      ...logLines,
      ...cleanupWarnings.map((warning) => `Cleanup warning: ${warning}`),
    ]) {
      this.#publishSessionOutput(session.id, attemptId, line);
    }

    publishSessionUpdated(
      this.#dependencies.eventHub,
      finalSession,
      finalSession
        ? this.#dependencies.executionRuntime.hasActiveExecution(
            finalSession.id,
          )
        : false,
    );
    publishTicketUpdated(
      this.#dependencies.eventHub,
      finalTicket ?? doneTicket,
    );
    await this.#dependencies.ticketWorkspaceService.disposeTicket(ticket.id);
    this.#clearSchedule(ticket.id);
  }

  async #handleRequestedChanges(
    ticket: TicketFrontmatter,
    snapshot: PullRequestSnapshot,
  ): Promise<void> {
    const session = this.#requireSession(ticket);
    const project = this.#requireProject(ticket.project);
    const repository = this.#requireRepository(ticket.repo);
    this.#dependencies.executionRuntime.assertProjectExecutionBackendAvailable(
      project,
    );
    const githubRepository = await resolveGitHubRepositoryIdentity(
      session.worktree_path ?? repository.path,
      repository.path,
    );
    const detailedReview = await this.#fetchDetailedRequestedChanges(
      session.worktree_path ?? repository.path,
      {
        owner: snapshot.owner,
        name: snapshot.repo,
        remoteName: githubRepository.remoteName,
      },
      snapshot.number,
    );
    const requestBody = buildRequestedChangesBody(
      ticket,
      buildLinkedPullRequestRef(snapshot, ticket.linked_pr),
      detailedReview,
    );
    const restartResult = this.#dependencies.store.requestTicketChanges(
      ticket.id,
      requestBody,
      "system",
    );
    const updatedTicket = this.#dependencies.store.updateTicketLinkedPr(
      ticket.id,
      buildLinkedPullRequestRef(snapshot, ticket.linked_pr, {
        review_status: "changes_requested",
        changes_requested_by:
          detailedReview.reviewerLogin ?? snapshot.changesRequestedBy,
        last_changes_requested_head_sha: snapshot.headSha,
      }),
    );

    publishTicketUpdated(this.#dependencies.eventHub, updatedTicket);
    if (shouldPublishPreExecutionSessionUpdate(restartResult.session)) {
      publishSessionUpdated(
        this.#dependencies.eventHub,
        restartResult.session,
        this.#dependencies.executionRuntime.hasActiveExecution(
          restartResult.session.id,
        ),
      );
    }
    this.#publishExistingLogs(
      restartResult.session.id,
      restartResult.attempt.id,
      restartResult.logs,
    );

    this.#dependencies.executionRuntime.startExecution({
      project,
      repository,
      ticket: this.#requireTicket(ticket.id),
      session: restartResult.session,
    });
    this.#clearSchedule(ticket.id);
  }

  async #fetchPullRequestSnapshots(
    cwd: string,
    repository: GitHubRepositoryIdentity,
    numbers: number[],
  ): Promise<Map<number, PullRequestSnapshot>> {
    const aliases = numbers
      .map(
        (number) => `
          pr_${number}: pullRequest(number: ${number}) {
            number
            url
            state
            reviewDecision
            headRefName
            baseRefName
            headRefOid
            reviews(last: 20) {
              nodes {
                state
                submittedAt
                author {
                  login
                }
              }
            }
          }
        `,
      )
      .join("\n");
    const query = `
      query {
        repository(owner: ${JSON.stringify(repository.owner)}, name: ${JSON.stringify(repository.name)}) {
          ${aliases}
        }
      }
    `;
    const response = await this.#runGraphQl<{
      data?: {
        repository?: Record<string, unknown> | null;
      } | null;
    }>(cwd, query);
    const repositoryData = response.data?.repository ?? {};
    const snapshots = new Map<number, PullRequestSnapshot>();

    for (const number of numbers) {
      const node = repositoryData[`pr_${number}`] as
        | Record<string, unknown>
        | null
        | undefined;
      if (!node) {
        continue;
      }

      const reviews =
        node.reviews &&
        typeof node.reviews === "object" &&
        "nodes" in node.reviews &&
        Array.isArray((node.reviews as { nodes?: unknown }).nodes)
          ? (((node.reviews as { nodes?: unknown }).nodes ??
              []) as GraphQlReviewNode[])
          : [];
      const detailedReview = extractLatestRequestedChangesReview(reviews);

      snapshots.set(number, {
        owner: repository.owner,
        repo: repository.name,
        number,
        url: typeof node.url === "string" ? node.url : "",
        headBranch:
          typeof node.headRefName === "string" ? node.headRefName : "",
        baseBranch:
          typeof node.baseRefName === "string" ? node.baseRefName : "",
        state: mapPullRequestState(node.state),
        reviewStatus: mapReviewStatus(node.reviewDecision),
        headSha:
          typeof node.headRefOid === "string" && node.headRefOid.length > 0
            ? node.headRefOid
            : null,
        changesRequestedBy: detailedReview.reviewerLogin,
      });
    }

    return snapshots;
  }

  async #fetchPullRequestSnapshot(
    cwd: string,
    repository: GitHubRepositoryIdentity,
    number: number,
  ): Promise<PullRequestSnapshot> {
    const snapshot = (
      await this.#fetchPullRequestSnapshots(cwd, repository, [number])
    ).get(number);
    if (!snapshot) {
      throw new Error(`Unable to load GitHub pull request #${number}`);
    }

    return snapshot;
  }

  async #fetchDetailedRequestedChanges(
    cwd: string,
    repository: GitHubRepositoryIdentity,
    number: number,
  ): Promise<DetailedRequestedChanges> {
    const query = `
      query {
        repository(owner: ${JSON.stringify(repository.owner)}, name: ${JSON.stringify(repository.name)}) {
          pullRequest(number: ${number}) {
            reviews(last: 20) {
              nodes {
                state
                submittedAt
                body
                author {
                  login
                }
                comments(first: 50) {
                  nodes {
                    body
                    path
                    line
                  }
                }
              }
            }
            comments(last: 50) {
              nodes {
                body
                createdAt
                isMinimized
                author {
                  login
                }
              }
            }
          }
        }
      }
    `;
    const response = await this.#runGraphQl<{
      data?: {
        repository?: {
          pullRequest?: {
            reviews?: {
              nodes?: GraphQlReviewNode[];
            } | null;
            comments?: {
              nodes?: GraphQlDiscussionCommentNode[];
            } | null;
          } | null;
        } | null;
      } | null;
    }>(cwd, query);
    const reviews =
      response.data?.repository?.pullRequest?.reviews?.nodes ?? [];
    const discussionComments =
      response.data?.repository?.pullRequest?.comments?.nodes ?? [];

    return extractLatestRequestedChangesReview(reviews, discussionComments);
  }

  async #runGraphQl<T>(cwd: string, query: string): Promise<T> {
    const raw = await this.#runGhCommand(
      ["api", "graphql", "-f", `query=${query}`],
      cwd,
    );
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to parse GraphQL response";
      throw new Error(`GitHub returned invalid JSON: ${message}`);
    }
  }

  #publishSessionOutput(
    sessionId: string,
    attemptId: string,
    line: string,
  ): void {
    publishSessionOutput(
      this.#dependencies.eventHub,
      this.#dependencies.store,
      sessionId,
      attemptId,
      line,
    );
  }

  #publishExistingLogs(
    sessionId: string,
    attemptId: string,
    lines: string[],
  ): void {
    const totalLogCount =
      this.#dependencies.store.getSessionLogs(sessionId).length;
    const startSequence = totalLogCount - lines.length;

    lines.forEach((line, index) => {
      this.#dependencies.eventHub.publish(
        makeProtocolEvent("session.output", "session", sessionId, {
          session_id: sessionId,
          attempt_id: attemptId,
          sequence: startSequence + index,
          chunk: line,
        }),
      );
    });
  }

  #isTicketDue(ticketId: number): boolean {
    const schedule = this.#schedules.get(ticketId);
    if (!schedule) {
      return true;
    }

    return Date.now() >= schedule.nextRunAt;
  }

  #resetSchedule(ticketId: number): void {
    this.#schedules.set(ticketId, {
      intervalMs: basePollIntervalMs,
      nextRunAt: Date.now() + basePollIntervalMs,
      fingerprint: null,
    });
  }

  #advanceSchedule(
    ticketId: number,
    fingerprint: string,
    _manual: boolean,
  ): void {
    const existing = this.#schedules.get(ticketId);
    if (!existing || existing.fingerprint !== fingerprint) {
      this.#schedules.set(ticketId, {
        intervalMs: basePollIntervalMs,
        nextRunAt: Date.now() + basePollIntervalMs,
        fingerprint,
      });
      return;
    }

    const nextInterval = Math.min(existing.intervalMs * 2, maxPollIntervalMs);
    this.#schedules.set(ticketId, {
      intervalMs: nextInterval,
      nextRunAt: Date.now() + nextInterval,
      fingerprint,
    });
  }

  #clearSchedule(ticketId: number): void {
    this.#schedules.delete(ticketId);
  }

  async #runBackgroundReconcile(): Promise<void> {
    if (this.#backgroundReconcileInFlight) {
      return;
    }

    this.#backgroundReconcileInFlight = true;
    try {
      await this.reconcileDuePullRequests();
    } catch (error) {
      console.warn(
        `[github-pr-sync] Background reconcile failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.#backgroundReconcileInFlight = false;
    }
  }

  #requireTicket(ticketId: number): TicketFrontmatter {
    const ticket = this.#dependencies.store.getTicket(ticketId);
    if (!ticket) {
      throw new Error("Ticket not found");
    }

    return ticket;
  }

  #requireSession(ticket: TicketFrontmatter): ExecutionSession {
    if (!ticket.session_id) {
      throw new Error("Ticket has no execution session");
    }

    const session = this.#dependencies.store.getSession(ticket.session_id);
    if (!session) {
      throw new Error("Session not found");
    }

    return session;
  }

  #requireProject(projectId: string): Project {
    const project = this.#dependencies.store.getProject(projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    return project;
  }

  #requireRepository(repositoryId: string): RepositoryConfig {
    const repository = this.#dependencies.store.getRepository(repositoryId);
    if (!repository) {
      throw new Error("Repository not found");
    }

    return repository;
  }

  #requireReviewPackage(ticketId: number): ReviewPackage {
    const reviewPackage = this.#dependencies.store.getReviewPackage(ticketId);
    if (!reviewPackage) {
      throw new Error(
        "Review package is required before creating a pull request",
      );
    }

    return reviewPackage;
  }
}
