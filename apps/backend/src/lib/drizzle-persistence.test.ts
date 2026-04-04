import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createMigratedWalleyboardDatabase } from "@walleyboard/db";

import { createApp } from "../app.js";
import { createTestDockerRuntime } from "../test-support/create-isolated-app.js";
import { SqliteStore } from "./sqlite-store.js";

test("SqliteStore bootstraps a fresh database with Drizzle migrations", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-drizzle-store-"));
  const databasePath = join(tempDir, "walleyboard.sqlite");

  let store: SqliteStore | null = null;
  let reopenedStore: SqliteStore | null = null;

  try {
    store = new SqliteStore(databasePath);
    const { project, repository } = store.createProject({
      name: "Migration Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
        validation_commands: ["npm test"],
      },
    });
    const draft = store.createDraft({
      project_id: project.id,
      title: "Bootstrap ticket",
      description: "Verify the initial Drizzle migration path.",
    });
    const ticket = store.confirmDraft(draft.id, {
      title: "Bootstrap ticket",
      description: "Verify the initial Drizzle migration path.",
      repo_id: repository.id,
      ticket_type: "feature",
      acceptance_criteria: ["Persist records across store restarts."],
      target_branch: "main",
    });

    store.close();
    store = null;

    reopenedStore = new SqliteStore(databasePath);
    const persistedProject = reopenedStore.getProject(project.id);
    const persistedRepository = reopenedStore.getRepository(repository.id);
    const persistedTicket = reopenedStore.getTicket(ticket.id);

    assert.equal(persistedProject?.execution_backend, "docker");
    assert.equal(persistedProject?.agent_adapter, "codex");
    assert.equal(persistedRepository?.validation_profile.length, 1);
    assert.equal(persistedTicket?.title, "Bootstrap ticket");
    assert.deepEqual(persistedTicket?.acceptance_criteria, [
      "Persist records across store restarts.",
    ]);
  } finally {
    reopenedStore?.close();
    store?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("createMigratedWalleyboardDatabase can reopen an already migrated database", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-drizzle-handle-"));
  const databasePath = join(tempDir, "walleyboard.sqlite");

  try {
    const firstHandle = createMigratedWalleyboardDatabase(databasePath);
    firstHandle.close();

    const secondHandle = createMigratedWalleyboardDatabase(databasePath);
    secondHandle.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("createApp starts cleanly against a fresh Drizzle-migrated database", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-drizzle-app-"));
  const databasePath = join(tempDir, "walleyboard.sqlite");
  const dockerRuntime = createTestDockerRuntime();

  let app: Awaited<ReturnType<typeof createApp>> | null = null;

  try {
    app = await createApp({
      databasePath,
      dockerRuntime,
      skipStartupDockerCleanup: true,
    });

    const response = await app.inject({
      method: "GET",
      url: "/projects",
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { projects: [] });
  } finally {
    await app?.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
