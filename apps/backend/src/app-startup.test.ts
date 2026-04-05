import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "./app.js";
import { EventHub } from "./lib/event-hub.js";
import { SqliteStore } from "./lib/sqlite-store.js";
import {
  buildTicketArtifactFilePath,
  ensureTicketArtifactScopeDir,
} from "./lib/ticket-artifacts.js";
import { TicketWorkspaceService } from "./lib/ticket-workspace-service.js";
import {
  createIsolatedApp,
  createTestDockerRuntime,
} from "./test-support/create-isolated-app.js";

test("createApp skips startup Docker cleanup when explicitly disabled", async () => {
  const dockerRuntime = createTestDockerRuntime();
  const { close, dockerRuntime: runtime } = await createIsolatedApp({
    dockerRuntime,
    skipStartupDockerCleanup: true,
  });

  try {
    assert.equal(runtime.cleanupStaleContainersCalls.length, 0);
  } finally {
    await close();
  }
});

test("createApp uses the supplied Docker runtime for startup cleanup only", async () => {
  const dockerRuntime = createTestDockerRuntime();
  const { close, dockerRuntime: runtime } = await createIsolatedApp({
    dockerRuntime,
    skipStartupDockerCleanup: false,
  });

  try {
    assert.equal(runtime.cleanupStaleContainersCalls.length, 1);
    assert.deepEqual(runtime.cleanupStaleContainersCalls[0], {
      preserveSessionIds: [],
    });
  } finally {
    await close();
  }

  assert.equal(runtime.cleanupStaleContainersCalls.length, 1);
  assert.equal(runtime.disposeCalls, 1);
});

test("createApp removes stale orphaned draft artifact scopes during startup", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-app-startup-"));
  const previousWalleyBoardHome = process.env.WALLEYBOARD_HOME;
  process.env.WALLEYBOARD_HOME = join(tempDir, ".walleyboard-home");
  const databasePath = join(tempDir, "walleyboard.sqlite");
  const dockerRuntime = createTestDockerRuntime();

  try {
    const store = new SqliteStore(databasePath);
    const { project } = store.createProject({
      name: "Startup Artifact Cleanup",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });
    store.close();

    const orphanScopePath = ensureTicketArtifactScopeDir(
      project.slug,
      "orphan",
    );
    const orphanFilePath = buildTicketArtifactFilePath(
      project.slug,
      "orphan",
      "ghost.png",
    );
    writeFileSync(orphanFilePath, "ghost");
    const staleTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1_000);
    utimesSync(orphanScopePath, staleTimestamp, staleTimestamp);
    assert.equal(existsSync(orphanScopePath), true);

    const app = await createApp({
      databasePath,
      dockerRuntime,
      skipStartupDockerCleanup: true,
    });

    try {
      assert.equal(existsSync(orphanScopePath), false);
    } finally {
      await app.close();
    }
  } finally {
    if (previousWalleyBoardHome === undefined) {
      delete process.env.WALLEYBOARD_HOME;
    } else {
      process.env.WALLEYBOARD_HOME = previousWalleyBoardHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("createApp preserves fresh orphaned draft artifact scopes during startup", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-app-startup-"));
  const previousWalleyBoardHome = process.env.WALLEYBOARD_HOME;
  process.env.WALLEYBOARD_HOME = join(tempDir, ".walleyboard-home");
  const databasePath = join(tempDir, "walleyboard.sqlite");
  const dockerRuntime = createTestDockerRuntime();

  try {
    const store = new SqliteStore(databasePath);
    const { project } = store.createProject({
      name: "Startup Artifact Preservation",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });
    store.close();

    const freshScopePath = ensureTicketArtifactScopeDir(project.slug, "fresh");
    const freshFilePath = buildTicketArtifactFilePath(
      project.slug,
      "fresh",
      "draft.png",
    );
    writeFileSync(freshFilePath, "draft");
    assert.equal(existsSync(freshScopePath), true);

    const app = await createApp({
      databasePath,
      dockerRuntime,
      skipStartupDockerCleanup: true,
    });

    try {
      assert.equal(existsSync(freshScopePath), true);
    } finally {
      await app.close();
    }
  } finally {
    if (previousWalleyBoardHome === undefined) {
      delete process.env.WALLEYBOARD_HOME;
    } else {
      process.env.WALLEYBOARD_HOME = previousWalleyBoardHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("createApp closes active workspace previews during shutdown", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-app-shutdown-"));
  const databasePath = join(tempDir, "walleyboard.sqlite");
  const dockerRuntime = createTestDockerRuntime();
  let stopCalls = 0;
  let stopAndWaitCalls = 0;
  let unrefCalls = 0;

  const ticketWorkspaceService = new TicketWorkspaceService({
    apiBaseUrl: "http://127.0.0.1:4000",
    eventHub: new EventHub(),
    previewRuntimeDependencies: {
      findAvailablePort: async () => 4310,
      spawnPreviewProcess: () => ({
        get exitCode() {
          return null;
        },
        get pid() {
          return 123;
        },
        onStderr() {},
        onStdout() {},
        onceExit() {},
        stop() {
          stopCalls += 1;
        },
        async stopAndWait() {
          stopAndWaitCalls += 1;
        },
        unref() {
          unrefCalls += 1;
        },
      }),
      waitForPort: async () => {},
    },
  });

  try {
    const preview = await ticketWorkspaceService.ensureRepositoryPreview({
      repositoryId: "repo-1",
      previewStartCommand: "npm run dev",
      worktreePath: tempDir,
    });
    assert.equal(preview.state, "ready");
    assert.equal(unrefCalls, 1);

    const app = await createApp({
      databasePath,
      dockerRuntime,
      skipStartupDockerCleanup: true,
      ticketWorkspaceService,
    });

    await app.close();

    assert.equal(stopCalls, 1);
    assert.equal(stopAndWaitCalls, 1);
    assert.equal(
      ticketWorkspaceService.getRepositoryPreview("repo-1").state,
      "idle",
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
