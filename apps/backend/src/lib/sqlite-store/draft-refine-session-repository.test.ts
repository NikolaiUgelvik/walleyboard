import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  draftTicketStatesTable,
  projectsTable,
  repositoriesTable,
} from "@walleyboard/db";

import { DraftRefineSessionRepository } from "./draft-refine-session-repository.js";
import { SqliteStoreContext } from "./shared.js";

function makeContext() {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-refine-repo-"));
  const dbPath = join(tempDir, "test.sqlite");
  const context = new SqliteStoreContext(dbPath);
  const now = new Date().toISOString();
  context.db
    .insert(projectsTable)
    .values({
      id: "project-1",
      slug: "test",
      name: "Test",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  context.db
    .insert(repositoriesTable)
    .values({
      id: "repo-1",
      projectId: "project-1",
      name: "test-repo",
      path: "/tmp/test-repo",
      validationProfile: [],
      extraEnvAllowlist: [],
      createdAt: now,
      updatedAt: now,
    })
    .run();
  context.db
    .insert(draftTicketStatesTable)
    .values({
      id: "draft-1",
      projectId: "project-1",
      artifactScopeId: "scope-1",
      titleDraft: "Test draft",
      descriptionDraft: "A test draft",
      proposedAcceptanceCriteria: [],
      wizardStatus: "editing",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return {
    context,
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  };
}

test("create returns a running session with zero attempts", () => {
  const { context, cleanup } = makeContext();
  try {
    const repo = new DraftRefineSessionRepository(context);
    const session = repo.create({
      draftId: "draft-1",
      projectId: "project-1",
      repositoryId: "repo-1",
    });

    assert.equal(session.draft_id, "draft-1");
    assert.equal(session.project_id, "project-1");
    assert.equal(session.repository_id, "repo-1");
    assert.equal(session.status, "running");
    assert.equal(session.attempt_count, 0);
    assert.equal(session.adapter_session_ref, null);
    assert.ok(session.id.length > 0);
    assert.ok(session.created_at.length > 0);
  } finally {
    cleanup();
  }
});

test("recordAttempt updates attempt count and adapter session ref", () => {
  const { context, cleanup } = makeContext();
  try {
    const repo = new DraftRefineSessionRepository(context);
    const session = repo.create({
      draftId: "draft-1",
      projectId: "project-1",
      repositoryId: "repo-1",
    });

    const updated = repo.recordAttempt(session.id, {
      adapterSessionRef: "sess-abc",
      attemptCount: 1,
    });

    assert.ok(updated);
    assert.equal(updated.attempt_count, 1);
    assert.equal(updated.adapter_session_ref, "sess-abc");
    assert.equal(updated.status, "running");
  } finally {
    cleanup();
  }
});

test("complete sets the status to completed", () => {
  const { context, cleanup } = makeContext();
  try {
    const repo = new DraftRefineSessionRepository(context);
    const session = repo.create({
      draftId: "draft-1",
      projectId: "project-1",
      repositoryId: "repo-1",
    });

    repo.complete(session.id, "completed");

    const updated = repo.recordAttempt(session.id, {
      adapterSessionRef: null,
      attemptCount: 0,
    });
    assert.ok(updated);
    assert.equal(updated.status, "completed");
  } finally {
    cleanup();
  }
});

test("complete sets the status to failed", () => {
  const { context, cleanup } = makeContext();
  try {
    const repo = new DraftRefineSessionRepository(context);
    const session = repo.create({
      draftId: "draft-1",
      projectId: "project-1",
      repositoryId: "repo-1",
    });

    repo.complete(session.id, "failed");

    const updated = repo.recordAttempt(session.id, {
      adapterSessionRef: null,
      attemptCount: 0,
    });
    assert.ok(updated);
    assert.equal(updated.status, "failed");
  } finally {
    cleanup();
  }
});

test("recordAttempt returns undefined for non-existent id", () => {
  const { context, cleanup } = makeContext();
  try {
    const repo = new DraftRefineSessionRepository(context);
    const result = repo.recordAttempt("nonexistent", {
      adapterSessionRef: null,
      attemptCount: 1,
    });
    assert.equal(result, undefined);
  } finally {
    cleanup();
  }
});
