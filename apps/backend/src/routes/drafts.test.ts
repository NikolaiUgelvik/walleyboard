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
