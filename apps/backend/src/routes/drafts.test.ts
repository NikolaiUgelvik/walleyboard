import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Fastify from "fastify";
import fastifyRateLimit from "fastify-rate-limit";

import { EventHub } from "../lib/event-hub.js";
import { SqliteStore } from "../lib/sqlite-store.js";
import { draftRoutes } from "./drafts.js";

test("confirm route rejects missing ticket references before promotion", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-draft-routes-"));

  try {
    const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
    const { project, repository } = store.createProject({
      name: "Draft Route Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });
    const draft = store.createDraft({
      project_id: project.id,
      title: "Depends on #999",
      description: "Finish the follow-up after #999 is done.",
    });

    const app = Fastify();
    await app.register(fastifyRateLimit, { global: false });
    await app.register(draftRoutes, {
      eventHub: new EventHub(),
      executionRuntime: {
        hasActiveDraftRun() {
          return false;
        },
        runDraftFeasibility() {},
        runDraftRefinement() {},
      } as never,
      store,
    });

    const response = await app.inject({
      method: "POST",
      url: `/drafts/${draft.id}/confirm`,
      payload: {
        title: draft.title_draft,
        description: draft.description_draft,
        repo_id: repository.id,
        ticket_type: "feature",
        acceptance_criteria: ["Block promotion when a reference is missing."],
        target_branch: "main",
      },
    });

    assert.equal(response.statusCode, 400);
    assert.match(
      response.json().error,
      /Ticket reference #999 does not exist\./,
    );
    assert.equal(store.listProjectTickets(project.id).length, 0);

    await app.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("draft analysis routes return 409 when Claude is unavailable", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-draft-routes-"));
  const claudeUnavailableError =
    "Claude Code CLI is unavailable: Claude config directory /tmp/.claude is empty.";

  try {
    const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
    const { project } = store.createProject({
      name: "Claude Draft Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });
    store.updateProject(project.id, {
      draft_analysis_agent_adapter: "claude-code",
    });
    const draft = store.createDraft({
      project_id: project.id,
      title: "Claude draft analysis",
      description: "Fail before launching an unavailable Claude run.",
    });

    const app = Fastify();
    await app.register(fastifyRateLimit, { global: false });
    await app.register(draftRoutes, {
      eventHub: new EventHub(),
      executionRuntime: {
        hasActiveDraftRun() {
          return false;
        },
        runDraftFeasibility() {
          throw new Error(claudeUnavailableError);
        },
        runDraftRefinement() {
          throw new Error(claudeUnavailableError);
        },
      } as never,
      store,
    });

    const refineResponse = await app.inject({
      method: "POST",
      url: `/drafts/${draft.id}/refine`,
      payload: {
        instruction: "Tighten the scope.",
      },
    });
    assert.equal(refineResponse.statusCode, 409);
    assert.deepEqual(refineResponse.json(), {
      error: claudeUnavailableError,
    });

    const questionsResponse = await app.inject({
      method: "POST",
      url: `/drafts/${draft.id}/questions`,
      payload: {
        instruction: "Find missing details.",
      },
    });
    assert.equal(questionsResponse.statusCode, 409);
    assert.deepEqual(questionsResponse.json(), {
      error: claudeUnavailableError,
    });

    await app.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("draft updates succeed even when artifact cleanup fails afterwards", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-draft-routes-"));

  try {
    const sqliteStore = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
    const { project } = sqliteStore.createProject({
      name: "Draft Cleanup Failure",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });
    const draft = sqliteStore.createDraft({
      project_id: project.id,
      title: "Before update",
      description: "Old description",
    });

    const store = new Proxy(sqliteStore, {
      get(target, property, receiver) {
        if (property === "listProjectDrafts") {
          return () => {
            throw new Error("cleanup failed");
          };
        }

        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const app = Fastify();
    await app.register(fastifyRateLimit, { global: false });
    await app.register(draftRoutes, {
      eventHub: new EventHub(),
      executionRuntime: {
        hasActiveDraftRun() {
          return false;
        },
        runDraftFeasibility() {},
        runDraftRefinement() {},
      } as never,
      store: store as never,
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/drafts/${draft.id}`,
      payload: {
        title_draft: "After update",
        description_draft: "New description",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(sqliteStore.getDraft(draft.id)?.title_draft, "After update");
    assert.equal(
      sqliteStore.getDraft(draft.id)?.description_draft,
      "New description",
    );

    await app.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
