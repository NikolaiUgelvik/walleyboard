import assert from "node:assert/strict";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import type {
  ExecutionAttempt,
  ExecutionSession,
  Project,
  RepositoryConfig,
  ReviewPackage,
  ReviewRun,
  StructuredEvent,
  TicketFrontmatter,
} from "../../../../packages/contracts/src/index.js";

import { generatePullRequestBody } from "./pull-request-body-generator.js";

function createProject(): Project {
  return {
    id: "project-1",
    slug: "spacegame",
    name: "spacegame",
    color: "#2563EB",
    agent_adapter: "claude-code",
    draft_analysis_agent_adapter: "claude-code",
    ticket_work_agent_adapter: "claude-code",
    execution_backend: "docker",
    disabled_mcp_servers: [],
    automatic_agent_review: false,
    automatic_agent_review_run_limit: 1,
    default_review_action: "direct_merge",
    default_target_branch: "origin/main",
    preview_start_command: null,
    worktree_init_command: null,
    worktree_teardown_command: null,
    worktree_init_run_sequential: false,
    draft_analysis_model: "claude-haiku-4-5",
    draft_analysis_reasoning_effort: null,
    ticket_work_model: "claude-sonnet-4-6",
    ticket_work_reasoning_effort: null,
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
    working_branch: "claude/ticket-5",
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
    agent_adapter: "claude-code",
    worktree_path: worktreePath,
    adapter_session_ref: null,
    status: "completed",
    planning_enabled: false,
    plan_status: "not_requested",
    plan_summary: "Implement the return-to-menu flow.",
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

function createExecutionAttempt(): ExecutionAttempt {
  return {
    id: "attempt-1",
    session_id: "session-1",
    attempt_number: 1,
    status: "completed",
    prompt_kind: "implementation",
    prompt: "Implement the PR body generator.",
    pty_pid: null,
    started_at: "2026-04-01T00:00:00.000Z",
    ended_at: "2026-04-01T00:05:00.000Z",
    end_reason: null,
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

function createReviewRun(): ReviewRun {
  return {
    id: "review-run-1",
    ticket_id: 5,
    review_package_id: "review-package-1",
    implementation_session_id: "session-1",
    status: "completed",
    adapter_session_ref: null,
    prompt: "Review the implementation.",
    report: {
      summary: "Looks good.",
      strengths: [],
      actionable_findings: [],
    },
    failure_message: null,
    created_at: "2026-04-01T00:06:00.000Z",
    updated_at: "2026-04-01T00:07:00.000Z",
    completed_at: "2026-04-01T00:07:00.000Z",
  };
}

function createTicketEvent(): StructuredEvent {
  return {
    id: "event-1",
    occurred_at: "2026-04-01T00:08:00.000Z",
    entity_type: "ticket",
    entity_id: "5",
    event_type: "pull_request.created",
    payload: {
      number: 12,
      url: "https://github.com/acme/repo/pull/12",
    },
  };
}

function createFakeChildProcess(): {
  child: ChildProcessWithoutNullStreams;
  emitExit: (event: { exitCode: number; signal?: NodeJS.Signals }) => void;
  emitStdout: (chunk: string) => void;
} {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();

  return {
    child: Object.assign(emitter, {
      kill() {
        return true;
      },
      pid: 654,
      stderr,
      stdin,
      stdout,
    }) as unknown as ChildProcessWithoutNullStreams,
    emitExit(event) {
      emitter.emit("exit", event.exitCode, event.signal ?? null);
    },
    emitStdout(chunk) {
      stdout.write(chunk);
    },
  };
}

test("generatePullRequestBody passes the local schema into the adapter and trims the result", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-pr-body-"));
  const worktreePath = join(tempDir, "workspace");
  mkdirSync(worktreePath, { recursive: true });

  const fakeChild = createFakeChildProcess();
  let forwardedSchemaAcceptsBody = false;
  let forwardedSchemaRejectsExtra = true;
  const loggedLines: string[] = [];

  try {
    const bodyPromise = generatePullRequestBody({
      adapter: {
        id: "claude-code",
        label: "Claude Code",
        buildDraftRun() {
          throw new Error("draft runs are not used in this test");
        },
        buildExecutionRun() {
          throw new Error("execution runs are not used in this test");
        },
        buildMergeConflictRun() {
          throw new Error("merge-conflict runs are not used in this test");
        },
        buildReviewRun() {
          throw new Error("review runs are not used in this test");
        },
        buildPullRequestBodyRun(input) {
          forwardedSchemaAcceptsBody = input.resultSchema.safeParse({
            body: "Hello",
          }).success;
          forwardedSchemaRejectsExtra = input.resultSchema.safeParse({
            body: "Hello",
            extra: true,
          }).success;
          return {
            command: "claude",
            args: ["-p", "fake PR body prompt"],
            prompt: "fake PR body prompt",
            outputPath: input.outputPath,
            dockerSpec: {
              imageTag: "example/claude:latest",
              dockerfilePath: "apps/backend/docker/codex-runtime.Dockerfile",
              homePath: "/home/walley",
              configMountPath: "/home/walley/.claude",
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
          return `Claude Code exited with code ${exitCode}. Final output: ${rawOutput}`;
        },
        resolveModelSelection() {
          return {
            model: "claude-haiku-4-5",
            reasoningEffort: null,
          };
        },
      },
      context: {
        attempts: [createExecutionAttempt()],
        baseBranch: "main",
        headBranch: "claude/ticket-5",
        patch: "diff --git a/file b/file",
        project: createProject(),
        repository: createRepository(worktreePath),
        reviewPackage: createReviewPackage(),
        reviewRuns: [createReviewRun()],
        session: createSession(worktreePath),
        sessionLogs: ["Prepared pull request metadata from the timeline."],
        ticket: createTicket(),
        ticketEvents: [createTicketEvent()],
      },
      dockerRuntime: {
        ensureSessionContainer() {},
        getSessionContainerInfo() {
          return {
            id: "container-pr-body",
            name: "test-container-pr-body",
            projectId: "project-1",
            ticketId: 5,
            worktreePath,
          };
        },
        cleanupSessionContainer() {},
        spawnProcessInSession(_sessionId: string, command: string) {
          assert.equal(command, "claude");
          return fakeChild.child;
        },
      } as never,
      onLogLine(line) {
        loggedLines.push(line);
      },
      registerHostSidecar() {},
    });

    // allocatePort is async; wait for the spawn before emitting events.
    await new Promise((r) => setTimeout(r, 50));

    fakeChild.emitStdout('{"body":"  ## Summary\\n- Generated body  "}\n');
    fakeChild.emitExit({ exitCode: 0 });

    const result = await bodyPromise;
    assert.equal(result.body, "## Summary\n- Generated body");
    assert.equal(forwardedSchemaAcceptsBody, true);
    assert.equal(forwardedSchemaRejectsExtra, false);
    assert.match(loggedLines[1] ?? "", /Command: claude/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
