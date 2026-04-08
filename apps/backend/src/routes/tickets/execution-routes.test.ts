import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";

import type { Project } from "../../../../../packages/contracts/src/index.js";
import type { PreparedExecutionRuntime } from "../../lib/store.js";
import { runInitCommandAndStartExecution } from "./execution-routes.js";
import type { TicketRouteDependencies } from "./shared.js";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    slug: "test",
    name: "Test",
    color: "#2563EB",
    agent_adapter: "claude-code",
    draft_analysis_agent_adapter: "claude-code",
    ticket_work_agent_adapter: "claude-code",
    execution_backend: "local",
    disabled_mcp_servers: [],
    automatic_agent_review: false,
    automatic_agent_review_run_limit: 3,
    default_review_action: "merge",
    default_target_branch: null,
    preview_start_command: null,
    worktree_init_command: null,
    worktree_teardown_command: null,
    worktree_init_run_sequential: false,
    draft_analysis_model: null,
    draft_analysis_reasoning_effort: null,
    ticket_work_model: null,
    ticket_work_reasoning_effort: null,
    max_concurrent_sessions: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as Project;
}

function makeMocks() {
  const startExecution =
    mock.fn<TicketRouteDependencies["executionRuntime"]["startExecution"]>();
  const deferWatcher =
    mock.fn<
      TicketRouteDependencies["ticketWorkspaceService"]["deferWatcher"]
    >();
  const appendWarning = mock.fn<(message: string) => void>();
  const startExecutionArgs = {} as Parameters<
    TicketRouteDependencies["executionRuntime"]["startExecution"]
  >[0];
  return { startExecution, deferWatcher, appendWarning, startExecutionArgs };
}

function makeInput(
  mocks: ReturnType<typeof makeMocks>,
  project: Project,
  runtime: PreparedExecutionRuntime,
) {
  return {
    project,
    runtime,
    executionRuntime: {
      startExecution: mocks.startExecution,
    } as unknown as TicketRouteDependencies["executionRuntime"],
    ticketWorkspaceService: {
      deferWatcher: mocks.deferWatcher,
    } as unknown as TicketRouteDependencies["ticketWorkspaceService"],
    ticketId: 1,
    startExecutionArgs: mocks.startExecutionArgs,
    appendWarning: mocks.appendWarning,
  };
}

test("parallel mode starts execution and defers watcher when init command runs", async () => {
  const tempDir = mkdtempSync(
    join(tmpdir(), "walleyboard-exec-parallel-started-"),
  );

  try {
    const mocks = makeMocks();
    const runtime: PreparedExecutionRuntime = {
      workingBranch: "b",
      worktreePath: tempDir,
      logs: [],
    };
    const project = makeProject({
      worktree_init_run_sequential: false,
      worktree_init_command: "true",
    });

    runInitCommandAndStartExecution(makeInput(mocks, project, runtime));

    assert.equal(mocks.startExecution.mock.callCount(), 1);
    assert.equal(mocks.deferWatcher.mock.callCount(), 1);
    const deferWatcherCall = mocks.deferWatcher.mock.calls[0];
    assert.ok(deferWatcherCall);
    assert.equal(deferWatcherCall.arguments[0], 1);
    assert.equal(mocks.appendWarning.mock.callCount(), 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("parallel mode starts execution without deferring when no init command", () => {
  const mocks = makeMocks();
  const runtime: PreparedExecutionRuntime = {
    workingBranch: "b",
    worktreePath: "/nonexistent",
    logs: [],
  };
  const project = makeProject({
    worktree_init_run_sequential: false,
    worktree_init_command: null,
  });

  runInitCommandAndStartExecution(makeInput(mocks, project, runtime));

  assert.equal(mocks.startExecution.mock.callCount(), 1);
  assert.equal(mocks.deferWatcher.mock.callCount(), 0);
});

test("sequential mode starts execution after init command completes", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-exec-seq-started-"));

  try {
    const mocks = makeMocks();
    const runtime: PreparedExecutionRuntime = {
      workingBranch: "b",
      worktreePath: tempDir,
      logs: [],
    };
    const project = makeProject({
      worktree_init_run_sequential: true,
      worktree_init_command: "true",
    });

    runInitCommandAndStartExecution(makeInput(mocks, project, runtime));

    assert.equal(mocks.startExecution.mock.callCount(), 0);

    await new Promise((r) => setTimeout(r, 500));

    assert.equal(mocks.startExecution.mock.callCount(), 1);
    assert.equal(mocks.deferWatcher.mock.callCount(), 0);
    assert.equal(mocks.appendWarning.mock.callCount(), 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("sequential mode starts execution immediately when no init command", () => {
  const mocks = makeMocks();
  const runtime: PreparedExecutionRuntime = {
    workingBranch: "b",
    worktreePath: "/nonexistent",
    logs: [],
  };
  const project = makeProject({
    worktree_init_run_sequential: true,
    worktree_init_command: null,
  });

  runInitCommandAndStartExecution(makeInput(mocks, project, runtime));

  assert.equal(mocks.startExecution.mock.callCount(), 1);
  assert.equal(mocks.deferWatcher.mock.callCount(), 0);
});

test("sequential mode appends warning when init command fails", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-exec-seq-fail-"));

  try {
    const mocks = makeMocks();
    const runtime: PreparedExecutionRuntime = {
      workingBranch: "b",
      worktreePath: tempDir,
      logs: [],
    };
    const project = makeProject({
      worktree_init_run_sequential: true,
      worktree_init_command: "exit 1",
    });

    runInitCommandAndStartExecution(makeInput(mocks, project, runtime));

    await new Promise((r) => setTimeout(r, 500));

    assert.equal(mocks.startExecution.mock.callCount(), 1);
    assert.equal(mocks.appendWarning.mock.callCount(), 1);
    const appendWarningCall = mocks.appendWarning.mock.calls[0];
    assert.ok(appendWarningCall);
    assert.match(appendWarningCall.arguments[0], /exited with code 1/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
