import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import websocket from "@fastify/websocket";
import Fastify from "fastify";
import fastifyRateLimit from "fastify-rate-limit";

import type { TicketFrontmatter } from "../../../../packages/contracts/src/index.js";

import { EventHub } from "../lib/event-hub.js";
import {
  closeTrackedWorkspaceTerminals,
  startTrackedWorkspaceTerminal,
  type WorkspaceTerminalRuntime,
} from "../lib/execution-runtime/terminal-runtime.js";
import { SqliteStore } from "../lib/sqlite-store.js";
import { prepareWorktree } from "../lib/worktree-service.js";
import { ticketRoutes } from "./tickets.js";

type WebSocketClient = {
  addEventListener: (
    type: "close" | "error" | "message" | "open",
    listener: (event?: { data?: unknown }) => void,
  ) => void;
  close: () => void;
  send: (data: string) => void;
};

function createWebSocket(url: string): WebSocketClient {
  const WebSocketConstructor = (
    globalThis as typeof globalThis & {
      WebSocket: new (url: string) => WebSocketClient;
    }
  ).WebSocket;
  return new WebSocketConstructor(url);
}

async function openSocket(url: string): Promise<WebSocketClient> {
  return await new Promise<WebSocketClient>((resolve, reject) => {
    const socket = createWebSocket(url);
    const timeout = setTimeout(() => {
      reject(new Error("Timed out opening workspace terminal socket"));
    }, 5_000);

    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Workspace terminal socket failed to open"));
    });
  });
}

async function waitForSocketMessage(
  socket: WebSocketClient,
  predicate: (message: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for workspace terminal message"));
    }, 5_000);

    socket.addEventListener("message", (event) => {
      const rawData = typeof event?.data === "string" ? event.data : "";
      const message = JSON.parse(rawData) as Record<string, unknown>;
      if (!predicate(message)) {
        return;
      }

      clearTimeout(timeout);
      resolve(message);
    });
    socket.addEventListener("close", () => {
      clearTimeout(timeout);
      reject(new Error("Workspace terminal socket closed before the message"));
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Workspace terminal socket errored"));
    });
  });
}

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
      closeWorkspaceTerminals() {},
      cleanupExecutionEnvironment() {},
      hasActiveExecution() {
        return false;
      },
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

test("edit route reopens a ready ticket as a draft without losing its content", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-ticket-edit-"));

  try {
    const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
    const { project, repository } = store.createProject({
      name: "Route Edit Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    const description = [
      "Revise the ready ticket before execution.",
      "",
      "![Artifact](/projects/project-1/draft-artifacts/artifact-edit/screenshot.png)",
    ].join("\n");
    const draft = store.createDraft({
      project_id: project.id,
      artifact_scope_id: "artifact-edit",
      title: "Edit a ready ticket",
      description,
      proposed_ticket_type: "bugfix",
      proposed_acceptance_criteria: [
        "Keep the current title and description.",
        "Keep the current artifact references.",
      ],
    });
    const ticket = store.confirmDraft(draft.id, {
      title: "Edit a ready ticket",
      description,
      repo_id: repository.id,
      ticket_type: "bugfix",
      acceptance_criteria: [
        "Keep the current title and description.",
        "Keep the current artifact references.",
      ],
      target_branch: "main",
    });

    const executionRuntime = {
      assertProjectExecutionBackendAvailable() {},
      cleanupExecutionEnvironment() {},
      closeWorkspaceTerminals() {},
      hasActiveExecution() {
        return false;
      },
      startExecution() {},
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
      url: `/tickets/${ticket.id}/edit`,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(store.getTicket(ticket.id), undefined);
    assert.deepEqual(store.listProjectTickets(project.id), []);

    const reopenedDrafts = store.listProjectDrafts(project.id);
    assert.equal(reopenedDrafts.length, 1);
    assert.equal(reopenedDrafts[0]?.artifact_scope_id, "artifact-edit");
    assert.equal(reopenedDrafts[0]?.title_draft, "Edit a ready ticket");
    assert.equal(reopenedDrafts[0]?.description_draft, description);
    assert.equal(reopenedDrafts[0]?.proposed_repo_id, repository.id);
    assert.equal(reopenedDrafts[0]?.confirmed_repo_id, repository.id);
    assert.equal(reopenedDrafts[0]?.proposed_ticket_type, "bugfix");
    assert.deepEqual(reopenedDrafts[0]?.proposed_acceptance_criteria, [
      "Keep the current title and description.",
      "Keep the current artifact references.",
    ]);
    assert.equal(reopenedDrafts[0]?.wizard_status, "editing");
    assert.equal(reopenedDrafts[0]?.source_ticket_id, ticket.id);
    assert.equal(reopenedDrafts[0]?.target_branch, "main");

    await app.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("merge route clears the persisted worktree path after cleanup", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-ticket-merge-"));
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
      name: "Route Merge Project",
      repository: {
        name: "repo",
        path: repoPath,
      },
    });

    const ticket = createReadyTicket(store, project.id, repository.id);
    const runtime = prepareWorktree(project, repository, ticket);
    const started = store.startTicket(ticket.id, false, runtime);

    configureGitIdentity(runtime.worktreePath);
    writeFileSync(join(runtime.worktreePath, "ticket.txt"), "ticket work\n");
    runGit(runtime.worktreePath, ["add", "ticket.txt"]);
    runGit(runtime.worktreePath, ["commit", "-m", "ticket change"]);

    store.createReviewPackage({
      ticket_id: ticket.id,
      session_id: started.session.id,
      diff_ref: "ticket.patch",
      commit_refs: ["abc123"],
      change_summary: "Ready to merge",
      validation_results: [],
      remaining_risks: [],
    });
    store.updateTicketStatus(ticket.id, "review");
    store.updateSessionStatus(
      started.session.id,
      "completed",
      "Review package ready.",
    );

    let previewStopped = false;
    let workspaceDisposed = false;
    const app = Fastify();
    await app.register(fastifyRateLimit, { global: false });
    await app.register(ticketRoutes, {
      agentReviewService: {
        startReviewLoop() {
          throw new Error("Not used in this test");
        },
      } as never,
      eventHub: new EventHub(),
      store,
      executionRuntime: {
        closeWorkspaceTerminals() {},
        hasActiveExecution() {
          return false;
        },
        resolveMergeConflicts() {
          throw new Error("Merge conflicts are not expected in this test");
        },
      } as never,
      githubPullRequestService: {
        async createPullRequest() {
          throw new Error("Not used in this test");
        },
        async reconcileTicket() {
          throw new Error("Not used in this test");
        },
      } as never,
      ticketWorkspaceService: {
        async disposeTicket() {
          workspaceDisposed = true;
        },
        async stopPreviewAndWait() {
          previewStopped = true;
        },
      } as never,
    });

    const response = await app.inject({
      method: "POST",
      url: `/tickets/${ticket.id}/merge`,
      payload: {},
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().accepted, true);
    assert.equal(previewStopped, true);
    assert.equal(workspaceDisposed, true);
    assert.equal(store.getTicket(ticket.id)?.status, "done");
    assert.equal(store.getSession(started.session.id)?.status, "completed");
    assert.equal(store.getSession(started.session.id)?.worktree_path, null);
    assert.equal(existsSync(runtime.worktreePath), false);
    assert.equal(
      runGit(repoPath, ["branch", "--list", runtime.workingBranch]),
      "",
    );
    assert.equal(
      readFileSync(join(repoPath, "ticket.txt"), "utf8"),
      "ticket work\n",
    );

    await app.close();
  } finally {
    restoreWalleyBoardHome();
    process.chdir(previousCwd);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("done tickets keep their stored diff through archive and restore", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-ticket-diff-"));
  const previousCwd = process.cwd();
  const walleyBoardHome = join(tempDir, ".walleyboard-home");
  const restoreWalleyBoardHome = setWalleyBoardHome(walleyBoardHome);

  try {
    process.chdir(tempDir);

    const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
    const { project, repository } = store.createProject({
      name: "Route Archive Diff Project",
      repository: {
        name: "repo",
        path: tempDir,
      },
    });

    const ticket = createReadyTicket(store, project.id, repository.id);
    const started = store.startTicket(ticket.id, false, {
      logs: [],
      workingBranch: "ticket-archive-diff",
      worktreePath: join(tempDir, "ticket-worktree"),
    });
    const diffPath = join(
      walleyBoardHome,
      "review-packages",
      project.slug,
      `ticket-${ticket.id}.patch`,
    );
    const patch = [
      "diff --git a/src/app.ts b/src/app.ts",
      "index 1111111..2222222 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1 +1 @@",
      '-console.log("before");',
      '+console.log("after");',
    ].join("\n");

    mkdirSync(join(walleyBoardHome, "review-packages", project.slug), {
      recursive: true,
    });
    writeFileSync(diffPath, patch, "utf8");
    store.createReviewPackage({
      ticket_id: ticket.id,
      session_id: started.session.id,
      diff_ref: diffPath,
      commit_refs: ["abc123"],
      change_summary: "Ready to archive",
      validation_results: [],
      remaining_risks: [],
    });
    store.updateSessionWorktreePath(started.session.id, null);
    store.updateSessionStatus(
      started.session.id,
      "completed",
      "Review package ready.",
    );
    store.updateTicketStatus(ticket.id, "done");

    const app = Fastify();
    await app.register(fastifyRateLimit, { global: false });
    await app.register(ticketRoutes, {
      agentReviewService: {
        startReviewLoop() {
          throw new Error("Not used in this test");
        },
      } as never,
      eventHub: new EventHub(),
      store,
      executionRuntime: {
        closeWorkspaceTerminals() {},
        hasActiveExecution() {
          return false;
        },
      } as never,
      githubPullRequestService: {
        async createPullRequest() {
          throw new Error("Not used in this test");
        },
        async reconcileTicket() {
          throw new Error("Not used in this test");
        },
      } as never,
      ticketWorkspaceService: {
        async disposeTicket() {},
        getDiff() {
          throw new Error("Stored diff fallback should be used in this test");
        },
        async stopPreviewAndWait() {},
      } as never,
    });

    const assertStoredDiff = async () => {
      const response = await app.inject({
        method: "GET",
        url: `/tickets/${ticket.id}/workspace/diff`,
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json().workspace_diff, {
        artifact_path: diffPath,
        generated_at: store.getReviewPackage(ticket.id)?.created_at,
        patch,
        source: "review_artifact",
        target_branch: "main",
        ticket_id: ticket.id,
        working_branch: "ticket-archive-diff",
        worktree_path: null,
      });
      assert.equal(readFileSync(diffPath, "utf8"), patch);
    };

    await assertStoredDiff();

    const archiveResponse = await app.inject({
      method: "POST",
      url: `/tickets/${ticket.id}/archive`,
      payload: {},
    });
    assert.equal(archiveResponse.statusCode, 200);
    assert.equal(store.listProjectTickets(project.id).length, 0);
    assert.equal(
      store.listProjectTickets(project.id, { archivedOnly: true }).length,
      1,
    );
    await assertStoredDiff();

    const restoreResponse = await app.inject({
      method: "POST",
      url: `/tickets/${ticket.id}/restore`,
      payload: {},
    });
    assert.equal(restoreResponse.statusCode, 200);
    assert.equal(store.listProjectTickets(project.id).length, 1);
    await assertStoredDiff();

    await app.close();
  } finally {
    restoreWalleyBoardHome();
    process.chdir(previousCwd);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("delete route closes an open workspace terminal before cleaning up the worktree", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-ticket-delete-"));
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
      name: "Route Delete Project",
      repository: {
        name: "repo",
        path: repoPath,
      },
    });

    const ticket = createReadyTicket(store, project.id, repository.id);
    const runtime = prepareWorktree(project, repository, ticket);
    const started = store.startTicket(ticket.id, false, runtime);
    const workspaceTerminals = new Map<string, Set<WorkspaceTerminalRuntime>>();
    const executionRuntime = {
      closeWorkspaceTerminals(sessionId: string, exitMessage: string) {
        closeTrackedWorkspaceTerminals(
          workspaceTerminals,
          sessionId,
          exitMessage,
        );
      },
      cleanupExecutionEnvironment() {},
      hasActiveExecution() {
        return false;
      },
      startQueuedSessions() {},
      startWorkspaceTerminal(input: {
        sessionId: string;
        worktreePath: string;
      }) {
        return startTrackedWorkspaceTerminal({
          ...input,
          workspaceTerminals,
        });
      },
      async stopExecution() {
        return false;
      },
    };

    const app = Fastify();
    await app.register(websocket);
    await app.register(fastifyRateLimit, { global: false });
    await app.register(ticketRoutes, {
      agentReviewService: {
        startReviewLoop() {
          throw new Error("Not used in this test");
        },
      } as never,
      eventHub: new EventHub(),
      store,
      executionRuntime: executionRuntime as never,
      githubPullRequestService: {
        async createPullRequest() {
          throw new Error("Not used in this test");
        },
        async reconcileTicket() {
          throw new Error("Not used in this test");
        },
      } as never,
      ticketWorkspaceService: {
        async disposeTicket() {},
        async stopPreviewAndWait() {},
      } as never,
    });

    let socket: WebSocketClient | null = null;
    try {
      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      socket = await openSocket(
        `${address.replace(/^http/, "ws")}/tickets/${ticket.id}/workspace/terminal`,
      );

      socket.send(
        JSON.stringify({
          type: "terminal.input",
          data: "pwd\r",
        }),
      );
      await waitForSocketMessage(
        socket,
        (message) =>
          message.type === "terminal.output" &&
          typeof message.data === "string" &&
          message.data.includes(runtime.worktreePath),
      );

      socket.send(
        JSON.stringify({
          type: "terminal.input",
          data: "echo terminal-busy; trap '' HUP; sleep 30\r",
        }),
      );
      await waitForSocketMessage(
        socket,
        (message) =>
          message.type === "terminal.output" &&
          typeof message.data === "string" &&
          message.data.includes("terminal-busy"),
      );

      const errorPromise = waitForSocketMessage(
        socket,
        (message) => message.type === "terminal.error",
      );
      const exitPromise = waitForSocketMessage(
        socket,
        (message) => message.type === "terminal.exit",
      );

      const response = await app.inject({
        method: "POST",
        url: `/tickets/${ticket.id}/delete`,
        payload: {},
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.json().accepted, true);

      const errorMessage = await errorPromise;
      assert.deepEqual(errorMessage, {
        type: "terminal.error",
        message:
          "This workspace terminal closed because the ticket worktree was cleaned up.",
      });

      const exitMessage = await exitPromise;
      assert.equal(exitMessage.type, "terminal.exit");
      assert.equal(store.getTicket(ticket.id), undefined);
      assert.equal(existsSync(runtime.worktreePath), false);
      assert.equal(store.getSession(started.session.id), undefined);
      assert.equal(workspaceTerminals.has(started.session.id), false);
    } finally {
      socket?.close();
      await app.close();
    }
  } finally {
    restoreWalleyBoardHome();
    process.chdir(previousCwd);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("closing tracked workspace terminals tolerates terminals that already exited", () => {
  const workspaceTerminals = new Map<string, Set<WorkspaceTerminalRuntime>>();
  let killCalls = 0;
  const terminal: WorkspaceTerminalRuntime = {
    exitMessage: null,
    pty: {
      kill() {
        killCalls += 1;
        throw new Error("PTY already exited");
      },
    } as unknown as WorkspaceTerminalRuntime["pty"],
  };
  workspaceTerminals.set("session-9", new Set([terminal]));

  assert.doesNotThrow(() => {
    closeTrackedWorkspaceTerminals(
      workspaceTerminals,
      "session-9",
      "This workspace terminal closed because the ticket worktree was cleaned up.",
    );
  });
  assert.equal(killCalls, 1);
  assert.equal(
    terminal.exitMessage,
    "This workspace terminal closed because the ticket worktree was cleaned up.",
  );
  assert.equal(workspaceTerminals.has("session-9"), false);
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
