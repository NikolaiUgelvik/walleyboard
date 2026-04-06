import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { assertProjectAgentAdapterSaveAvailable } from "./project-agent-adapter-save-validation.js";

test("project save validation accepts Codex when the host config directory and binary exist", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-project-save-"));
  const configHomePath = join(tempDir, ".codex");

  mkdirSync(configHomePath, { recursive: true });

  try {
    assert.doesNotThrow(() =>
      assertProjectAgentAdapterSaveAvailable("codex", {
        locateCommandPath: () => "/usr/local/bin/codex",
        resolveConfigHomePath: () => configHomePath,
      }),
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("project save validation rejects Claude when the host config directory is missing", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-project-save-"));
  const configHomePath = join(tempDir, ".claude");

  try {
    assert.throws(
      () =>
        assertProjectAgentAdapterSaveAvailable("claude-code", {
          locateCommandPath: () => "/usr/local/bin/claude",
          resolveConfigHomePath: () => configHomePath,
        }),
      {
        message: `Claude Code CLI is unavailable on this machine: config directory ${configHomePath} does not exist.`,
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("project save validation rejects Codex when the binary is missing from PATH", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-project-save-"));
  const configHomePath = join(tempDir, ".codex");

  mkdirSync(configHomePath, { recursive: true });

  try {
    assert.throws(
      () =>
        assertProjectAgentAdapterSaveAvailable("codex", {
          locateCommandPath: () => null,
          resolveConfigHomePath: () => configHomePath,
        }),
      {
        message:
          "Codex CLI is unavailable on this machine: `codex` was not found in PATH.",
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
