import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { type FSWatcher, existsSync, readFileSync, watch } from "node:fs";
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
  child: ChildProcess;
  command: string;
  label: "backend" | "frontend" | "preview";
};

type PreviewRuntime = {
  ticketId: number;
  backendUrl: string | null;
  error: string | null;
  previewUrl: string | null;
  processes: PreviewProcess[];
  startedAt: string | null;
  startPromise: Promise<TicketWorkspacePreview> | null;
  state: TicketWorkspacePreview["state"];
  stopping: boolean;
  worktreePath: string;
  logs: string[];
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

function isGitInternalPath(filename: string | null): boolean {
  if (!filename) {
    return false;
  }

  return filename === ".git" || filename.startsWith(".git/");
}

function makePreviewSnapshot(runtime: PreviewRuntime): TicketWorkspacePreview {
  return {
    ticket_id: runtime.ticketId,
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
  child: ChildProcess,
  timeoutMs = 20_000,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Preview process exited before port ${port} was ready`);
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

export class TicketWorkspaceService {
  readonly #apiBaseUrl: string;
  readonly #eventHub: EventHub;
  readonly #previews = new Map<number, PreviewRuntime>();
  readonly #watchRegistrations = new Map<number, WatchRegistration>();

  constructor(options: { apiBaseUrl: string; eventHub: EventHub }) {
    this.#apiBaseUrl = options.apiBaseUrl;
    this.#eventHub = options.eventHub;
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
      target_branch: input.targetBranch,
      working_branch: input.workingBranch,
      worktree_path: input.worktreePath,
      patch: [trackedPatch, untrackedPatch].filter(Boolean).join("\n\n"),
      generated_at: nowIso(),
    };
  }

  getPreview(ticketId: number): TicketWorkspacePreview {
    const runtime = this.#previews.get(ticketId);
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

    return makePreviewSnapshot(runtime);
  }

  async ensurePreview(input: {
    ticketId: number;
    worktreePath: string;
  }): Promise<TicketWorkspacePreview> {
    const existing = this.#previews.get(input.ticketId);
    if (existing?.state === "ready") {
      return makePreviewSnapshot(existing);
    }
    if (existing?.startPromise) {
      return await existing.startPromise;
    }
    if (existing) {
      this.stopPreview(input.ticketId);
    }

    const runtime: PreviewRuntime = {
      ticketId: input.ticketId,
      backendUrl: null,
      error: null,
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
      const current = this.#previews.get(input.ticketId);
      if (current === runtime) {
        current.startPromise = null;
      }
    });

    this.#previews.set(input.ticketId, runtime);
    this.#publishWorkspaceUpdate(input.ticketId, "preview");

    return await runtime.startPromise;
  }

  stopPreview(ticketId: number): void {
    const runtime = this.#previews.get(ticketId);
    if (!runtime) {
      return;
    }

    runtime.stopping = true;
    for (const previewProcess of runtime.processes) {
      const pid = previewProcess.child.pid;
      if (!pid) {
        continue;
      }

      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        // Ignore already-stopped preview processes.
      }
    }

    this.#previews.delete(ticketId);
    this.#publishWorkspaceUpdate(ticketId, "preview");
  }

  async stopPreviewAndWait(ticketId: number): Promise<void> {
    const runtime = this.#previews.get(ticketId);
    if (!runtime) {
      return;
    }

    runtime.stopping = true;
    for (const previewProcess of runtime.processes) {
      const pid = previewProcess.child.pid;
      if (!pid) {
        continue;
      }

      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        // Ignore already-stopped preview processes.
      }
    }

    await Promise.all(
      runtime.processes.flatMap((previewProcess) =>
        previewProcess.child.pid
          ? [waitForProcessGroupExit(previewProcess.child.pid)]
          : [],
      ),
    );

    this.#previews.delete(ticketId);
    this.#publishWorkspaceUpdate(ticketId, "preview");
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

  async #startPreview(
    runtime: PreviewRuntime,
  ): Promise<TicketWorkspacePreview> {
    const scripts = parsePackageScripts(runtime.worktreePath);
    if (!scripts) {
      runtime.state = "failed";
      runtime.error =
        "Preview requires a package.json with a dev, dev:web, or dev:backend script.";
      this.#publishWorkspaceUpdate(runtime.ticketId, "preview");
      return makePreviewSnapshot(runtime);
    }

    try {
      if (scripts["dev:web"] && scripts["dev:backend"]) {
        const backendPort = await findAvailablePort();
        const frontendPort = await findAvailablePort();
        const backendUrl = `http://127.0.0.1:${backendPort}`;
        const previewUrl = `http://127.0.0.1:${frontendPort}`;

        const backend = this.#spawnPreviewProcess(runtime, {
          command: "npm run dev:backend",
          env: {
            HOST: "127.0.0.1",
            PORT: String(backendPort),
          },
          label: "backend",
        });
        await waitForPort(backendPort, backend.child);

        runtime.backendUrl = backendUrl;

        const frontend = this.#spawnPreviewProcess(runtime, {
          command: `npm run dev:web -- --host 127.0.0.1 --port ${frontendPort}`,
          env: {
            HOST: "127.0.0.1",
            PORT: String(frontendPort),
            VITE_API_URL: backendUrl,
          },
          label: "frontend",
        });
        await waitForPort(frontendPort, frontend.child);

        runtime.previewUrl = previewUrl;
      } else if (scripts.dev) {
        const previewPort = await findAvailablePort();
        const previewUrl = `http://127.0.0.1:${previewPort}`;

        const preview = this.#spawnPreviewProcess(runtime, {
          command: `npm run dev -- --host 127.0.0.1 --port ${previewPort}`,
          env: {
            HOST: "127.0.0.1",
            PORT: String(previewPort),
          },
          label: "preview",
        });
        await waitForPort(previewPort, preview.child);

        runtime.previewUrl = previewUrl;
      } else if (scripts["dev:web"]) {
        const frontendPort = await findAvailablePort();
        const previewUrl = `http://127.0.0.1:${frontendPort}`;

        const frontend = this.#spawnPreviewProcess(runtime, {
          command: `npm run dev:web -- --host 127.0.0.1 --port ${frontendPort}`,
          env: {
            HOST: "127.0.0.1",
            PORT: String(frontendPort),
            VITE_API_URL: this.#apiBaseUrl,
          },
          label: "frontend",
        });
        await waitForPort(frontendPort, frontend.child);

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
      this.#publishWorkspaceUpdate(runtime.ticketId, "preview");
      return makePreviewSnapshot(runtime);
    } catch (error) {
      runtime.state = "failed";
      runtime.error =
        error instanceof Error ? error.message : "Unable to start preview";
      runtime.previewUrl = null;
      runtime.backendUrl = null;
      runtime.startedAt = null;
      await this.stopPreviewAndWait(runtime.ticketId);
      this.#previews.set(runtime.ticketId, runtime);
      this.#publishWorkspaceUpdate(runtime.ticketId, "preview");
      return makePreviewSnapshot(runtime);
    }
  }

  #spawnPreviewProcess(
    runtime: PreviewRuntime,
    input: {
      command: string;
      env: Record<string, string>;
      label: PreviewProcess["label"];
    },
  ): PreviewProcess {
    const child = spawn("bash", ["-lc", `exec ${input.command}`], {
      cwd: runtime.worktreePath,
      detached: true,
      env: {
        ...process.env,
        ...input.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const previewProcess: PreviewProcess = {
      child,
      command: input.command,
      label: input.label,
    };

    runtime.processes.push(previewProcess);
    child.unref();

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

    child.stdout?.on("data", (chunk: Buffer | string) => {
      appendOutput(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      appendOutput(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    });
    child.once("exit", (code, signal) => {
      if (runtime.stopping) {
        return;
      }

      runtime.state = "failed";
      runtime.error = `${input.label} preview exited (${signal ?? code ?? "unknown"})`;
      runtime.previewUrl = null;
      runtime.backendUrl = null;
      this.stopPreview(runtime.ticketId);
      this.#previews.set(runtime.ticketId, runtime);
      this.#publishWorkspaceUpdate(runtime.ticketId, "preview");
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
}
