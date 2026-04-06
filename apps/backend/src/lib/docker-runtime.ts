import {
  type ChildProcessWithoutNullStreams,
  execFileSync,
  spawn,
} from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { type IPty, spawn as spawnPty } from "node-pty";
import {
  type ClaudeCodeAvailability,
  claudeCodeDockerSpec,
} from "./agent-adapters/claude-code-runtime.js";
import type { PreparedAgentRun } from "./agent-adapters/types.js";
import { resolveWalleyBoardHome } from "./walleyboard-paths.js";

export const dockerWorkspacePath = "/workspace";
export const dockerWalleyBoardHomePath = "/walleyboard-home";

const walleyboardNetworkSubnet = "172.30.99.0/24";
const walleyboardNetworkGateway = "172.30.99.1";

/**
 * The IP address where the host-side MCP sidecar listens, reachable
 * only from containers on the walleyboard Docker network.
 */
export const dockerHostAddress = walleyboardNetworkGateway;

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
  getClaudeCodeAvailability(): ClaudeCodeAvailability;
  assertClaudeCodeAvailable(): ClaudeCodeAvailability;
  cleanupStaleContainers(input?: {
    preserveSessionIds?: Iterable<string>;
  }): void;
  ensureSessionContainer(input: {
    dockerSpec: NonNullable<PreparedAgentRun["dockerSpec"]>;
    configFileOverrides?: ReadonlyArray<{
      hostPath: string;
      relativePath: string;
    }> | null;
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
  getSessionContainerInfo(sessionId: string): {
    id: string;
    name: string;
    projectId: string;
    ticketId: number;
    worktreePath: string;
  } | null;
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
  statSyncImpl?: typeof statSync;
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

function formatClaudeCodeAvailabilityError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Claude Code CLI is installed but could not be executed.";
  }

  const execError = error as ExecFileSyncError;
  const stderr = toText(execError.stderr);
  if (stderr.length > 0) {
    return `Claude Code CLI is unavailable: ${stderr}`;
  }

  return `Claude Code CLI is unavailable: ${error.message}`;
}

function validateClaudeConfigHome(configHomePath: string): string | null {
  if (!existsSync(configHomePath)) {
    return `Claude Code CLI is unavailable: Claude config directory ${configHomePath} does not exist.`;
  }

  try {
    if (readdirSync(configHomePath).length === 0) {
      return `Claude Code CLI is unavailable: Claude config directory ${configHomePath} is empty.`;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "could not be read";
    return `Claude Code CLI is unavailable: Claude config directory ${configHomePath} could not be read (${message}).`;
  }

  return null;
}

function buildContainerName(repoRootHash: string, sessionId: string): string {
  return `walleyboard-${repoRootHash.slice(0, 12)}-${sessionId}`;
}

function shellEscapeArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function buildUnattendedDockerCommand(
  command: string,
  args: string[],
): string[] {
  const wrappedCommand = [command, ...args].map(shellEscapeArg).join(" ");
  return [
    "bash",
    "-lc",
    `exec script -qefc ${shellEscapeArg(wrappedCommand)} /dev/null`,
  ];
}

function buildConfigMountSpecs(input: {
  configHomePath: string;
  configMountPath: string;
  configFileOverrides?:
    | ReadonlyArray<{ hostPath: string; relativePath: string }>
    | null
    | undefined;
  includeSiblingJsonFile?: boolean;
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

  if (input.includeSiblingJsonFile) {
    const siblingJsonPath = `${input.configHomePath}.json`;
    if (existsSync(siblingJsonPath)) {
      mounts.push(
        `type=bind,src=${siblingJsonPath},dst=${input.configMountPath}.json`,
      );
      if (hostPathAlias) {
        mounts.push(
          `type=bind,src=${siblingJsonPath},dst=${hostPathAlias}.json`,
        );
      }
    }
  }

  for (const override of input.configFileOverrides ?? []) {
    const mountTarget = join(input.configMountPath, override.relativePath);
    mounts.push(`type=bind,src=${override.hostPath},dst=${mountTarget}`);
    if (hostPathAlias) {
      mounts.push(
        `type=bind,src=${override.hostPath},dst=${join(hostPathAlias, override.relativePath)}`,
      );
    }
  }

  return mounts;
}

export class DockerRuntimeManager implements DockerRuntime {
  readonly #execFileSyncImpl: typeof execFileSync;
  readonly #spawnImpl: typeof spawn;
  readonly #spawnPtyImpl: typeof spawnPty;
  readonly #statSyncImpl: typeof statSync;
  readonly #repoRoot: string;
  readonly #repoRootHash: string;
  readonly #configHomeResolver: (configMountPath: string) => string;
  readonly #uid: number;
  readonly #gid: number;
  readonly #sessionContainers = new Map<string, SessionContainer>();
  #networkCreated = false;

  constructor(dependencies: DockerRuntimeDependencies = {}) {
    this.#execFileSyncImpl = dependencies.execFileSyncImpl ?? execFileSync;
    this.#spawnImpl = dependencies.spawnImpl ?? spawn;
    this.#spawnPtyImpl = dependencies.spawnPtyImpl ?? spawnPty;
    this.#statSyncImpl = dependencies.statSyncImpl ?? statSync;
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

  getClaudeCodeAvailability(): ClaudeCodeAvailability {
    const dockerHealth = this.getHealth();
    if (!dockerHealth.available) {
      return {
        available: false,
        detected_path: null,
        error:
          dockerHealth.error ??
          "Docker is configured for this project, but the daemon is unavailable.",
      };
    }

    const configHomePath = this.#resolveConfigHomePath(
      claudeCodeDockerSpec.configMountPath,
    );
    const configError = validateClaudeConfigHome(configHomePath);
    if (configError) {
      return {
        available: false,
        detected_path: null,
        error: configError,
      };
    }

    try {
      this.#ensureRuntimeImage(claudeCodeDockerSpec);
      const output = this.#runDocker([
        "run",
        "--rm",
        "--user",
        `${this.#uid}:${this.#gid}`,
        ...buildConfigMountSpecs({
          configHomePath,
          configMountPath: claudeCodeDockerSpec.configMountPath,
          includeSiblingJsonFile: true,
        }).flatMap((mountSpec) => ["--mount", mountSpec]),
        "-e",
        `HOME=${claudeCodeDockerSpec.homePath}`,
        claudeCodeDockerSpec.imageTag,
        "bash",
        "-lc",
        "command -v claude && claude --version >/dev/null",
      ]);
      const detectedPath =
        output
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.length > 0) ?? null;

      return {
        available: true,
        detected_path: detectedPath,
        error: null,
      };
    } catch (error) {
      const execError = error as ExecFileSyncError;
      const detectedPath =
        toText(execError.stdout)
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.length > 0) ?? null;

      return {
        available: false,
        detected_path: detectedPath,
        error: formatClaudeCodeAvailabilityError(error),
      };
    }
  }

  assertClaudeCodeAvailable(): ClaudeCodeAvailability {
    const availability = this.getClaudeCodeAvailability();
    if (!availability.available) {
      throw new Error(
        availability.error ??
          "Claude Code CLI is unavailable for this project.",
      );
    }

    return availability;
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
    configFileOverrides?: ReadonlyArray<{
      hostPath: string;
      relativePath: string;
    }> | null;
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
      configFileOverrides: input.configFileOverrides,
      includeSiblingJsonFile:
        input.dockerSpec.configMountPath ===
        claudeCodeDockerSpec.configMountPath,
    });

    const name = buildContainerName(this.#repoRootHash, input.sessionId);
    this.#removeContainerIfPresent(name);
    this.#ensureNetwork();

    const containerId = this.#runDocker([
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "--network",
      this.#networkName,
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
        ...buildUnattendedDockerCommand(command, args),
      ],
      options,
    );
  }

  getSessionContainerInfo(sessionId: string): {
    id: string;
    name: string;
    projectId: string;
    ticketId: number;
    worktreePath: string;
  } | null {
    const container = this.#sessionContainers.get(sessionId);
    if (!container) {
      return null;
    }

    return {
      id: container.id,
      name: container.name,
      projectId: container.projectId,
      ticketId: container.ticketId,
      worktreePath: container.worktreePath,
    };
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
    this.#removeNetworkIfCreated();
  }

  get #networkName(): string {
    return `walleyboard-${this.#repoRootHash.slice(0, 12)}`;
  }

  #ensureNetwork(): void {
    if (this.#networkCreated) {
      return;
    }

    // Check if the network already exists (e.g. from a previous run that
    // didn't shut down cleanly).
    try {
      this.#runDocker(["network", "inspect", this.#networkName]);
      this.#networkCreated = true;
      return;
    } catch {
      // Network doesn't exist yet — create it below.
    }

    this.#runDocker([
      "network",
      "create",
      "--driver",
      "bridge",
      "--subnet",
      walleyboardNetworkSubnet,
      "--gateway",
      walleyboardNetworkGateway,
      "--label",
      `${dockerManagedLabel}=true`,
      this.#networkName,
    ]);
    this.#networkCreated = true;
  }

  #removeNetworkIfCreated(): void {
    if (!this.#networkCreated) {
      return;
    }

    try {
      this.#runDocker(["network", "rm", this.#networkName]);
    } catch {
      // Network may already be removed or have active endpoints.
    }
    this.#networkCreated = false;
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
    if (!this.#runtimeImageNeedsBuild(dockerSpec)) {
      return;
    }

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

  #runtimeImageNeedsBuild(
    dockerSpec: NonNullable<PreparedAgentRun["dockerSpec"]>,
  ): boolean {
    const imageMetadata = this.#inspectRuntimeImage(dockerSpec.imageTag);
    if (!imageMetadata.exists) {
      return true;
    }

    if (imageMetadata.createdAtMs === null) {
      return false;
    }

    const dockerfileUpdatedAtMs = this.#getDockerfileUpdatedAtMs(
      dockerSpec.dockerfilePath,
    );
    if (dockerfileUpdatedAtMs === null) {
      return false;
    }

    return dockerfileUpdatedAtMs > imageMetadata.createdAtMs;
  }

  #inspectRuntimeImage(imageTag: string): {
    exists: boolean;
    createdAtMs: number | null;
  } {
    try {
      const createdAt = this.#runDocker([
        "image",
        "inspect",
        "--format",
        "{{.Created}}",
        imageTag,
      ]);
      const createdAtMs = Date.parse(createdAt);

      return {
        exists: true,
        createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : null,
      };
    } catch {
      return {
        exists: false,
        createdAtMs: null,
      };
    }
  }

  #getDockerfileUpdatedAtMs(dockerfilePath: string): number | null {
    try {
      return this.#statSyncImpl(join(this.#repoRoot, dockerfilePath)).mtimeMs;
    } catch {
      return null;
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
