import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import fastifyRateLimit from "fastify-rate-limit";

import { EventHub } from "../lib/event-hub.js";
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

async function createApp(
  dependencies: Partial<TicketRouteDependencies>,
): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(websocket);
  await app.register(fastifyRateLimit, { global: false });
  registerTicketReadWorkspaceRoutes(app, {
    agentReviewService: {} as never,
    appendSessionOutput() {},
    eventHub: new EventHub(),
    executionRuntime: {} as never,
    githubPullRequestService: {} as never,
    store: {
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
    } as never,
    ticketWorkspaceService: {} as never,
    ...dependencies,
  });
  return app;
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

test("workspace terminal publishes shell exit messages for worktree sessions", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-terminal-"));
  const app = await createApp({
    store: {
      getSession(sessionId: string) {
        return sessionId === "session-12"
          ? { id: "session-12", worktree_path: tempDir }
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
