import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createIsolatedApp,
  createTestDockerRuntime,
} from "../test-support/create-isolated-app.js";

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

test("GET /health reports Claude Code through Docker-mounted ~/.claude state", async () => {
  const homeDir = join(tmpdir(), `walleyboard-health-home-${Date.now()}`);
  mkdirSync(join(homeDir, ".claude"), { recursive: true });
  const restoreHome = setEnv("HOME", homeDir);
  const { app, close } = await createIsolatedApp({
    dockerRuntime: createTestDockerRuntime(),
  });

  try {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().claude_code, {
      available: true,
      configured_path: join(homeDir, ".claude"),
      error: null,
    });
  } finally {
    await close();
    restoreHome();
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("GET /health marks Claude Code unavailable when Docker is unavailable", async () => {
  const homeDir = join(
    tmpdir(),
    `walleyboard-health-home-docker-down-${Date.now()}`,
  );
  mkdirSync(join(homeDir, ".claude"), { recursive: true });
  const restoreHome = setEnv("HOME", homeDir);
  const { app, close } = await createIsolatedApp({
    dockerRuntime: createTestDockerRuntime({
      available: false,
      error: "Docker daemon offline",
      server_version: null,
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
      configured_path: join(homeDir, ".claude"),
      error: "Docker must be available before Claude Code can run.",
    });
  } finally {
    await close();
    restoreHome();
    rmSync(homeDir, { recursive: true, force: true });
  }
});
