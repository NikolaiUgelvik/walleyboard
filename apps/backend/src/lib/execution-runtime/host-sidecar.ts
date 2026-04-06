import { type ChildProcess, spawn } from "node:child_process";
import { createConnection, createServer } from "node:net";

import type { HostSidecar } from "../agent-adapters/types.js";

const defaultHealthCheckTimeoutMs = 5_000;
const healthCheckIntervalMs = 100;

/**
 * Wait for a TCP port to accept connections.
 */
function waitForPort(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    const attempt = () => {
      if (Date.now() > deadline) {
        reject(
          new Error(
            `Host sidecar health check timed out after ${timeoutMs}ms (${host}:${port}).`,
          ),
        );
        return;
      }

      const socket = createConnection({ port, host }, () => {
        socket.destroy();
        resolve();
      });

      socket.on("error", () => {
        socket.destroy();
        setTimeout(attempt, healthCheckIntervalMs);
      });
    };

    attempt();
  });
}

export type RunningHostSidecar = {
  process: ChildProcess;
  kill: () => void;
};

/**
 * Spawn a host-side sidecar process and wait for its health-check port to
 * accept connections before resolving. The caller is responsible for calling
 * `kill()` on the returned handle when the main process exits.
 */
export async function startHostSidecar(
  spec: HostSidecar,
): Promise<RunningHostSidecar> {
  const child = spawn(spec.command, spec.args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
    env: spec.env ? { ...process.env, ...spec.env } : undefined,
  });

  const kill = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      // Already exited.
    }
  };

  // If the process exits before the health check succeeds, reject early.
  const earlyExitPromise = new Promise<never>((_, reject) => {
    child.once("exit", (code, signal) => {
      reject(
        new Error(
          `Host sidecar exited before becoming ready (code=${code}, signal=${signal}).`,
        ),
      );
    });
    child.once("error", (err) => {
      reject(new Error(`Host sidecar failed to start: ${err.message}`));
    });
  });

  const timeoutMs = spec.healthCheckTimeoutMs ?? defaultHealthCheckTimeoutMs;

  await Promise.race([
    waitForPort(
      spec.healthCheckHost ?? "127.0.0.1",
      spec.healthCheckPort,
      timeoutMs,
    ),
    earlyExitPromise,
  ]);

  return { process: child, kill };
}

/**
 * Bind a temporary server to port 0 on the given host to get an
 * OS-assigned free port, then immediately close it and return the port.
 */
export function allocatePort(host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, host, () => {
      const addr = server.address();
      if (typeof addr === "object" && addr !== null) {
        const { port } = addr;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Failed to allocate port.")));
      }
    });
    server.on("error", reject);
  });
}
