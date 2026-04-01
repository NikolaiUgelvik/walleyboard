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

test("starting beyond the running cap keeps the ticket in progress and queues the session", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "orchestrator-queue-start-"));

  try {
    const store = new SqliteStore(join(tempDir, "orchestrator.sqlite"));
    const { project, repository } = store.createProject({
      name: "Queued Start Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    const tickets = Array.from({ length: 5 }, (_, index) =>
      createReadyTicket(store, project.id, repository.id, index + 1),
    );

    const startedSessions = tickets.map((ticket, index) =>
      store.startTicket(ticket.id, false, {
        workingBranch: `codex/ticket-${index + 1}`,
        worktreePath: join(tempDir, "worktrees", `ticket-${index + 1}`),
        logs: [`Started session ${index + 1}`],
      }),
    );

    for (const result of startedSessions.slice(0, 4)) {
      assert.equal(result.session.status, "awaiting_input");
    }

    const queuedStart = startedSessions[4];
    const queuedTicket = tickets[4];
    assert.ok(queuedStart);
    assert.ok(queuedTicket);
    assert.equal(store.getTicket(queuedTicket.id)?.status, "in_progress");
    assert.equal(queuedStart.session.status, "queued");
    assert.ok(store.getSession(queuedStart.session.id)?.queue_entered_at);
    assert.equal(
      store.listSessionAttempts(queuedStart.session.id)[0]?.status,
      "queued",
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("queued sessions are claimed in FIFO order when a slot opens", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "orchestrator-queue-order-"));

  try {
    const store = new SqliteStore(join(tempDir, "orchestrator.sqlite"));
    const { project, repository } = store.createProject({
      name: "Queued Order Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    const tickets = Array.from({ length: 6 }, (_, index) =>
      createReadyTicket(store, project.id, repository.id, index + 1),
    );

    const sessions = tickets.map((ticket, index) =>
      store.startTicket(ticket.id, false, {
        workingBranch: `codex/ticket-${index + 1}`,
        worktreePath: join(tempDir, "worktrees", `ticket-${index + 1}`),
        logs: [`Started session ${index + 1}`],
      }),
    );

    const fifthSession = sessions[4];
    const sixthSession = sessions[5];
    const firstSession = sessions[0];
    const secondSession = sessions[1];
    assert.ok(fifthSession);
    assert.ok(sixthSession);
    assert.ok(firstSession);
    assert.ok(secondSession);

    assert.equal(fifthSession.session.status, "queued");
    assert.equal(sixthSession.session.status, "queued");

    store.completeSession(firstSession.session.id, {
      status: "failed",
      last_summary: "First session freed its running slot.",
    });

    const firstClaimed = store.claimNextQueuedSession(project.id);
    assert.equal(firstClaimed?.id, fifthSession.session.id);
    assert.equal(firstClaimed?.status, "awaiting_input");
    assert.equal(firstClaimed?.queue_entered_at, null);

    store.completeSession(secondSession.session.id, {
      status: "failed",
      last_summary: "Second session freed its running slot.",
    });

    const secondClaimed = store.claimNextQueuedSession(project.id);
    assert.equal(secondClaimed?.id, sixthSession.session.id);
    assert.equal(secondClaimed?.status, "awaiting_input");
    assert.equal(secondClaimed?.queue_entered_at, null);
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

test("archived tickets stay in storage but leave active project lists", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "orchestrator-archive-"));
  const databasePath = join(tempDir, "orchestrator.sqlite");

  try {
    const store = new SqliteStore(databasePath);
    const { project, repository } = store.createProject({
      name: "Archive Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    const ticket = createReadyTicket(store, project.id, repository.id, 1);
    const completedTicket = store.updateTicketStatus(ticket.id, "done");
    assert.equal(completedTicket?.status, "done");

    const archivedTicket = store.archiveTicket(ticket.id);
    assert.equal(archivedTicket?.id, ticket.id);
    assert.deepEqual(store.listProjectTickets(project.id), []);
    assert.equal(
      store.listProjectTickets(project.id, { archivedOnly: true }).length,
      1,
    );
    assert.equal(
      store.listProjectTickets(project.id, { includeArchived: true }).length,
      1,
    );

    const reopenedStore = new SqliteStore(databasePath);
    assert.deepEqual(reopenedStore.listProjectTickets(project.id), []);
    assert.equal(reopenedStore.getTicket(ticket.id)?.id, ticket.id);
    assert.equal(
      reopenedStore.listProjectTickets(project.id, { archivedOnly: true })
        .length,
      1,
    );
    assert.equal(
      reopenedStore.listProjectTickets(project.id, { includeArchived: true })
        .length,
      1,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("restored tickets rejoin active project lists and persist after reload", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "orchestrator-restore-"));
  const databasePath = join(tempDir, "orchestrator.sqlite");

  try {
    const store = new SqliteStore(databasePath);
    const { project, repository } = store.createProject({
      name: "Restore Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    const ticket = createReadyTicket(store, project.id, repository.id, 1);
    const completedTicket = store.updateTicketStatus(ticket.id, "done");
    assert.equal(completedTicket?.status, "done");
    store.archiveTicket(ticket.id);

    const restoredTicket = store.restoreTicket(ticket.id);
    assert.equal(restoredTicket?.id, ticket.id);
    assert.equal(store.listProjectTickets(project.id).length, 1);
    assert.equal(
      store.listProjectTickets(project.id, { archivedOnly: true }).length,
      0,
    );

    const reopenedStore = new SqliteStore(databasePath);
    assert.equal(reopenedStore.listProjectTickets(project.id).length, 1);
    assert.equal(
      reopenedStore.listProjectTickets(project.id, { archivedOnly: true })
        .length,
      0,
    );
    assert.equal(reopenedStore.getTicket(ticket.id)?.id, ticket.id);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("markdown content is preserved across draft, ticket, and session note flows", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "orchestrator-markdown-"));

  try {
    const store = new SqliteStore(join(tempDir, "orchestrator.sqlite"));
    const { project, repository } = store.createProject({
      name: "Markdown Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    const draftDescription = [
      "# Ticket Description",
      "",
      "- Keep **bold** formatting",
      '- Preserve [links](https://example.com "docs") literally in storage',
    ].join("\n");
    const draftCriteria = [
      "**First** acceptance criterion",
      "[Second criterion](https://example.com)",
    ];
    const draft = store.createDraft({
      project_id: project.id,
      artifact_scope_id: "artifact-scope-markdown",
      title: "**Markdown** draft",
      description: draftDescription,
      proposed_acceptance_criteria: draftCriteria,
    });

    assert.equal(draft.artifact_scope_id, "artifact-scope-markdown");
    assert.equal(draft.title_draft, "**Markdown** draft");
    assert.equal(draft.description_draft, draftDescription);
    assert.deepEqual(draft.proposed_acceptance_criteria, draftCriteria);

    const ticket = store.confirmDraft(draft.id, {
      title: draft.title_draft,
      description: draft.description_draft,
      repo_id: repository.id,
      ticket_type: "feature",
      acceptance_criteria: draft.proposed_acceptance_criteria,
      target_branch: "main",
    });

    assert.equal(ticket.title, "**Markdown** draft");
    assert.equal(ticket.artifact_scope_id, "artifact-scope-markdown");
    assert.equal(ticket.description, draftDescription);
    assert.deepEqual(ticket.acceptance_criteria, draftCriteria);

    const started = store.startTicket(ticket.id, false, {
      workingBranch: "codex/ticket-markdown",
      worktreePath: join(tempDir, "worktrees", "ticket-markdown"),
      logs: ["Started markdown session"],
    });

    const sessionInput = [
      "## Session note",
      "",
      "- Keep the raw Markdown",
      "- Do not collapse whitespace",
    ].join("\n");
    store.addSessionInput(started.session.id, sessionInput);
    assert.equal(
      store.getSessionLogs(started.session.id).at(-1),
      `User input recorded:\n${sessionInput}`,
    );

    store.createReviewPackage({
      ticket_id: ticket.id,
      session_id: started.session.id,
      diff_ref: "ticket.patch",
      commit_refs: ["abc123"],
      change_summary: "Summary",
      validation_results: [],
      remaining_risks: [],
    });
    store.updateTicketStatus(ticket.id, "review");

    const requestedChanges = [
      "# Requested Changes",
      "",
      "1. Fix the [broken path](https://example.com/fix).",
      "2. Keep _emphasis_ intact.",
    ].join("\n");
    const restarted = store.requestTicketChanges(ticket.id, requestedChanges);
    assert.ok(restarted.requestedChangeNote);
    assert.equal(restarted.requestedChangeNote.body, requestedChanges);
    assert.equal(
      store.getSessionLogs(started.session.id).at(-4),
      `Requested changes recorded:\n${requestedChanges}`,
    );

    const resumeInstruction = [
      "### Resume Guidance",
      "",
      "- Re-check the markdown renderer",
      "- Keep `code` spans untouched",
    ].join("\n");
    const resumed = store.resumeTicket(ticket.id, resumeInstruction);
    assert.equal(
      resumed.session.last_summary,
      `Execution resume requested:\n${resumeInstruction}`,
    );
    assert.equal(
      store.getSessionLogs(started.session.id).at(-4),
      `Resume instruction recorded:\n${resumeInstruction}`,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("recordMergeConflict moves the ticket back to in progress with a system note", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "orchestrator-merge-note-"));

  try {
    const store = new SqliteStore(join(tempDir, "orchestrator.sqlite"));
    const { project, repository } = store.createProject({
      name: "Merge Conflict Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    const draft = store.createDraft({
      project_id: project.id,
      title: "Handle merge conflict fallback",
      description:
        "Preserve the ticket state when direct merge recovery fails.",
    });
    const ticket = store.confirmDraft(draft.id, {
      title: draft.title_draft,
      description: draft.description_draft,
      repo_id: repository.id,
      ticket_type: "feature",
      acceptance_criteria: ["Return the ticket to in_progress with a note."],
      target_branch: "main",
    });

    const started = store.startTicket(ticket.id, false, {
      workingBranch: "codex/ticket-merge",
      worktreePath: join(tempDir, "worktrees", "ticket-merge"),
      logs: ["Started merge ticket session"],
    });

    store.createReviewPackage({
      ticket_id: ticket.id,
      session_id: started.session.id,
      diff_ref: "ticket.patch",
      commit_refs: ["abc123"],
      change_summary: "Summary",
      validation_results: [],
      remaining_risks: [],
    });
    store.updateTicketStatus(ticket.id, "review");
    store.updateSessionStatus(
      started.session.id,
      "completed",
      "Review package ready.",
    );

    const noteBody =
      "Automatic merge recovery could not resolve conflicts in src/app.ts.";
    const result = store.recordMergeConflict(ticket.id, noteBody);

    assert.equal(result.ticket.status, "in_progress");
    assert.equal(result.session.status, "failed");
    assert.equal(result.requestedChangeNote.author_type, "system");
    assert.equal(result.requestedChangeNote.body, noteBody);
    assert.equal(
      result.session.latest_requested_change_note_id,
      result.requestedChangeNote.id,
    );
    assert.equal(
      result.session.last_summary,
      `Merge conflict detected:\n${noteBody}`,
    );
    assert.equal(
      store.getSessionLogs(started.session.id).at(-4),
      `Merge conflict note recorded:\n${noteBody}`,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
