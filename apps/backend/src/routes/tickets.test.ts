import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Fastify from "fastify";
import fastifyRateLimit from "fastify-rate-limit";

import type { TicketFrontmatter } from "../../../../packages/contracts/src/index.js";

import { EventHub } from "../lib/event-hub.js";
import { SqliteStore } from "../lib/sqlite-store.js";
import { prepareWorktree } from "../lib/worktree-service.js";
import { ticketRoutes } from "./tickets.js";

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

function createReadyTicket(
  store: SqliteStore,
  projectId: string,
  repoId: string,
): TicketFrontmatter {
  const draft = store.createDraft({
    project_id: projectId,
    title: "Restart interrupted ticket",
    description: "Recreate the worktree from scratch.",
  });

  return store.confirmDraft(draft.id, {
    title: "Restart interrupted ticket",
    description: "Recreate the worktree from scratch.",
    repo_id: repoId,
    ticket_type: "feature",
    acceptance_criteria: ["Allow a clean restart for interrupted work."],
    target_branch: "main",
  });
}

test("restart route recreates the worktree and launches a fresh attempt", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-ticket-route-"));
  const previousCwd = process.cwd();
  const restoreWalleyBoardHome = setWalleyBoardHome(
    join(tempDir, ".walleyboard-home"),
  );

  try {
    process.chdir(tempDir);

    const repoPath = join(tempDir, "repo");
    execFileSync("git", ["init", repoPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    configureGitIdentity(repoPath);

    writeFileSync(join(repoPath, "base.txt"), "base\n", "utf8");
    runGit(repoPath, ["add", "base.txt"]);
    runGit(repoPath, ["commit", "-m", "initial"]);
    runGit(repoPath, ["branch", "-M", "main"]);

    const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
    const { project, repository } = store.createProject({
      name: "Route Restart Project",
      repository: {
        name: "repo",
        path: repoPath,
      },
    });

    const ticket = createReadyTicket(store, project.id, repository.id);
    const initialRuntime = prepareWorktree(project, repository, ticket);
    const started = store.startTicket(ticket.id, false, initialRuntime);

    writeFileSync(
      join(initialRuntime.worktreePath, "stale.txt"),
      "stale\n",
      "utf8",
    );
    store.updateSessionAdapterSessionRef(
      started.session.id,
      "old-codex-thread",
    );
    store.updateSessionStatus(
      started.session.id,
      "interrupted",
      "Restart from a clean worktree.",
    );
    store.updateExecutionAttempt(started.attempt.id, {
      status: "interrupted",
      end_reason: "user_restart",
    });

    const executionStarts: Array<{
      sessionId: string;
      worktreePath: string | null;
      ticketId: number;
      additionalInstruction?: string;
    }> = [];
    const executionRuntime = {
      assertProjectExecutionBackendAvailable() {},
      cleanupExecutionEnvironment() {},
      startExecution(input: {
        session: { id: string; worktree_path: string | null };
        ticket: { id: number };
        additionalInstruction?: string;
      }) {
        const nextStart = {
          sessionId: input.session.id,
          worktreePath: input.session.worktree_path,
          ticketId: input.ticket.id,
          ...(input.additionalInstruction
            ? { additionalInstruction: input.additionalInstruction }
            : {}),
        };
        executionStarts.push(nextStart);
      },
    };
    const ticketWorkspaceService = {
      async disposeTicket() {},
      async stopPreviewAndWait() {},
    };
    const githubPullRequestService = {
      async createPullRequest() {
        throw new Error("Not used in this test");
      },
      async reconcileTicket() {
        throw new Error("Not used in this test");
      },
    };
    const agentReviewService = {
      startReviewLoop() {
        throw new Error("Not used in this test");
      },
    };

    const app = Fastify();
    await app.register(fastifyRateLimit, { global: false });
    await app.register(ticketRoutes, {
      agentReviewService: agentReviewService as never,
      eventHub: new EventHub(),
      store,
      executionRuntime: executionRuntime as never,
      githubPullRequestService: githubPullRequestService as never,
      ticketWorkspaceService: ticketWorkspaceService as never,
    });

    const response = await app.inject({
      method: "POST",
      url: `/tickets/${ticket.id}/restart`,
      payload: {
        reason: "Try again from a clean state",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().accepted, true);

    const restartedSession = store.getSession(started.session.id);
    assert.ok(restartedSession);
    assert.equal(restartedSession.id, started.session.id);
    assert.equal(restartedSession.status, "awaiting_input");
    assert.equal(restartedSession.adapter_session_ref, null);
    assert.equal(store.listSessionAttempts(started.session.id).length, 2);
    assert.equal(
      existsSync(join(initialRuntime.worktreePath, "stale.txt")),
      false,
    );
    assert.equal(executionStarts.length, 1);
    assert.deepEqual(executionStarts[0], {
      sessionId: started.session.id,
      worktreePath: initialRuntime.worktreePath,
      ticketId: ticket.id,
      additionalInstruction: "Try again from a clean state",
    });

    await app.close();
  } finally {
    restoreWalleyBoardHome();
    process.chdir(previousCwd);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("start-agent-review route delegates to the agent review service", async () => {
  const requestedTicketIds: number[] = [];
  const app = Fastify();

  try {
    await app.register(fastifyRateLimit, { global: false });
    await app.register(ticketRoutes, {
      agentReviewService: {
        startReviewLoop(ticketId: number) {
          requestedTicketIds.push(ticketId);
          return {
            id: "review-run-1",
            ticket_id: ticketId,
            review_package_id: "review-package-1",
            implementation_session_id: "session-7",
            status: "running",
            adapter_session_ref: null,
            report: null,
            failure_message: null,
            created_at: "2026-04-02T00:00:00.000Z",
            updated_at: "2026-04-02T00:00:00.000Z",
            completed_at: null,
          };
        },
      } as never,
      eventHub: new EventHub(),
      store: {
        appendSessionLog() {
          return 0;
        },
      } as never,
      executionRuntime: {} as never,
      githubPullRequestService: {} as never,
      ticketWorkspaceService: {} as never,
    });

    const response = await app.inject({
      method: "POST",
      url: "/tickets/7/start-agent-review",
      payload: {},
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().accepted, true);
    assert.deepEqual(requestedTicketIds, [7]);
  } finally {
    await app.close();
  }
});
