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

test("AgentReviewService reruns review until no actionable findings remain", async () => {
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

    const reviewRun = service.startReviewLoop(ticket.id);

    await waitFor(() => !service.hasActiveReviewLoop(ticket.id));

    assert.equal(reviewRun.status, "running");
    assert.equal(reviewInvocationCount, 2);
    assert.equal(resumedReviewPackageCount, 1);

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
