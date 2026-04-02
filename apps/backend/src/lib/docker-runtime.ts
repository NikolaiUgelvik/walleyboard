import {
  type ChildProcessWithoutNullStreams,
  execFileSync,
  spawn,
} from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { type IPty, spawn as spawnPty } from "node-pty";

export const dockerWorkspacePath = "/workspace";
export const dockerHomePath = "/home/codex";
export const dockerCodexConfigPath = `${dockerHomePath}/.codex`;
export const dockerRuntimeImageTag =
  "orchestrator/codex-runtime:ubuntu-24.04-node-24";

const dockerManagedLabel = "com.orchestrator.managed";
const dockerRepoRootHashLabel = "com.orchestrator.repo_root_hash";
const dockerProjectIdLabel = "com.orchestrator.project_id";
const dockerSessionIdLabel = "com.orchestrator.session_id";
const dockerTicketIdLabel = "com.orchestrator.ticket_id";

type ExecFileSyncError = Error & {
  code?: string;
  stderr?: Buffer | string;
  stdout?: Buffer | string;
};

export type DockerCapability = {
  installed: boolean;
  available: boolean;
  client_version: string | null;
  server_version: string | null;
  error: string | null;
};

type SessionContainer = {
  id: string;
  name: string;
  projectId: string;
  ticketId: number;
  worktreePath: string;
};

type DockerRuntimeDependencies = {
  execFileSyncImpl?: typeof execFileSync;
  spawnImpl?: typeof spawn;
  spawnPtyImpl?: typeof spawnPty;
  repoRoot?: string;
  codexHomePath?: string;
  uid?: number;
  gid?: number;
};

function toText(value: Buffer | string | undefined): string {
  if (typeof value === "string") {
    return value.trim();
  }

  return value ? value.toString("utf8").trim() : "";
}

function buildContainerName(repoRootHash: string, sessionId: string): string {
  return `orchestrator-${repoRootHash.slice(0, 12)}-${sessionId}`;
}

export class DockerRuntimeManager {
  readonly #execFileSyncImpl: typeof execFileSync;
  readonly #spawnImpl: typeof spawn;
  readonly #spawnPtyImpl: typeof spawnPty;
  readonly #repoRoot: string;
  readonly #repoRootHash: string;
  readonly #codexHomePath: string;
  readonly #uid: number;
  readonly #gid: number;
  readonly #sessionContainers = new Map<string, SessionContainer>();

  constructor(dependencies: DockerRuntimeDependencies = {}) {
    this.#execFileSyncImpl = dependencies.execFileSyncImpl ?? execFileSync;
    this.#spawnImpl = dependencies.spawnImpl ?? spawn;
    this.#spawnPtyImpl = dependencies.spawnPtyImpl ?? spawnPty;
    this.#repoRoot = dependencies.repoRoot ?? process.cwd();
    this.#repoRootHash = createHash("sha256")
      .update(this.#repoRoot)
      .digest("hex");
    this.#codexHomePath =
      dependencies.codexHomePath ?? join(homedir(), ".codex");
    this.#uid = dependencies.uid ?? process.getuid?.() ?? 1000;
    this.#gid = dependencies.gid ?? process.getgid?.() ?? 1000;
  }

  getHealth(): DockerCapability {
    try {
      const output = this.#execFileSyncImpl(
        "docker",
        ["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      ).trim();
      const [clientVersion, serverVersion] = output.split("|");

      return {
        installed: true,
        available: true,
        client_version: clientVersion?.trim() || null,
        server_version: serverVersion?.trim() || null,
        error: null,
      };
    } catch (error) {
      const dockerError = error as ExecFileSyncError;
      if (dockerError.code === "ENOENT") {
        return {
          installed: false,
          available: false,
          client_version: null,
          server_version: null,
          error: "Docker is not installed on this machine.",
        };
      }

      const stdout = toText(dockerError.stdout);
      const stderr = toText(dockerError.stderr);
      const [clientVersion, serverVersion] = stdout.split("|");

      return {
        installed: true,
        available: false,
        client_version: clientVersion?.trim() || null,
        server_version: serverVersion?.trim() || null,
        error:
          stderr ||
          dockerError.message ||
          "Docker is installed, but the daemon is unavailable.",
      };
    }
  }

  assertAvailable(): DockerCapability {
    const health = this.getHealth();
    if (!health.available) {
      throw new Error(
        health.error ??
          "Docker is configured for this project, but the daemon is unavailable.",
      );
    }

    return health;
  }

  cleanupStaleContainers(): void {
    const health = this.getHealth();
    if (!health.available) {
      return;
    }

    const staleContainers = this.#listManagedContainers();
    if (staleContainers.length === 0) {
      return;
    }

    this.#runDocker(["rm", "-f", ...staleContainers]);
  }

  ensureSessionContainer(input: {
    sessionId: string;
    projectId: string;
    ticketId: number;
    worktreePath: string;
  }): SessionContainer {
    this.assertAvailable();
    this.#ensureRuntimeImage();
    this.#ensureCodexHome();

    const name = buildContainerName(this.#repoRootHash, input.sessionId);
    this.#removeContainerIfPresent(name);

    const containerId = this.#runDocker([
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "--label",
      `${dockerManagedLabel}=true`,
      "--label",
      `${dockerRepoRootHashLabel}=${this.#repoRootHash}`,
      "--label",
      `${dockerProjectIdLabel}=${input.projectId}`,
      "--label",
      `${dockerSessionIdLabel}=${input.sessionId}`,
      "--label",
      `${dockerTicketIdLabel}=${input.ticketId}`,
      "--user",
      `${this.#uid}:${this.#gid}`,
      "--workdir",
      dockerWorkspacePath,
      "--mount",
      `type=bind,src=${this.#codexHomePath},dst=${dockerCodexConfigPath}`,
      "--mount",
      `type=bind,src=${input.worktreePath},dst=${dockerWorkspacePath}`,
      "-e",
      `HOME=${dockerHomePath}`,
      dockerRuntimeImageTag,
      "tail",
      "-f",
      "/dev/null",
    ]);

    const container = {
      id: containerId,
      name,
      projectId: input.projectId,
      ticketId: input.ticketId,
      worktreePath: input.worktreePath,
    } satisfies SessionContainer;
    this.#sessionContainers.set(input.sessionId, container);
    return container;
  }

  spawnPtyInSession(
    sessionId: string,
    command: string,
    args: string[],
    options: {
      cols: number;
      rows: number;
      cwd: string;
      env: Record<string, string>;
      name: string;
    },
  ): IPty {
    const container = this.#requireSessionContainer(sessionId);

    return this.#spawnPtyImpl(
      "docker",
      [
        "exec",
        "-i",
        "-t",
        "-w",
        dockerWorkspacePath,
        "-e",
        `HOME=${dockerHomePath}`,
        container.id,
        command,
        ...args,
      ],
      options,
    );
  }

  spawnProcessInSession(
    sessionId: string,
    command: string,
    args: string[],
    options: {
      cwd: string;
      env: Record<string, string>;
    },
  ): ChildProcessWithoutNullStreams {
    const container = this.#requireSessionContainer(sessionId);

    return this.#spawnImpl(
      "docker",
      [
        "exec",
        "-i",
        "-w",
        dockerWorkspacePath,
        "-e",
        `HOME=${dockerHomePath}`,
        container.id,
        command,
        ...args,
      ],
      options,
    );
  }

  cleanupSessionContainer(sessionId: string): void {
    const trackedContainer = this.#sessionContainers.get(sessionId);
    const name =
      trackedContainer?.name ??
      buildContainerName(this.#repoRootHash, sessionId);

    this.#sessionContainers.delete(sessionId);
    this.#removeContainerIfPresent(name);
  }

  dispose(): void {
    for (const sessionId of [...this.#sessionContainers.keys()]) {
      this.cleanupSessionContainer(sessionId);
    }

    this.cleanupStaleContainers();
  }

  #requireSessionContainer(sessionId: string): SessionContainer {
    const container = this.#sessionContainers.get(sessionId);
    if (!container) {
      throw new Error(
        `No Docker container is prepared for session ${sessionId}.`,
      );
    }

    return container;
  }

  #ensureRuntimeImage(): void {
    try {
      this.#runDocker(["image", "inspect", dockerRuntimeImageTag]);
      return;
    } catch {
      this.#runDocker([
        "build",
        "--pull",
        "--tag",
        dockerRuntimeImageTag,
        "--file",
        join(
          this.#repoRoot,
          "apps",
          "backend",
          "docker",
          "codex-runtime.Dockerfile",
        ),
        this.#repoRoot,
      ]);
    }
  }

  #ensureCodexHome(): void {
    if (!existsSync(this.#codexHomePath)) {
      mkdirSync(this.#codexHomePath, { recursive: true });
    }
  }

  #listManagedContainers(): string[] {
    const output = this.#runDocker([
      "ps",
      "-aq",
      "--filter",
      `label=${dockerManagedLabel}=true`,
      "--filter",
      `label=${dockerRepoRootHashLabel}=${this.#repoRootHash}`,
    ]);

    if (output.length === 0) {
      return [];
    }

    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  #removeContainerIfPresent(name: string): void {
    try {
      this.#runDocker(["rm", "-f", name]);
    } catch {
      // Ignore missing-container cleanup failures.
    }
  }

  #runDocker(args: string[]): string {
    return this.#execFileSyncImpl("docker", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }
}
