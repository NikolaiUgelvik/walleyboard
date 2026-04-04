import assert from "node:assert/strict";
import test from "node:test";

import { createIsolatedApp } from "../test-support/create-isolated-app.js";

test("GET /health reports Claude Code availability when the CLI probe succeeds", async () => {
  const { app, close } = await createIsolatedApp({
    probeClaudeCodeAvailability: () => ({
      available: true,
      detected_path: "/usr/local/bin/claude",
      error: null,
    }),
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().claude_code, {
      available: true,
      detected_path: "/usr/local/bin/claude",
      error: null,
    });
  } finally {
    await close();
  }
});

test("GET /health reports a Claude Code availability error when the CLI probe fails", async () => {
  const { app, close } = await createIsolatedApp({
    probeClaudeCodeAvailability: () => ({
      available: false,
      detected_path: "/usr/local/bin/claude",
      error: "Claude Code CLI is unavailable: permission denied",
    }),
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().claude_code, {
      available: false,
      detected_path: "/usr/local/bin/claude",
      error: "Claude Code CLI is unavailable: permission denied",
    });
  } finally {
    await close();
  }
});
