import assert from "node:assert/strict";
import { spawn as spawnProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import fastifyRateLimit from "fastify-rate-limit";
import { spawn as spawnPty } from "node-pty";

import type {
  ExecutionSession,
  Project,
  RepositoryConfig,
  ReviewPackage,
  TicketFrontmatter,
} from "../../../../packages/contracts/src/index.js";

import { AgentAdapterRegistry } from "../lib/agent-adapters/registry.js";
import { EventHub } from "../lib/event-hub.js";
import type { WorkspaceTerminalRuntime } from "../lib/execution-runtime/terminal-runtime.js";
import { ExecutionRuntime } from "../lib/execution-runtime.js";
import {
  handleTicketWorkspaceTerminalConnection,
  registerTicketReadWorkspaceRoutes,
} from "./tickets/read-workspace-routes.js";
import type { TicketRouteDependencies } from "./tickets/shared.js";

class FakeTerminalSocket {
  #closed = false;
  #closeListeners = new Set<() => void>();
  #messageListeners = new Set<(payload?: unknown) => void>();
  #messageWaiters = new Set<{
    predicate: (message: Record<string, unknown>) => boolean;
    reject: (error: Error) => void;
    resolve: (message: Record<string, unknown>) => void;
    timeout: NodeJS.Timeout;
  }>();
  readonly messages: Array<Record<string, unknown>> = [];

  close(): void {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    for (const waiter of this.#messageWaiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(
        new Error("Workspace terminal socket closed before the message"),
      );
    }
    this.#messageWaiters.clear();
    for (const listener of this.#closeListeners) {
      listener();
    }
  }

  on(event: "close" | "message", listener: (payload?: unknown) => void): void {
    if (event === "close") {
      this.#closeListeners.add(() => listener());
      return;
    }

    this.#messageListeners.add(listener);
  }

  send(message: string): void {
    const parsed = JSON.parse(message) as Record<string, unknown>;
    this.messages.push(parsed);

    for (const waiter of [...this.#messageWaiters]) {
      if (!waiter.predicate(parsed)) {
        continue;
      }

      clearTimeout(waiter.timeout);
      this.#messageWaiters.delete(waiter);
      waiter.resolve(parsed);
    }
  }

  emitMessage(message: Record<string, unknown>): void {
    const rawMessage = JSON.stringify(message);
    for (const listener of this.#messageListeners) {
      listener(rawMessage);
    }
  }

  async waitForMessage(
    predicate: (message: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> {
    const existing = this.messages.find(predicate);
    if (existing) {
      return existing;
    }

    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#messageWaiters.delete(waiter);
        reject(new Error("Timed out waiting for workspace terminal message"));
      }, 5_000);
      const waiter = {
        predicate,
        reject,
        resolve,
        timeout,
      };

      this.#messageWaiters.add(waiter);
    });
  }
}

async function createApp(
  dependencies: Partial<TicketRouteDependencies>,
): Promise<FastifyInstance> {
  const eventHub = dependencies.eventHub ?? new EventHub();
  const store = {
    appendSessionLog() {
      return 0;
    },
    getLatestReviewRun() {
      return null;
    },
    listReviewRuns() {
      return [];
    },
    getReviewPackage() {
      return null;
    },
    getSession() {
      return null;
    },
    getTicket() {
      return null;
    },
    getTicketEvents() {
      return [];
    },
    ...(dependencies.store ?? {}),
  };
  const executionRuntime = {
    hasActiveExecution() {
      return false;
    },
    startWorkspaceTerminal({
      worktreePath,
    }: {
      sessionId: string;
      worktreePath: string;
    }): WorkspaceTerminalRuntime {
      return {
        exitMessage: null,
        pty: spawnPty("bash", ["--noprofile", "--norc"], {
          cwd: worktreePath,
          env: {
            ...process.env,
            TERM: "xterm-256color",
          },
          cols: 120,
          rows: 32,
          name: "xterm-256color",
        }),
      };
    },
    ...(dependencies.executionRuntime ?? {}),
  };
  const app = Fastify();
  await app.register(fastifyRateLimit, { global: false });
  const ticketWorkspaceService = {
    ...(dependencies.ticketWorkspaceService ?? {}),
  };
  registerTicketReadWorkspaceRoutes(app, {
    agentReviewService: {} as never,
    appendSessionOutput() {},
    eventHub,
    executionRuntime: executionRuntime as never,
    githubPullRequestService: {} as never,
    store: store as never,
    ticketWorkspaceService: ticketWorkspaceService as never,
  });
  return app;
}

function createTerminalDependencies(
  dependencies: Partial<TicketRouteDependencies>,
): Pick<TicketRouteDependencies, "executionRuntime" | "store"> {
  const store = {
    getSession() {
      return null;
    },
    getTicket() {
      return null;
    },
    ...(dependencies.store ?? {}),
  };
  const executionRuntime = {
    startWorkspaceTerminal({
      worktreePath,
    }: {
      sessionId: string;
      worktreePath: string;
    }): WorkspaceTerminalRuntime {
      return {
        exitMessage: null,
        pty: spawnPty("bash", ["--noprofile", "--norc"], {
          cwd: worktreePath,
          env: {
            ...process.env,
            TERM: "xterm-256color",
          },
          cols: 120,
          rows: 32,
          name: "xterm-256color",
        }),
      };
    },
    ...(dependencies.executionRuntime ?? {}),
  };

  return {
    executionRuntime: executionRuntime as never,
    store: store as never,
  };
}

function openTicketWorkspaceTerminal(
  rawTicketId: string,
  dependencies: Partial<TicketRouteDependencies>,
): FakeTerminalSocket {
  const socket = new FakeTerminalSocket();
  handleTicketWorkspaceTerminalConnection(
    socket,
    rawTicketId,
    createTerminalDependencies(dependencies),
  );
  return socket;
}

function createProject(): Project {
  return {
    id: "project-1",
    slug: "project-1",
    name: "Project",
    color: "#2563EB",
    agent_adapter: "codex",
    execution_backend: "docker",
    disabled_mcp_servers: [],
    automatic_agent_review: false,
    automatic_agent_review_run_limit: 1,
    default_review_action: "direct_merge",
    default_target_branch: "main",
    preview_start_command: null,
    pre_worktree_command: null,
    post_worktree_command: null,
    draft_analysis_model: null,
    draft_analysis_reasoning_effort: null,
    ticket_work_model: null,
    ticket_work_reasoning_effort: null,
    max_concurrent_sessions: 1,
    created_at: "2026-04-02T00:00:00.000Z",
    updated_at: "2026-04-02T00:00:00.000Z",
  };
}

function createRepository(path: string): RepositoryConfig {
  return {
    id: "repo-1",
    project_id: "project-1",
    name: "repo",
    path,
    target_branch: "main",
    setup_hook: null,
    cleanup_hook: null,
    validation_profile: [],
    extra_env_allowlist: [],
    created_at: "2026-04-02T00:00:00.000Z",
    updated_at: "2026-04-02T00:00:00.000Z",
  };
}

function createTicket(
  overrides: Partial<TicketFrontmatter> = {},
): TicketFrontmatter {
  return {
    acceptance_criteria: [],
    artifact_scope_id: "artifact-scope-9",
    created_at: "2026-04-02T00:00:00.000Z",
    description: "Replace the ticket workspace tabs with card action icons.",
    id: 9,
    linked_pr: null,
    project: "project-1",
    repo: "repo-1",
    session_id: "session-9",
    status: "in_progress",
    target_branch: "main",
    ticket_type: "feature",
    title: "Replace ticket workspace tabs with card action icons",
    updated_at: "2026-04-02T00:00:00.000Z",
    working_branch: "ticket-9",
    ...overrides,
  };
}

function createSession(
  worktreePath: string,
  overrides: Partial<ExecutionSession> = {},
): ExecutionSession {
  return {
    adapter_session_ref: null,
    agent_adapter: "codex",
    completed_at: null,
    current_attempt_id: "attempt-9",
    id: "session-9",
    last_heartbeat_at: "2026-04-02T00:00:00.000Z",
    last_summary: null,
    latest_requested_change_note_id: null,
    latest_review_package_id: null,
    plan_status: "not_requested",
    plan_summary: null,
    planning_enabled: false,
    project_id: "project-1",
    queue_entered_at: "2026-04-02T00:00:00.000Z",
    repo_id: "repo-1",
    started_at: "2026-04-02T00:00:00.000Z",
    status: "queued",
    ticket_id: 9,
    worktree_path: worktreePath,
    ...overrides,
  };
}

test("review-runs route returns the full review history for a ticket", async () => {
  const app = await createApp({
    store: {
      listReviewRuns(ticketId: number) {
        if (ticketId !== 9) {
          return [];
        }

        return [
          {
            id: "review-run-1",
            ticket_id: 9,
            review_package_id: "review-package-1",
            implementation_session_id: "session-9",
            status: "completed",
            adapter_session_ref: "adapter-session-1",
            report: {
              summary: "The first review summary stays available.",
              strengths: [],
              actionable_findings: [],
            },
            failure_message: null,
            created_at: "2026-04-02T00:00:00.000Z",
            updated_at: "2026-04-02T00:01:00.000Z",
            completed_at: "2026-04-02T00:01:00.000Z",
          },
          {
            id: "review-run-2",
            ticket_id: 9,
            review_package_id: "review-package-2",
            implementation_session_id: "session-9",
            status: "running",
            adapter_session_ref: null,
            report: null,
            failure_message: null,
            created_at: "2026-04-02T00:02:00.000Z",
            updated_at: "2026-04-02T00:02:00.000Z",
            completed_at: null,
          },
        ];
      },
    } as never,
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/tickets/9/review-runs",
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      review_runs: [
        {
          id: "review-run-1",
          ticket_id: 9,
          review_package_id: "review-package-1",
          implementation_session_id: "session-9",
          status: "completed",
          adapter_session_ref: "adapter-session-1",
          report: {
            summary: "The first review summary stays available.",
            strengths: [],
            actionable_findings: [],
          },
          failure_message: null,
          created_at: "2026-04-02T00:00:00.000Z",
          updated_at: "2026-04-02T00:01:00.000Z",
          completed_at: "2026-04-02T00:01:00.000Z",
        },
        {
          id: "review-run-2",
          ticket_id: 9,
          review_package_id: "review-package-2",
          implementation_session_id: "session-9",
          status: "running",
          adapter_session_ref: null,
          report: null,
          failure_message: null,
          created_at: "2026-04-02T00:02:00.000Z",
          updated_at: "2026-04-02T00:02:00.000Z",
          completed_at: null,
        },
      ],
    });
  } finally {
    await app.close();
  }
});

test("review-run route returns null when the ticket has no review history yet", async () => {
  const app = await createApp({});

  try {
    const response = await app.inject({
      method: "GET",
      url: "/tickets/9/review-run",
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      review_run: null,
    });
  } finally {
    await app.close();
  }
});

test("workspace diff prefers the persisted review artifact for done tickets even when a worktree remains", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-done-diff-"));
  const diffDir = join(tempDir, "review-packages");
  const diffPath = join(diffDir, "ticket-9.patch");
  const patch = [
    "diff --git a/src/example.ts b/src/example.ts",
    "index 1111111..2222222 100644",
    "--- a/src/example.ts",
    "+++ b/src/example.ts",
    "@@ -1,2 +1,2 @@",
    '-console.log("before");',
    '+console.log("after");',
  ].join("\n");
  const reviewPackage: ReviewPackage = {
    change_summary: "Merged and archived.",
    commit_refs: ["abc123"],
    created_at: "2026-04-02T00:05:00.000Z",
    diff_ref: diffPath,
    id: "review-package-9",
    remaining_risks: [],
    session_id: "session-9",
    ticket_id: 9,
    validation_results: [],
  };

  mkdirSync(diffDir, { recursive: true });
  writeFileSync(diffPath, patch, "utf8");

  const app = await createApp({
    store: {
      getReviewPackage(ticketId: number) {
        return ticketId === 9 ? reviewPackage : null;
      },
      getSession(sessionId: string) {
        return sessionId === "session-9"
          ? createSession(join(tempDir, "ticket-worktree"))
          : null;
      },
      getTicket(ticketId: number) {
        return ticketId === 9 ? createTicket({ status: "done" }) : null;
      },
    } as never,
    ticketWorkspaceService: {
      getDiff() {
        throw new Error(
          "Live worktree diff should not be used for done tickets",
        );
      },
      summarizePersistedDiff() {
        return {
          ticket_id: 9,
          source: "review_artifact",
          added_lines: 2,
          removed_lines: 1,
          files_changed: 1,
          has_changes: true,
          generated_at: reviewPackage.created_at,
        };
      },
    } as never,
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/tickets/9/workspace/diff",
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      workspace_diff: {
        artifact_path: diffPath,
        generated_at: reviewPackage.created_at,
        patch,
        source: "review_artifact",
        target_branch: "main",
        ticket_id: 9,
        working_branch: "ticket-9",
        worktree_path: null,
      },
    });
  } finally {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("workspace summary prefers the persisted review artifact for done tickets even when a worktree remains", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-summary-route-"));
  const diffDir = join(tempDir, "review-artifacts");
  const diffPath = join(diffDir, "ticket-9.patch");
  const patch = [
    "diff --git a/src/example.ts b/src/example.ts",
    "index 1111111..2222222 100644",
    "--- a/src/example.ts",
    "+++ b/src/example.ts",
    "@@ -1,2 +1,3 @@",
    '-console.log("before");',
    '+console.log("after");',
    '+console.log("extra");',
  ].join("\n");
  const reviewPackage: ReviewPackage = {
    change_summary: "Merged and archived.",
    commit_refs: ["abc123"],
    created_at: "2026-04-02T00:05:00.000Z",
    diff_ref: diffPath,
    id: "review-package-9",
    remaining_risks: [],
    session_id: "session-9",
    ticket_id: 9,
    validation_results: [],
  };

  mkdirSync(diffDir, { recursive: true });
  writeFileSync(diffPath, patch, "utf8");

  const app = await createApp({
    store: {
      getReviewPackage(ticketId: number) {
        return ticketId === 9 ? reviewPackage : null;
      },
      getSession(sessionId: string) {
        return sessionId === "session-9"
          ? createSession(join(tempDir, "ticket-worktree"))
          : null;
      },
      getTicket(ticketId: number) {
        return ticketId === 9 ? createTicket({ status: "done" }) : null;
      },
    } as never,
    ticketWorkspaceService: {
      summarizePersistedDiff() {
        return {
          ticket_id: 9,
          source: "review_artifact",
          added_lines: 2,
          removed_lines: 1,
          files_changed: 1,
          has_changes: true,
          generated_at: reviewPackage.created_at,
        };
      },
    } as never,
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/tickets/9/workspace/summary",
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      workspace_summary: {
        ticket_id: 9,
        source: "review_artifact",
        added_lines: 2,
        removed_lines: 1,
        files_changed: 1,
        has_changes: true,
        generated_at: reviewPackage.created_at,
      },
    });
  } finally {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("workspace preview stop waits for preview shutdown before returning idle", async () => {
  const callOrder: string[] = [];
  const preview = {
    ticket_id: 7,
    state: "idle",
    preview_url: null,
    backend_url: null,
    started_at: null,
    error: null,
  } as const;
  const app = await createApp({
    store: {
      getTicket(ticketId: number) {
        return ticketId === 7 ? { id: 7 } : null;
      },
    } as never,
    ticketWorkspaceService: {
      getPreview(ticketId: number) {
        callOrder.push(`preview:${ticketId}`);
        return preview;
      },
      async stopPreviewAndWait(ticketId: number) {
        callOrder.push(`stop:start:${ticketId}`);
        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });
        callOrder.push(`stop:end:${ticketId}`);
      },
    } as never,
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/tickets/7/workspace/preview/stop",
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { preview });
    assert.deepEqual(callOrder, ["stop:start:7", "stop:end:7", "preview:7"]);
  } finally {
    await app.close();
  }
});

test("workspace terminal reports a clear error when the ticket has no prepared worktree", async () => {
  const socket = openTicketWorkspaceTerminal("11", {
    store: {
      getTicket(ticketId: number) {
        return ticketId === 11 ? { id: 11, session_id: null } : null;
      },
    } as never,
  });

  const message = await socket.waitForMessage(
    (candidate) => candidate.type === "terminal.error",
  );

  assert.deepEqual(message, {
    type: "terminal.error",
    message: "Ticket has no prepared workspace yet",
  });
});

test("workspace terminal stays available while the agent still owns the worktree", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-terminal-owned-"));
  const socket = openTicketWorkspaceTerminal("13", {
    executionRuntime: {
      hasActiveExecution(sessionId: string) {
        return sessionId === "session-13";
      },
    } as never,
    store: {
      getSession(sessionId: string) {
        return sessionId === "session-13"
          ? {
              id: "session-13",
              status: "running",
              worktree_path: tempDir,
            }
          : null;
      },
      getTicket(ticketId: number) {
        return ticketId === 13 ? { id: 13, session_id: "session-13" } : null;
      },
    } as never,
  });

  try {
    socket.emitMessage({
      type: "terminal.input",
      data: "exit\r",
    });

    const message = await socket.waitForMessage(
      (candidate) => candidate.type === "terminal.exit",
    );

    assert.equal(message.type, "terminal.exit");
    assert.equal(message.exit_code, 0);
  } finally {
    socket.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

for (const status of ["queued", "awaiting_input"] as const) {
  test(`workspace terminal stays available for ${status} sessions without an active runtime`, async () => {
    const tempDir = mkdtempSync(
      join(tmpdir(), `walleyboard-terminal-${status}-`),
    );
    const sessionId = `session-${status}`;
    const ticketId = status === "queued" ? 21 : 22;
    const socket = openTicketWorkspaceTerminal(String(ticketId), {
      store: {
        getSession(requestedSessionId: string) {
          return requestedSessionId === sessionId
            ? {
                id: sessionId,
                status,
                worktree_path: tempDir,
              }
            : null;
        },
        getTicket(requestedTicketId: number) {
          return requestedTicketId === ticketId
            ? { id: ticketId, session_id: sessionId }
            : null;
        },
      } as never,
    });

    try {
      socket.emitMessage({
        type: "terminal.input",
        data: "exit\r",
      });

      const message = await socket.waitForMessage(
        (candidate) => candidate.type === "terminal.exit",
      );

      assert.equal(message.type, "terminal.exit");
      assert.equal(message.exit_code, 0);
    } finally {
      socket.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
}

test("workspace terminal publishes shell exit messages for worktree sessions", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-terminal-"));
  const socket = openTicketWorkspaceTerminal("12", {
    store: {
      getSession(sessionId: string) {
        return sessionId === "session-12"
          ? {
              id: "session-12",
              status: "completed",
              worktree_path: tempDir,
            }
          : null;
      },
      getTicket(ticketId: number) {
        return ticketId === 12 ? { id: 12, session_id: "session-12" } : null;
      },
    } as never,
  });

  try {
    socket.emitMessage({
      type: "terminal.input",
      data: "exit\r",
    });

    const message = await socket.waitForMessage(
      (candidate) => candidate.type === "terminal.exit",
    );

    assert.equal(message.type, "terminal.exit");
    assert.equal(message.exit_code, 0);
  } finally {
    socket.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("workspace terminal stays available after execution starts in the same worktree", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-terminal-runtime-"));
  const walleyBoardHome = join(tempDir, ".walleyboard-home");
  const ticket = createTicket();
  let session = createSession(tempDir);
  const project = createProject();
  const repository = createRepository(tempDir);
  let socket: FakeTerminalSocket | null = null;
  const previousWalleyBoardHome = process.env.WALLEYBOARD_HOME;
  const runtime = new ExecutionRuntime({
    adapterRegistry: new AgentAdapterRegistry([
      {
        id: "codex",
        label: "Codex",
        buildDraftRun() {
          throw new Error("draft runs are not used in this test");
        },
        buildExecutionRun(input) {
          return {
            command: "bash",
            args: ["-lc", "sleep 30"],
            prompt: "sleep 30",
            dockerSpec: {
              imageTag: "walleyboard/test-runtime:latest",
              dockerfilePath: "apps/backend/docker/codex-runtime.Dockerfile",
              homePath: "/home/walley",
              configMountPath: "/home/walley/.codex",
            },
            outputPath: input.outputPath,
          };
        },
        buildMergeConflictRun() {
          throw new Error("merge-conflict runs are not used in this test");
        },
        buildReviewRun() {
          throw new Error("review runs are not used in this test");
        },
        buildPullRequestBodyRun() {
          throw new Error("pull request body runs are not used in this test");
        },
        formatExitReason() {
          return "Codex exited";
        },
        interpretOutputLine(line: string) {
          return {
            logLine: line,
          };
        },
        parseDraftResult() {
          throw new Error("draft parsing is not used in this test");
        },
        resolveModelSelection() {
          return {
            model: null,
            reasoningEffort: null,
          };
        },
      },
    ]),
    dockerRuntime: {
      assertAvailable() {
        return {
          installed: true,
          available: true,
          client_version: "1.0.0",
          server_version: "1.0.0",
          error: null,
        };
      },
      cleanupSessionContainer() {},
      dispose() {},
      ensureSessionContainer() {},
      getSessionContainerInfo() {
        return {
          id: "container-session-2",
          name: "test-container-session-2",
          projectId: project.id,
          ticketId: ticket.id,
          worktreePath: tempDir,
        };
      },
      spawnProcessInSession() {
        return spawnProcess("bash", ["-lc", "sleep 30"], {
          cwd: tempDir,
          env: {
            ...process.env,
          },
          stdio: ["pipe", "pipe", "pipe"],
        });
      },
    } as never,
    eventHub: {
      publish() {},
    } as never,
    store: {
      appendSessionLog() {
        return 0;
      },
      claimNextQueuedSession() {
        return undefined;
      },
      completeSession() {
        return session;
      },
      getRequestedChangeNote() {
        return undefined;
      },
      getSession(sessionId: string) {
        return sessionId === session.id ? session : undefined;
      },
      getTicket(ticketId: number) {
        return ticketId === ticket.id ? ticket : undefined;
      },
      updateExecutionAttempt() {
        return undefined;
      },
      updateSessionAdapterSessionRef() {
        return session;
      },
      updateSessionStatus(
        sessionId: string,
        status: ExecutionSession["status"],
        lastSummary: string | null = null,
      ) {
        if (sessionId !== session.id) {
          return undefined;
        }

        session = {
          ...session,
          last_summary: lastSummary,
          queue_entered_at:
            status === "queued" ? session.queue_entered_at : null,
          status,
        };
        return session;
      },
    } as never,
  });
  try {
    process.env.WALLEYBOARD_HOME = walleyBoardHome;
    session = {
      ...session,
      queue_entered_at: null,
      status: "awaiting_input",
    };
    runtime.startExecution({
      project,
      repository,
      ticket,
      session,
    });

    assert.equal(runtime.hasActiveExecution(session.id), true);

    socket = openTicketWorkspaceTerminal(String(ticket.id), {
      executionRuntime: {
        hasActiveExecution: runtime.hasActiveExecution.bind(runtime),
        startWorkspaceTerminal: runtime.startWorkspaceTerminal.bind(runtime),
      } as never,
      store: {
        getSession(sessionId: string) {
          return sessionId === session.id ? session : null;
        },
        getTicket(ticketId: number) {
          return ticketId === ticket.id ? ticket : null;
        },
      } as never,
    });

    const startedMessage = await socket.waitForMessage(
      (candidate) => candidate.type === "terminal.started",
    );
    assert.deepEqual(startedMessage, {
      type: "terminal.started",
      worktree_path: tempDir,
    });
  } finally {
    socket?.close();
    runtime.closeWorkspaceTerminals(session.id, "Test cleanup.");
    if (runtime.hasActiveExecution(session.id)) {
      await runtime.stopExecution(session.id, "Test cleanup.");
    }
    runtime.dispose();
    if (previousWalleyBoardHome === undefined) {
      delete process.env.WALLEYBOARD_HOME;
    } else {
      process.env.WALLEYBOARD_HOME = previousWalleyBoardHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});
