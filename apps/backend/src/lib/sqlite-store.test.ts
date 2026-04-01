import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SqliteStore } from "./sqlite-store.js";

function createReadyTicket(
  store: SqliteStore,
  projectId: string,
  repoId: string,
  index: number,
) {
  const title = `Parallel ticket ${index}`;
  const draft = store.createDraft({
    project_id: projectId,
    title,
    description: `Handle parallel execution case ${index}`,
  });

  return store.confirmDraft(draft.id, {
    title,
    description: `Handle parallel execution case ${index}`,
    repo_id: repoId,
    ticket_type: "feature",
    acceptance_criteria: [`Keep execution ${index} isolated.`],
    target_branch: "main",
  });
}

test("parallel ticket sessions stay isolated across stop and resume", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "orchestrator-parallel-"));

  try {
    const store = new SqliteStore(join(tempDir, "orchestrator.sqlite"));
    const { project, repository } = store.createProject({
      name: "Parallel Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    assert.equal(project.max_concurrent_sessions, 4);

    const firstTicket = createReadyTicket(store, project.id, repository.id, 1);
    const secondTicket = createReadyTicket(store, project.id, repository.id, 2);

    const firstStart = store.startTicket(firstTicket.id, false, {
      workingBranch: "codex/ticket-1",
      worktreePath: join(tempDir, "worktrees", "ticket-1"),
      logs: ["Started first session"],
    });
    const secondStart = store.startTicket(secondTicket.id, false, {
      workingBranch: "codex/ticket-2",
      worktreePath: join(tempDir, "worktrees", "ticket-2"),
      logs: ["Started second session"],
    });

    assert.notEqual(firstStart.session.id, secondStart.session.id);
    assert.equal(store.getTicket(firstTicket.id)?.status, "in_progress");
    assert.equal(store.getTicket(secondTicket.id)?.status, "in_progress");
    assert.equal(
      store.getSession(firstStart.session.id)?.status,
      "awaiting_input",
    );
    assert.equal(
      store.getSession(secondStart.session.id)?.status,
      "awaiting_input",
    );

    const secondLogsBeforeStop = store.getSessionLogs(secondStart.session.id);

    const stopped = store.stopTicket(firstTicket.id, "pause the first session");
    assert.equal(stopped.session.status, "interrupted");
    assert.equal(store.getTicket(secondTicket.id)?.status, "in_progress");
    assert.equal(
      store.getSession(secondStart.session.id)?.status,
      "awaiting_input",
    );
    assert.deepEqual(
      store.getSessionLogs(secondStart.session.id),
      secondLogsBeforeStop,
    );

    const resumed = store.resumeTicket(
      firstTicket.id,
      "resume the first session",
    );
    assert.equal(resumed.attempt.attempt_number, 2);
    assert.equal(resumed.session.status, "awaiting_input");
    assert.equal(store.getTicket(secondTicket.id)?.status, "in_progress");
    assert.equal(
      store.getSession(secondStart.session.id)?.status,
      "awaiting_input",
    );
    assert.deepEqual(
      store.getSessionLogs(secondStart.session.id),
      secondLogsBeforeStop,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
