import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  DraftTicketState,
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
    color: "#2563EB",
    agent_adapter: "codex",
    execution_backend: "docker",
    disabled_mcp_servers: [],
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

function createDraft(): DraftTicketState {
  return {
    id: "draft-1",
    project_id: "project-1",
    artifact_scope_id: "artifact-scope-1",
    title_draft: "Handle menu navigation",
    description_draft: "Refine the draft inside Docker.",
    proposed_repo_id: "repo-1",
    confirmed_repo_id: "repo-1",
    proposed_ticket_type: "feature",
    proposed_acceptance_criteria: ["Keep draft analysis inside Docker."],
    wizard_status: "editing",
    split_proposal_summary: null,
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

function resolveWalleyBoardHomeForTest(): string {
  return process.env.WALLEYBOARD_HOME ?? join(homedir(), ".walleyboard");
}

test("CodexCliAdapter.buildExecutionRun maps Docker summary paths into /workspace", () => {
  const adapter = new CodexCliAdapter();
  const session = createSession();

  const run = adapter.buildExecutionRun({
    executionMode: "implementation",
    extraInstructions: [],
    outputPath: join(
      resolveWalleyBoardHomeForTest(),
      "agent-summaries",
      "spacegame",
      "ticket-5-session-1.txt",
    ),
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
    "/walleyboard-home/agent-summaries/spacegame/ticket-5-session-1.txt",
  );
  assert.equal(
    run.outputPath,
    "/walleyboard-home/agent-summaries/spacegame/ticket-5-session-1.txt",
  );
});

test("CodexCliAdapter.buildDraftRun maps Docker output paths into /workspace", () => {
  const adapter = new CodexCliAdapter();

  const run = adapter.buildDraftRun({
    draft: createDraft(),
    mode: "refine",
    outputPath: join(
      resolveWalleyBoardHomeForTest(),
      "draft-analyses",
      "spacegame",
      "draft-1-refine-run-1.json",
    ),
    project: createProject(),
    repository: createRepository(),
    useDockerRuntime: true,
  });

  const outputFlagIndex = run.args.indexOf("--output-last-message");
  assert.notEqual(outputFlagIndex, -1);
  assert.equal(
    run.args[outputFlagIndex + 1],
    "/walleyboard-home/draft-analyses/spacegame/draft-1-refine-run-1.json",
  );
  assert.equal(
    run.outputPath,
    "/walleyboard-home/draft-analyses/spacegame/draft-1-refine-run-1.json",
  );
  assert.ok(run.args.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.equal(run.args.includes("--full-auto"), false);
  assert.ok(run.dockerSpec);
});

test("CodexCliAdapter.buildDraftRun uses full-auto outside Docker", () => {
  const adapter = new CodexCliAdapter();

  const run = adapter.buildDraftRun({
    draft: createDraft(),
    mode: "refine",
    outputPath: "/tmp/draft-1-refine-run-1.json",
    project: createProject(),
    repository: createRepository(),
    useDockerRuntime: false,
  });

  assert.ok(run.args.includes("--full-auto"));
  assert.equal(
    run.args.includes("--dangerously-bypass-approvals-and-sandbox"),
    false,
  );
  assert.equal(run.dockerSpec, null);
});

test("CodexCliAdapter.buildExecutionRun rejects Docker output paths outside the worktree and WalleyBoard home", () => {
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
    outputPath: join(
      resolveWalleyBoardHomeForTest(),
      "agent-summaries",
      "spacegame",
      "ticket-5-session-1-merge-conflict.txt",
    ),
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
    "/walleyboard-home/agent-summaries/spacegame/ticket-5-session-1-merge-conflict.txt",
  );
});

test("CodexCliAdapter.buildReviewRun uses read-only sandbox when Docker mode is disabled", () => {
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
  assert.match(run.prompt, /## Review Goal/);
  assert.match(run.prompt, /## Output JSON/);
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
    outputPath: join(
      resolveWalleyBoardHomeForTest(),
      "agent-reviews",
      "spacegame",
      "ticket-5-review-run-1.json",
    ),
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
    "/walleyboard-home/agent-reviews/spacegame/ticket-5-review-run-1.json",
  );
  assert.equal(
    run.outputPath,
    "/walleyboard-home/agent-reviews/spacegame/ticket-5-review-run-1.json",
  );
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

test("CodexCliAdapter.interpretOutputLine summarizes web search events", () => {
  const adapter = new CodexCliAdapter();

  const interpreted = adapter.interpretOutputLine(
    JSON.stringify({
      type: "item.completed",
      item: {
        id: "ws_1",
        type: "web_search",
        query: "Simple Icons license CC0 OpenAI icon Claude icon",
        action: {
          type: "search",
          query: "Simple Icons license CC0 OpenAI icon Claude icon",
        },
      },
    }),
  );

  assert.equal(
    interpreted.logLine,
    "[codex web_search.search] Simple Icons license CC0 OpenAI icon Claude icon",
  );
});

test("CodexCliAdapter.interpretOutputLine summarizes todo list events", () => {
  const adapter = new CodexCliAdapter();

  const interpreted = adapter.interpretOutputLine(
    JSON.stringify({
      type: "item.started",
      item: {
        id: "item_51",
        type: "todo_list",
        items: [
          {
            text: "Vendor SVG assets and document third-party license/source",
            completed: false,
          },
          {
            text: "Wire icons into Agent CLI selector rendering without behavior changes",
            completed: false,
          },
          {
            text: "Add focused regression test",
            completed: false,
          },
        ],
      },
    }),
  );

  assert.equal(
    interpreted.logLine,
    "[codex todo_list.started] Vendor SVG assets and document third-party license/source | Wire icons into Agent CLI selector rendering without behavior changes (+1 more) [0/3]",
  );
});
