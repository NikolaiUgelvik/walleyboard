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

test("TicketWorkspaceService diffs the worktree and publishes live summary updates", async () => {
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

    const diff = await workspaceService.getDiff({
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
          event.payload.kind === "summary"
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
    assert.deepEqual(
      (workspaceUpdate as { payload: { summary: unknown } }).payload.summary,
      {
        ticket_id: 29,
        source: "live_worktree",
        added_lines: 2,
        removed_lines: 1,
        files_changed: 2,
        has_changes: true,
        generated_at: (
          workspaceUpdate as {
            payload: { summary: { generated_at: string } };
          }
        ).payload.summary.generated_at,
      },
    );
  } finally {
    await workspaceService.disposeTicket(29);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("disposeTicket succeeds after worktree is already removed", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-dispose-"));
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

    writeFileSync(join(repoPath, "base.txt"), "base\n", "utf8");
    runGit(repoPath, ["add", "base.txt"]);
    runGit(repoPath, ["commit", "-m", "initial"]);
    runGit(repoPath, ["branch", "-M", "main"]);

    runGit(repoPath, [
      "worktree",
      "add",
      "-b",
      "dispose-branch",
      worktreePath,
      "main",
    ]);

    await workspaceService.getSummary({
      targetBranch: "main",
      ticketId: 50,
      workingBranch: "dispose-branch",
      worktreePath,
    });

    assert.ok(workspaceService.hasWatcher(50));

    rmSync(worktreePath, { recursive: true, force: true });
    runGit(repoPath, ["worktree", "prune"]);

    await workspaceService.disposeTicket(50);

    assert.ok(!workspaceService.hasWatcher(50));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("disposeTicket waits for watcher initialization before cleanup", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-dispose-race-"));
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

    writeFileSync(join(repoPath, "base.txt"), "base\n", "utf8");
    runGit(repoPath, ["add", "base.txt"]);
    runGit(repoPath, ["commit", "-m", "initial"]);
    runGit(repoPath, ["branch", "-M", "main"]);

    runGit(repoPath, [
      "worktree",
      "add",
      "-b",
      "race-branch",
      worktreePath,
      "main",
    ]);

    await workspaceService.getSummary({
      targetBranch: "main",
      ticketId: 51,
      workingBranch: "race-branch",
      worktreePath,
    });

    await workspaceService.disposeTicket(51);

    assert.ok(!workspaceService.hasWatcher(51));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("deferred watcher starts after deferral resolves and publishes summary updates", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-deferred-"));
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

    writeFileSync(join(repoPath, "base.txt"), "base\n", "utf8");
    runGit(repoPath, ["add", "base.txt"]);
    runGit(repoPath, ["commit", "-m", "initial"]);
    runGit(repoPath, ["branch", "-M", "main"]);

    runGit(repoPath, [
      "worktree",
      "add",
      "-b",
      "deferred-branch",
      worktreePath,
      "main",
    ]);

    let resolveDeferral!: () => void;
    const deferralPromise = new Promise<void>((resolve) => {
      resolveDeferral = resolve;
    });

    workspaceService.deferWatcher(52, deferralPromise);

    const summary = await workspaceService.getSummary({
      targetBranch: "main",
      ticketId: 52,
      workingBranch: "deferred-branch",
      worktreePath,
    });

    assert.equal(summary.has_changes, false);

    resolveDeferral();
    await new Promise((r) => setTimeout(r, 200));

    const workspaceUpdate = await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error("Timed out waiting for deferred watcher update"));
      }, 5_000);

      const unsubscribe = eventHub.subscribe((event) => {
        if (
          event.event_type === "ticket.workspace.updated" &&
          event.payload.ticket_id === 52 &&
          event.payload.kind === "summary"
        ) {
          clearTimeout(timeout);
          unsubscribe();
          resolve(event);
        }
      });

      writeFileSync(join(worktreePath, "base.txt"), "changed\n", "utf8");
    });

    assert.ok(workspaceUpdate);
    const payload = (
      workspaceUpdate as { payload: { summary: { has_changes: boolean } } }
    ).payload;
    assert.equal(payload.summary.has_changes, true);
  } finally {
    await workspaceService.disposeTicket(52);
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

test("TicketWorkspaceService forwards nested npm args for dev:web previews", async () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "walleyboard-preview-dev-web-only-"),
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
  writeFileSync(
    join(worktreePath, "package.json"),
    JSON.stringify(
      {
        name: "preview-app",
        private: true,
        type: "module",
        scripts: {
          "dev:web": "npm --workspace @walleyboard/web run dev",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  try {
    const preview = await workspaceService.ensurePreview({
      ticketId: 43,
      worktreePath,
    });

    assert.equal(preview.state, "ready");
    assert.equal(preview.preview_url, "http://127.0.0.1:4100");
    assert.equal(
      previewHarness.spawned[0]?.command,
      "npm run dev:web -- -- --host 127.0.0.1 --port 4100",
    );
    assert.equal(
      previewHarness.spawned[0]?.env.VITE_API_URL,
      "http://127.0.0.1:4000",
    );
  } finally {
    await workspaceService.disposeTicket(43);
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

test("TicketWorkspaceService adds host and port flags for configured npm run dev repository previews", async () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "walleyboard-repository-preview-npm-dev-"),
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
    const preview = await workspaceService.ensureRepositoryPreview({
      repositoryId: "repo-43",
      previewStartCommand: "npm run dev",
      worktreePath,
    });

    assert.equal(preview.state, "ready");
    assert.equal(preview.preview_url, "http://127.0.0.1:4100");
    assert.equal(
      previewHarness.spawned[0]?.command,
      "npm run dev -- --host 127.0.0.1 --port 4100",
    );
  } finally {
    await workspaceService.stopRepositoryPreviewAndWait("repo-43");
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
