import type { Server as HttpServer } from "node:http";

import { Server, type Socket } from "socket.io";

import { handleRepositoryWorkspaceTerminalConnection } from "../routes/projects.js";
import { handleTicketWorkspaceTerminalConnection } from "../routes/tickets/read-workspace-routes.js";
import type { TerminalSocket } from "../routes/workspace-terminal-socket.js";
import type { EventHub } from "./event-hub.js";
import type { ExecutionRuntime } from "./execution-runtime.js";
import type { Store } from "./store.js";

type CreateSocketServerInput = {
  eventHub: EventHub;
  executionRuntime: ExecutionRuntime;
  server: HttpServer;
  store: Store;
};

type ParsedTerminalSocketPath =
  | {
      kind: "ticket";
      ticketId: string;
    }
  | {
      kind: "repository";
      projectId: string;
      repositoryId: string;
    };

export function parseTerminalSocketPath(
  socketPath: string,
): ParsedTerminalSocketPath | null {
  const ticketMatch = /^\/tickets\/([^/]+)\/workspace\/terminal$/.exec(
    socketPath,
  );
  if (ticketMatch) {
    return {
      kind: "ticket",
      ticketId: ticketMatch[1] ?? "",
    };
  }

  const repositoryMatch =
    /^\/projects\/([^/]+)\/repositories\/([^/]+)\/workspace\/terminal$/.exec(
      socketPath,
    );
  if (repositoryMatch) {
    return {
      kind: "repository",
      projectId: repositoryMatch[1] ?? "",
      repositoryId: repositoryMatch[2] ?? "",
    };
  }

  return null;
}

function createTerminalSocketAdapter(socket: Socket): TerminalSocket {
  return {
    close: () => {
      socket.disconnect(true);
    },
    on: (event, listener) => {
      if (event === "close") {
        socket.on("disconnect", () => {
          listener();
        });
        return;
      }

      socket.on("terminal.message", (payload) => {
        listener(payload);
      });
    },
    send: (message) => {
      socket.emit("terminal.message", message);
    },
  };
}

function sendTerminalError(socket: Socket, message: string): void {
  socket.emit(
    "terminal.message",
    JSON.stringify({
      type: "terminal.error",
      message,
    }),
  );
  socket.disconnect(true);
}

function readTerminalSocketPath(socket: Socket): string | null {
  const authSocketPath = socket.handshake.auth.socketPath;
  if (typeof authSocketPath === "string" && authSocketPath.length > 0) {
    return authSocketPath;
  }

  const querySocketPath = socket.handshake.query.socketPath;
  return typeof querySocketPath === "string" && querySocketPath.length > 0
    ? querySocketPath
    : null;
}

export function createSocketServer({
  eventHub,
  executionRuntime,
  server,
  store,
}: CreateSocketServerInput) {
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.of("/events").on("connection", (socket) => {
    const unsubscribe = eventHub.subscribe((event) => {
      socket.emit("protocol.event", event);
    });

    socket.once("disconnect", unsubscribe);
  });

  io.of("/terminals").on("connection", (socket) => {
    const socketPath = readTerminalSocketPath(socket);
    if (!socketPath) {
      sendTerminalError(socket, "Terminal socket target is required");
      return;
    }

    const parsedPath = parseTerminalSocketPath(socketPath);
    if (!parsedPath) {
      sendTerminalError(socket, "Unknown terminal socket target");
      return;
    }

    const terminalSocket = createTerminalSocketAdapter(socket);
    if (parsedPath.kind === "ticket") {
      handleTicketWorkspaceTerminalConnection(
        terminalSocket,
        parsedPath.ticketId,
        {
          executionRuntime,
          store,
        },
      );
      return;
    }

    const project = store.getProject(parsedPath.projectId);
    const repository = store.getRepository(parsedPath.repositoryId);
    handleRepositoryWorkspaceTerminalConnection(terminalSocket, {
      executionRuntime,
      repository:
        project && repository?.project_id === project.id
          ? repository
          : undefined,
    });
  });

  return io;
}
