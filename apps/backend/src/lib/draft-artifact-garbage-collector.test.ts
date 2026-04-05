import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  cleanupAllDraftArtifacts,
  cleanupProjectDraftArtifacts,
} from "./draft-artifact-garbage-collector.js";
import { SqliteStore } from "./sqlite-store.js";
import {
  buildTicketArtifactFilePath,
  ensureTicketArtifactScopeDir,
} from "./ticket-artifacts.js";

function setWalleyBoardHome(path: string): () => void {
  const previous = process.env.WALLEYBOARD_HOME;
  process.env.WALLEYBOARD_HOME = path;
  return () => {
    if (previous === undefined) {
      delete process.env.WALLEYBOARD_HOME;
      return;
    }

    process.env.WALLEYBOARD_HOME = previous;
  };
}

test("cleanupProjectDraftArtifacts removes orphan files and scopes while preserving referenced images", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-draft-artifact-gc-"));
  const restoreWalleyBoardHome = setWalleyBoardHome(tempDir);
  const databasePath = join(tempDir, "walleyboard.sqlite");

  try {
    const store = new SqliteStore(databasePath);
    const { project } = store.createProject({
      name: "Artifact GC Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    store.createDraft({
      project_id: project.id,
      artifact_scope_id: "scope-1",
      title: "Keep one image",
      description: `![Keep](/projects/${project.id}/draft-artifacts/scope-1/keep.png)`,
      proposed_ticket_type: "feature",
      proposed_acceptance_criteria: [],
    });

    const keepPath = buildTicketArtifactFilePath(
      project.slug,
      "scope-1",
      "keep.png",
    );
    const orphanFilePath = buildTicketArtifactFilePath(
      project.slug,
      "scope-1",
      "drop.png",
    );
    const orphanScopePath = ensureTicketArtifactScopeDir(
      project.slug,
      "scope-2",
    );
    const orphanScopeFilePath = buildTicketArtifactFilePath(
      project.slug,
      "scope-2",
      "orphan.png",
    );

    ensureTicketArtifactScopeDir(project.slug, "scope-1");
    writeFileSync(keepPath, "keep");
    writeFileSync(orphanFilePath, "drop");
    writeFileSync(orphanScopeFilePath, "orphan");

    const cleanup = cleanupProjectDraftArtifacts({
      orphanScopeGraceMs: 0,
      project,
      store,
    });

    assert.equal(existsSync(keepPath), true);
    assert.equal(existsSync(orphanFilePath), false);
    assert.equal(existsSync(orphanScopeFilePath), false);
    assert.equal(existsSync(orphanScopePath), false);
    assert.deepEqual(cleanup.removedFiles, [orphanFilePath]);
    assert.deepEqual(cleanup.removedScopes, [orphanScopePath]);
  } finally {
    restoreWalleyBoardHome();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("cleanupAllDraftArtifacts preserves images referenced by archived tickets", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-draft-artifact-gc-"));
  const restoreWalleyBoardHome = setWalleyBoardHome(tempDir);
  const databasePath = join(tempDir, "walleyboard.sqlite");

  try {
    const store = new SqliteStore(databasePath);
    const { project, repository } = store.createProject({
      name: "Archived Artifact Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    const draft = store.createDraft({
      project_id: project.id,
      artifact_scope_id: "scope-ticket",
      title: "Ship it",
      description: `![Keep](/projects/${project.id}/draft-artifacts/scope-ticket/keep.png)`,
      proposed_ticket_type: "feature",
      proposed_acceptance_criteria: ["Done"],
    });
    const ticket = store.confirmDraft(draft.id, {
      title: draft.title_draft,
      description: draft.description_draft,
      repo_id: repository.id,
      ticket_type: "feature",
      acceptance_criteria: ["Done"],
      target_branch: "main",
    });
    store.updateTicketStatus(ticket.id, "done");
    store.archiveTicket(ticket.id);

    const keepPath = buildTicketArtifactFilePath(
      project.slug,
      "scope-ticket",
      "keep.png",
    );
    ensureTicketArtifactScopeDir(project.slug, "scope-ticket");
    writeFileSync(keepPath, "keep");

    const cleanup = cleanupAllDraftArtifacts({
      orphanScopeGraceMs: 0,
      store,
    });

    assert.equal(existsSync(keepPath), true);
    assert.deepEqual(cleanup.removedFiles, []);
    assert.deepEqual(cleanup.removedScopes, []);
  } finally {
    restoreWalleyBoardHome();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("cleanupProjectDraftArtifacts preserves fresh unreferenced files in active scopes", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-draft-artifact-gc-"));
  const restoreWalleyBoardHome = setWalleyBoardHome(tempDir);
  const databasePath = join(tempDir, "walleyboard.sqlite");

  try {
    const store = new SqliteStore(databasePath);
    const { project } = store.createProject({
      name: "Fresh Upload Preservation",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    store.createDraft({
      project_id: project.id,
      artifact_scope_id: "scope-1",
      title: "Keep the recent upload",
      description: `![Keep](/projects/${project.id}/draft-artifacts/scope-1/keep.png)`,
      proposed_ticket_type: "feature",
      proposed_acceptance_criteria: [],
    });

    const keepPath = buildTicketArtifactFilePath(
      project.slug,
      "scope-1",
      "keep.png",
    );
    const recentUploadPath = buildTicketArtifactFilePath(
      project.slug,
      "scope-1",
      "recent.png",
    );

    ensureTicketArtifactScopeDir(project.slug, "scope-1");
    writeFileSync(keepPath, "keep");
    writeFileSync(recentUploadPath, "recent");

    const cleanup = cleanupProjectDraftArtifacts({
      orphanScopeGraceMs: 24 * 60 * 60 * 1_000,
      project,
      store,
    });

    assert.equal(existsSync(keepPath), true);
    assert.equal(existsSync(recentUploadPath), true);
    assert.deepEqual(cleanup.removedFiles, []);
  } finally {
    restoreWalleyBoardHome();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("cleanupProjectDraftArtifacts removes stale unreferenced files in active scopes", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-draft-artifact-gc-"));
  const restoreWalleyBoardHome = setWalleyBoardHome(tempDir);
  const databasePath = join(tempDir, "walleyboard.sqlite");

  try {
    const store = new SqliteStore(databasePath);
    const { project } = store.createProject({
      name: "Stale Upload Cleanup",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    store.createDraft({
      project_id: project.id,
      artifact_scope_id: "scope-1",
      title: "Drop the stale upload",
      description: `![Keep](/projects/${project.id}/draft-artifacts/scope-1/keep.png)`,
      proposed_ticket_type: "feature",
      proposed_acceptance_criteria: [],
    });

    const keepPath = buildTicketArtifactFilePath(
      project.slug,
      "scope-1",
      "keep.png",
    );
    const staleUploadPath = buildTicketArtifactFilePath(
      project.slug,
      "scope-1",
      "stale.png",
    );

    ensureTicketArtifactScopeDir(project.slug, "scope-1");
    writeFileSync(keepPath, "keep");
    writeFileSync(staleUploadPath, "stale");
    const staleTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1_000);
    utimesSync(staleUploadPath, staleTimestamp, staleTimestamp);

    const cleanup = cleanupProjectDraftArtifacts({
      orphanScopeGraceMs: 24 * 60 * 60 * 1_000,
      project,
      store,
    });

    assert.equal(existsSync(keepPath), true);
    assert.equal(existsSync(staleUploadPath), false);
    assert.deepEqual(cleanup.removedFiles, [staleUploadPath]);
  } finally {
    restoreWalleyBoardHome();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
