import assert from "node:assert/strict";
import test from "node:test";

import type {
  ExecutionAttempt,
  ExecutionSession,
  ReviewRun,
  StructuredEvent,
} from "../../../../packages/contracts/src/index.js";
import { buildSessionTimeline } from "./session-activity-model.js";

function createSession(): ExecutionSession {
  return {
    id: "session-7",
    ticket_id: 7,
    project_id: "project-1",
    repo_id: "repo-1",
    agent_adapter: "codex",
    worktree_path: "/tmp/worktree-7",
    adapter_session_ref: "sess_7",
    status: "interrupted",
    planning_enabled: true,
    plan_status: "approved",
    plan_summary: "Plan summary for attempt 1.",
    current_attempt_id: "attempt-3",
    latest_requested_change_note_id: null,
    latest_review_package_id: "review-package-2",
    queue_entered_at: null,
    started_at: "2026-04-04T08:00:00.000Z",
    completed_at: null,
    last_heartbeat_at: "2026-04-04T10:15:00.000Z",
    last_summary: "The backend restarted while the session was active.",
  };
}

test("buildSessionTimeline merges attempts, prompts, review runs, and ticket events newest to oldest", () => {
  const session = createSession();
  const attempts: ExecutionAttempt[] = [
    {
      id: "attempt-1",
      session_id: session.id,
      attempt_number: 1,
      status: "completed",
      prompt_kind: "plan",
      prompt: "Draft a plan for ticket 7.",
      pty_pid: null,
      started_at: "2026-04-04T08:00:00.000Z",
      ended_at: "2026-04-04T08:05:00.000Z",
      end_reason: "plan_completed",
    },
    {
      id: "attempt-2",
      session_id: session.id,
      attempt_number: 2,
      status: "completed",
      prompt_kind: "implementation",
      prompt: "Implement ticket 7.",
      pty_pid: null,
      started_at: "2026-04-04T08:15:00.000Z",
      ended_at: "2026-04-04T08:45:00.000Z",
      end_reason: "completed",
    },
    {
      id: "attempt-3",
      session_id: session.id,
      attempt_number: 3,
      status: "interrupted",
      prompt_kind: "implementation",
      prompt: "Address review feedback for ticket 7.",
      pty_pid: null,
      started_at: "2026-04-04T09:10:00.000Z",
      ended_at: "2026-04-04T10:15:00.000Z",
      end_reason: "backend_restart",
    },
  ];
  const reviewRuns: ReviewRun[] = [
    {
      id: "review-run-1",
      ticket_id: 7,
      review_package_id: "review-package-1",
      implementation_session_id: session.id,
      status: "completed",
      adapter_session_ref: null,
      prompt: "Review the ticket implementation.",
      report: {
        summary: "The AI review found one actionable issue.",
        strengths: [],
        actionable_findings: [],
      },
      failure_message: null,
      created_at: "2026-04-04T08:50:00.000Z",
      updated_at: "2026-04-04T08:55:00.000Z",
      completed_at: "2026-04-04T08:55:00.000Z",
    },
  ];
  const events: StructuredEvent[] = [
    {
      id: "event-created",
      occurred_at: "2026-04-04T07:55:00.000Z",
      entity_type: "ticket",
      entity_id: "7",
      event_type: "ticket.created",
      payload: {
        title: "Add a timeline to the activity dialog",
      },
    },
    {
      id: "event-pr-created",
      occurred_at: "2026-04-04T09:00:00.000Z",
      entity_type: "ticket",
      entity_id: "7",
      event_type: "pull_request.created",
      payload: {
        number: 17,
        url: "https://github.com/example/repo/pull/17",
      },
    },
    {
      id: "event-interrupted",
      occurred_at: "2026-04-04T10:15:00.000Z",
      entity_type: "ticket",
      entity_id: "7",
      event_type: "ticket.interrupted",
      payload: {
        reason: "backend_restart",
      },
    },
  ];

  const timeline = buildSessionTimeline({
    attempts,
    events,
    logs: [
      "Plan approved by user: Ship it.",
      "Starting execution attempt 2.",
      "Requested changes recorded:\nPlease handle the failing review case.",
      "Starting execution attempt 3.",
      "Session was marked interrupted after backend startup recovery.",
    ],
    reviewRuns,
    session,
  });

  assert.deepEqual(
    timeline.map((entry) => entry.title),
    [
      "Session interrupted",
      "Attempt 3 interrupted",
      "Backend restart recovery",
      "Implementation prompt prepared for attempt 3",
      "Requested changes recorded",
      "Pull request created",
      "AI review completed",
      "AI review prompt prepared",
      "Attempt 2 completed",
      "Implementation prompt prepared for attempt 2",
      "Plan approved",
      "Attempt 1 completed",
      "Plan prompt prepared for attempt 1",
      "Ticket created",
    ],
  );

  assert.equal(
    timeline.find(
      (entry) => entry.title === "Implementation prompt prepared for attempt 3",
    )?.copyMarkdown,
    "Address review feedback for ticket 7.",
  );
  assert.equal(
    timeline.find(
      (entry) => entry.title === "Plan prompt prepared for attempt 1",
    )?.copyMarkdown,
    undefined,
  );
  assert.equal(
    timeline.find((entry) => entry.title === "AI review prompt prepared")
      ?.copyMarkdown,
    "Review the ticket implementation.",
  );
});

test("buildSessionTimeline preserves expanded restart and input prompts from logs", () => {
  const session = createSession();

  const timeline = buildSessionTimeline({
    attempts: [
      {
        id: "attempt-4",
        session_id: session.id,
        attempt_number: 4,
        status: "queued",
        prompt_kind: "implementation",
        prompt: "Continue implementation.",
        pty_pid: null,
        started_at: "2026-04-04T10:20:00.000Z",
        ended_at: null,
        end_reason: null,
      },
    ],
    events: [],
    logs: [
      "Fresh restart guidance recorded:\nReset the branch and retry from scratch.",
      "User input recorded:\nPlease also update the tests.",
      "[agent input] Run the timeline checks again.",
      "Starting fresh execution attempt 4.",
    ],
    reviewRuns: [],
    session,
  });

  assert.equal(
    timeline.find((entry) => entry.title === "Fresh restart guidance")?.detail,
    "Reset the branch and retry from scratch.",
  );
  assert.equal(
    timeline.find((entry) => entry.title === "User input recorded")?.detail,
    "Please also update the tests.",
  );
  assert.equal(
    timeline.find((entry) => entry.title === "Live input sent")?.detail,
    "Run the timeline checks again.",
  );
});
