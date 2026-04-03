import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

function listRelativePaths(rootPath: string, relativePath = ""): string[] {
  const absolutePath =
    relativePath.length === 0 ? rootPath : join(rootPath, relativePath);
  const entries = readdirSync(absolutePath, { withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries) {
    const childRelativePath =
      relativePath.length === 0 ? entry.name : join(relativePath, entry.name);
    paths.push(childRelativePath);

    if (entry.isDirectory()) {
      paths.push(...listRelativePaths(rootPath, childRelativePath));
    }
  }

  return paths.sort((left, right) => left.localeCompare(right));
}

test("parallel ticket sessions stay isolated across stop and resume", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-parallel-"));

  try {
    const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
    const { project, repository } = store.createProject({
      name: "Parallel Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    assert.equal(project.max_concurrent_sessions, 4);
    assert.equal(project.agent_adapter, "codex");
    assert.equal(project.automatic_agent_review, false);

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

test("startup recovery leaves sessions alone when the tracked PTY is still alive", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-recovery-live-"));
  const databasePath = join(tempDir, "walleyboard.sqlite");

  try {
    const store = new SqliteStore(databasePath);
    const { project, repository } = store.createProject({
      name: "Recovery Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    const ticket = createReadyTicket(store, project.id, repository.id, 1);
    const started = store.startTicket(ticket.id, false, {
      workingBranch: "codex/ticket-1",
      worktreePath: join(tempDir, "worktrees", "ticket-1"),
      logs: ["Started implementation session"],
    });

    store.updateSessionStatus(
      started.session.id,
      "running",
      "Execution is still attached to a live PTY.",
    );
    store.updateExecutionAttempt(started.attempt.id, {
      status: "running",
      pty_pid: process.pid,
    });

    const reopenedStore = new SqliteStore(databasePath);
    const recovery = reopenedStore.recoverInterruptedSessions();

    assert.deepEqual(recovery.sessions, []);
    assert.equal(
      reopenedStore.getSession(started.session.id)?.status,
      "running",
    );
    assert.equal(
      reopenedStore.listSessionAttempts(started.session.id)[0]?.status,
      "running",
    );
    assert.equal(
      reopenedStore
        .getSessionLogs(started.session.id)
        .includes(
          "Session was marked interrupted after backend startup recovery.",
        ),
      false,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("updateProject persists repository target branch changes", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-project-options-"));
  const databasePath = join(tempDir, "walleyboard.sqlite");

  try {
    const store = new SqliteStore(databasePath);
    const { project, repository } = store.createProject({
      name: "Project Options",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
        target_branch: "main",
      },
    });

    store.updateProject(project.id, {
      repository_target_branches: [
        {
          repository_id: repository.id,
          target_branch: "release/1.0",
        },
      ],
    });

    assert.equal(
      store.getRepository(repository.id)?.target_branch,
      "release/1.0",
    );

    const reloadedStore = new SqliteStore(databasePath);
    assert.equal(
      reloadedStore.getRepository(repository.id)?.target_branch,
      "release/1.0",
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("updateProject persists automatic agent review changes", () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "walleyboard-project-auto-review-"),
  );
  const databasePath = join(tempDir, "walleyboard.sqlite");

  try {
    const store = new SqliteStore(databasePath);
    const { project } = store.createProject({
      name: "Automatic Review Options",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    assert.equal(store.getProject(project.id)?.automatic_agent_review, false);

    store.updateProject(project.id, {
      automatic_agent_review: true,
    });

    assert.equal(store.getProject(project.id)?.automatic_agent_review, true);

    const reloadedStore = new SqliteStore(databasePath);
    assert.equal(
      reloadedStore.getProject(project.id)?.automatic_agent_review,
      true,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("review run history persists across reloads in chronological order", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-review-runs-"));
  const databasePath = join(tempDir, "walleyboard.sqlite");

  try {
    const store = new SqliteStore(databasePath);
    const { project, repository } = store.createProject({
      name: "Review Runs",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    const ticket = createReadyTicket(store, project.id, repository.id, 1);
    const started = store.startTicket(ticket.id, false, {
      workingBranch: "codex/ticket-1",
      worktreePath: join(tempDir, "worktrees", "ticket-1"),
      logs: ["Started review history session"],
    });

    const firstPackage = store.createReviewPackage({
      ticket_id: ticket.id,
      session_id: started.session.id,
      diff_ref: "ticket-1.patch",
      commit_refs: ["abc123"],
      change_summary: "Initial implementation",
      validation_results: [],
      remaining_risks: [],
    });
    const firstRun = store.createReviewRun({
      ticket_id: ticket.id,
      review_package_id: firstPackage.id,
      implementation_session_id: started.session.id,
      trigger_source: "automatic",
    });
    store.updateReviewRun(firstRun.id, {
      status: "completed",
      report: {
        summary: "The first review finished with one finding.",
        strengths: [],
        actionable_findings: [],
      },
    });

    const secondPackage = store.createReviewPackage({
      ticket_id: ticket.id,
      session_id: started.session.id,
      diff_ref: "ticket-2.patch",
      commit_refs: ["def456"],
      change_summary: "Follow-up implementation",
      validation_results: [],
      remaining_risks: [],
    });
    const secondRun = store.createReviewRun({
      ticket_id: ticket.id,
      review_package_id: secondPackage.id,
      implementation_session_id: started.session.id,
    });
    store.updateReviewRun(secondRun.id, {
      status: "completed",
      report: {
        summary: "The second review finished cleanly.",
        strengths: [],
        actionable_findings: [],
      },
    });

    const reloadedStore = new SqliteStore(databasePath);
    const reviewRuns = reloadedStore.listReviewRuns(ticket.id);

    assert.equal(reviewRuns.length, 2);
    assert.deepEqual(
      reviewRuns.map((reviewRun) => reviewRun.id),
      [firstRun.id, secondRun.id],
    );
    assert.equal(
      reviewRuns[0]?.report?.summary,
      "The first review finished with one finding.",
    );
    assert.equal(
      reviewRuns[1]?.report?.summary,
      "The second review finished cleanly.",
    );
    assert.equal(reloadedStore.countAutomaticReviewRuns(ticket.id), 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("updateProject persists preview start command changes", () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "walleyboard-project-preview-command-"),
  );
  const databasePath = join(tempDir, "walleyboard.sqlite");

  try {
    const store = new SqliteStore(databasePath);
    const { project } = store.createProject({
      name: "Project Preview Command",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    assert.equal(store.getProject(project.id)?.preview_start_command, null);

    store.updateProject(project.id, {
      preview_start_command: "pnpm dev --host $HOST --port $PORT",
    });

    assert.equal(
      store.getProject(project.id)?.preview_start_command,
      "pnpm dev --host $HOST --port $PORT",
    );

    const reloadedStore = new SqliteStore(databasePath);
    assert.equal(
      reloadedStore.getProject(project.id)?.preview_start_command,
      "pnpm dev --host $HOST --port $PORT",
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("editing a ready ticket preserves its id and target branch when re-promoted", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-ticket-reedit-"));

  try {
    const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
    const { project, repository } = store.createProject({
      name: "Ready Ticket Edit",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
        target_branch: "main",
      },
    });

    const draft = store.createDraft({
      project_id: project.id,
      artifact_scope_id: "artifact-scope-edit",
      title: "Original ready ticket",
      description: "Keep the same ticket identity after editing.",
      proposed_ticket_type: "bugfix",
      proposed_acceptance_criteria: ["Preserve the original branch."],
    });
    const originalTicket = store.confirmDraft(draft.id, {
      title: "Original ready ticket",
      description: "Keep the same ticket identity after editing.",
      repo_id: repository.id,
      ticket_type: "bugfix",
      acceptance_criteria: ["Preserve the original branch."],
      target_branch: "release/1.0",
    });

    const reopenedDraft = store.editReadyTicket(originalTicket.id);
    assert.equal(reopenedDraft.source_ticket_id, originalTicket.id);
    assert.equal(reopenedDraft.target_branch, "release/1.0");

    const reproTicket = store.confirmDraft(reopenedDraft.id, {
      title: "Original ready ticket, revised",
      description: "Edited content should still keep the same ticket number.",
      repo_id: repository.id,
      ticket_type: "bugfix",
      acceptance_criteria: [
        "Preserve the original branch.",
        "Require promotion again after editing.",
      ],
      target_branch: "main",
    });

    assert.equal(reproTicket.id, originalTicket.id);
    assert.equal(reproTicket.target_branch, "release/1.0");
    assert.equal(reproTicket.artifact_scope_id, "artifact-scope-edit");
    assert.equal(reproTicket.title, "Original ready ticket, revised");
    assert.equal(
      reproTicket.description,
      "Edited content should still keep the same ticket number.",
    );
    assert.deepEqual(reproTicket.acceptance_criteria, [
      "Preserve the original branch.",
      "Require promotion again after editing.",
    ]);
    assert.equal(store.getDraft(reopenedDraft.id), undefined);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("projects default to host execution and persist execution backend updates", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-project-backend-"));
  const databasePath = join(tempDir, "walleyboard.sqlite");

  try {
    const store = new SqliteStore(databasePath);
    const { project } = store.createProject({
      name: "Project Backend",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    assert.equal(store.getProject(project.id)?.execution_backend, "host");
    assert.equal(store.getProject(project.id)?.agent_adapter, "codex");

    store.updateProject(project.id, {
      execution_backend: "docker",
    });

    assert.equal(store.getProject(project.id)?.execution_backend, "docker");

    const reloadedStore = new SqliteStore(databasePath);
    assert.equal(
      reloadedStore.getProject(project.id)?.execution_backend,
      "docker",
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("projects default to direct merge and persist review action updates", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-project-review-"));
  const databasePath = join(tempDir, "walleyboard.sqlite");

  try {
    const store = new SqliteStore(databasePath);
    const { project } = store.createProject({
      name: "Project Review Action",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    assert.equal(
      store.getProject(project.id)?.default_review_action,
      "direct_merge",
    );

    store.updateProject(project.id, {
      default_review_action: "pull_request",
    });

    assert.equal(
      store.getProject(project.id)?.default_review_action,
      "pull_request",
    );

    const reloadedStore = new SqliteStore(databasePath);
    assert.equal(
      reloadedStore.getProject(project.id)?.default_review_action,
      "pull_request",
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("started sessions snapshot the project's agent adapter", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-session-adapter-"));

  try {
    const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
    const { project, repository } = store.createProject({
      name: "Session Adapter Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });
    const ticket = createReadyTicket(store, project.id, repository.id, 1);

    const started = store.startTicket(ticket.id, false, {
      workingBranch: "codex/ticket-1",
      worktreePath: join(tempDir, "worktrees", "ticket-1"),
      logs: ["Started adapter snapshot session"],
    });

    assert.equal(started.session.agent_adapter, project.agent_adapter);
    assert.equal(started.session.adapter_session_ref, null);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("sqlite migration renames codex_session_id to adapter_session_ref", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-session-migrate-"));
  const databasePath = join(tempDir, "walleyboard.sqlite");

  try {
    const db = new DatabaseSync(databasePath);
    db.exec(`
      CREATE TABLE execution_sessions (
        id TEXT PRIMARY KEY,
        ticket_id INTEGER NOT NULL,
        project_id TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        worktree_path TEXT,
        codex_session_id TEXT,
        status TEXT NOT NULL,
        planning_enabled INTEGER NOT NULL,
        plan_status TEXT NOT NULL DEFAULT 'not_requested',
        plan_summary TEXT,
        current_attempt_id TEXT,
        latest_requested_change_note_id TEXT,
        latest_review_package_id TEXT,
        queue_entered_at TEXT,
        started_at TEXT,
        completed_at TEXT,
        last_heartbeat_at TEXT,
        last_summary TEXT
      );
    `);
    db.prepare(
      `
        INSERT INTO execution_sessions (
          id, ticket_id, project_id, repo_id, worktree_path, codex_session_id,
          status, planning_enabled, plan_status, plan_summary, current_attempt_id,
          latest_requested_change_note_id, latest_review_package_id, queue_entered_at,
          started_at, completed_at, last_heartbeat_at, last_summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      "session-1",
      1,
      "project-1",
      "repo-1",
      "/tmp/worktree",
      "old-codex-thread",
      "awaiting_input",
      0,
      "not_requested",
      null,
      "attempt-1",
      null,
      null,
      null,
      "2026-04-01T00:00:00.000Z",
      null,
      "2026-04-01T00:00:00.000Z",
      null,
    );
    db.close();

    const store = new SqliteStore(databasePath);
    const session = store.getSession("session-1");
    assert.ok(session);
    assert.equal(session.agent_adapter, "codex");
    assert.equal(session.adapter_session_ref, "old-codex-thread");

    const validationDb = new DatabaseSync(databasePath);
    const columns = validationDb
      .prepare("PRAGMA table_info(execution_sessions)")
      .all() as Array<{ name: string }>;
    validationDb.close();

    assert.equal(
      columns.some((column) => column.name === "adapter_session_ref"),
      true,
    );
    assert.equal(
      columns.some((column) => column.name === "codex_session_id"),
      false,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("starting beyond the running cap keeps the ticket in progress and queues the session", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-queue-start-"));

  try {
    const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
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
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-queue-order-"));

  try {
    const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
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
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-planning-"));

  try {
    const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
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

test("restartInterruptedTicket keeps ids but resets fresh-launch session state", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-fresh-restart-"));
  const databasePath = join(tempDir, "walleyboard.sqlite");

  try {
    const store = new SqliteStore(databasePath);
    const { project, repository } = store.createProject({
      name: "Fresh Restart Project",
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

    store.updateSessionPlan(started.session.id, {
      plan_status: "approved",
      plan_summary: "Approved plan",
    });
    store.updateSessionAdapterSessionRef(
      started.session.id,
      "019d4cd5-78db-7c22-b9d7-bb251d30a1f1",
    );
    store.updateSessionStatus(
      started.session.id,
      "interrupted",
      "Paused after the original worktree drifted too far.",
    );
    store.updateExecutionAttempt(started.attempt.id, {
      status: "interrupted",
      end_reason: "user_restart",
    });

    const restarted = store.restartInterruptedTicket(
      ticket.id,
      {
        workingBranch: "codex/ticket-1",
        worktreePath: join(tempDir, "worktrees", "ticket-1-fresh"),
        logs: ["Prepared a fresh worktree"],
      },
      "Start over from a clean branch",
    );

    assert.equal(restarted.ticket.id, ticket.id);
    assert.equal(restarted.session.id, started.session.id);
    assert.equal(restarted.attempt.attempt_number, 2);
    assert.equal(restarted.session.status, "awaiting_input");
    assert.equal(restarted.session.adapter_session_ref, null);
    assert.equal(restarted.session.plan_status, "drafting");
    assert.equal(restarted.session.plan_summary, null);
    assert.equal(
      restarted.session.worktree_path,
      join(tempDir, "worktrees", "ticket-1-fresh"),
    );
    assert.notEqual(restarted.session.current_attempt_id, started.attempt.id);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("adapter session refs persist across resume and reload", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-codex-session-"));
  const databasePath = join(tempDir, "walleyboard.sqlite");

  try {
    const store = new SqliteStore(databasePath);
    const { project, repository } = store.createProject({
      name: "Adapter Session Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    const ticket = createReadyTicket(store, project.id, repository.id, 1);
    const started = store.startTicket(ticket.id, false, {
      workingBranch: "codex/ticket-1",
      worktreePath: join(tempDir, "worktrees", "ticket-1"),
      logs: ["Started adapter session ticket"],
    });

    assert.equal(started.session.adapter_session_ref, null);

    const adapterSessionRef = "019d4cd5-78db-7c22-b9d7-bb251d30a1f1";
    const linkedSession = store.updateSessionAdapterSessionRef(
      started.session.id,
      adapterSessionRef,
    );
    assert.equal(linkedSession?.adapter_session_ref, adapterSessionRef);

    store.updateSessionStatus(
      started.session.id,
      "interrupted",
      "Paused so the agent can resume on the same session reference.",
    );

    const resumed = store.resumeTicket(ticket.id, "continue from the same run");
    assert.equal(resumed.session.adapter_session_ref, adapterSessionRef);

    const reopenedStore = new SqliteStore(databasePath);
    assert.equal(
      reopenedStore.getSession(started.session.id)?.adapter_session_ref,
      adapterSessionRef,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("restartInterruptedTicket preserves prior history and appends fresh restart logs", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-restart-logs-"));

  try {
    const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
    const { project, repository } = store.createProject({
      name: "Restart Log Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    const ticket = createReadyTicket(store, project.id, repository.id, 1);
    const started = store.startTicket(ticket.id, false, {
      workingBranch: "codex/ticket-1",
      worktreePath: join(tempDir, "worktrees", "ticket-1"),
      logs: ["Started implementation session"],
    });

    store.updateSessionStatus(
      started.session.id,
      "interrupted",
      "The local branch should be discarded and recreated.",
    );
    store.updateExecutionAttempt(started.attempt.id, {
      status: "interrupted",
      end_reason: "user_restart",
    });

    const logsBeforeRestart = store.getSessionLogs(started.session.id);
    const restarted = store.restartInterruptedTicket(ticket.id, {
      workingBranch: "codex/ticket-1",
      worktreePath: join(tempDir, "worktrees", "ticket-1-fresh"),
      logs: ["Prepared fresh workspace from target branch"],
    });

    const logsAfterRestart = store.getSessionLogs(started.session.id);
    assert.equal(store.listSessionAttempts(started.session.id).length, 2);
    assert.deepEqual(
      logsAfterRestart.slice(0, logsBeforeRestart.length),
      logsBeforeRestart,
    );
    assert.deepEqual(
      logsAfterRestart.slice(-restarted.logs.length),
      restarted.logs,
    );
    assert.ok(
      restarted.logs.includes(
        "Fresh restart requested without additional guidance.",
      ),
    );
    assert.ok(
      restarted.logs.includes(
        "Preserving ticket history while resetting the local worktree and adapter session state.",
      ),
    );
    assert.ok(
      restarted.logs.includes("Working branch recreated: codex/ticket-1"),
    );
    assert.ok(
      restarted.logs.includes(
        `Worktree recreated at: ${join(tempDir, "worktrees", "ticket-1-fresh")}`,
      ),
    );
    assert.ok(restarted.logs.includes("Starting fresh execution attempt 2."));
    assert.equal(restarted.attempt.attempt_number, 2);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("archived tickets stay in storage but leave active project lists", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-archive-"));
  const databasePath = join(tempDir, "walleyboard.sqlite");

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
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-restore-"));
  const databasePath = join(tempDir, "walleyboard.sqlite");

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
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-markdown-"));

  try {
    const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
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
      "",
      "![Pasted screenshot](/projects/project-1/draft-artifacts/artifact-scope-markdown/example.png)",
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

    const reopenedStore = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
    assert.equal(
      reopenedStore.getTicket(ticket.id)?.description,
      draftDescription,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("drafts and tickets keep markdown in SQLite instead of creating ticket files", {
  concurrency: false,
}, () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-ticket-store-"));
  const originalWalleyBoardHome = process.env.WALLEYBOARD_HOME;
  process.env.WALLEYBOARD_HOME = tempDir;

  try {
    const store = new SqliteStore();
    const { project, repository } = store.createProject({
      name: "SQLite Ticket Storage Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    const draftDescription = [
      "# Stored In SQLite",
      "",
      "- Keep markdown exactly as written.",
      "- Do not emit ticket markdown files on disk.",
    ].join("\n");
    const draft = store.createDraft({
      project_id: project.id,
      title: "Keep markdown in SQLite",
      description: draftDescription,
      proposed_acceptance_criteria: [
        "Persist the markdown body without writing a ticket file.",
      ],
    });
    const ticket = store.confirmDraft(draft.id, {
      title: draft.title_draft,
      description: draft.description_draft,
      repo_id: repository.id,
      ticket_type: "feature",
      acceptance_criteria: draft.proposed_acceptance_criteria,
      target_branch: "main",
    });

    const reopenedStore = new SqliteStore();
    assert.equal(
      reopenedStore.getTicket(ticket.id)?.description,
      draftDescription,
    );

    const persistedPaths = listRelativePaths(tempDir);
    assert.ok(persistedPaths.includes("walleyboard.sqlite"));
    assert.deepEqual(
      persistedPaths.filter((path) => path.endsWith(".md")),
      [],
    );
    assert.equal(
      persistedPaths.some(
        (path) =>
          path === "projects" ||
          path.startsWith("projects/") ||
          path === "tickets" ||
          path.endsWith("/tickets") ||
          path.includes("/tickets/"),
      ),
      false,
    );
  } finally {
    if (originalWalleyBoardHome === undefined) {
      process.env.WALLEYBOARD_HOME = undefined;
    } else {
      process.env.WALLEYBOARD_HOME = originalWalleyBoardHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("recordMergeConflict moves the ticket back to in progress with a system note", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-merge-note-"));

  try {
    const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
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
