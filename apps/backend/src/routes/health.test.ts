import assert from "node:assert/strict";
import test from "node:test";

import { createIsolatedApp } from "../test-support/create-isolated-app.js";

test("GET /health reports Docker availability and configured Codex MCP servers", async () => {
  const { app, close } = await createIsolatedApp();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().docker, {
      installed: true,
      available: true,
      client_version: "test-client",
      server_version: "test-server",
      error: null,
    });
    assert.ok(Array.isArray(response.json().codex_mcp_servers));
  } finally {
    await close();
  }
});
