import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  configureBackendObservability,
  disposeBackendObservability,
  enterObservedRequestContext,
  finishObservedRequest,
  observeNamedMethodsOnInstance,
  runObservedOperation,
  startObservedRequest,
} from "./backend-observability.js";
import { SqliteStore } from "./sqlite-store.js";

type CapturedLog = {
  message: string;
  payload: Record<string, unknown>;
};

class CaptureLogger {
  readonly infoLogs: CapturedLog[] = [];
  readonly warnLogs: CapturedLog[] = [];

  info(payload: Record<string, unknown>, message: string): void {
    this.infoLogs.push({ message, payload });
  }

  warn(payload: Record<string, unknown>, message: string): void {
    this.warnLogs.push({ message, payload });
  }
}

test.afterEach(() => {
  disposeBackendObservability();
});

test("observability logs slow requests and operations with request context", async () => {
  const logger = new CaptureLogger();
  configureBackendObservability({
    eventLoopStallMs: 10_000,
    logger,
    sampleIntervalMs: 25,
    slowOperationMs: 10,
    slowRequestMs: 10,
  });

  startObservedRequest({
    method: "GET",
    requestId: "req-1",
    url: "/api/projects",
  });
  enterObservedRequestContext("req-1");

  runObservedOperation("ticket-workspace.git", { command: "git diff" }, () => {
    blockMainThread(15);
  });

  finishObservedRequest({
    requestId: "req-1",
    routeUrl: "/api/projects",
    statusCode: 200,
  });

  const slowOperationLog = logger.warnLogs.find(
    (log) => log.message === "Slow backend operation",
  );
  assert.ok(slowOperationLog);
  assert.equal(slowOperationLog.payload.operation, "ticket-workspace.git");
  assert.equal(slowOperationLog.payload.requestId, "req-1");
  assert.equal(slowOperationLog.payload.method, "GET");

  const slowRequestLog = logger.warnLogs.find(
    (log) => log.message === "Slow backend request",
  );
  assert.ok(slowRequestLog);
  assert.equal(slowRequestLog.payload.requestId, "req-1");
  assert.equal(slowRequestLog.payload.routeUrl, "/api/projects");
  assert.equal(slowRequestLog.payload.statusCode, 200);
});

test("observability reports event loop stalls with recent operations", async () => {
  const logger = new CaptureLogger();
  configureBackendObservability({
    eventLoopStallMs: 20,
    logger,
    recentOperationTtlMs: 1_000,
    sampleIntervalMs: 20,
    slowOperationMs: 10,
    slowRequestMs: 1_000,
  });

  startObservedRequest({
    method: "POST",
    requestId: "req-2",
    url: "/api/tickets/12/execute",
  });
  enterObservedRequestContext("req-2");

  await delay(30);
  runObservedOperation("worktree.git", { command: "git status" }, () => {
    blockMainThread(55);
  });
  await delay(30);

  const stallLog = logger.warnLogs.find(
    (log) => log.message === "Event loop stall detected",
  );
  assert.ok(stallLog);

  const activeRequests = stallLog.payload.activeRequests as Array<
    Record<string, unknown>
  >;
  assert.equal(activeRequests[0]?.requestId, "req-2");

  const recentOperations = stallLog.payload.recentOperations as Array<
    Record<string, unknown>
  >;
  assert.equal(recentOperations.at(-1)?.operation, "worktree.git");
});

test("sqlite store methods are timed through the observed proxy", () => {
  const logger = new CaptureLogger();
  configureBackendObservability({
    eventLoopStallMs: 10_000,
    logger,
    sampleIntervalMs: 25,
    slowOperationMs: 10,
    slowRequestMs: 1_000,
  });

  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-observability-"));

  try {
    const store = observeNamedMethodsOnInstance(
      "sqlite-store",
      new SqliteStore(join(tempDir, "walleyboard.sqlite")),
    );
    try {
      store.withTransaction(() => {
        blockMainThread(15);
        return null;
      });
    } finally {
      store.close();
    }
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }

  const slowOperationLog = logger.warnLogs.find(
    (log) => log.message === "Slow backend operation",
  );
  assert.ok(slowOperationLog);
  assert.equal(
    slowOperationLog.payload.operation,
    "sqlite-store.withTransaction",
  );
});

function blockMainThread(durationMs: number): void {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, durationMs);
}

async function delay(durationMs: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
