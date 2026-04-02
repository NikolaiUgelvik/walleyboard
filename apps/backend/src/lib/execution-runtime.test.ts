import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  ExecutionSession,
  Project,
  RepositoryConfig,
  TicketFrontmatter,
} from "../../../../packages/contracts/src/index.js";

import { AgentAdapterRegistry } from "./agent-adapters/registry.js";
import { ExecutionRuntime } from "./execution-runtime.js";

function createProject(): Project {
  return {
    id: "project-1",
    slug: "project-1",
    name: "Project",
    agent_adapter: "codex",
    execution_backend: "docker",
    default_target_branch: "main",
    pre_worktree_command: null,
    post_worktree_command: null,
    draft_analysis_model: null,
    draft_analysis_reasoning_effort: null,
    ticket_work_model: null,
    ticket_work_reasoning_effort: null,
    max_concurrent_sessions: 4,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
  };
}

function createRepository(path: string): RepositoryConfig {
  return {
    id: "repo-1",
    project_id: "project-1",
    name: "repo",
    path,
    target_branch: "main",
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
    id: 14,
    project: "project-1",
    repo: "repo-1",
    artifact_scope_id: "artifact-scope-1",
    status: "in_progress",
    title: "Run ticket in Docker",
    description: "Use the Docker backend.",
    ticket_type: "feature",
    acceptance_criteria: ["Run Codex inside Docker."],
    working_branch: "codex/ticket-14",
    target_branch: "main",
    linked_pr: null,
    session_id: "session-1",
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
  };
}

function createSession(worktreePath: string): ExecutionSession {
  return {
    id: "session-1",
    ticket_id: 14,
    project_id: "project-1",
    repo_id: "repo-1",
    agent_adapter: "codex",
    worktree_path: worktreePath,
    adapter_session_ref: null,
    status: "awaiting_input",
    planning_enabled: false,
    plan_status: "not_requested",
    plan_summary: null,
    current_attempt_id: "attempt-1",
    latest_requested_change_note_id: null,
    latest_review_package_id: null,
    queue_entered_at: null,
    started_at: null,
    completed_at: null,
    last_heartbeat_at: null,
    last_summary: null,
  };
}

test("docker-backed execution launches the configured adapter command inside Docker", () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "orchestrator-execution-runtime-"),
  );
  const worktreePath = join(tempDir, "workspace");
  mkdirSync(worktreePath, { recursive: true });

  let spawnedArgs: string[] | null = null;
  const dockerRuntime = {
    assertAvailable() {
      return {
        installed: true,
        available: true,
        client_version: "29.3.1",
        server_version: "29.3.1",
        error: null,
      };
    },
    cleanupSessionContainer() {},
    dispose() {},
    ensureSessionContainer() {},
    spawnPtyInSession(_sessionId: string, command: string, args: string[]) {
      assert.equal(command, "test-agent");
      spawnedArgs = args;
      return {
        kill() {},
        onData() {},
        onExit() {},
        pid: 1234,
        process: "docker",
        resize() {},
        write() {},
      } as never;
    },
  };
  const store = {
    appendSessionLog() {
      return 0;
    },
    getRequestedChangeNote() {
      return undefined;
    },
    updateExecutionAttempt() {
      return undefined;
    },
    updateSessionStatus(_sessionId: string, _status: string, _summary: string) {
      return createSession(worktreePath);
    },
  };
  const eventHub = {
    publish() {},
  };

  try {
    const adapterRegistry = new AgentAdapterRegistry([
      {
        id: "codex",
        label: "Fake Agent",
        buildDraftRun() {
          throw new Error("draft runs are not used in this test");
        },
        buildExecutionRun(input) {
          return {
            command: "test-agent",
            args: [
              "exec",
              "--json",
              "--dangerously-bypass-approvals-and-sandbox",
              "--output-last-message",
              input.outputPath,
              "fake prompt",
            ],
            outputPath: input.outputPath,
            dockerSpec: {
              imageTag: "example/test-agent:latest",
              dockerfilePath: "apps/backend/docker/codex-runtime.Dockerfile",
              homePath: "/home/test-agent",
              configMountPath: "/home/test-agent/.fake-agent",
            },
          };
        },
        buildMergeConflictRun() {
          throw new Error("merge-conflict runs are not used in this test");
        },
        interpretOutputLine(line) {
          return {
            logLine: line,
          };
        },
        parseDraftResult() {
          throw new Error("draft parsing is not used in this test");
        },
        formatExitReason() {
          return "fake exit";
        },
        resolveModelSelection() {
          return {
            model: null,
            reasoningEffort: null,
          };
        },
      },
    ]);
    const runtime = new ExecutionRuntime({
      adapterRegistry,
      dockerRuntime: dockerRuntime as never,
      eventHub: eventHub as never,
      store: store as never,
    });

    runtime.startExecution({
      project: createProject(),
      repository: createRepository(tempDir),
      ticket: createTicket(),
      session: createSession(worktreePath),
    });

    assert.ok(spawnedArgs);
    const dockerArgs = spawnedArgs as string[];
    assert.ok(
      dockerArgs.includes("--dangerously-bypass-approvals-and-sandbox"),
    );
    assert.ok(
      !dockerArgs.some(
        (value: string) =>
          value.includes('sandbox_mode="') ||
          value.includes('approval_policy="'),
      ),
    );

    const outputFlagIndex = dockerArgs.indexOf("--output-last-message");
    assert.notEqual(outputFlagIndex, -1);
    const outputPath = dockerArgs[outputFlagIndex + 1];
    assert.ok(outputPath);
    assert.equal(outputPath.startsWith(worktreePath), true);
    assert.match(outputPath, /\.orchestrator\//);
    assert.equal(dockerArgs[0], "exec");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
