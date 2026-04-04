import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  ExecutionSession,
  Project,
  RepositoryConfig,
  ReviewPackage,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import { runTicketReviewSession } from "./review-runner.js";

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

test("runTicketReviewSession streams Docker reviews through a PTY", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-review-runner-"));
  const worktreePath = join(tempDir, "workspace");
  mkdirSync(worktreePath, { recursive: true });

  let onDataHandler: ((chunk: string) => void) | null = null;
  let onExitHandler:
    | ((event: { exitCode: number; signal?: number }) => void)
    | null = null;
  let spawnPtyCalls = 0;
  let cleanedSessionId: string | null = null;
  const activeReviewRuns = new Map<
    string,
    { kill(signal?: NodeJS.Signals): unknown }
  >();

  try {
    const reviewPromise = runTicketReviewSession({
      activeReviewRuns,
      adapter: {
        id: "codex",
        label: "Codex",
        buildDraftRun() {
          throw new Error("draft runs are not used in this test");
        },
        buildExecutionRun() {
          throw new Error("execution runs are not used in this test");
        },
        buildMergeConflictRun() {
          throw new Error("merge-conflict runs are not used in this test");
        },
        buildReviewRun(input) {
          return {
            command: "codex",
            args: [
              "exec",
              "--json",
              "--output-last-message",
              input.outputPath,
              "fake review prompt",
            ],
            prompt: "fake review prompt",
            outputPath: input.outputPath,
            dockerSpec: {
              imageTag: "example/codex:latest",
              dockerfilePath: "apps/backend/docker/codex-runtime.Dockerfile",
              homePath: "/home/codex",
              configMountPath: "/home/codex/.codex",
            },
          };
        },
        interpretOutputLine(line) {
          return {
            logLine: line,
            outputContent: line,
          };
        },
        parseDraftResult(rawOutput, schema) {
          return schema.parse(JSON.parse(rawOutput));
        },
        formatExitReason(exitCode, _signal, rawOutput) {
          return `Codex exited with code ${exitCode}. Final output: ${rawOutput}`;
        },
        resolveModelSelection() {
          return {
            model: null,
            reasoningEffort: null,
          };
        },
      },
      cleanupExecutionEnvironment(sessionId) {
        cleanedSessionId = sessionId;
      },
      dockerRuntime: {
        ensureSessionContainer() {},
        spawnPtyInSession(_sessionId: string, command: string, args: string[]) {
          spawnPtyCalls += 1;
          assert.equal(command, "codex");
          assert.deepEqual(args.slice(0, 3), [
            "exec",
            "--json",
            "--output-last-message",
          ]);
          return {
            kill() {},
            onData(callback: (chunk: string) => void) {
              onDataHandler = callback;
            },
            onExit(
              callback: (event: { exitCode: number; signal?: number }) => void,
            ) {
              onExitHandler = callback;
            },
            pid: 321,
            process: "docker",
            resize() {},
            write() {},
          } as never;
        },
      } as never,
      project: createProject(),
      repository: createRepository(worktreePath),
      reviewPackage: createReviewPackage(),
      reviewRunId: "review-run-1",
      session: createSession(worktreePath),
      ticket: createTicket(),
    });

    assert.equal(spawnPtyCalls, 1);
    assert.equal(activeReviewRuns.size, 1);
    if (!onDataHandler || !onExitHandler) {
      throw new Error("Expected Docker PTY callbacks to be registered");
    }
    const emitData: (chunk: string) => void = onDataHandler;
    const emitExit: (event: { exitCode: number; signal?: number }) => void =
      onExitHandler;

    emitData(
      '{"summary":"Looks good","strengths":["Covers the scene transitions"],',
    );
    emitData('"actionable_findings":[]}\n');
    emitExit({ exitCode: 0 });

    const result = await reviewPromise;
    assert.equal(result.adapterSessionRef, null);
    assert.equal(result.report.summary, "Looks good");
    assert.deepEqual(result.report.actionable_findings, []);
    assert.equal(cleanedSessionId, "review-review-run-1");
    assert.equal(activeReviewRuns.size, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
