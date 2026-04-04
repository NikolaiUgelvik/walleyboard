import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, type FSWatcher, readFileSync, watch } from "node:fs";
import net from "node:net";

import type {
  TicketWorkspaceDiff,
  TicketWorkspacePreview,
} from "../../../../packages/contracts/src/index.js";

import { type EventHub, makeProtocolEvent } from "./event-hub.js";
import { nowIso } from "./time.js";

type GitExecError = Error & {
  status?: number | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
};

type WatchRegistration = {
  debounceTimer: NodeJS.Timeout | null;
  watchers: FSWatcher[];
};

type PreviewProcess = {
  command: string;
  handle: PreviewProcessHandle;
  label: "backend" | "frontend" | "preview";
};

export type RepositoryWorkspacePreview = {
  repository_id: string;
  state: TicketWorkspacePreview["state"];
  preview_url: string | null;
  backend_url: string | null;
  started_at: string | null;
  error: string | null;
};

type PreviewRuntime = {
  key: string;
  repositoryId: string | null;
  ticketId: number | null;
  backendUrl: string | null;
  error: string | null;
  previewStartCommand: string | null;
  previewUrl: string | null;
  processes: PreviewProcess[];
  startedAt: string | null;
  startPromise: Promise<void> | null;
  state: TicketWorkspacePreview["state"];
  stopping: boolean;
  worktreePath: string;
  logs: string[];
};

type PreviewProcessHandle = {
  readonly exitCode: number | null;
  readonly pid: number | undefined;
  onStderr: (listener: (chunk: string) => void) => void;
  onStdout: (listener: (chunk: string) => void) => void;
  onceExit: (
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ) => void;
  stop: () => void;
  stopAndWait: (timeoutMs?: number) => Promise<void>;
  unref: () => void;
};

type PreviewRuntimeDependencies = {
  findAvailablePort: () => Promise<number>;
  spawnPreviewProcess: (input: {
    command: string;
    env: Record<string, string>;
    worktreePath: string;
  }) => PreviewProcessHandle;
  waitForPort: (
    port: number,
    handle: PreviewProcessHandle,
    processDescription: string,
    timeoutMs?: number,
  ) => Promise<void>;
};

function parseGitOutput(error: GitExecError): {
  exitCode: number | null;
  stderr: string;
  stdout: string;
} {
  return {
    exitCode: error.status ?? null,
    stdout:
      typeof error.stdout === "string"
        ? error.stdout
        : (error.stdout?.toString("utf8") ?? ""),
    stderr:
      typeof error.stderr === "string"
        ? error.stderr
        : (error.stderr?.toString("utf8") ?? ""),
  };
}

function runGit(
  repoPath: string,
  args: string[],
  options?: {
    allowExitCodes?: number[];
  },
): string {
  const allowExitCodes = options?.allowExitCodes ?? [0];

  try {
    return execFileSync("git", ["-C", repoPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const gitError = error as GitExecError;
    const parsed = parseGitOutput(gitError);
    if (parsed.exitCode !== null && allowExitCodes.includes(parsed.exitCode)) {
      return parsed.stdout;
    }

    const detail =
      parsed.stderr.trim() ||
      parsed.stdout.trim() ||
      gitError.message ||
      "Unknown git failure";
    throw new Error(`Git command failed (${args.join(" ")}): ${detail}`);
  }
}

function parsePackageScripts(
  worktreePath: string,
): Record<string, string> | null {
  const packageJsonPath = `${worktreePath}/package.json`;
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    return parsed.scripts ?? null;
  } catch {
    return null;
  }
}

function resolveConfiguredRepositoryPreviewCommand(input: {
  command: string;
  port: number;
  worktreePath: string;
}): string {
  const normalizedCommand = input.command.trim();
  const scripts = parsePackageScripts(input.worktreePath);

  if (normalizedCommand === "npm run dev" && scripts?.dev) {
    return `npm run dev -- --host 127.0.0.1 --port ${input.port}`;
  }

  if (normalizedCommand === "npm run dev:web" && scripts?.["dev:web"]) {
    return `npm run dev:web -- -- --host 127.0.0.1 --port ${input.port}`;
  }

  if (
    /^npm\s+--workspace\s+\S+\s+run\s+dev$/.test(normalizedCommand) &&
    scripts?.dev
  ) {
    return `${normalizedCommand} -- --host 127.0.0.1 --port ${input.port}`;
  }

  if (
    /^npm\s+--workspace\s+\S+\s+run\s+dev:web$/.test(normalizedCommand) &&
    scripts?.["dev:web"]
  ) {
    return `${normalizedCommand} -- -- --host 127.0.0.1 --port ${input.port}`;
  }

  return normalizedCommand;
}

function isGitInternalPath(filename: string | null): boolean {
  if (!filename) {
    return false;
  }

  return filename === ".git" || filename.startsWith(".git/");
}

function getTicketPreviewKey(ticketId: number): string {
  return `ticket:${ticketId}`;
}

function getRepositoryPreviewKey(repositoryId: string): string {
  return `repository:${repositoryId}`;
}

function makeTicketPreviewSnapshot(
  runtime: PreviewRuntime,
): TicketWorkspacePreview {
  if (runtime.ticketId === null) {
    throw new Error("Ticket preview runtime is missing its ticket id");
  }

  return {
    ticket_id: runtime.ticketId,
    state: runtime.state,
    preview_url: runtime.previewUrl,
    backend_url: runtime.backendUrl,
    started_at: runtime.startedAt,
    error: runtime.error,
  };
}

function makeRepositoryPreviewSnapshot(
  runtime: PreviewRuntime,
): RepositoryWorkspacePreview {
  if (runtime.repositoryId === null) {
    throw new Error("Repository preview runtime is missing its repository id");
  }

  return {
    repository_id: runtime.repositoryId,
    state: runtime.state,
    preview_url: runtime.previewUrl,
    backend_url: runtime.backendUrl,
    started_at: runtime.startedAt,
    error: runtime.error,
  };
}

function collectUntrackedFiles(worktreePath: string): string[] {
  const output = runGit(
    worktreePath,
    ["ls-files", "--others", "--exclude-standard", "-z"],
    {
      allowExitCodes: [0],
    },
  );

  return output.split("\0").filter((value) => value.length > 0);
}

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a preview port"));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

async function waitForPort(
  port: number,
  handle: PreviewProcessHandle,
  processDescription: string,
  timeoutMs = 20_000,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (handle.exitCode !== null) {
      throw new Error(
        `${processDescription} exited before port ${port} was ready`,
      );
    }

    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });

      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
    });

    if (connected) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
  }

  throw new Error(`Timed out waiting for preview port ${port}`);
}

async function waitForProcessGroupExit(
  pid: number,
  timeoutMs = 5_000,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      process.kill(-pid, 0);
    } catch {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Ignore already-terminated process groups.
  }
}

function stopPreviewProcessGroup(pid: number | undefined): void {
  if (!pid) {
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // Ignore already-stopped preview processes.
  }
}

function createChildPreviewProcessHandle(
  child: ChildProcess,
): PreviewProcessHandle {
  return {
    get exitCode() {
      return child.exitCode;
    },
    get pid() {
      return child.pid;
    },
    onStderr(listener) {
      child.stderr?.on("data", (chunk: Buffer | string) => {
        listener(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      });
    },
    onStdout(listener) {
      child.stdout?.on("data", (chunk: Buffer | string) => {
        listener(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      });
    },
    onceExit(listener) {
      child.once("exit", listener);
    },
    stop() {
      stopPreviewProcessGroup(child.pid);
    },
    async stopAndWait(timeoutMs) {
      if (!child.pid) {
        return;
      }

      await waitForProcessGroupExit(child.pid, timeoutMs);
    },
    unref() {
      child.unref();
    },
  };
}

export class TicketWorkspaceService {
  readonly #apiBaseUrl: string;
  readonly #eventHub: EventHub;
  readonly #previews = new Map<string, PreviewRuntime>();
  readonly #watchRegistrations = new Map<number, WatchRegistration>();
  readonly #previewRuntimeDependencies: PreviewRuntimeDependencies;

  constructor(options: {
    apiBaseUrl: string;
    eventHub: EventHub;
    previewRuntimeDependencies?: Partial<PreviewRuntimeDependencies>;
  }) {
    this.#apiBaseUrl = options.apiBaseUrl;
    this.#eventHub = options.eventHub;
    this.#previewRuntimeDependencies = {
      findAvailablePort,
      spawnPreviewProcess: ({ command, env, worktreePath }) =>
        createChildPreviewProcessHandle(
          spawn("bash", ["-lc", `exec ${command}`], {
            cwd: worktreePath,
            detached: true,
            env: {
              ...process.env,
              ...env,
            },
            stdio: ["ignore", "pipe", "pipe"],
          }),
        ),
      waitForPort,
      ...options.previewRuntimeDependencies,
    };
  }

  getDiff(input: {
    targetBranch: string;
    ticketId: number;
    workingBranch: string;
    worktreePath: string;
  }): TicketWorkspaceDiff {
    this.#ensureWatcher(input.ticketId, input.worktreePath);

    const trackedPatch = runGit(input.worktreePath, [
      "diff",
      "--no-color",
      "--find-renames",
      input.targetBranch,
      "--",
    ]).trim();
    const untrackedPatch = collectUntrackedFiles(input.worktreePath)
      .map((relativePath) =>
        runGit(
          input.worktreePath,
          ["diff", "--no-index", "--no-color", "--", "/dev/null", relativePath],
          {
            allowExitCodes: [0, 1],
          },
        ).trim(),
      )
      .filter((patch) => patch.length > 0)
      .join("\n\n");

    return {
      ticket_id: input.ticketId,
      source: "live_worktree",
      target_branch: input.targetBranch,
      working_branch: input.workingBranch,
      worktree_path: input.worktreePath,
      artifact_path: null,
      patch: [trackedPatch, untrackedPatch].filter(Boolean).join("\n\n"),
      generated_at: nowIso(),
    };
  }

  getPreview(ticketId: number): TicketWorkspacePreview {
    const runtime = this.#previews.get(getTicketPreviewKey(ticketId));
    if (!runtime) {
      return {
        ticket_id: ticketId,
        state: "idle",
        preview_url: null,
        backend_url: null,
        started_at: null,
        error: null,
      };
    }

    return makeTicketPreviewSnapshot(runtime);
  }

  getRepositoryPreview(repositoryId: string): RepositoryWorkspacePreview {
    const runtime = this.#previews.get(getRepositoryPreviewKey(repositoryId));
    if (!runtime) {
      return {
        repository_id: repositoryId,
        state: "idle",
        preview_url: null,
        backend_url: null,
        started_at: null,
        error: null,
      };
    }

    return makeRepositoryPreviewSnapshot(runtime);
  }

  async ensurePreview(input: {
    ticketId: number;
    worktreePath: string;
  }): Promise<TicketWorkspacePreview> {
    const runtime = await this.#ensurePreviewRuntime({
      key: getTicketPreviewKey(input.ticketId),
      repositoryId: null,
      ticketId: input.ticketId,
      previewStartCommand: null,
      worktreePath: input.worktreePath,
    });
    return makeTicketPreviewSnapshot(runtime);
  }

  async ensureRepositoryPreview(input: {
    repositoryId: string;
    worktreePath: string;
    previewStartCommand: string | null;
  }): Promise<RepositoryWorkspacePreview> {
    const runtime = await this.#ensurePreviewRuntime({
      key: getRepositoryPreviewKey(input.repositoryId),
      repositoryId: input.repositoryId,
      ticketId: null,
      previewStartCommand: input.previewStartCommand,
      worktreePath: input.worktreePath,
    });
    return makeRepositoryPreviewSnapshot(runtime);
  }

  stopPreview(ticketId: number): void {
    this.#stopPreviewByKey(getTicketPreviewKey(ticketId));
  }

  stopRepositoryPreview(repositoryId: string): void {
    this.#stopPreviewByKey(getRepositoryPreviewKey(repositoryId));
  }

  async stopPreviewAndWait(ticketId: number): Promise<void> {
    await this.#stopPreviewAndWaitByKey(getTicketPreviewKey(ticketId));
  }

  async stopRepositoryPreviewAndWait(repositoryId: string): Promise<void> {
    await this.#stopPreviewAndWaitByKey(getRepositoryPreviewKey(repositoryId));
  }

  async disposeTicket(ticketId: number): Promise<void> {
    await this.stopPreviewAndWait(ticketId);

    const watchRegistration = this.#watchRegistrations.get(ticketId);
    if (!watchRegistration) {
      return;
    }

    if (watchRegistration.debounceTimer) {
      clearTimeout(watchRegistration.debounceTimer);
    }

    for (const watcher of watchRegistration.watchers) {
      watcher.close();
    }

    this.#watchRegistrations.delete(ticketId);
  }

  async #ensurePreviewRuntime(input: {
    key: string;
    repositoryId: string | null;
    ticketId: number | null;
    previewStartCommand: string | null;
    worktreePath: string;
  }): Promise<PreviewRuntime> {
    const existing = this.#previews.get(input.key);
    if (existing?.state === "ready") {
      return existing;
    }
    if (existing?.startPromise) {
      await existing.startPromise;
      return this.#previews.get(input.key) ?? existing;
    }
    if (existing) {
      await this.#stopPreviewAndWaitByKey(input.key);
    }

    const runtime: PreviewRuntime = {
      key: input.key,
      repositoryId: input.repositoryId,
      ticketId: input.ticketId,
      backendUrl: null,
      error: null,
      previewStartCommand: input.previewStartCommand,
      previewUrl: null,
      processes: [],
      startedAt: null,
      startPromise: null,
      state: "starting",
      stopping: false,
      worktreePath: input.worktreePath,
      logs: [],
    };

    runtime.startPromise = this.#startPreview(runtime).finally(() => {
      const current = this.#previews.get(input.key);
      if (current === runtime) {
        current.startPromise = null;
      }
    });

    this.#previews.set(input.key, runtime);
    this.#publishPreviewUpdate(runtime);
    await runtime.startPromise;
    return this.#previews.get(input.key) ?? runtime;
  }

  #stopPreviewByKey(key: string): void {
    const runtime = this.#previews.get(key);
    if (!runtime) {
      return;
    }

    runtime.stopping = true;
    for (const previewProcess of runtime.processes) {
      previewProcess.handle.stop();
    }

    this.#previews.delete(key);
    this.#publishPreviewUpdate(runtime);
  }

  async #stopPreviewAndWaitByKey(key: string): Promise<void> {
    const runtime = this.#previews.get(key);
    if (!runtime) {
      return;
    }

    runtime.stopping = true;
    for (const previewProcess of runtime.processes) {
      previewProcess.handle.stop();
    }

    await Promise.all(
      runtime.processes.map((previewProcess) =>
        previewProcess.handle.stopAndWait(),
      ),
    );

    this.#previews.delete(key);
    this.#publishPreviewUpdate(runtime);
  }

  async #startPreview(runtime: PreviewRuntime): Promise<void> {
    if (runtime.repositoryId !== null && runtime.previewStartCommand) {
      try {
        const previewPort =
          await this.#previewRuntimeDependencies.findAvailablePort();
        const previewUrl = `http://127.0.0.1:${previewPort}`;
        const previewCommand = resolveConfiguredRepositoryPreviewCommand({
          command: runtime.previewStartCommand,
          port: previewPort,
          worktreePath: runtime.worktreePath,
        });

        const preview = this.#spawnPreviewProcess(runtime, {
          command: previewCommand,
          env: {
            HOST: "127.0.0.1",
            PORT: String(previewPort),
            VITE_API_URL: this.#apiBaseUrl,
          },
          exitErrorMessage: `Preview command "${previewCommand}" exited`,
          label: "preview",
        });
        await this.#previewRuntimeDependencies.waitForPort(
          previewPort,
          preview.handle,
          `Preview command "${previewCommand}"`,
        );

        runtime.previewUrl = previewUrl;
        runtime.state = "ready";
        runtime.startedAt = nowIso();
        runtime.error = null;
        this.#publishPreviewUpdate(runtime);
        return;
      } catch (error) {
        runtime.state = "failed";
        runtime.error =
          error instanceof Error ? error.message : "Unable to start preview";
        runtime.previewUrl = null;
        runtime.backendUrl = null;
        runtime.startedAt = null;
        await this.#stopPreviewAndWaitByKey(runtime.key);
        this.#previews.set(runtime.key, runtime);
        this.#publishPreviewUpdate(runtime);
        return;
      }
    }

    const scripts = parsePackageScripts(runtime.worktreePath);
    if (!scripts) {
      runtime.state = "failed";
      runtime.error =
        "Preview requires a package.json with a dev, dev:web, or dev:backend script.";
      this.#publishPreviewUpdate(runtime);
      return;
    }

    try {
      if (scripts["dev:web"] && scripts["dev:backend"]) {
        const backendPort =
          await this.#previewRuntimeDependencies.findAvailablePort();
        const frontendPort =
          await this.#previewRuntimeDependencies.findAvailablePort();
        const backendUrl = `http://127.0.0.1:${backendPort}`;
        const previewUrl = `http://127.0.0.1:${frontendPort}`;

        const backend = this.#spawnPreviewProcess(runtime, {
          command: "npm run dev:backend",
          env: {
            HOST: "127.0.0.1",
            PORT: String(backendPort),
          },
          exitErrorMessage: "backend preview exited",
          label: "backend",
        });
        await this.#previewRuntimeDependencies.waitForPort(
          backendPort,
          backend.handle,
          "Backend preview process",
        );

        runtime.backendUrl = backendUrl;

        const frontend = this.#spawnPreviewProcess(runtime, {
          command: `npm run dev:web -- -- --host 127.0.0.1 --port ${frontendPort}`,
          env: {
            HOST: "127.0.0.1",
            PORT: String(frontendPort),
            VITE_API_URL: backendUrl,
          },
          exitErrorMessage: "frontend preview exited",
          label: "frontend",
        });
        await this.#previewRuntimeDependencies.waitForPort(
          frontendPort,
          frontend.handle,
          "Frontend preview process",
        );

        runtime.previewUrl = previewUrl;
      } else if (scripts.dev) {
        const previewPort =
          await this.#previewRuntimeDependencies.findAvailablePort();
        const previewUrl = `http://127.0.0.1:${previewPort}`;

        const preview = this.#spawnPreviewProcess(runtime, {
          command: `npm run dev -- --host 127.0.0.1 --port ${previewPort}`,
          env: {
            HOST: "127.0.0.1",
            PORT: String(previewPort),
          },
          exitErrorMessage: "preview exited",
          label: "preview",
        });
        await this.#previewRuntimeDependencies.waitForPort(
          previewPort,
          preview.handle,
          "Preview process",
        );

        runtime.previewUrl = previewUrl;
      } else if (scripts["dev:web"]) {
        const frontendPort =
          await this.#previewRuntimeDependencies.findAvailablePort();
        const previewUrl = `http://127.0.0.1:${frontendPort}`;

        const frontend = this.#spawnPreviewProcess(runtime, {
          command: `npm run dev:web -- -- --host 127.0.0.1 --port ${frontendPort}`,
          env: {
            HOST: "127.0.0.1",
            PORT: String(frontendPort),
            VITE_API_URL: this.#apiBaseUrl,
          },
          exitErrorMessage: "frontend preview exited",
          label: "frontend",
        });
        await this.#previewRuntimeDependencies.waitForPort(
          frontendPort,
          frontend.handle,
          "Frontend preview process",
        );

        runtime.backendUrl = this.#apiBaseUrl;
        runtime.previewUrl = previewUrl;
      } else {
        throw new Error(
          "Preview requires a dev, dev:web, or dev:backend script in package.json.",
        );
      }

      runtime.state = "ready";
      runtime.startedAt = nowIso();
      runtime.error = null;
      this.#publishPreviewUpdate(runtime);
      return;
    } catch (error) {
      runtime.state = "failed";
      runtime.error =
        error instanceof Error ? error.message : "Unable to start preview";
      runtime.previewUrl = null;
      runtime.backendUrl = null;
      runtime.startedAt = null;
      await this.#stopPreviewAndWaitByKey(runtime.key);
      this.#previews.set(runtime.key, runtime);
      this.#publishPreviewUpdate(runtime);
    }
  }

  #spawnPreviewProcess(
    runtime: PreviewRuntime,
    input: {
      command: string;
      env: Record<string, string>;
      exitErrorMessage: string;
      label: PreviewProcess["label"];
    },
  ): PreviewProcess {
    const handle = this.#previewRuntimeDependencies.spawnPreviewProcess({
      command: input.command,
      env: input.env,
      worktreePath: runtime.worktreePath,
    });
    const previewProcess: PreviewProcess = {
      command: input.command,
      handle,
      label: input.label,
    };

    runtime.processes.push(previewProcess);
    handle.unref();

    const appendOutput = (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (line.trim().length === 0) {
          continue;
        }

        runtime.logs.push(`[${input.label}] ${line}`);
      }

      if (runtime.logs.length > 80) {
        runtime.logs.splice(0, runtime.logs.length - 80);
      }
    };

    handle.onStdout(appendOutput);
    handle.onStderr(appendOutput);
    handle.onceExit((code, signal) => {
      if (runtime.stopping) {
        return;
      }

      runtime.state = "failed";
      runtime.error = `${input.exitErrorMessage} (${signal ?? code ?? "unknown"})`;
      runtime.previewUrl = null;
      runtime.backendUrl = null;
      this.#stopPreviewByKey(runtime.key);
      this.#previews.set(runtime.key, runtime);
      this.#publishPreviewUpdate(runtime);
    });

    return previewProcess;
  }

  #ensureWatcher(ticketId: number, worktreePath: string): void {
    if (this.#watchRegistrations.has(ticketId)) {
      return;
    }

    const scheduleUpdate = (filename: string | null) => {
      if (isGitInternalPath(filename)) {
        return;
      }

      const registration = this.#watchRegistrations.get(ticketId);
      if (!registration) {
        return;
      }

      if (registration.debounceTimer) {
        clearTimeout(registration.debounceTimer);
      }

      registration.debounceTimer = setTimeout(() => {
        registration.debounceTimer = null;
        this.#publishWorkspaceUpdate(ticketId, "diff");
      }, 150);
    };

    const watchers: FSWatcher[] = [];
    try {
      watchers.push(
        watch(worktreePath, { recursive: true }, (_eventType, filename) => {
          scheduleUpdate(filename ?? null);
        }),
      );
    } catch {
      watchers.push(
        watch(worktreePath, (_eventType, filename) => {
          scheduleUpdate(filename ?? null);
        }),
      );
    }

    this.#watchRegistrations.set(ticketId, {
      debounceTimer: null,
      watchers,
    });
  }

  #publishWorkspaceUpdate(ticketId: number, kind: "diff" | "preview"): void {
    this.#eventHub.publish(
      makeProtocolEvent(
        "ticket.workspace.updated",
        "ticket",
        String(ticketId),
        {
          ticket_id: ticketId,
          kind,
          updated_at: nowIso(),
        },
      ),
    );
  }

  #publishPreviewUpdate(runtime: PreviewRuntime): void {
    if (runtime.ticketId === null) {
      return;
    }

    this.#publishWorkspaceUpdate(runtime.ticketId, "preview");
  }
}
