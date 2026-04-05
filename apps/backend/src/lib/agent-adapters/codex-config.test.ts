import assert from "node:assert/strict";
import test from "node:test";

import {
  filterCodexConfigToml,
  listConfiguredCodexMcpServersInConfig,
  selectEnabledCodexMcpServers,
} from "./codex-config.js";

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
