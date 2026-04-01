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

test("planning sessions keep plan approval state across retries", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "orchestrator-planning-"));

  try {
    const store = new SqliteStore(join(tempDir, "orchestrator.sqlite"));
    const { project, repository } = store.createProject({
      name: "Planning Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    const ticket = createReadyTicket(store, project.id, repository.id, 1);
    const started = store.startTicket(ticket.id, true, {
      workingBranch: "codex/ticket-1",
      worktreePath: join(tempDir, "worktrees", "ticket-1"),
      logs: ["Started planning session"],
    });

    assert.equal(started.session.plan_status, "drafting");
    assert.equal(started.session.plan_summary, null);

    const awaitingFeedback = store.updateSessionPlan(started.session.id, {
      status: "paused_checkpoint",
      plan_status: "awaiting_feedback",
      plan_summary: "Inspect the session plumbing and wire plan approval.",
    });
    assert.equal(awaitingFeedback?.plan_status, "awaiting_feedback");
    assert.equal(
      awaitingFeedback?.plan_summary,
      "Inspect the session plumbing and wire plan approval.",
    );

    const revisedPlanning = store.resumeTicket(ticket.id, "revise the plan");
    assert.equal(revisedPlanning.session.plan_status, "drafting");
    assert.equal(revisedPlanning.session.plan_summary, null);

    store.updateSessionPlan(started.session.id, {
      plan_status: "approved",
      plan_summary: "Approved plan",
    });

    const implementationResume = store.resumeTicket(ticket.id, "approved plan");
    assert.equal(implementationResume.session.plan_status, "approved");
    assert.equal(implementationResume.session.plan_summary, "Approved plan");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
