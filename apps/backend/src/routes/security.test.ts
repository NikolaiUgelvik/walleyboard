import assert from "node:assert/strict";
import test from "node:test";

import { createIsolatedApp } from "../test-support/create-isolated-app.js";

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

test("createApp rate limits repeated requests", async () => {
  const restoreRateLimitMax = setEnv("RATE_LIMIT_MAX", "2");
  const restoreRateLimitTimeWindow = setEnv(
    "RATE_LIMIT_TIME_WINDOW",
    "1 minute",
  );
  const { app, close, dockerRuntime } = await createIsolatedApp({
    skipStartupDockerCleanup: false,
  });

  try {
    const firstResponse = await app.inject({
      method: "GET",
      url: "/health",
    });
    const secondResponse = await app.inject({
      method: "GET",
      url: "/health",
    });
    const thirdResponse = await app.inject({
      method: "GET",
      url: "/health",
    });

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(secondResponse.statusCode, 200);
    assert.equal(thirdResponse.statusCode, 429);
    assert.equal(dockerRuntime.cleanupStaleContainersCalls.length, 1);
  } finally {
    await close();
    restoreRateLimitTimeWindow();
    restoreRateLimitMax();
  }
});
