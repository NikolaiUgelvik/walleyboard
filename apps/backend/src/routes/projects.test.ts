import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Fastify from "fastify";
import fastifyRateLimit from "fastify-rate-limit";

import { SqliteStore } from "../lib/sqlite-store.js";
import { projectRoutes } from "./projects.js";

test("project updates reject the Claude adapter when Claude is unavailable", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-project-route-"));

  try {
    const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
    const { project } = store.createProject({
      name: "Claude availability project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    const app = Fastify();

    try {
      await app.register(fastifyRateLimit, { global: false });
      await app.register(projectRoutes, {
        executionRuntime: {} as never,
        getClaudeCodeAvailability: () => ({
          available: false,
          detected_path: "/usr/local/bin/claude",
          error:
            "Claude Code CLI is unavailable: Claude config directory /tmp/.claude is empty.",
        }),
        store,
        ticketWorkspaceService: {} as never,
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/projects/${project.id}`,
        payload: {
          agent_adapter: "claude-code",
        },
      });

      assert.equal(response.statusCode, 409);
      assert.deepEqual(response.json(), {
        error:
          "Claude Code CLI is unavailable: Claude config directory /tmp/.claude is empty.",
      });
      assert.equal(store.getProject(project.id)?.agent_adapter, "codex");
    } finally {
      await app.close();
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
