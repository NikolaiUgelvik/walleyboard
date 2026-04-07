import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  getAgentEnvOverrides,
  getAgentEnvOverridesCached,
  loadAgentEnvOverrides,
  resetConfCache,
} from "./walleyboard-conf.js";

function makeTmpHome(): string {
  const dir = join(tmpdir(), `walleyboard-conf-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

test("loadAgentEnvOverrides returns empty when config file does not exist", async () => {
  const home = makeTmpHome();
  process.env.WALLEYBOARD_HOME = home;
  resetConfCache();
  try {
    const result = await loadAgentEnvOverrides();
    assert.deepEqual(result, {});
  } finally {
    delete process.env.WALLEYBOARD_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

test("loadAgentEnvOverrides parses agent sections", async () => {
  const home = makeTmpHome();
  process.env.WALLEYBOARD_HOME = home;
  resetConfCache();
  writeFileSync(
    join(home, "walleyboard.conf"),
    `[claude-code]
ANTHROPIC_API_KEY = "sk-ant-test"
CUSTOM_VAR = "hello"

[codex]
OPENAI_API_KEY = "sk-test"
`,
    "utf8",
  );
  try {
    const result = await loadAgentEnvOverrides();
    assert.deepEqual(result["claude-code"], {
      ANTHROPIC_API_KEY: "sk-ant-test",
      CUSTOM_VAR: "hello",
    });
    assert.deepEqual(result.codex, {
      OPENAI_API_KEY: "sk-test",
    });
  } finally {
    delete process.env.WALLEYBOARD_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

test("getAgentEnvOverrides returns only matching agent section", async () => {
  const home = makeTmpHome();
  process.env.WALLEYBOARD_HOME = home;
  resetConfCache();
  writeFileSync(
    join(home, "walleyboard.conf"),
    `[claude-code]
FOO = "bar"

[codex]
BAZ = "qux"
`,
    "utf8",
  );
  try {
    const claudeEnv = await getAgentEnvOverrides("claude-code");
    assert.deepEqual(claudeEnv, { FOO: "bar" });
    const codexEnv = await getAgentEnvOverrides("codex");
    assert.deepEqual(codexEnv, { BAZ: "qux" });
  } finally {
    delete process.env.WALLEYBOARD_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

test("getAgentEnvOverrides returns empty for unknown agent when other sections exist", async () => {
  const home = makeTmpHome();
  process.env.WALLEYBOARD_HOME = home;
  resetConfCache();
  writeFileSync(
    join(home, "walleyboard.conf"),
    `[claude-code]
FOO = "bar"
`,
    "utf8",
  );
  try {
    const codexEnv = await getAgentEnvOverrides("codex");
    assert.deepEqual(codexEnv, {});
  } finally {
    delete process.env.WALLEYBOARD_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

test("loadAgentEnvOverrides handles invalid TOML gracefully", async () => {
  const home = makeTmpHome();
  process.env.WALLEYBOARD_HOME = home;
  resetConfCache();
  writeFileSync(join(home, "walleyboard.conf"), "{{invalid toml", "utf8");
  try {
    const result = await loadAgentEnvOverrides();
    assert.deepEqual(result, {});
  } finally {
    delete process.env.WALLEYBOARD_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

test("getAgentEnvOverridesCached returns empty when cache is not populated", () => {
  resetConfCache();
  const result = getAgentEnvOverridesCached("claude-code");
  assert.deepEqual(result, {});
});

test("getAgentEnvOverridesCached returns cached data after async load", async () => {
  const home = makeTmpHome();
  process.env.WALLEYBOARD_HOME = home;
  resetConfCache();
  writeFileSync(
    join(home, "walleyboard.conf"),
    `[claude-code]
MY_VAR = "cached"
`,
    "utf8",
  );
  try {
    await loadAgentEnvOverrides();
    const result = getAgentEnvOverridesCached("claude-code");
    assert.deepEqual(result, { MY_VAR: "cached" });
  } finally {
    delete process.env.WALLEYBOARD_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

test("loadAgentEnvOverrides ignores non-string values in sections", async () => {
  const home = makeTmpHome();
  process.env.WALLEYBOARD_HOME = home;
  resetConfCache();
  writeFileSync(
    join(home, "walleyboard.conf"),
    `[claude-code]
STRING_VAR = "value"
NUM_VAR = 42
BOOL_VAR = true
`,
    "utf8",
  );
  try {
    const result = await loadAgentEnvOverrides();
    assert.deepEqual(result["claude-code"], { STRING_VAR: "value" });
  } finally {
    delete process.env.WALLEYBOARD_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});
