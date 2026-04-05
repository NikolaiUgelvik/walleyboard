import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { Project } from "../../../../../packages/contracts/src/index.js";
import {
  listConfiguredClaudeMcpServersInConfigHome,
  listConfiguredClaudeMcpServersInSettings,
  listEnabledProjectClaudeMcpServersInConfigHome,
  writeClaudeConfigOverridesInConfigHome,
} from "./claude-config.js";

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    slug: "project-1",
    name: "Project",
    color: "#2563EB",
    agent_adapter: "claude-code",
    execution_backend: "docker",
    disabled_mcp_servers: [],
    automatic_agent_review: false,
    automatic_agent_review_run_limit: 1,
    default_review_action: "direct_merge",
    default_target_branch: "main",
    preview_start_command: null,
    pre_worktree_command: null,
    post_worktree_command: null,
    draft_analysis_model: null,
    draft_analysis_reasoning_effort: null,
    ticket_work_model: null,
    ticket_work_reasoning_effort: null,
    max_concurrent_sessions: 4,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

test("listConfiguredClaudeMcpServersInSettings reads MCP server names from Claude settings JSON", () => {
  const servers = listConfiguredClaudeMcpServersInSettings(
    JSON.stringify({
      mcpServers: {
        context7: {},
        sentry: {},
      },
      mcp_servers: {
        "chrome-devtools": {},
      },
    }),
  );

  assert.deepEqual(servers, ["chrome-devtools", "context7", "sentry"]);
});

test("listEnabledProjectClaudeMcpServersInConfigHome excludes disabled Claude MCP servers", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-claude-config-"));
  const configHomePath = join(tempDir, ".claude");

  mkdirSync(configHomePath, { recursive: true });
  writeFileSync(
    join(configHomePath, "settings.json"),
    JSON.stringify(
      {
        mcpServers: {
          context7: {},
          sentry: {},
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  try {
    const servers = listEnabledProjectClaudeMcpServersInConfigHome(
      configHomePath,
      createProject({
        disabled_mcp_servers: ["sentry", "missing-server"],
      }),
    );

    assert.deepEqual(servers, ["context7"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("writeClaudeConfigOverridesInConfigHome filters Claude settings overrides per project", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-claude-overrides-"));
  const configHomePath = join(tempDir, ".claude");
  const overrideDir = join(tempDir, "overrides");

  mkdirSync(configHomePath, { recursive: true });
  writeFileSync(
    join(configHomePath, "settings.json"),
    JSON.stringify(
      {
        mcpServers: {
          context7: { command: "npx" },
          sentry: { command: "npx" },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(
    join(configHomePath, "settings.local.json"),
    JSON.stringify(
      {
        mcp_servers: {
          "chrome-devtools": { command: "npx" },
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  try {
    const overrides = writeClaudeConfigOverridesInConfigHome(
      configHomePath,
      overrideDir,
      createProject({
        disabled_mcp_servers: ["sentry", "chrome-devtools"],
      }),
    );

    assert.deepEqual(overrides, [
      {
        hostPath: join(overrideDir, "settings.json"),
        relativePath: "settings.json",
      },
      {
        hostPath: join(overrideDir, "settings.local.json"),
        relativePath: "settings.local.json",
      },
    ]);
    assert.deepEqual(
      listConfiguredClaudeMcpServersInConfigHome(configHomePath),
      ["chrome-devtools", "context7", "sentry"],
    );
    assert.doesNotMatch(
      readFileSync(join(overrideDir, "settings.json"), "utf8"),
      /sentry/,
    );
    assert.match(
      readFileSync(join(overrideDir, "settings.json"), "utf8"),
      /context7/,
    );
    assert.doesNotMatch(
      readFileSync(join(overrideDir, "settings.local.json"), "utf8"),
      /chrome-devtools/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
