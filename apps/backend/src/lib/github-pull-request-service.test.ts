import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ReviewPackage } from "../../../../packages/contracts/src/index.js";

import { EventHub } from "./event-hub.js";
import { GitHubPullRequestService } from "./github-pull-request-service.js";
import { SqliteStore } from "./sqlite-store.js";
import { prepareWorktree } from "./worktree-service.js";

function setWalleyBoardHome(path: string): () => void {
  const previous = process.env.WALLEYBOARD_HOME;
  process.env.WALLEYBOARD_HOME = path;
  return () => {
    if (previous === undefined) {
      process.env.WALLEYBOARD_HOME = undefined;
      return;
    }

    process.env.WALLEYBOARD_HOME = previous;
  };
}

function runGit(repoPath: string, args: string[]): string {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function configureGitIdentity(repoPath: string): void {
  runGit(repoPath, ["config", "user.name", "Test User"]);
  runGit(repoPath, ["config", "user.email", "test@example.com"]);
}

function createTicketFixture(tempDir: string) {
  const remotePath = join(tempDir, "remote.git");
  const repoPath = join(tempDir, "repo");

  execFileSync("git", ["init", "--bare", remotePath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  execFileSync("git", ["clone", remotePath, repoPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  configureGitIdentity(repoPath);

  writeFileSync(join(repoPath, "base.txt"), "base\n", "utf8");
  runGit(repoPath, ["add", "base.txt"]);
  runGit(repoPath, ["commit", "-m", "initial"]);
  runGit(repoPath, ["branch", "-M", "main"]);
  runGit(repoPath, ["push", "-u", "origin", "main"]);

  const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
  const { project, repository } = store.createProject({
    name: "GitHub PR Project",
    repository: {
      name: "repo",
      path: repoPath,
      target_branch: "main",
    },
  });
  const draft = store.createDraft({
    project_id: project.id,
    title: "Ship the PR workflow",
    description: "Handle GitHub review and follow-up changes.",
  });
  const ticket = store.confirmDraft(draft.id, {
    title: "Ship the PR workflow",
    description: "Handle GitHub review and follow-up changes.",
    repo_id: repository.id,
    ticket_type: "feature",
    acceptance_criteria: ["Keep review automation on the same worktree."],
    target_branch: "main",
  });
  const runtime = prepareWorktree(project, repository, ticket);
  const started = store.startTicket(ticket.id, false, runtime);

  writeFileSync(join(runtime.worktreePath, "feature.txt"), "one\n", "utf8");
  runGit(runtime.worktreePath, ["add", "feature.txt"]);
  runGit(runtime.worktreePath, ["commit", "-m", "feature work"]);

  store.updateSessionStatus(
    started.session.id,
    "completed",
    "Ready for review.",
  );
  store.updateTicketStatus(ticket.id, "review");

  const reviewPackage = store.createReviewPackage({
    ticket_id: ticket.id,
    session_id: started.session.id,
    diff_ref: join(tempDir, "ticket.patch"),
    commit_refs: [runGit(runtime.worktreePath, ["rev-parse", "HEAD"])],
    change_summary: "Implements the feature and prepares review output.",
    validation_results: [],
    remaining_risks: [],
  });

  runGit(repoPath, [
    "remote",
    "set-url",
    "origin",
    "git@github.com:acme/repo.git",
  ]);
  runGit(repoPath, ["remote", "set-url", "--push", "origin", remotePath]);

  return {
    project,
    remotePath,
    repository,
    reviewPackage,
    runtime,
    session: started.session,
    store,
    ticket: store.getTicket(ticket.id),
  };
}

function createService(
  store: SqliteStore,
  runGhCommand: (args: string[], cwd: string) => string,
  options?: {
    onStartExecution?: (input: {
      sessionId: string;
      ticketId: number;
      worktreePath: string | null;
    }) => void;
    stopPreviewAndWait?: (ticketId: number) => Promise<void>;
    disposeTicket?: (ticketId: number) => Promise<void>;
  },
) {
  const executionStarts: Array<{
    sessionId: string;
    ticketId: number;
    worktreePath: string | null;
  }> = [];
  const previewStops: number[] = [];
  const disposedTickets: number[] = [];
  const executionRuntime = {
    startExecution(input: {
      session: { id: string; worktree_path: string | null };
      ticket: { id: number };
    }) {
      const nextStart = {
        sessionId: input.session.id,
        ticketId: input.ticket.id,
        worktreePath: input.session.worktree_path,
      };
      executionStarts.push(nextStart);
      options?.onStartExecution?.(nextStart);
    },
  };
  const ticketWorkspaceService = {
    async stopPreviewAndWait(ticketId: number) {
      previewStops.push(ticketId);
      await options?.stopPreviewAndWait?.(ticketId);
    },
    async disposeTicket(ticketId: number) {
      disposedTickets.push(ticketId);
      await options?.disposeTicket?.(ticketId);
    },
  };

  return {
    disposedTickets,
    executionStarts,
    previewStops,
    service: new GitHubPullRequestService(
      {
        eventHub: new EventHub(),
        executionRuntime: executionRuntime as never,
        store,
        ticketWorkspaceService: ticketWorkspaceService as never,
      },
      {
        runGhCommand,
      },
    ),
  };
}

function dequeueGhResponse(
  responses: Array<{
    assertArgs?: (args: string[]) => void;
    output: string;
  }>,
): (args: string[], cwd: string) => string {
  return (args, _cwd) => {
    const next = responses.shift();
    assert.ok(next, `Unexpected gh call: ${args.join(" ")}`);
    next.assertArgs?.(args);
    return next.output;
  };
}

test("createPullRequest pushes the branch, creates the PR, and links it to the ticket", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-gh-create-pr-"));
  const restoreWalleyBoardHome = setWalleyBoardHome(join(tempDir, ".home"));

  try {
    const fixture = createTicketFixture(tempDir);
    assert.ok(fixture.ticket);

    const ghCalls: string[][] = [];
    const { service } = createService(
      fixture.store,
      dequeueGhResponse([
        {
          assertArgs: (args) => {
            ghCalls.push(args);
            assert.equal(args[0], "pr");
            assert.equal(args[1], "create");
          },
          output: "https://github.com/acme/repo/pull/12",
        },
        {
          assertArgs: (args) => {
            ghCalls.push(args);
            assert.equal(args[0], "api");
            assert.equal(args[1], "graphql");
          },
          output: JSON.stringify({
            data: {
              repository: {
                pr_12: {
                  number: 12,
                  url: "https://github.com/acme/repo/pull/12",
                  state: "OPEN",
                  reviewDecision: "REVIEW_REQUIRED",
                  headRefName: fixture.ticket.working_branch,
                  baseRefName: fixture.ticket.target_branch,
                  headRefOid: runGit(fixture.runtime.worktreePath, [
                    "rev-parse",
                    "HEAD",
                  ]),
                  reviews: {
                    nodes: [],
                  },
                },
              },
            },
          }),
        },
      ]),
    );

    const updatedTicket = await service.createPullRequest(fixture.ticket.id);

    assert.equal(updatedTicket.status, "review");
    assert.equal(updatedTicket.linked_pr?.number, 12);
    assert.equal(updatedTicket.linked_pr?.review_status, "pending");
    assert.equal(updatedTicket.linked_pr?.state, "open");
    assert.equal(
      runGit(fixture.remotePath, [
        "show-ref",
        "--verify",
        `refs/heads/${fixture.ticket.working_branch}`,
      ]).length > 0,
      true,
    );
    assert.equal(ghCalls.length, 2);
  } finally {
    restoreWalleyBoardHome();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("reconcileTicket marks merged pull requests done and cleans up local artifacts", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-gh-merged-pr-"));
  const restoreWalleyBoardHome = setWalleyBoardHome(join(tempDir, ".home"));

  try {
    const fixture = createTicketFixture(tempDir);
    assert.ok(fixture.ticket);
    fixture.store.updateTicketLinkedPr(fixture.ticket.id, {
      provider: "github",
      repo_owner: "acme",
      repo_name: "repo",
      number: 18,
      url: "https://github.com/acme/repo/pull/18",
      head_branch: fixture.ticket.working_branch ?? "feature",
      base_branch: fixture.ticket.target_branch,
      state: "open",
      review_status: "pending",
      head_sha: runGit(fixture.runtime.worktreePath, ["rev-parse", "HEAD"]),
      changes_requested_by: null,
      last_changes_requested_head_sha: null,
      last_reconciled_at: null,
    });

    const { disposedTickets, previewStops, service } = createService(
      fixture.store,
      dequeueGhResponse([
        {
          output: JSON.stringify({
            data: {
              repository: {
                pr_18: {
                  number: 18,
                  url: "https://github.com/acme/repo/pull/18",
                  state: "MERGED",
                  reviewDecision: "APPROVED",
                  headRefName: fixture.ticket.working_branch,
                  baseRefName: fixture.ticket.target_branch,
                  headRefOid: runGit(fixture.runtime.worktreePath, [
                    "rev-parse",
                    "HEAD",
                  ]),
                  reviews: {
                    nodes: [],
                  },
                },
              },
            },
          }),
        },
      ]),
    );

    await service.reconcileTicket(fixture.ticket.id);

    const updatedTicket = fixture.store.getTicket(fixture.ticket.id);
    assert.equal(updatedTicket?.status, "done");
    assert.equal(updatedTicket?.linked_pr?.state, "merged");
    assert.equal(existsSync(fixture.runtime.worktreePath), false);
    assert.equal(
      runGit(fixture.repository.path, [
        "branch",
        "--list",
        fixture.ticket.working_branch ?? "",
      ]).trim().length,
      0,
    );
    assert.deepEqual(previewStops, [fixture.ticket.id]);
    assert.deepEqual(disposedTickets, [fixture.ticket.id]);
  } finally {
    restoreWalleyBoardHome();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("changes requested resumes the same session and follow-up sync pushes commits back to the PR", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-gh-requested-"));
  const restoreWalleyBoardHome = setWalleyBoardHome(join(tempDir, ".home"));

  try {
    const fixture = createTicketFixture(tempDir);
    assert.ok(fixture.ticket);
    const originalHead = runGit(fixture.runtime.worktreePath, [
      "rev-parse",
      "HEAD",
    ]);
    fixture.store.updateTicketLinkedPr(fixture.ticket.id, {
      provider: "github",
      repo_owner: "acme",
      repo_name: "repo",
      number: 27,
      url: "https://github.com/acme/repo/pull/27",
      head_branch: fixture.ticket.working_branch ?? "feature",
      base_branch: fixture.ticket.target_branch,
      state: "open",
      review_status: "pending",
      head_sha: originalHead,
      changes_requested_by: null,
      last_changes_requested_head_sha: null,
      last_reconciled_at: null,
    });

    const ghCalls: string[][] = [];
    const { executionStarts, service } = createService(
      fixture.store,
      dequeueGhResponse([
        {
          assertArgs: (args) => {
            ghCalls.push(args);
            assert.equal(args[0], "api");
          },
          output: JSON.stringify({
            data: {
              repository: {
                pr_27: {
                  number: 27,
                  url: "https://github.com/acme/repo/pull/27",
                  state: "OPEN",
                  reviewDecision: "CHANGES_REQUESTED",
                  headRefName: fixture.ticket.working_branch,
                  baseRefName: fixture.ticket.target_branch,
                  headRefOid: originalHead,
                  reviews: {
                    nodes: [
                      {
                        state: "CHANGES_REQUESTED",
                        submittedAt: "2026-04-02T10:00:00.000Z",
                        author: {
                          login: "reviewer1",
                        },
                      },
                    ],
                  },
                },
              },
            },
          }),
        },
        {
          assertArgs: (args) => {
            ghCalls.push(args);
            assert.equal(args[0], "api");
          },
          output: JSON.stringify({
            data: {
              repository: {
                pullRequest: {
                  reviews: {
                    nodes: [
                      {
                        state: "CHANGES_REQUESTED",
                        submittedAt: "2026-04-02T10:00:00.000Z",
                        body: "Please tighten the follow-up path.",
                        author: {
                          login: "reviewer1",
                        },
                        comments: {
                          nodes: [
                            {
                              body: "Handle the resumed PR flow here.",
                              path: "src/review.ts",
                              line: 42,
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            },
          }),
        },
        {
          assertArgs: (args) => {
            ghCalls.push(args);
            assert.equal(args[0], "pr");
            assert.equal(args[1], "edit");
            assert.equal(args[6], "reviewer1");
          },
          output: "",
        },
        {
          assertArgs: (args) => {
            ghCalls.push(args);
            assert.equal(args[0], "api");
          },
          output: JSON.stringify({
            data: {
              repository: {
                pr_27: {
                  number: 27,
                  url: "https://github.com/acme/repo/pull/27",
                  state: "OPEN",
                  reviewDecision: "REVIEW_REQUIRED",
                  headRefName: fixture.ticket.working_branch,
                  baseRefName: fixture.ticket.target_branch,
                  headRefOid: "",
                  reviews: {
                    nodes: [],
                  },
                },
              },
            },
          }),
        },
      ]),
    );

    await service.reconcileTicket(fixture.ticket.id);

    const restartedTicket = fixture.store.getTicket(fixture.ticket.id);
    const restartedSession = fixture.store.getSession(fixture.session.id);
    assert.equal(restartedTicket?.status, "in_progress");
    assert.equal(
      restartedTicket?.linked_pr?.review_status,
      "changes_requested",
    );
    assert.equal(restartedTicket?.linked_pr?.changes_requested_by, "reviewer1");
    assert.equal(
      restartedTicket?.linked_pr?.last_changes_requested_head_sha,
      originalHead,
    );
    assert.equal(restartedSession?.id, fixture.session.id);
    assert.equal(restartedSession?.worktree_path, fixture.runtime.worktreePath);
    assert.equal(executionStarts.length, 1);
    assert.deepEqual(executionStarts[0], {
      sessionId: fixture.session.id,
      ticketId: fixture.ticket.id,
      worktreePath: fixture.runtime.worktreePath,
    });
    const requestedChangeBody =
      restartedSession?.latest_requested_change_note_id
        ? fixture.store.getRequestedChangeNote(
            restartedSession.latest_requested_change_note_id,
          )?.body
        : null;
    assert.match(requestedChangeBody ?? "", /reviewer1/);
    assert.match(requestedChangeBody ?? "", /src\/review\.ts:42/);

    writeFileSync(
      join(fixture.runtime.worktreePath, "feature.txt"),
      "two\n",
      "utf8",
    );
    runGit(fixture.runtime.worktreePath, ["add", "feature.txt"]);
    runGit(fixture.runtime.worktreePath, ["commit", "-m", "follow-up fix"]);
    const updatedHead = runGit(fixture.runtime.worktreePath, [
      "rev-parse",
      "HEAD",
    ]);

    const reviewPackage: ReviewPackage = {
      ...fixture.reviewPackage,
      id: "review-package-2",
      commit_refs: [updatedHead],
      created_at: "2026-04-02T11:00:00.000Z",
    };
    await service.handleReviewReady({
      project: fixture.project,
      repository: fixture.repository,
      reviewPackage,
      session: fixture.store.getSession(fixture.session.id) ?? fixture.session,
      ticket: fixture.store.getTicket(fixture.ticket.id) ?? fixture.ticket,
    });

    const finalTicket = fixture.store.getTicket(fixture.ticket.id);
    assert.equal(finalTicket?.linked_pr?.head_sha, updatedHead);
    assert.equal(finalTicket?.linked_pr?.review_status, "pending");
    assert.equal(finalTicket?.linked_pr?.changes_requested_by, null);
    assert.equal(
      runGit(fixture.remotePath, [
        "rev-parse",
        `refs/heads/${fixture.ticket.working_branch}`,
      ]),
      updatedHead,
    );
    assert.equal(ghCalls.length, 4);
  } finally {
    restoreWalleyBoardHome();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
