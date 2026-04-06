import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ReviewReport } from "../../../../packages/contracts/src/index.js";

import { AgentReviewService } from "./agent-review-service.js";
import { EventHub } from "./event-hub.js";
import { SqliteStore } from "./sqlite-store.js";

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }
}

function createActionableReport(summary: string): ReviewReport {
  return {
    summary,
    strengths: [],
    actionable_findings: [
      {
        severity: "high",
        category: "separation_of_concerns",
        title: "Business logic is mixed into the route",
        details:
          "The implementation keeps orchestration logic in the HTTP layer.",
        suggested_fix:
          "Move the orchestration into a dedicated service and keep the route thin.",
      },
    ],
  };
}

test("AgentReviewService reruns automatic review until no actionable findings remain", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-agent-review-"));

  try {
    const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
    const { project, repository } = store.createProject({
      name: "Agent Review Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });
    store.updateProject(project.id, {
      automatic_agent_review_run_limit: 2,
    });

    const draft = store.createDraft({
      project_id: project.id,
      title: "Loop agent review",
      description: "Re-run review until the report is clean.",
    });
    const ticket = store.confirmDraft(draft.id, {
      title: draft.title_draft,
      description: draft.description_draft,
      repo_id: repository.id,
      ticket_type: "feature",
      acceptance_criteria: ["Repeat the review loop until no findings remain."],
      target_branch: "main",
    });

    const started = store.startTicket(ticket.id, false, {
      workingBranch: "codex/ticket-review-loop",
      worktreePath: join(tempDir, "worktrees", "ticket-review-loop"),
      logs: ["Started ticket session"],
    });
    const initialReviewPackage = store.createReviewPackage({
      ticket_id: ticket.id,
      session_id: started.session.id,
      diff_ref: "ticket.patch",
      commit_refs: ["abc123"],
      change_summary: "Implements the requested ticket.",
      validation_results: [],
      remaining_risks: [],
    });
    store.updateTicketStatus(ticket.id, "review");
    store.completeSession(started.session.id, {
      status: "completed",
      last_summary: "Initial implementation finished.",
      latest_review_package_id: initialReviewPackage.id,
    });

    let reviewInvocationCount = 0;
    let resumedReviewPackageCount = 0;
    const executionRuntime = {
      assertProjectExecutionBackendAvailable(
        _project: unknown,
        _agentAdapter: unknown,
      ) {},
      hasActiveExecution() {
        return false;
      },
      async runTicketReview() {
        reviewInvocationCount += 1;
        return reviewInvocationCount === 1
          ? {
              adapterSessionRef: "review-session-1",
              report: createActionableReport(
                "The first review found a service-boundary problem.",
              ),
            }
          : {
              adapterSessionRef: "review-session-2",
              report: {
                summary:
                  "The follow-up implementation addressed the review findings.",
                strengths: [
                  "The orchestration is isolated in a dedicated service.",
                ],
                actionable_findings: [],
              },
            };
      },
      startExecution(input: {
        session: { id: string };
        ticket: { id: number };
      }) {
        resumedReviewPackageCount += 1;
        queueMicrotask(() => {
          const nextReviewPackage = store.createReviewPackage({
            ticket_id: input.ticket.id,
            session_id: input.session.id,
            diff_ref: `ticket-${resumedReviewPackageCount}.patch`,
            commit_refs: [`fix-${resumedReviewPackageCount}`],
            change_summary: "Addresses the agent review report.",
            validation_results: [],
            remaining_risks: [],
          });
          store.updateTicketStatus(input.ticket.id, "review");
          store.completeSession(input.session.id, {
            status: "completed",
            last_summary: "Review feedback implemented.",
            latest_review_package_id: nextReviewPackage.id,
          });
        });
      },
    };

    const service = new AgentReviewService({
      eventHub: new EventHub(),
      executionRuntime: executionRuntime as never,
      store,
    });

    const reviewRun = service.startReviewLoop(ticket.id, {
      trigger: "automatic",
    });

    await waitFor(() => !service.hasActiveReviewLoop(ticket.id));

    assert.equal(reviewRun.status, "running");
    assert.equal(reviewInvocationCount, 2);
    assert.equal(resumedReviewPackageCount, 1);
    assert.equal(store.countAutomaticReviewRuns(ticket.id), 2);

    const latestReviewRun = store.getLatestReviewRun(ticket.id);
    assert.ok(latestReviewRun);
    assert.equal(latestReviewRun.status, "completed");
    assert.equal(latestReviewRun.adapter_session_ref, "review-session-2");
    assert.equal(latestReviewRun.report?.actionable_findings.length, 0);

    const latestSession = store.getSession(started.session.id);
    assert.ok(latestSession?.latest_requested_change_note_id);
    const requestedChangeNote = store.getRequestedChangeNote(
      latestSession.latest_requested_change_note_id,
    );
    assert.ok(requestedChangeNote);
    assert.match(requestedChangeNote.body, /Review report JSON:/);
    assert.match(requestedChangeNote.body, /separation_of_concerns/);
    assert.match(
      store.getSessionLogs(started.session.id).join("\n"),
      /Agent review returned no actionable findings\./,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("AgentReviewService runs manual review only once even when it finds issues", async () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "walleyboard-agent-review-manual-once-"),
  );

  try {
    const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
    const { project, repository } = store.createProject({
      name: "Manual Review Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    const draft = store.createDraft({
      project_id: project.id,
      title: "Run manual review once",
      description: "Avoid rerunning review when started manually.",
    });
    const ticket = store.confirmDraft(draft.id, {
      title: draft.title_draft,
      description: draft.description_draft,
      repo_id: repository.id,
      ticket_type: "feature",
      acceptance_criteria: ["Manual review should not loop."],
      target_branch: "main",
    });

    const started = store.startTicket(ticket.id, false, {
      workingBranch: "codex/ticket-manual-review-once",
      worktreePath: join(tempDir, "worktrees", "ticket-manual-review-once"),
      logs: ["Started ticket session"],
    });
    const initialReviewPackage = store.createReviewPackage({
      ticket_id: ticket.id,
      session_id: started.session.id,
      diff_ref: "ticket.patch",
      commit_refs: ["abc123"],
      change_summary: "Implements the requested ticket.",
      validation_results: [],
      remaining_risks: [],
    });
    store.updateTicketStatus(ticket.id, "review");
    store.completeSession(started.session.id, {
      status: "completed",
      last_summary: "Initial implementation finished.",
      latest_review_package_id: initialReviewPackage.id,
    });

    let reviewInvocationCount = 0;
    let resumedReviewPackageCount = 0;
    const executionRuntime = {
      assertProjectExecutionBackendAvailable(
        _project: unknown,
        _agentAdapter: unknown,
      ) {},
      hasActiveExecution() {
        return false;
      },
      async runTicketReview() {
        reviewInvocationCount += 1;
        return {
          adapterSessionRef: "review-session-1",
          report: createActionableReport(
            "The manual review found a service-boundary problem.",
          ),
        };
      },
      startExecution(input: {
        session: { id: string };
        ticket: { id: number };
      }) {
        resumedReviewPackageCount += 1;
        queueMicrotask(() => {
          const nextReviewPackage = store.createReviewPackage({
            ticket_id: input.ticket.id,
            session_id: input.session.id,
            diff_ref: `ticket-${resumedReviewPackageCount}.patch`,
            commit_refs: [`fix-${resumedReviewPackageCount}`],
            change_summary: "Addresses the manual agent review report.",
            validation_results: [],
            remaining_risks: [],
          });
          store.updateTicketStatus(input.ticket.id, "review");
          store.completeSession(input.session.id, {
            status: "completed",
            last_summary: "Manual review feedback implemented.",
            latest_review_package_id: nextReviewPackage.id,
          });
        });
      },
    };

    const service = new AgentReviewService({
      eventHub: new EventHub(),
      executionRuntime: executionRuntime as never,
      store,
    });

    service.startReviewLoop(ticket.id);

    await waitFor(() => !service.hasActiveReviewLoop(ticket.id));
    await waitFor(() => store.getTicket(ticket.id)?.status === "review");
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });

    assert.equal(reviewInvocationCount, 1);
    assert.equal(resumedReviewPackageCount, 1);
    assert.equal(store.countAutomaticReviewRuns(ticket.id), 0);

    const reviewRuns = store.listReviewRuns(ticket.id);
    assert.equal(reviewRuns.length, 1);
    assert.equal(reviewRuns[0]?.status, "completed");
    assert.equal(reviewRuns[0]?.report?.actionable_findings.length, 1);

    const latestSession = store.getSession(started.session.id);
    assert.ok(latestSession?.latest_requested_change_note_id);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("AgentReviewService stops automatic reruns at the configured limit without failing the completed run", async () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "walleyboard-agent-review-limit-"),
  );

  try {
    const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
    const { project, repository } = store.createProject({
      name: "Automatic Review Limit Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });
    store.updateProject(project.id, {
      automatic_agent_review_run_limit: 1,
    });

    const draft = store.createDraft({
      project_id: project.id,
      title: "Cap automatic review runs",
      description: "Stop automatic review reruns after the configured limit.",
    });
    const ticket = store.confirmDraft(draft.id, {
      title: draft.title_draft,
      description: draft.description_draft,
      repo_id: repository.id,
      ticket_type: "feature",
      acceptance_criteria: ["Require a manual start after one automatic run."],
      target_branch: "main",
    });

    const started = store.startTicket(ticket.id, false, {
      workingBranch: "codex/ticket-review-limit",
      worktreePath: join(tempDir, "worktrees", "ticket-review-limit"),
      logs: ["Started ticket session"],
    });
    const initialReviewPackage = store.createReviewPackage({
      ticket_id: ticket.id,
      session_id: started.session.id,
      diff_ref: "ticket.patch",
      commit_refs: ["abc123"],
      change_summary: "Implements the requested ticket.",
      validation_results: [],
      remaining_risks: [],
    });
    store.updateTicketStatus(ticket.id, "review");
    store.completeSession(started.session.id, {
      status: "completed",
      last_summary: "Initial implementation finished.",
      latest_review_package_id: initialReviewPackage.id,
    });

    let reviewInvocationCount = 0;
    let resumedReviewPackageCount = 0;
    const executionRuntime = {
      assertProjectExecutionBackendAvailable(
        _project: unknown,
        _agentAdapter: unknown,
      ) {},
      hasActiveExecution() {
        return false;
      },
      async runTicketReview() {
        reviewInvocationCount += 1;
        return reviewInvocationCount === 1
          ? {
              adapterSessionRef: "review-session-1",
              report: createActionableReport(
                "The first review found a service-boundary problem.",
              ),
            }
          : {
              adapterSessionRef: "review-session-2",
              report: {
                summary:
                  "The manual continuation addressed the review findings.",
                strengths: [],
                actionable_findings: [],
              },
            };
      },
      startExecution(input: {
        session: { id: string };
        ticket: { id: number };
      }) {
        resumedReviewPackageCount += 1;
        queueMicrotask(() => {
          const nextReviewPackage = store.createReviewPackage({
            ticket_id: input.ticket.id,
            session_id: input.session.id,
            diff_ref: `ticket-${resumedReviewPackageCount}.patch`,
            commit_refs: [`fix-${resumedReviewPackageCount}`],
            change_summary: "Addresses the agent review report.",
            validation_results: [],
            remaining_risks: [],
          });
          store.updateTicketStatus(input.ticket.id, "review");
          store.completeSession(input.session.id, {
            status: "completed",
            last_summary: "Review feedback implemented.",
            latest_review_package_id: nextReviewPackage.id,
          });
        });
      },
    };

    const service = new AgentReviewService({
      eventHub: new EventHub(),
      executionRuntime: executionRuntime as never,
      store,
    });

    service.startReviewLoop(ticket.id, {
      trigger: "automatic",
    });

    await waitFor(() => !service.hasActiveReviewLoop(ticket.id));

    assert.equal(reviewInvocationCount, 1);
    assert.equal(resumedReviewPackageCount, 1);
    assert.equal(store.countAutomaticReviewRuns(ticket.id), 1);

    const automaticRuns = store.listReviewRuns(ticket.id);
    assert.equal(automaticRuns.length, 1);
    assert.equal(automaticRuns[0]?.status, "completed");
    assert.equal(automaticRuns[0]?.failure_message, null);
    assert.match(
      store.getSessionLogs(started.session.id).join("\n"),
      /Automatic agent review run limit reached \(1\)\. Start agent review manually to continue\./,
    );

    service.startReviewLoop(ticket.id);

    await waitFor(() => !service.hasActiveReviewLoop(ticket.id));

    assert.equal(reviewInvocationCount, 2);
    assert.equal(store.countAutomaticReviewRuns(ticket.id), 1);

    const reviewRuns = store.listReviewRuns(ticket.id);
    assert.equal(reviewRuns.length, 2);
    assert.equal(reviewRuns[0]?.status, "completed");
    assert.equal(reviewRuns[1]?.status, "completed");
    assert.equal(reviewRuns[1]?.report?.actionable_findings.length, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("AgentReviewService stops a running review without restarting implementation", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-agent-review-stop-"));

  try {
    const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
    const { project, repository } = store.createProject({
      name: "Stop Running Review Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    const draft = store.createDraft({
      project_id: project.id,
      title: "Stop a running review",
      description: "Allow an operator to stop the active review loop.",
    });
    const ticket = store.confirmDraft(draft.id, {
      title: draft.title_draft,
      description: draft.description_draft,
      repo_id: repository.id,
      ticket_type: "feature",
      acceptance_criteria: ["Stop the active review loop without restarting."],
      target_branch: "main",
    });

    const started = store.startTicket(ticket.id, false, {
      workingBranch: "codex/ticket-review-stop",
      worktreePath: join(tempDir, "worktrees", "ticket-review-stop"),
      logs: ["Started ticket session"],
    });
    const reviewPackage = store.createReviewPackage({
      ticket_id: ticket.id,
      session_id: started.session.id,
      diff_ref: "ticket.patch",
      commit_refs: ["abc123"],
      change_summary: "Implements the requested ticket.",
      validation_results: [],
      remaining_risks: [],
    });
    store.updateTicketStatus(ticket.id, "review");
    store.completeSession(started.session.id, {
      status: "completed",
      last_summary: "Initial implementation finished.",
      latest_review_package_id: reviewPackage.id,
    });

    let rejectReviewRun: ((reason?: unknown) => void) | null = null;
    let startExecutionCalls = 0;
    const stopReviewRunCalls: string[] = [];
    const executionRuntime = {
      assertProjectExecutionBackendAvailable(
        _project: unknown,
        _agentAdapter: unknown,
      ) {},
      hasActiveExecution() {
        return false;
      },
      async runTicketReview() {
        return await new Promise<never>((_resolve, reject) => {
          rejectReviewRun = reject;
        });
      },
      async stopReviewRun(reviewRunId: string) {
        stopReviewRunCalls.push(reviewRunId);
        rejectReviewRun?.(new Error("Review run stopped by user."));
        return true;
      },
      startExecution() {
        startExecutionCalls += 1;
      },
    };

    const service = new AgentReviewService({
      eventHub: new EventHub(),
      executionRuntime: executionRuntime as never,
      store,
    });

    const reviewRun = service.startReviewLoop(ticket.id);
    const stoppedReviewRun = await service.stopReviewLoop(ticket.id);

    await waitFor(() => !service.hasActiveReviewLoop(ticket.id));

    assert.equal(stoppedReviewRun.id, reviewRun.id);
    assert.equal(stoppedReviewRun.status, "failed");
    assert.equal(
      stoppedReviewRun.failure_message,
      "Agent review stopped by user.",
    );
    assert.deepEqual(stopReviewRunCalls, [reviewRun.id]);
    assert.equal(startExecutionCalls, 0);

    const latestReviewRun = store.getLatestReviewRun(ticket.id);
    assert.ok(latestReviewRun);
    assert.equal(latestReviewRun.status, "failed");
    assert.equal(
      latestReviewRun.failure_message,
      "Agent review stopped by user.",
    );
    assert.equal(
      store
        .getSessionLogs(started.session.id)
        .join("\n")
        .includes("Agent review stopped by user."),
      true,
    );
    assert.equal(
      store.getSession(started.session.id)?.latest_requested_change_note_id,
      null,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("AgentReviewService does not restart implementation when Claude becomes unavailable", async () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "walleyboard-agent-review-unavailable-"),
  );
  const claudeUnavailableError =
    "Claude Code CLI is unavailable: Claude config directory /tmp/.claude is empty.";

  try {
    const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
    const { project, repository } = store.createProject({
      name: "Claude Review Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });
    store.updateProject(project.id, {
      draft_analysis_agent_adapter: "claude-code",
      ticket_work_agent_adapter: "claude-code",
    });

    const draft = store.createDraft({
      project_id: project.id,
      title: "Block unavailable Claude restarts",
      description: "Fail the review loop before relaunching Claude.",
    });
    const ticket = store.confirmDraft(draft.id, {
      title: draft.title_draft,
      description: draft.description_draft,
      repo_id: repository.id,
      ticket_type: "feature",
      acceptance_criteria: ["Do not relaunch when Claude is unavailable."],
      target_branch: "main",
    });

    const started = store.startTicket(ticket.id, false, {
      workingBranch: "claude/ticket-review-loop",
      worktreePath: join(tempDir, "worktrees", "ticket-review-loop"),
      logs: ["Started ticket session"],
    });
    const reviewPackage = store.createReviewPackage({
      ticket_id: ticket.id,
      session_id: started.session.id,
      diff_ref: "ticket.patch",
      commit_refs: ["abc123"],
      change_summary: "Implements the requested ticket.",
      validation_results: [],
      remaining_risks: [],
    });
    store.updateTicketStatus(ticket.id, "review");
    store.completeSession(started.session.id, {
      status: "completed",
      last_summary: "Initial implementation finished.",
      latest_review_package_id: reviewPackage.id,
    });

    let availabilityChecks = 0;
    let startExecutionCalls = 0;
    const executionRuntime = {
      assertProjectExecutionBackendAvailable(
        _project: unknown,
        _agentAdapter: unknown,
      ) {
        availabilityChecks += 1;
        if (availabilityChecks > 1) {
          throw new Error(claudeUnavailableError);
        }
      },
      hasActiveExecution() {
        return false;
      },
      async runTicketReview() {
        return {
          adapterSessionRef: "review-session-1",
          report: createActionableReport(
            "The first review found a service-boundary problem.",
          ),
        };
      },
      startExecution() {
        startExecutionCalls += 1;
      },
    };

    const service = new AgentReviewService({
      eventHub: new EventHub(),
      executionRuntime: executionRuntime as never,
      store,
    });

    service.startReviewLoop(ticket.id);

    await waitFor(() => !service.hasActiveReviewLoop(ticket.id));

    const latestReviewRun = store.getLatestReviewRun(ticket.id);
    assert.ok(latestReviewRun);
    assert.equal(latestReviewRun.status, "failed");
    assert.equal(latestReviewRun.failure_message, claudeUnavailableError);
    assert.equal(startExecutionCalls, 0);
    assert.equal(store.getTicket(ticket.id)?.status, "review");
    assert.equal(
      store.getSession(started.session.id)?.latest_requested_change_note_id,
      null,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("AgentReviewService stops a stale persisted running review without an active loop", async () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "walleyboard-agent-review-stop-stale-"),
  );

  try {
    const store = new SqliteStore(join(tempDir, "walleyboard.sqlite"));
    const { project, repository } = store.createProject({
      name: "Stale Review Project",
      repository: {
        name: "repo",
        path: join(tempDir, "repo"),
      },
    });

    const draft = store.createDraft({
      project_id: project.id,
      title: "Stop stale review",
      description: "Allow clearing a stuck persisted review run.",
    });
    const ticket = store.confirmDraft(draft.id, {
      title: draft.title_draft,
      description: draft.description_draft,
      repo_id: repository.id,
      ticket_type: "feature",
      acceptance_criteria: ["A stale running review can be cleared."],
      target_branch: "main",
    });

    const started = store.startTicket(ticket.id, false, {
      workingBranch: "codex/ticket-review-stale",
      worktreePath: join(tempDir, "worktrees", "ticket-review-stale"),
      logs: ["Started ticket session"],
    });
    const reviewPackage = store.createReviewPackage({
      ticket_id: ticket.id,
      session_id: started.session.id,
      diff_ref: "ticket.patch",
      commit_refs: ["abc123"],
      change_summary: "Implements the requested ticket.",
      validation_results: [],
      remaining_risks: [],
    });
    store.updateTicketStatus(ticket.id, "review");
    store.completeSession(started.session.id, {
      status: "completed",
      last_summary: "Initial implementation finished.",
      latest_review_package_id: reviewPackage.id,
    });

    const reviewRun = store.createReviewRun({
      ticket_id: ticket.id,
      review_package_id: reviewPackage.id,
      implementation_session_id: started.session.id,
      trigger_source: "manual",
    });

    const stopReviewRunCalls: string[] = [];
    const executionRuntime = {
      assertProjectExecutionBackendAvailable(
        _project: unknown,
        _agentAdapter: unknown,
      ) {},
      hasActiveExecution() {
        return false;
      },
      async runTicketReview() {
        throw new Error("runTicketReview should not be called");
      },
      async stopReviewRun(reviewRunId: string) {
        stopReviewRunCalls.push(reviewRunId);
        return true;
      },
      startExecution() {
        throw new Error("startExecution should not be called");
      },
    };

    const service = new AgentReviewService({
      eventHub: new EventHub(),
      executionRuntime: executionRuntime as never,
      store,
    });

    const stoppedReviewRun = await service.stopReviewLoop(ticket.id);

    assert.equal(stoppedReviewRun.id, reviewRun.id);
    assert.equal(stoppedReviewRun.status, "failed");
    assert.equal(
      stoppedReviewRun.failure_message,
      "Agent review stopped by user.",
    );
    assert.deepEqual(stopReviewRunCalls, []);

    const latestReviewRun = store.getLatestReviewRun(ticket.id);
    assert.ok(latestReviewRun);
    assert.equal(latestReviewRun.status, "failed");
    assert.equal(
      latestReviewRun.failure_message,
      "Agent review stopped by user.",
    );
    assert.equal(
      store
        .getSessionLogs(started.session.id)
        .join("\n")
        .includes("Agent review stopped by user."),
      true,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
