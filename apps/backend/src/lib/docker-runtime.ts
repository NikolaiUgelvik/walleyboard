import {
  type ChildProcessWithoutNullStreams,
  execFileSync,
  spawn,
} from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { type IPty, spawn as spawnPty } from "node-pty";
import type { PreparedAgentRun } from "./agent-adapters/types.js";
import { resolveWalleyBoardHome } from "./walleyboard-paths.js";

export const dockerWorkspacePath = "/workspace";
export const dockerWalleyBoardHomePath = "/walleyboard-home";

const dockerManagedLabel = "com.walleyboard.managed";
const dockerRepoRootHashLabel = "com.walleyboard.repo_root_hash";
const dockerProjectIdLabel = "com.walleyboard.project_id";
const dockerSessionIdLabel = "com.walleyboard.session_id";
const dockerTicketIdLabel = "com.walleyboard.ticket_id";

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

export interface DockerRuntime {
  getHealth(): DockerCapability;
  assertAvailable(): DockerCapability;
  cleanupStaleContainers(input?: {
    preserveSessionIds?: Iterable<string>;
  }): void;
  ensureSessionContainer(input: {
    dockerSpec: NonNullable<PreparedAgentRun["dockerSpec"]>;
    configTomlPath?: string | null;
    sessionId: string;
    projectId: string;
    ticketId: number;
    worktreePath: string;
  }): {
    id: string;
    name: string;
    projectId: string;
    ticketId: number;
    worktreePath: string;
  };
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
  ): IPty;
  spawnProcessInSession(
    sessionId: string,
    command: string,
    args: string[],
    options: {
      cwd: string;
      env: Record<string, string>;
    },
  ): ChildProcessWithoutNullStreams;
  cleanupSessionContainer(sessionId: string): void;
  dispose(): void;
}

type SessionContainer = {
  dockerSpec: NonNullable<PreparedAgentRun["dockerSpec"]>;
  id: string;
  name: string;
  projectId: string;
  ticketId: number;
  worktreePath: string;
};

type ManagedContainer = {
  id: string;
  sessionId: string | null;
};

type DockerRuntimeDependencies = {
  configHomeResolver?: (configMountPath: string) => string;
  execFileSyncImpl?: typeof execFileSync;
  spawnImpl?: typeof spawn;
  spawnPtyImpl?: typeof spawnPty;
  repoRoot?: string;
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
  return `walleyboard-${repoRootHash.slice(0, 12)}-${sessionId}`;
}

function buildConfigMountSpecs(input: {
  configHomePath: string;
  configMountPath: string;
  configTomlPath?: string | null | undefined;
}): string[] {
  const mounts = [
    `type=bind,src=${input.configHomePath},dst=${input.configMountPath}`,
  ];

  const hostHomePath = homedir();
  const hostPathAlias =
    input.configHomePath !== input.configMountPath &&
    input.configHomePath.startsWith(`${hostHomePath}/`)
      ? input.configHomePath
      : null;

  // Codex can persist absolute paths inside its state DB. When we reuse the
  // host ~/.codex directory inside Docker at a different HOME, those paths can
  // look stale unless the original host path is also reachable in-container.
  if (hostPathAlias) {
    mounts.push(`type=bind,src=${input.configHomePath},dst=${hostPathAlias}`);
  }

  if (input.configTomlPath) {
    mounts.push(
      `type=bind,src=${input.configTomlPath},dst=${input.configMountPath}/config.toml`,
    );
    if (hostPathAlias) {
      mounts.push(
        `type=bind,src=${input.configTomlPath},dst=${hostPathAlias}/config.toml`,
      );
    }
  }

  return mounts;
}

export class DockerRuntimeManager implements DockerRuntime {
  readonly #execFileSyncImpl: typeof execFileSync;
  readonly #spawnImpl: typeof spawn;
  readonly #spawnPtyImpl: typeof spawnPty;
  readonly #repoRoot: string;
  readonly #repoRootHash: string;
  readonly #configHomeResolver: (configMountPath: string) => string;
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
    this.#configHomeResolver =
      dependencies.configHomeResolver ??
      ((configMountPath: string) => join(homedir(), basename(configMountPath)));
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

  cleanupStaleContainers(input?: {
    preserveSessionIds?: Iterable<string>;
  }): void {
    const health = this.getHealth();
    if (!health.available) {
      return;
    }

    const preserveSessionIds = new Set(input?.preserveSessionIds ?? []);
    const staleContainers = this.#listManagedContainers()
      .filter(
        (container) =>
          !(container.sessionId && preserveSessionIds.has(container.sessionId)),
      )
      .map((container) => container.id);
    if (staleContainers.length === 0) {
      return;
    }

    this.#runDocker(["rm", "-f", ...staleContainers]);
  }

  ensureSessionContainer(input: {
    dockerSpec: NonNullable<PreparedAgentRun["dockerSpec"]>;
    configTomlPath?: string | null;
    sessionId: string;
    projectId: string;
    ticketId: number;
    worktreePath: string;
  }): SessionContainer {
    this.assertAvailable();
    this.#ensureRuntimeImage(input.dockerSpec);
    const configHomePath = this.#resolveConfigHomePath(
      input.dockerSpec.configMountPath,
    );
    const walleyBoardHomePath = resolveWalleyBoardHome();
    this.#ensureConfigHome(configHomePath);
    this.#ensureWalleyBoardHome(walleyBoardHomePath);
    const configMountSpecs = buildConfigMountSpecs({
      configHomePath,
      configMountPath: input.dockerSpec.configMountPath,
      configTomlPath: input.configTomlPath,
    });

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
      ...configMountSpecs.flatMap((mountSpec) => ["--mount", mountSpec]),
      "--mount",
      `type=bind,src=${input.worktreePath},dst=${dockerWorkspacePath}`,
      "--mount",
      `type=bind,src=${walleyBoardHomePath},dst=${dockerWalleyBoardHomePath}`,
      "-e",
      `HOME=${input.dockerSpec.homePath}`,
      input.dockerSpec.imageTag,
      "tail",
      "-f",
      "/dev/null",
    ]);

    const container = {
      dockerSpec: input.dockerSpec,
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
        `HOME=${container.dockerSpec.homePath}`,
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
        `HOME=${container.dockerSpec.homePath}`,
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

  #ensureRuntimeImage(
    dockerSpec: NonNullable<PreparedAgentRun["dockerSpec"]>,
  ): void {
    try {
      this.#runDocker(["image", "inspect", dockerSpec.imageTag]);
      return;
    } catch {
      this.#runDocker([
        "build",
        "--pull",
        "--tag",
        dockerSpec.imageTag,
        "--file",
        join(this.#repoRoot, dockerSpec.dockerfilePath),
        this.#repoRoot,
      ]);
    }
  }

  #ensureConfigHome(configHomePath: string): void {
    if (!existsSync(configHomePath)) {
      mkdirSync(configHomePath, { recursive: true });
    }
  }

  #ensureWalleyBoardHome(walleyBoardHomePath: string): void {
    if (!existsSync(walleyBoardHomePath)) {
      mkdirSync(walleyBoardHomePath, { recursive: true });
    }
  }

  #resolveConfigHomePath(configMountPath: string): string {
    return this.#configHomeResolver(configMountPath);
  }

  #listManagedContainers(): ManagedContainer[] {
    const output = this.#runDocker([
      "ps",
      "-aq",
      "--filter",
      `label=${dockerManagedLabel}=true`,
      "--filter",
      `label=${dockerRepoRootHashLabel}=${this.#repoRootHash}`,
      "--format",
      "{{.ID}}|{{.Labels}}",
    ]);

    if (output.length === 0) {
      return [];
    }

    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const [rawId = "", labelList = ""] = line.split("|");
        const sessionLabel = labelList
          .split(",")
          .map((entry) => entry.trim())
          .find((entry) => entry.startsWith(`${dockerSessionIdLabel}=`));

        return {
          id: rawId,
          sessionId: sessionLabel
            ? sessionLabel.slice(`${dockerSessionIdLabel}=`.length)
            : null,
        };
      });
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
