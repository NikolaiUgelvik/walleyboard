import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import fastifyRateLimit from "fastify-rate-limit";
import { spawn as spawnPty } from "node-pty";

import type {
  ExecutionSession,
  Project,
  RepositoryConfig,
  TicketFrontmatter,
} from "../../../../packages/contracts/src/index.js";

import { AgentAdapterRegistry } from "../lib/agent-adapters/registry.js";
import { EventHub } from "../lib/event-hub.js";
import { ExecutionRuntime } from "../lib/execution-runtime.js";
import { registerTicketReadWorkspaceRoutes } from "./tickets/read-workspace-routes.js";
import type { TicketRouteDependencies } from "./tickets/shared.js";

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

async function waitForSocketClose(socket: WebSocketClient): Promise<void> {
  return await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error("Timed out waiting for workspace terminal socket close"),
      );
    }, 5_000);

    socket.addEventListener("close", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Workspace terminal socket errored"));
    });
  });
}

async function createApp(
  dependencies: Partial<TicketRouteDependencies>,
): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(websocket);
  await app.register(fastifyRateLimit, { global: false });
  const eventHub = dependencies.eventHub ?? new EventHub();
  const store = {
    appendSessionLog() {
      return 0;
    },
    getLatestReviewRun() {
      return null;
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
    }) {
      return spawnPty("bash", ["--noprofile", "--norc"], {
        cwd: worktreePath,
        env: {
          ...process.env,
          TERM: "xterm-256color",
        },
        cols: 120,
        rows: 32,
        name: "xterm-256color",
      });
    },
    ...(dependencies.executionRuntime ?? {}),
  };
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

function createProject(): Project {
  return {
    id: "project-1",
    slug: "project-1",
    name: "Project",
    agent_adapter: "codex",
    execution_backend: "host",
    default_review_action: "direct_merge",
    default_target_branch: "main",
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
  const app = await createApp({
    store: {
      getTicket(ticketId: number) {
        return ticketId === 11 ? { id: 11, session_id: null } : null;
      },
    } as never,
  });

  let socket: WebSocketClient | null = null;
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    socket = await openSocket(
      `${address.replace(/^http/, "ws")}/tickets/11/workspace/terminal`,
    );

    const message = await waitForSocketMessage(
      socket,
      (candidate) => candidate.type === "terminal.error",
    );

    assert.deepEqual(message, {
      type: "terminal.error",
      message: "Ticket has no prepared workspace yet",
    });
  } finally {
    socket?.close();
    await app.close();
  }
});

test("workspace terminal reports a clear error when the agent still owns the worktree", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-terminal-owned-"));
  const app = await createApp({
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

  let socket: WebSocketClient | null = null;
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    socket = await openSocket(
      `${address.replace(/^http/, "ws")}/tickets/13/workspace/terminal`,
    );

    const message = await waitForSocketMessage(
      socket,
      (candidate) => candidate.type === "terminal.error",
    );

    assert.deepEqual(message, {
      type: "terminal.error",
      message:
        "The agent still controls this worktree. Stop or finish the current run before opening the workspace terminal.",
    });
  } finally {
    socket?.close();
    await app.close();
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
    const app = await createApp({
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

    let socket: WebSocketClient | null = null;
    try {
      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      socket = await openSocket(
        `${address.replace(/^http/, "ws")}/tickets/${ticketId}/workspace/terminal`,
      );
      socket.send(
        JSON.stringify({
          type: "terminal.input",
          data: "exit\r",
        }),
      );

      const message = await waitForSocketMessage(
        socket,
        (candidate) => candidate.type === "terminal.exit",
      );

      assert.equal(message.type, "terminal.exit");
      assert.equal(message.exit_code, 0);
    } finally {
      socket?.close();
      await app.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
}

test("workspace terminal publishes shell exit messages for worktree sessions", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-terminal-"));
  const app = await createApp({
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

  let socket: WebSocketClient | null = null;
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    socket = await openSocket(
      `${address.replace(/^http/, "ws")}/tickets/12/workspace/terminal`,
    );
    socket.send(
      JSON.stringify({
        type: "terminal.input",
        data: "exit\r",
      }),
    );

    const message = await waitForSocketMessage(
      socket,
      (candidate) => candidate.type === "terminal.exit",
    );

    assert.equal(message.type, "terminal.exit");
    assert.equal(message.exit_code, 0);
  } finally {
    socket?.close();
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("workspace terminal closes when queued worktree ownership shifts back to the agent", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-terminal-runtime-"));
  const ticket = createTicket();
  let session = createSession(tempDir);
  const project = createProject();
  const repository = createRepository(tempDir);
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
            dockerSpec: null,
            outputPath: input.outputPath,
          };
        },
        buildMergeConflictRun() {
          throw new Error("merge-conflict runs are not used in this test");
        },
        buildReviewRun() {
          throw new Error("review runs are not used in this test");
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
        throw new Error("Docker is not used in this test");
      },
      cleanupSessionContainer() {},
      dispose() {},
      ensureSessionContainer() {},
      spawnPtyInSession() {
        throw new Error("Docker is not used in this test");
      },
    } as never,
    eventHub: {
      publish() {},
    } as never,
    store: {
      appendSessionLog() {
        return 0;
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
  const app = await createApp({
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

  let socket: WebSocketClient | null = null;
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    socket = await openSocket(
      `${address.replace(/^http/, "ws")}/tickets/${ticket.id}/workspace/terminal`,
    );

    const takeoverMessagePromise = waitForSocketMessage(
      socket,
      (candidate) => candidate.type === "terminal.error",
    );
    const closePromise = waitForSocketClose(socket);

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

    const message = await takeoverMessagePromise;
    assert.deepEqual(message, {
      type: "terminal.error",
      message:
        "The agent reclaimed this worktree and closed the workspace terminal.",
    });
    await closePromise;
    assert.equal(runtime.hasActiveExecution(session.id), true);
  } finally {
    if (runtime.hasActiveExecution(session.id)) {
      await runtime.stopExecution(session.id, "Test cleanup.");
    }
    socket?.close();
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
