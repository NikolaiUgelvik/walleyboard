import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../app.js";

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
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-rate-limit-"));
  const restoreWalleyBoardHome = setEnv(
    "WALLEYBOARD_HOME",
    join(tempDir, ".walleyboard-home"),
  );
  const restoreRateLimitMax = setEnv("RATE_LIMIT_MAX", "2");
  const restoreRateLimitTimeWindow = setEnv(
    "RATE_LIMIT_TIME_WINDOW",
    "1 minute",
  );

  try {
    const app = await createApp();

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
    } finally {
      await app.close();
    }
  } finally {
    restoreRateLimitTimeWindow();
    restoreRateLimitMax();
    restoreWalleyBoardHome();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
