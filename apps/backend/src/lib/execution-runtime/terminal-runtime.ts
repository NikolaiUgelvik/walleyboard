import { type IPty, spawn as spawnPty } from "node-pty";

import type { EventHub } from "../event-hub.js";
import type { Store } from "../store.js";
import { buildProcessEnv } from "./helpers.js";
import { publishSessionOutput } from "./publishers.js";
import { resolveTrackedExit } from "./waiters.js";

export type WorkspaceTerminalRuntime = {
  notifyAgentTakeover: () => void;
  pty: IPty;
};

export const workspaceTerminalAgentControlMessage =
  "The agent still controls this worktree. Stop or finish the current run before opening the workspace terminal.";

export function disposeTrackedWorkspaceTerminals(
  workspaceTerminals: Map<string, Set<WorkspaceTerminalRuntime>>,
): void {
  for (const terminals of workspaceTerminals.values()) {
    for (const terminal of terminals) {
      terminal.pty.kill("SIGTERM");
    }
  }
}

export function startTrackedWorkspaceTerminal(input: {
  activeSessions: Map<string, IPty>;
  onAgentTakeover?: () => void;
  sessionId: string;
  worktreePath: string;
  workspaceTerminals: Map<string, Set<WorkspaceTerminalRuntime>>;
}): IPty {
  if (input.activeSessions.has(input.sessionId)) {
    throw new Error(workspaceTerminalAgentControlMessage);
  }

  let child: IPty;

  try {
    child = spawnPty("bash", ["--noprofile", "--norc"], {
      cwd: input.worktreePath,
      env: {
        ...buildProcessEnv(),
        TERM: "xterm-256color",
      },
      cols: 120,
      rows: 32,
      name: "xterm-256color",
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Workspace terminal failed to start";
    throw new Error(message);
  }

  const runtime: WorkspaceTerminalRuntime = {
    notifyAgentTakeover: input.onAgentTakeover ?? (() => {}),
    pty: child,
  };
  const existingTerminals = input.workspaceTerminals.get(input.sessionId);
  const sessionTerminals = existingTerminals ?? new Set();
  if (!existingTerminals) {
    input.workspaceTerminals.set(input.sessionId, sessionTerminals);
  }
  sessionTerminals.add(runtime);

  child.onExit(() => {
    sessionTerminals.delete(runtime);
    if (input.workspaceTerminals.get(input.sessionId) !== sessionTerminals) {
      return;
    }

    if (sessionTerminals.size === 0) {
      input.workspaceTerminals.delete(input.sessionId);
    }
  });

  return child;
}

export function closeTrackedWorkspaceTerminalsForExecution(input: {
  sessionId: string;
  workspaceTerminals: Map<string, Set<WorkspaceTerminalRuntime>>;
}): void {
  const terminals = input.workspaceTerminals.get(input.sessionId);
  if (!terminals || terminals.size === 0) {
    return;
  }

  input.workspaceTerminals.delete(input.sessionId);
  for (const terminal of terminals) {
    try {
      terminal.notifyAgentTakeover();
    } catch {
      // Ignore disconnected clients while reclaiming the worktree.
    }
    try {
      terminal.pty.kill("SIGKILL");
    } catch {
      // Ignore already-exited terminals while reclaiming the worktree.
    }
  }
}

export function startTrackedManualTerminal(input: {
  attemptId: string | null;
  eventHub: EventHub;
  manualExitWaiters: Map<string, Set<(didExit: boolean) => void>>;
  manualTerminals: Map<string, { pty: IPty; attemptId: string | null }>;
  sessionId: string;
  stoppingManualTerminals: Map<string, string>;
  store: Store;
  worktreePath: string;
}): void {
  if (input.manualTerminals.has(input.sessionId)) {
    return;
  }

  let child: IPty;

  try {
    child = spawnPty("bash", ["--noprofile", "--norc"], {
      cwd: input.worktreePath,
      env: {
        ...buildProcessEnv(),
        TERM: "dumb",
      },
      cols: 120,
      rows: 32,
      name: "xterm-256color",
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Manual terminal failed to start";
    throw new Error(message);
  }

  const logAttemptId =
    input.attemptId ??
    input.store.getSession(input.sessionId)?.current_attempt_id ??
    input.sessionId;
  input.manualTerminals.set(input.sessionId, {
    pty: child,
    attemptId: input.attemptId,
  });
  publishSessionOutput(
    input.eventHub,
    input.store,
    input.sessionId,
    logAttemptId,
    `Manual terminal opened in ${input.worktreePath}`,
  );

  let pendingBuffer = "";

  child.onData((chunk) => {
    pendingBuffer += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    while (pendingBuffer.includes("\n")) {
      const newlineIndex = pendingBuffer.indexOf("\n");
      const line = pendingBuffer.slice(0, newlineIndex);
      pendingBuffer = pendingBuffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        publishSessionOutput(
          input.eventHub,
          input.store,
          input.sessionId,
          logAttemptId,
          `[terminal] ${line}`,
        );
      }
    }
  });

  child.onExit(() => {
    if (pendingBuffer.trim().length > 0) {
      publishSessionOutput(
        input.eventHub,
        input.store,
        input.sessionId,
        logAttemptId,
        `[terminal] ${pendingBuffer.trim()}`,
      );
      pendingBuffer = "";
    }

    input.stoppingManualTerminals.delete(input.sessionId);
    input.manualTerminals.delete(input.sessionId);
    publishSessionOutput(
      input.eventHub,
      input.store,
      input.sessionId,
      logAttemptId,
      "Manual terminal closed.",
    );
    resolveTrackedExit(input.manualExitWaiters, input.sessionId, true);
  });
}
