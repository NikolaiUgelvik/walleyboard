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
import type {
  InboxAlertPayload,
  ProtocolEvent,
} from "../../../packages/contracts/src/index.js";
import { createApp } from "./app.js";
import { EventHub, makeProtocolEvent } from "./lib/event-hub.js";
import {
  createSocketServer,
  type SocketServerFactory,
} from "./lib/socket-server.js";
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

async function waitForPromiseWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

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

test("createApp awaits socket server shutdown during backend close", async () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "walleyboard-app-socket-shutdown-"),
  );
  const databasePath = join(tempDir, "walleyboard.sqlite");
  const dockerRuntime = createTestDockerRuntime();

  let closeCalls = 0;
  let resolveSocketServerClose!: () => void;
  const socketServerClosed = new Promise<void>((resolve) => {
    resolveSocketServerClose = resolve;
  });
  const socketServerFactory: SocketServerFactory = () => ({
    close: async () => {
      closeCalls += 1;
      await socketServerClosed;
    },
  });

  let closePromise: Promise<void> | null = null;

  try {
    const app = await createApp({
      databasePath,
      dockerRuntime,
      skipStartupDockerCleanup: true,
      socketServerFactory,
      ticketWorkspaceService: new TicketWorkspaceService({
        apiBaseUrl: "http://127.0.0.1:4000",
        eventHub: new EventHub(),
      }),
    });

    closePromise = app.close();
    if (!closePromise) {
      throw new Error("Expected app.close() to have started");
    }

    const startedClosePromise = closePromise;
    let closeSettled = false;
    startedClosePromise.then(() => {
      closeSettled = true;
    });

    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(closeCalls, 1);
    assert.equal(closeSettled, false);

    resolveSocketServerClose();
    await startedClosePromise;
  } finally {
    resolveSocketServerClose();
    await closePromise?.catch(() => {});
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("createApp publishes inbox alerts over the events socket", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-app-inbox-alert-"));
  const databasePath = join(tempDir, "walleyboard.sqlite");
  const previousWalleyBoardHome = process.env.WALLEYBOARD_HOME;
  process.env.WALLEYBOARD_HOME = join(tempDir, ".walleyboard-home");
  const dockerRuntime = createTestDockerRuntime();
  const eventHub = new EventHub();
  const store = new SqliteStore(databasePath);
  const eventsNamespaceConnections = new Map<
    string,
    (socket: {
      emit: (event: string, payload: unknown) => void;
      on: (event: string, listener: (...args: unknown[]) => void) => void;
      once: (event: string, listener: () => void) => void;
      disconnect: (close?: boolean) => void;
      handshake: {
        auth: {
          socketPath?: unknown;
        };
        query: {
          socketPath?: unknown;
        };
      };
    }) => void
  >();
  let resolveInboxAlertEvent: ((event: ProtocolEvent) => void) | null = null;
  const inboxAlertEventPromise = new Promise<ProtocolEvent>((resolve) => {
    resolveInboxAlertEvent = resolve;
  });

  try {
    const { project } = store.createProject({
      name: "Inbox Alert App Test",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });
    const draft = store.createDraft({
      description: "Draft that should trigger a backend alert.",
      project_id: project.id,
      title: "Backend-owned inbox alert",
      proposed_acceptance_criteria: ["Keep the alert deterministic."],
    });

    const app = await createApp({
      databasePath,
      dockerRuntime,
      eventHub,
      skipStartupDockerCleanup: true,
      store,
      socketServerFactory: (input) =>
        createSocketServer({
          ...input,
          ioFactory: () => ({
            close: (callback: () => void) => {
              callback();
            },
            of: (namespace: string) => ({
              on: (
                event: "connection",
                listener: (socket: {
                  emit: (event: string, payload: unknown) => void;
                  on: (
                    event: string,
                    listener: (...args: unknown[]) => void,
                  ) => void;
                  once: (event: string, listener: () => void) => void;
                  disconnect: (close?: boolean) => void;
                  handshake: {
                    auth: {
                      socketPath?: unknown;
                    };
                    query: {
                      socketPath?: unknown;
                    };
                  };
                }) => void,
              ) => {
                if (event !== "connection") {
                  return;
                }

                eventsNamespaceConnections.set(namespace, listener);
              },
            }),
          }),
        }),
    });

    try {
      const connectEventsSocket = eventsNamespaceConnections.get("/events");
      if (!connectEventsSocket) {
        throw new Error("Expected the events namespace to be registered.");
      }

      connectEventsSocket({
        emit: (event, payload) => {
          if (
            event === "protocol.event" &&
            (payload as ProtocolEvent).event_type === "inbox.alert"
          ) {
            resolveInboxAlertEvent?.(payload as ProtocolEvent);
          }
        },
        on: () => {},
        once: (event, listener) => {
          if (event === "disconnect") {
            void listener;
          }
        },
        disconnect: () => {},
        handshake: {
          auth: {},
          query: {},
        },
      });

      const updatedDraft = store.updateDraft(draft.id, {
        wizard_status: "awaiting_confirmation",
      });
      eventHub.publish(
        makeProtocolEvent("draft.updated", "draft", draft.id, {
          draft: updatedDraft,
        }),
      );

      const inboxAlertEvent = await waitForPromiseWithin(
        inboxAlertEventPromise,
        5_000,
        "Timed out waiting for inbox.alert",
      );

      assert.equal(inboxAlertEvent.event_type, "inbox.alert");
      const inboxAlertPayload = inboxAlertEvent.payload as InboxAlertPayload;
      assert.deepEqual(inboxAlertPayload.notification_keys, [
        `draft-${draft.id}`,
      ]);
      assert.equal(inboxAlertPayload.alerts[0]?.kind, "draft");
    } finally {
      await app.close();
    }
  } finally {
    process.env.WALLEYBOARD_HOME = previousWalleyBoardHome;
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
