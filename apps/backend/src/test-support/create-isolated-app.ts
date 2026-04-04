import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { IPty } from "node-pty";

import { type CreateAppOptions, createApp } from "../app.js";
import type { ClaudeCodeAvailability } from "../lib/agent-adapters/claude-code-runtime.js";
import type { DockerCapability, DockerRuntime } from "../lib/docker-runtime.js";

type CleanupStaleContainersCall = {
  preserveSessionIds: string[];
};

export type TestDockerRuntime = DockerRuntime & {
  cleanupSessionContainerCalls: string[];
  cleanupStaleContainersCalls: CleanupStaleContainersCall[];
  disposeCalls: number;
  ensureSessionContainerCalls: string[];
};

export function createTestDockerRuntime(
  healthOverrides: Partial<DockerCapability> = {},
): TestDockerRuntime {
  const health: DockerCapability = {
    installed: true,
    available: true,
    client_version: "test-client",
    server_version: "test-server",
    error: null,
    ...healthOverrides,
  };
  const trackedSessionIds = new Set<string>();
  const cleanupStaleContainersCalls: CleanupStaleContainersCall[] = [];
  const cleanupSessionContainerCalls: string[] = [];
  const ensureSessionContainerCalls: string[] = [];
  let disposeCalls = 0;
  const claudeCodeAvailability: ClaudeCodeAvailability = {
    available: true,
    detected_path: "/usr/local/bin/claude",
    error: null,
  };

  const runtime: TestDockerRuntime = {
    get cleanupSessionContainerCalls() {
      return cleanupSessionContainerCalls;
    },
    get cleanupStaleContainersCalls() {
      return cleanupStaleContainersCalls;
    },
    get disposeCalls() {
      return disposeCalls;
    },
    get ensureSessionContainerCalls() {
      return ensureSessionContainerCalls;
    },
    getHealth() {
      return health;
    },
    assertAvailable() {
      if (!health.available) {
        throw new Error(
          health.error ??
            "Docker is configured for this project, but the daemon is unavailable.",
        );
      }

      return health;
    },
    getClaudeCodeAvailability() {
      return claudeCodeAvailability;
    },
    assertClaudeCodeAvailable() {
      if (!claudeCodeAvailability.available) {
        throw new Error(
          claudeCodeAvailability.error ??
            "Claude Code CLI is unavailable for this project.",
        );
      }

      return claudeCodeAvailability;
    },
    cleanupStaleContainers(input) {
      cleanupStaleContainersCalls.push({
        preserveSessionIds: [...(input?.preserveSessionIds ?? [])],
      });
    },
    ensureSessionContainer(input) {
      ensureSessionContainerCalls.push(input.sessionId);
      trackedSessionIds.add(input.sessionId);
      return {
        id: `container-${input.sessionId}`,
        name: `test-container-${input.sessionId}`,
        projectId: input.projectId,
        ticketId: input.ticketId,
        worktreePath: input.worktreePath,
      };
    },
    spawnPtyInSession(): IPty {
      throw new Error("Test Docker runtime does not spawn PTYs.");
    },
    spawnProcessInSession(): ChildProcessWithoutNullStreams {
      throw new Error("Test Docker runtime does not spawn child processes.");
    },
    cleanupSessionContainer(sessionId) {
      trackedSessionIds.delete(sessionId);
      cleanupSessionContainerCalls.push(sessionId);
    },
    dispose() {
      disposeCalls += 1;
      for (const sessionId of [...trackedSessionIds]) {
        runtime.cleanupSessionContainer(sessionId);
      }
    },
  };

  return runtime;
}

type CreateIsolatedAppResult = {
  app: FastifyInstance;
  dockerRuntime: TestDockerRuntime;
  tempDir: string;
  close: () => Promise<void>;
};

export async function createIsolatedApp(
  options: Omit<CreateAppOptions, "dockerRuntime"> & {
    dockerRuntime?: TestDockerRuntime;
  } = {},
): Promise<CreateIsolatedAppResult> {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-test-app-"));
  const previousWalleyBoardHome = process.env.WALLEYBOARD_HOME;
  process.env.WALLEYBOARD_HOME = join(tempDir, ".walleyboard-home");

  const dockerRuntime = options.dockerRuntime ?? createTestDockerRuntime();
  const app = await createApp({
    ...options,
    dockerRuntime,
  });

  return {
    app,
    dockerRuntime,
    tempDir,
    close: async () => {
      try {
        await app.close();
      } finally {
        if (previousWalleyBoardHome === undefined) {
          delete process.env.WALLEYBOARD_HOME;
        } else {
          process.env.WALLEYBOARD_HOME = previousWalleyBoardHome;
        }
        rmSync(tempDir, { recursive: true, force: true });
      }
    },
  };
}
