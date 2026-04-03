import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutionSession } from "../../../../packages/contracts/src/index.js";

import { shouldPublishPreExecutionSessionUpdate } from "./execution-runtime/publishers.js";

function createSession(
  overrides: Partial<ExecutionSession> = {},
): ExecutionSession {
  return {
    id: "session-1",
    ticket_id: 1,
    project_id: "project-1",
    repo_id: "repo-1",
    agent_adapter: "codex",
    worktree_path: "/tmp/worktree-1",
    adapter_session_ref: null,
    status: "awaiting_input",
    planning_enabled: false,
    plan_status: "not_requested",
    plan_summary: null,
    current_attempt_id: "attempt-1",
    latest_requested_change_note_id: null,
    latest_review_package_id: null,
    queue_entered_at: null,
    started_at: "2026-04-03T00:00:00.000Z",
    completed_at: null,
    last_heartbeat_at: "2026-04-03T00:00:00.000Z",
    last_summary: null,
    ...overrides,
  };
}

test("publishes pre-execution session updates only for queued sessions", () => {
  assert.equal(
    shouldPublishPreExecutionSessionUpdate(createSession({ status: "queued" })),
    true,
  );
  assert.equal(
    shouldPublishPreExecutionSessionUpdate(
      createSession({ status: "awaiting_input" }),
    ),
    false,
  );
  assert.equal(
    shouldPublishPreExecutionSessionUpdate(
      createSession({ status: "paused_checkpoint" }),
    ),
    false,
  );
});
