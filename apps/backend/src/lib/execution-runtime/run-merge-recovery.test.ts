import assert from "node:assert/strict";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import type {
  ExecutionSession,
  Project,
  RepositoryConfig,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import { runMergeRecovery } from "./run-merge-recovery.js";

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

function createRepository(worktreePath: string): RepositoryConfig {
  return {
    id: "repo-1",
    project_id: "project-1",
    name: "spacegame",
    path: worktreePath,
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

function createSession(worktreePath: string): ExecutionSession {
  return {
    id: "session-1",
    ticket_id: 5,
    project_id: "project-1",
    repo_id: "repo-1",
    agent_adapter: "codex",
    worktree_path: worktreePath,
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

function createFakeChild(): {
  child: ChildProcessWithoutNullStreams & EventEmitter;
  stderr: PassThrough;
  stdout: PassThrough;
} {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter() as ChildProcessWithoutNullStreams &
    EventEmitter;
  Object.assign(child, {
    kill() {
      return true;
    },
    stdin: new PassThrough(),
    stdout,
    stderr,
  });
  return {
    child,
    stderr,
    stdout,
  };
}

test("runMergeRecovery streams Docker stdout and stderr through the log callback", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-merge-recovery-"));
  const worktreePath = join(tempDir, "workspace");
  mkdirSync(worktreePath, { recursive: true });

  const loggedLines: string[] = [];
  let cleanedSessionId: string | null = null;
  const { child, stderr, stdout } = createFakeChild();

  try {
    const recoveryPromise = runMergeRecovery({
      adapter: {
        id: "codex",
        label: "Codex",
        buildDraftRun() {
          throw new Error("draft runs are not used in this test");
        },
        buildExecutionRun() {
          throw new Error("execution runs are not used in this test");
        },
        buildMergeConflictRun(input) {
          return {
            command: "codex",
            args: [
              "exec",
              "--json",
              "--output-last-message",
              input.outputPath,
              "fake merge recovery prompt",
            ],
            prompt: "fake merge recovery prompt",
            outputPath: input.outputPath,
            dockerSpec: {
              imageTag: "example/codex:latest",
              dockerfilePath: "apps/backend/docker/codex-runtime.Dockerfile",
              homePath: "/home/codex",
              configMountPath: "/home/codex/.codex",
            },
          };
        },
        buildReviewRun() {
          throw new Error("review runs are not used in this test");
        },
        interpretOutputLine(line) {
          return {
            logLine: `[codex] ${line}`,
            outputContent: line,
          };
        },
        parseDraftResult() {
          throw new Error("draft parsing is not used in this test");
        },
        formatExitReason(exitCode, _signal, rawOutput) {
          return `Codex exited with code ${exitCode}. Final output: ${rawOutput}`;
        },
        resolveModelSelection() {
          return {
            model: "gpt-5.4",
            reasoningEffort: "high",
          };
        },
      },
      cleanupExecutionEnvironment(sessionId) {
        cleanedSessionId = sessionId;
      },
      conflictedFiles: [
        "apps/web/src/features/walleyboard/board-scroll.test.tsx",
      ],
      dockerRuntime: {
        ensureSessionContainer() {},
        spawnProcessInSession() {
          return child;
        },
      } as never,
      failureMessage: "Git rebase stopped on board-scroll.test.tsx.",
      onLogLine(line) {
        loggedLines.push(line);
      },
      project: createProject(),
      recoveryKind: "conflicts",
      repository: createRepository(worktreePath),
      session: createSession(worktreePath),
      stage: "rebase",
      targetBranch: "origin/main",
      ticket: createTicket(),
    });

    stdout.write(
      '{"summary":"Resolved the conflict and continued the rebase."}\n',
    );
    stderr.write("Still waiting on one more tool check.\n");
    stdout.end();
    stderr.end();
    child.emit("close", 0, null);

    const result = await recoveryPromise;
    assert.equal(result.resolved, true);
    assert.equal(cleanedSessionId, "session-1");
    assert.match(
      loggedLines[0] ?? "",
      /Launching Codex merge-conflict resolution/,
    );
    assert.match(
      loggedLines[1] ?? "",
      /Command: codex exec --json --output-last-message/,
    );
    assert.ok(
      loggedLines.includes(
        '[codex] {"summary":"Resolved the conflict and continued the rebase."}',
      ),
    );
    assert.ok(
      loggedLines.includes(
        "[codex stderr] Still waiting on one more tool check.",
      ),
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
