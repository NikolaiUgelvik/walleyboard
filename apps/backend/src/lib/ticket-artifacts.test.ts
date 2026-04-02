import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildTicketArtifactFilePath,
  ensureTicketArtifactScopeDir,
  removeTicketArtifactScope,
} from "./ticket-artifacts.js";

function setWalleyBoardHome(path: string): () => void {
  const previous = process.env.WALLEYBOARD_HOME;
  process.env.WALLEYBOARD_HOME = path;
  return () => {
    if (previous === undefined) {
      process.env.WALLEYBOARD_HOME = undefined;
      return;
    }

    process.env.WALLEYBOARD_HOME = previous;
  };
}

test("buildTicketArtifactFilePath keeps files inside the artifact root", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-ticket-artifacts-"));
  const restoreWalleyBoardHome = setWalleyBoardHome(tempDir);

  try {
    const artifactPath = buildTicketArtifactFilePath(
      "project-one",
      "scope-one",
      "image.png",
    );

    assert.equal(
      artifactPath,
      join(
        tempDir,
        "ticket-artifacts",
        "project-one",
        "scope-one",
        "image.png",
      ),
    );
  } finally {
    restoreWalleyBoardHome();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("buildTicketArtifactFilePath rejects escaping artifact paths", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-ticket-artifacts-"));
  const restoreWalleyBoardHome = setWalleyBoardHome(tempDir);

  try {
    assert.throws(
      () =>
        buildTicketArtifactFilePath("project-one", "../scope-one", "image.png"),
      /Artifact path escapes project root/,
    );
    assert.throws(
      () =>
        buildTicketArtifactFilePath(
          "project-one",
          "scope-one",
          "../../image.png",
        ),
      /Artifact path escapes project root/,
    );
  } finally {
    restoreWalleyBoardHome();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ensureTicketArtifactScopeDir creates and removes scoped directories", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-ticket-artifacts-"));
  const restoreWalleyBoardHome = setWalleyBoardHome(tempDir);

  try {
    const scopeDir = ensureTicketArtifactScopeDir("project-one", "scope-one");
    assert.equal(existsSync(scopeDir), true);

    const removedPath = removeTicketArtifactScope("project-one", "scope-one");
    assert.equal(removedPath, scopeDir);
    assert.equal(existsSync(scopeDir), false);
  } finally {
    restoreWalleyBoardHome();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
