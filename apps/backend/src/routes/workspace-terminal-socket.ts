import type { WorkspaceTerminalRuntime } from "../lib/execution-runtime/terminal-runtime.js";

type TerminalInputMessage = {
  type: "terminal.input";
  data: string;
};

type TerminalResizeMessage = {
  type: "terminal.resize";
  cols: number;
  rows: number;
};

export type TerminalSocket = {
  close: () => void;
  on: (
    event: "close" | "message",
    listener: (payload?: unknown) => void,
  ) => void;
  send: (message: string) => void;
};

type StartWorkspaceTerminal = (input: {
  sessionId: string;
  worktreePath: string;
}) => WorkspaceTerminalRuntime;

function isTerminalInputMessage(value: unknown): value is TerminalInputMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return record.type === "terminal.input" && typeof record.data === "string";
}

function isTerminalResizeMessage(
  value: unknown,
): value is TerminalResizeMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    record.type === "terminal.resize" &&
    typeof record.cols === "number" &&
    Number.isFinite(record.cols) &&
    record.cols > 0 &&
    typeof record.rows === "number" &&
    Number.isFinite(record.rows) &&
    record.rows > 0
  );
}

function sendTerminalMessage(
  socket: TerminalSocket,
  message: Record<string, unknown>,
): void {
  socket.send(JSON.stringify(message));
}

export function attachWorkspaceTerminalSocket(
  socket: TerminalSocket,
  input: {
    sessionId: string;
    startWorkspaceTerminal: StartWorkspaceTerminal;
    startErrorMessage?: string;
    worktreePath: string;
  },
): void {
  let terminal: WorkspaceTerminalRuntime;

  try {
    terminal = input.startWorkspaceTerminal({
      sessionId: input.sessionId,
      worktreePath: input.worktreePath,
    });
  } catch (error) {
    sendTerminalMessage(socket, {
      type: "terminal.error",
      message:
        error instanceof Error
          ? error.message
          : (input.startErrorMessage ?? "Workspace terminal failed to start"),
    });
    socket.close();
    return;
  }

  sendTerminalMessage(socket, {
    type: "terminal.started",
    worktree_path: input.worktreePath,
  });

  terminal.pty.onData((data) => {
    sendTerminalMessage(socket, {
      type: "terminal.output",
      data,
    });
  });

  terminal.pty.onExit(({ exitCode, signal }) => {
    if (terminal.exitMessage) {
      sendTerminalMessage(socket, {
        type: "terminal.error",
        message: terminal.exitMessage,
      });
    }

    sendTerminalMessage(socket, {
      type: "terminal.exit",
      exit_code: exitCode,
      signal,
    });
    socket.close();
  });

  socket.on("message", (rawMessage: unknown) => {
    try {
      const message = JSON.parse(String(rawMessage)) as unknown;

      if (isTerminalInputMessage(message)) {
        if (message.data.length > 0) {
          terminal.pty.write(message.data);
        }
        return;
      }

      if (isTerminalResizeMessage(message)) {
        terminal.pty.resize(
          Math.max(1, Math.floor(message.cols)),
          Math.max(1, Math.floor(message.rows)),
        );
      }
    } catch {
      sendTerminalMessage(socket, {
        type: "terminal.error",
        message: "Unable to parse terminal message",
      });
    }
  });

  socket.on("close", () => {
    try {
      terminal.pty.kill();
    } catch {
      // Ignore already-exited terminals during socket cleanup.
    }
  });
}
