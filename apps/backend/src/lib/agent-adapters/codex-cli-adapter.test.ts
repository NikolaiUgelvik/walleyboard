import assert from "node:assert/strict";
import test from "node:test";

import type {
  ExecutionSession,
  Project,
  RepositoryConfig,
  ReviewPackage,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import { CodexCliAdapter } from "./codex-cli-adapter.js";

function createProject(): Project {
  return {
    id: "project-1",
    slug: "spacegame",
    name: "spacegame",
    agent_adapter: "codex",
    execution_backend: "docker",
    automatic_agent_review: false,
    automatic_agent_review_run_limit: 1,
    default_review_action: "direct_merge",
    default_target_branch: "origin/main",
    preview_start_command: null,
    pre_worktree_command: null,
    post_worktree_command: null,
    draft_analysis_model: null,
    draft_analysis_reasoning_effort: null,
    ticket_work_model: "gpt-5.4",
    ticket_work_reasoning_effort: "high",
    max_concurrent_sessions: 1,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
  };
}

function createRepository(): RepositoryConfig {
  return {
    id: "repo-1",
    project_id: "project-1",
    name: "spacegame",
    path: "/tmp/spacegame",
    target_branch: "origin/main",
    setup_hook: null,
    cleanup_hook: null,
    validation_profile: [],
    extra_env_allowlist: [],
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
  };
}

function createTicket(): TicketFrontmatter {
  return {
    id: 5,
    project: "project-1",
    repo: "repo-1",
    artifact_scope_id: "artifact-scope-1",
    status: "review",
    title: "Escape returns to the main menu during gameplay",
    description:
      "Pressing Escape during a run should return the player to the main menu.",
    ticket_type: "feature",
    acceptance_criteria: [
      "Ship and dungeon scenes return to the main menu.",
      "Escape and the gamepad cancel button share the same path.",
    ],
    working_branch: "codex/ticket-5",
    target_branch: "origin/main",
    linked_pr: null,
    session_id: "session-1",
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
  };
}

function createSession(): ExecutionSession {
  return {
    id: "session-1",
    ticket_id: 5,
    project_id: "project-1",
    repo_id: "repo-1",
    agent_adapter: "codex",
    worktree_path: "/tmp/spacegame-worktree",
    adapter_session_ref: null,
    status: "completed",
    planning_enabled: false,
    plan_status: "not_requested",
    plan_summary: null,
    current_attempt_id: "attempt-1",
    latest_requested_change_note_id: null,
    latest_review_package_id: "review-package-1",
    queue_entered_at: null,
    started_at: "2026-04-01T00:00:00.000Z",
    completed_at: "2026-04-01T00:10:00.000Z",
    last_heartbeat_at: "2026-04-01T00:10:00.000Z",
    last_summary: "Implementation finished.",
  };
}

function createReviewPackage(): ReviewPackage {
  return {
    id: "review-package-1",
    ticket_id: 5,
    session_id: "session-1",
    diff_ref: "/tmp/ticket-5.patch",
    commit_refs: ["61a4523a0f4259c5c06404ce5f0cabed1dc65f1c"],
    change_summary: "Adds cancel-to-main-menu behavior and tests.",
    validation_results: [],
    remaining_risks: [],
    created_at: "2026-04-01T00:10:00.000Z",
  };
}

test("CodexCliAdapter.buildExecutionRun maps Docker summary paths into /workspace", () => {
  const adapter = new CodexCliAdapter();
  const session = createSession();

  const run = adapter.buildExecutionRun({
    executionMode: "implementation",
    extraInstructions: [],
    outputPath: "/tmp/spacegame-worktree/.walleyboard/session-1-summary.txt",
    planSummary: null,
    project: createProject(),
    repository: createRepository(),
    session,
    ticket: createTicket(),
    useDockerRuntime: true,
  });

  const outputFlagIndex = run.args.indexOf("--output-last-message");
  assert.notEqual(outputFlagIndex, -1);
  assert.equal(
    run.args[outputFlagIndex + 1],
    "/workspace/.walleyboard/session-1-summary.txt",
  );
  assert.equal(run.outputPath, "/workspace/.walleyboard/session-1-summary.txt");
});

test("CodexCliAdapter.buildExecutionRun rejects Docker output paths outside the worktree", () => {
  const adapter = new CodexCliAdapter();

  assert.throws(() =>
    adapter.buildExecutionRun({
      executionMode: "implementation",
      extraInstructions: [],
      outputPath: "/tmp/outside-summary.txt",
      planSummary: null,
      project: createProject(),
      repository: createRepository(),
      session: createSession(),
      ticket: createTicket(),
      useDockerRuntime: true,
    }),
  );
});

test("CodexCliAdapter.buildMergeConflictRun resumes an existing adapter session when available", () => {
  const adapter = new CodexCliAdapter();
  const session = createSession();
  session.adapter_session_ref = "sess-merge-123";

  const run = adapter.buildMergeConflictRun({
    conflictedFiles: ["src/story.txt"],
    failureMessage: "Unfinished merge detected.",
    outputPath:
      "/tmp/spacegame-worktree/.walleyboard/session-1-merge-conflict.txt",
    project: createProject(),
    recoveryKind: "conflicts",
    repository: createRepository(),
    session,
    stage: "merge",
    targetBranch: "origin/main",
    ticket: createTicket(),
    useDockerRuntime: true,
  });

  assert.equal(run.args[0], "exec");
  assert.equal(run.args[1], "resume");
  assert.ok(run.args.includes("sess-merge-123"));
  const outputFlagIndex = run.args.indexOf("--output-last-message");
  assert.notEqual(outputFlagIndex, -1);
  assert.equal(
    run.args[outputFlagIndex + 1],
    "/workspace/.walleyboard/session-1-merge-conflict.txt",
  );
});

test("CodexCliAdapter.buildReviewRun uses read-only sandbox on host", () => {
  const adapter = new CodexCliAdapter();

  const run = adapter.buildReviewRun({
    outputPath: "/tmp/review.json",
    project: createProject(),
    repository: createRepository(),
    reviewPackage: createReviewPackage(),
    session: createSession(),
    ticket: createTicket(),
    useDockerRuntime: false,
  });

  assert.ok(run.args.includes("--full-auto"));
  assert.ok(run.args.includes('approval_policy="on-request"'));
  assert.ok(run.args.includes('sandbox_mode="read-only"'));
  assert.equal(
    run.args.includes("--dangerously-bypass-approvals-and-sandbox"),
    false,
  );
  assert.equal(run.dockerSpec, null);
});

test("CodexCliAdapter.buildReviewRun bypasses Codex sandbox inside Docker", () => {
  const adapter = new CodexCliAdapter();
  const session = createSession();

  const run = adapter.buildReviewRun({
    outputPath: "/tmp/spacegame-worktree/.walleyboard/review.json",
    project: createProject(),
    repository: createRepository(),
    reviewPackage: createReviewPackage(),
    session,
    ticket: createTicket(),
    useDockerRuntime: true,
  });

  assert.equal(run.args.includes("--full-auto"), false);
  assert.ok(run.args.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.equal(
    run.args.some((value) => value.includes('approval_policy="')),
    false,
  );
  assert.equal(
    run.args.some((value) => value.includes('sandbox_mode="')),
    false,
  );
  const outputFlagIndex = run.args.indexOf("--output-last-message");
  assert.notEqual(outputFlagIndex, -1);
  assert.equal(
    run.args[outputFlagIndex + 1],
    "/workspace/.walleyboard/review.json",
  );
  assert.equal(run.outputPath, "/workspace/.walleyboard/review.json");
  assert.ok(run.dockerSpec);
});

test("CodexCliAdapter.interpretOutputLine summarizes command execution events", () => {
  const adapter = new CodexCliAdapter();

  const interpreted = adapter.interpretOutputLine(
    JSON.stringify({
      type: "item.completed",
      item: {
        id: "item_54",
        type: "command_execution",
        command: `/bin/bash -lc "sed -n '240,360p' /workspace/apps/web/src/features/walleyboard/use-protocol-event-sync.ts"`,
        exit_code: 0,
        status: "completed",
      },
    }),
  );

  assert.equal(
    interpreted.logLine,
    `[codex command.completed] /bin/bash -lc "sed -n '240,360p' /workspace/apps/web/src/features/walleyboard/use-protocol-event-sync.ts"`,
  );
});

test("CodexCliAdapter.interpretOutputLine preserves readable agent messages", () => {
  const adapter = new CodexCliAdapter();

  const interpreted = adapter.interpretOutputLine(
    JSON.stringify({
      type: "item.completed",
      item: {
        id: "item_55",
        type: "agent_message",
        text: "I found the relevant files and I am preparing a patch.",
      },
    }),
  );

  assert.equal(
    interpreted.logLine,
    "[codex agent_message] I found the relevant files and I am preparing a patch.",
  );
});

test("CodexCliAdapter.interpretOutputLine summarizes file change events", () => {
  const adapter = new CodexCliAdapter();

  const interpreted = adapter.interpretOutputLine(
    JSON.stringify({
      type: "item.completed",
      item: {
        id: "item_81",
        type: "file_change",
        changes: [
          {
            path: "/workspace/apps/backend/src/lib/sqlite-store.test.ts",
            kind: "update",
          },
          {
            path: "/workspace/apps/web/src/components/AgentReviewHistoryModal.test.tsx",
            kind: "update",
          },
        ],
        status: "completed",
      },
    }),
  );

  assert.equal(
    interpreted.logLine,
    "[codex file_change.completed] /workspace/apps/backend/src/lib/sqlite-store.test.ts, /workspace/apps/web/src/components/AgentReviewHistoryModal.test.tsx",
  );
});
