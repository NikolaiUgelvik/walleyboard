import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "./app.js";
import { DockerRuntimeManager } from "./lib/docker-runtime.js";

function setEnv(name: string, value: string): () => void {
  const previous = process.env[name];
  process.env[name] = value;

  return () => {
    if (previous === undefined) {
      delete process.env[name];
      return;
    }

    process.env[name] = previous;
  };
}

test("createApp skips startup Docker cleanup when explicitly disabled", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-app-startup-"));
  const restoreWalleyboardHome = setEnv(
    "WALLEYBOARD_HOME",
    join(tempDir, ".walleyboard-home"),
  );
  const restoreSkipCleanup = setEnv(
    "WALLEYBOARD_SKIP_STARTUP_DOCKER_CLEANUP",
    "1",
  );
  const originalCleanup = DockerRuntimeManager.prototype.cleanupStaleContainers;
  let cleanupCalls = 0;

  DockerRuntimeManager.prototype.cleanupStaleContainers =
    function cleanupStaleContainersSpy() {
      cleanupCalls += 1;
    };

  try {
    const app = await createApp();
    try {
      assert.equal(cleanupCalls, 0);
    } finally {
      await app.close();
    }
  } finally {
    DockerRuntimeManager.prototype.cleanupStaleContainers = originalCleanup;
    restoreSkipCleanup();
    restoreWalleyboardHome();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
