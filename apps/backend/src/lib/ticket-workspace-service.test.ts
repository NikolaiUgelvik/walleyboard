import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { EventHub } from "./event-hub.js";
import { TicketWorkspaceService } from "./ticket-workspace-service.js";

function runGit(repoPath: string, args: string[]): string {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function configureGitIdentity(repoPath: string): void {
  runGit(repoPath, ["config", "user.name", "Test User"]);
  runGit(repoPath, ["config", "user.email", "test@example.com"]);
}

class FakePreviewProcessHandle {
  exitCode: number | null = null;
  readonly onStderrListeners: Array<(chunk: string) => void> = [];
  readonly onStdoutListeners: Array<(chunk: string) => void> = [];
  readonly onceExitListeners: Array<
    (code: number | null, signal: NodeJS.Signals | null) => void
  > = [];
  readonly pid: number | undefined;
  stopCalls = 0;
  stopAndWaitCalls = 0;

  constructor(pid: number) {
    this.pid = pid;
  }

  onStderr(listener: (chunk: string) => void): void {
    this.onStderrListeners.push(listener);
  }

  onStdout(listener: (chunk: string) => void): void {
    this.onStdoutListeners.push(listener);
  }

  onceExit(
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): void {
    this.onceExitListeners.push(listener);
  }

  stop(): void {
    this.stopCalls += 1;
  }

  async stopAndWait(): Promise<void> {
    this.stopAndWaitCalls += 1;
  }

  unref(): void {}
}

function createPreviewRuntimeHarness(options?: {
  waitForPort?: (input: {
    description: string;
    handle: { exitCode: number | null };
    port: number;
  }) => Promise<void>;
}) {
  let nextPid = 100;
  let nextPort = 4_100;
  const spawned: Array<{
    command: string;
    env: Record<string, string>;
    handle: FakePreviewProcessHandle;
    worktreePath: string;
  }> = [];

  return {
    previewRuntimeDependencies: {
      async findAvailablePort() {
        return nextPort++;
      },
      spawnPreviewProcess(input: {
        command: string;
        env: Record<string, string>;
        worktreePath: string;
      }) {
        const handle = new FakePreviewProcessHandle(nextPid++);
        spawned.push({
          ...input,
          handle,
        });
        return handle;
      },
      async waitForPort(
        port: number,
        handle: { exitCode: number | null },
        description: string,
      ) {
        if (options?.waitForPort) {
          await options.waitForPort({
            description,
            handle,
            port,
          });
        }
      },
    },
    spawned,
  };
}

test("TicketWorkspaceService diffs the worktree and publishes live diff updates", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-workspace-"));
  const repoPath = join(tempDir, "repo");
  const worktreePath = join(tempDir, "ticket-worktree");
  const eventHub = new EventHub();
  const workspaceService = new TicketWorkspaceService({
    apiBaseUrl: "http://127.0.0.1:4000",
    eventHub,
  });

  try {
    execFileSync("git", ["init", repoPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    configureGitIdentity(repoPath);

    writeFileSync(join(repoPath, "tracked.txt"), "base\n", "utf8");
    runGit(repoPath, ["add", "tracked.txt"]);
    runGit(repoPath, ["commit", "-m", "initial"]);
    runGit(repoPath, ["branch", "-M", "main"]);

    runGit(repoPath, [
      "worktree",
      "add",
      "-b",
      "ticket-branch",
      worktreePath,
      "main",
    ]);

    writeFileSync(join(worktreePath, "tracked.txt"), "ticket update\n", "utf8");
    writeFileSync(join(worktreePath, "draft.txt"), "untracked draft\n", "utf8");

    const diff = workspaceService.getDiff({
      targetBranch: "main",
      ticketId: 29,
      workingBranch: "ticket-branch",
      worktreePath,
    });

    assert.match(diff.patch, /ticket update/);
    assert.match(diff.patch, /draft\.txt/);
    assert.match(diff.patch, /untracked draft/);

    const workspaceUpdate = await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error("Timed out waiting for workspace diff update"));
      }, 5_000);

      const unsubscribe = eventHub.subscribe((event) => {
        if (
          event.event_type === "ticket.workspace.updated" &&
          event.payload.ticket_id === 29 &&
          event.payload.kind === "diff"
        ) {
          clearTimeout(timeout);
          unsubscribe();
          resolve(event);
        }
      });

      writeFileSync(
        join(worktreePath, "tracked.txt"),
        "ticket update 2\n",
        "utf8",
      );
    });

    assert.ok(workspaceUpdate);
  } finally {
    await workspaceService.disposeTicket(29);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("TicketWorkspaceService starts and stops previews for ticket worktrees", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-preview-"));
  const worktreePath = join(tempDir, "preview-app");
  const eventHub = new EventHub();
  const previewHarness = createPreviewRuntimeHarness();
  const workspaceService = new TicketWorkspaceService({
    apiBaseUrl: "http://127.0.0.1:4000",
    eventHub,
    previewRuntimeDependencies: previewHarness.previewRuntimeDependencies,
  });

  mkdirSync(worktreePath, { recursive: true });
  writeFileSync(
    join(worktreePath, "package.json"),
    JSON.stringify(
      {
        name: "preview-app",
        private: true,
        type: "module",
        scripts: {
          dev: "vite",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  try {
    const preview = await workspaceService.ensurePreview({
      ticketId: 41,
      worktreePath,
    });

    assert.equal(preview.state, "ready");
    assert.equal(preview.preview_url, "http://127.0.0.1:4100");
    assert.equal(previewHarness.spawned.length, 1);
    assert.equal(
      previewHarness.spawned[0]?.command,
      "npm run dev -- --host 127.0.0.1 --port 4100",
    );
    assert.equal(previewHarness.spawned[0]?.env.PORT, "4100");

    await workspaceService.stopPreviewAndWait(41);

    assert.deepEqual(workspaceService.getPreview(41), {
      ticket_id: 41,
      state: "idle",
      preview_url: null,
      backend_url: null,
      started_at: null,
      error: null,
    });
    assert.equal(previewHarness.spawned[0]?.handle.stopCalls, 1);
    assert.equal(previewHarness.spawned[0]?.handle.stopAndWaitCalls, 1);
  } finally {
    await workspaceService.disposeTicket(41);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("TicketWorkspaceService starts repository previews with a configured command", async () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "walleyboard-repository-preview-"),
  );
  const worktreePath = join(tempDir, "preview-app");
  const eventHub = new EventHub();
  const previewHarness = createPreviewRuntimeHarness();
  const workspaceService = new TicketWorkspaceService({
    apiBaseUrl: "http://127.0.0.1:4000",
    eventHub,
    previewRuntimeDependencies: previewHarness.previewRuntimeDependencies,
  });

  mkdirSync(worktreePath, { recursive: true });

  try {
    const preview = await workspaceService.ensureRepositoryPreview({
      repositoryId: "repo-41",
      previewStartCommand: "node preview-server.cjs",
      worktreePath,
    });

    assert.equal(preview.state, "ready");
    assert.equal(preview.preview_url, "http://127.0.0.1:4100");
    assert.equal(previewHarness.spawned[0]?.command, "node preview-server.cjs");
    assert.equal(
      previewHarness.spawned[0]?.env.VITE_API_URL,
      "http://127.0.0.1:4000",
    );

    await workspaceService.stopRepositoryPreviewAndWait("repo-41");

    assert.deepEqual(workspaceService.getRepositoryPreview("repo-41"), {
      repository_id: "repo-41",
      state: "idle",
      preview_url: null,
      backend_url: null,
      started_at: null,
      error: null,
    });
    assert.equal(previewHarness.spawned[0]?.handle.stopCalls, 1);
    assert.equal(previewHarness.spawned[0]?.handle.stopAndWaitCalls, 1);
  } finally {
    await workspaceService.stopRepositoryPreviewAndWait("repo-41");
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("TicketWorkspaceService reports configured preview command failures clearly", async () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "walleyboard-repository-preview-fail-"),
  );
  const worktreePath = join(tempDir, "preview-app");
  const eventHub = new EventHub();
  const previewHarness = createPreviewRuntimeHarness({
    async waitForPort({ description, port }) {
      throw new Error(`${description} exited before port ${port} was ready`);
    },
  });
  const workspaceService = new TicketWorkspaceService({
    apiBaseUrl: "http://127.0.0.1:4000",
    eventHub,
    previewRuntimeDependencies: previewHarness.previewRuntimeDependencies,
  });

  mkdirSync(worktreePath, { recursive: true });

  try {
    const preview = await workspaceService.ensureRepositoryPreview({
      repositoryId: "repo-42",
      previewStartCommand: "node exit-immediately.cjs",
      worktreePath,
    });

    assert.equal(preview.state, "failed");
    assert.equal(preview.preview_url, null);
    assert.match(
      preview.error ?? "",
      /^Preview command "node exit-immediately\.cjs" exited before port \d+ was ready$/,
    );
  } finally {
    await workspaceService.stopRepositoryPreviewAndWait("repo-42");
    rmSync(tempDir, { recursive: true, force: true });
  }
});
