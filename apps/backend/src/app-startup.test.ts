import assert from "node:assert/strict";
import test from "node:test";

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
