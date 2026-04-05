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
  filterCodexConfigToml,
  listConfiguredCodexMcpServersInConfig,
  listEnabledProjectCodexMcpServersInConfigPath,
  selectEnabledCodexMcpServers,
  writeCodexConfigOverrideForConfigPath,
} from "./codex-config.js";

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    slug: "project-1",
    name: "Project",
    color: "#2563EB",
    agent_adapter: "codex",
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

test("filterCodexConfigToml removes disabled MCP server sections", () => {
  const configToml = `
model = "gpt-5.4"

[mcp_servers.chrome-devtools]
command = "npx"

[mcp_servers.chrome-devtools.tools.new_page]
approval_mode = "approve"

[mcp_servers.sentry]
command = "npx"

[mcp_servers.sentry.env]
SENTRY_HOST = "example.com"

[projects."/home/nikolai/git/walleyboard"]
trust_level = "trusted"
`.trimStart();

  const filtered = filterCodexConfigToml(configToml, ["sentry"]);

  assert.match(filtered, /\[mcp_servers\.chrome-devtools\]/);
  assert.doesNotMatch(filtered, /\[mcp_servers\.sentry\]/);
  assert.doesNotMatch(filtered, /\[mcp_servers\.sentry\.env\]/);
  assert.match(filtered, /\[projects\."\/home\/nikolai\/git\/walleyboard"\]/);
});

test("listConfiguredCodexMcpServersInConfig reads MCP server names from config.toml", () => {
  const servers = listConfiguredCodexMcpServersInConfig(`
[mcp_servers.context7]
url = "https://example.com"

[mcp_servers.chrome-devtools]
command = "npx"
`);

  assert.deepEqual(servers, ["chrome-devtools", "context7"]);
});

test("selectEnabledCodexMcpServers excludes disabled MCP servers from the configured set", () => {
  const servers = selectEnabledCodexMcpServers(
    ["context7", "sentry", "context7", "chrome-devtools"],
    ["sentry", "unknown-server", "sentry"],
  );

  assert.deepEqual(servers, ["chrome-devtools", "context7"]);
});

test("Codex MCP discovery and overrides ignore unreadable config files", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-codex-config-"));
  const configPath = join(tempDir, "config.toml");
  const overrideDir = join(tempDir, "overrides");

  mkdirSync(configPath);

  try {
    const project = createProject({
      disabled_mcp_servers: ["context7"],
    });

    assert.deepEqual(
      listEnabledProjectCodexMcpServersInConfigPath(configPath, project),
      [],
    );
    assert.equal(
      writeCodexConfigOverrideForConfigPath(configPath, overrideDir, project),
      null,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("writeCodexConfigOverrideForConfigPath filters disabled servers from readable config", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-codex-config-"));
  const configPath = join(tempDir, "config.toml");
  const overrideDir = join(tempDir, "overrides");

  writeFileSync(
    configPath,
    `
[mcp_servers.context7]
url = "https://example.com"

[mcp_servers.sentry]
command = "npx"
`.trimStart(),
    "utf8",
  );

  try {
    const overridePath = writeCodexConfigOverrideForConfigPath(
      configPath,
      overrideDir,
      createProject({
        disabled_mcp_servers: ["sentry"],
      }),
    );

    assert.equal(overridePath, join(overrideDir, "config.toml"));
    assert.ok(overridePath);
    assert.match(
      readFileSync(overridePath, "utf8"),
      /\[mcp_servers\.context7\]/,
    );
    assert.doesNotMatch(
      readFileSync(overridePath, "utf8"),
      /\[mcp_servers\.sentry\]/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
