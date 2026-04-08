import assert from "node:assert/strict";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import type {
  DraftTicketState,
  ExecutionSession,
  Project,
  RepositoryConfig,
  TicketFrontmatter,
} from "../../../../packages/contracts/src/index.js";

import { AgentAdapterRegistry } from "./agent-adapters/registry.js";
import { ExecutionRuntime } from "./execution-runtime.js";

function configureGitIdentity(repoPath: string) {
  execFileSync("git", ["-C", repoPath, "config", "user.name", "WalleyBoard"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  execFileSync(
    "git",
    ["-C", repoPath, "config", "user.email", "walleyboard@example.com"],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function runGit(repoPath: string, args: string[]) {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    slug: "project-1",
    name: "Project",
    color: "#2563EB",
    agent_adapter: "codex",
    draft_analysis_agent_adapter: "codex",
    ticket_work_agent_adapter: "codex",
    execution_backend: "docker",
    disabled_mcp_servers: [],
    automatic_agent_review: false,
    automatic_agent_review_run_limit: 1,
    default_review_action: "direct_merge",
    default_target_branch: "main",
    preview_start_command: null,
    worktree_init_command: null,
    worktree_teardown_command: null,
    worktree_init_run_sequential: false,
    draft_analysis_model: null,
    draft_analysis_reasoning_effort: null,
    ticket_work_model: null,
    ticket_work_reasoning_effort: null,
    max_concurrent_sessions: 4,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

function createRepository(
  path: string,
  overrides: Partial<RepositoryConfig> = {},
): RepositoryConfig {
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
    ...overrides,
  };
}

function createDraft(): DraftTicketState {
  return {
    id: "draft-1",
    project_id: "project-1",
    artifact_scope_id: "artifact-scope-1",
    title_draft: "Draft title",
    description_draft: "Draft description",
    proposed_repo_id: "repo-1",
    confirmed_repo_id: "repo-1",
    proposed_ticket_type: "feature",
    proposed_acceptance_criteria: ["Refine this draft inside Docker."],
    wizard_status: "editing",
    split_proposal_summary: null,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
  };
}

function createTicket(
  overrides: Partial<TicketFrontmatter> = {},
): TicketFrontmatter {
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
    ...overrides,
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
      pid: 1234,
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

test("docker-backed execution launches the configured adapter command inside Docker", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-execution-runtime-"));
  const worktreePath = join(tempDir, "workspace");
  const walleyBoardHome = join(tempDir, ".walleyboard-home");
  mkdirSync(worktreePath, { recursive: true });
  const previousWalleyBoardHome = process.env.WALLEYBOARD_HOME;

  let spawnedArgs: string[] | null = null;
  const { child } = createFakeChildProcess();
  const updateExecutionAttemptCalls: Array<{
    attemptId: string;
    input: Record<string, unknown>;
  }> = [];
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
    getSessionContainerInfo() {
      return {
        id: "container-session-1",
        name: "test-container-session-1",
        projectId: "project-1",
        ticketId: 14,
        worktreePath,
      };
    },
    spawnProcessInSession(_sessionId: string, command: string, args: string[]) {
      assert.equal(command, "test-agent");
      spawnedArgs = args;
      return child;
    },
  };
  const store = {
    appendSessionLog() {
      return 0;
    },
    getRequestedChangeNote() {
      return undefined;
    },
    updateExecutionAttempt(attemptId: string, input: Record<string, unknown>) {
      updateExecutionAttemptCalls.push({ attemptId, input });
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
    process.env.WALLEYBOARD_HOME = walleyBoardHome;
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
            prompt: "fake prompt",
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
        buildReviewRun() {
          throw new Error("review runs are not used in this test");
        },
        buildPullRequestBodyRun() {
          throw new Error("pull request body runs are not used in this test");
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
    assert.equal(child.stdin.writableEnded, true);
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
    assert.equal(outputPath.startsWith(walleyBoardHome), true);
    assert.match(outputPath, /agent-summaries\/project-1\//);
    assert.equal(dockerArgs[0], "exec");
    assert.deepEqual(updateExecutionAttemptCalls[0], {
      attemptId: "attempt-1",
      input: {
        prompt_kind: "implementation",
        prompt: "fake prompt",
      },
    });
  } finally {
    if (previousWalleyBoardHome === undefined) {
      delete process.env.WALLEYBOARD_HOME;
    } else {
      process.env.WALLEYBOARD_HOME = previousWalleyBoardHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("draft refinement launches the configured adapter command inside Docker", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-draft-runtime-"));
  const repositoryPath = join(tempDir, "repository");
  const walleyBoardHome = join(tempDir, ".walleyboard-home");
  mkdirSync(repositoryPath, { recursive: true });
  const previousWalleyBoardHome = process.env.WALLEYBOARD_HOME;

  let ensureSessionContainerInput: {
    worktreePath: string;
    ticketId: number;
  } | null = null;
  let spawned: { command: string; args: string[] } | null = null;
  const fakeChild = createFakeChildProcess();

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
    ensureSessionContainer(input: { worktreePath: string; ticketId: number }) {
      ensureSessionContainerInput = input;
      return undefined;
    },
    getSessionContainerInfo() {
      return {
        id: "container-draft-run",
        name: "test-container-draft-run",
        projectId: "project-1",
        ticketId: 0,
        worktreePath: repositoryPath,
      };
    },
    spawnProcessInSession(_sessionId: string, command: string, args: string[]) {
      spawned = { command, args };
      return fakeChild.child;
    },
  };
  const store = {
    recordDraftEvent() {
      return {
        id: "event-1",
        occurred_at: "2026-04-01T00:00:00.000Z",
        entity_type: "draft",
        entity_id: "draft-1",
        event_type: "draft.refine.started",
        payload: {},
      };
    },
  };
  const eventHub = {
    publish() {},
  };

  try {
    process.env.WALLEYBOARD_HOME = walleyBoardHome;
    const adapterRegistry = new AgentAdapterRegistry([
      {
        id: "codex",
        label: "Fake Agent",
        buildDraftRun(input) {
          assert.equal(input.useDockerRuntime, true);
          assert.equal(input.outputPath.startsWith(walleyBoardHome), true);
          assert.match(input.outputPath, /draft-analyses\/project-1\//);
          assert.equal(
            input.resultSchema.safeParse({
              title: "Refined title",
              description: "Refined description",
              ticket_type: "feature",
              acceptance_criteria: ["criterion"],
            }).success,
            true,
          );
          assert.equal(
            input.resultSchema.safeParse({
              verdict: "feasible",
            }).success,
            false,
          );
          return {
            command: "test-agent",
            args: ["exec", "--json", "--output-last-message", input.outputPath],
            prompt: "fake prompt",
            outputPath: input.outputPath,
            dockerSpec: {
              imageTag: "example/test-agent:latest",
              dockerfilePath: "apps/backend/docker/codex-runtime.Dockerfile",
              homePath: "/home/test-agent",
              configMountPath: "/home/test-agent/.fake-agent",
            },
          };
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
        buildPullRequestBodyRun() {
          throw new Error("pull request body runs are not used in this test");
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

    runtime.runDraftRefinement({
      draft: createDraft(),
      project: createProject(),
      repository: createRepository(repositoryPath),
    });

    // runDraftRefinement is fire-and-forget async; flush microtasks so
    // the port allocation and spawn complete before we check results.
    await new Promise((r) => setTimeout(r, 50));

    if (!ensureSessionContainerInput || !spawned) {
      throw new Error("Expected draft refinement to start in Docker");
    }
    const capturedContainerInput = ensureSessionContainerInput as {
      worktreePath: string;
      ticketId: number;
    };
    const spawnedRun = spawned as { command: string; args: string[] };
    assert.equal(fakeChild.child.stdin.writableEnded, true);
    assert.equal(capturedContainerInput.worktreePath, repositoryPath);
    assert.equal(capturedContainerInput.ticketId, 0);
    assert.equal(spawnedRun.command, "test-agent");
    fakeChild.emitExit({ exitCode: 1 });
  } finally {
    if (previousWalleyBoardHome === undefined) {
      delete process.env.WALLEYBOARD_HOME;
    } else {
      process.env.WALLEYBOARD_HOME = previousWalleyBoardHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("draft refinement maps agent-facing fields into the stored draft shape", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-draft-runtime-"));
  const repositoryPath = join(tempDir, "repository");
  const walleyBoardHome = join(tempDir, ".walleyboard-home");
  mkdirSync(repositoryPath, { recursive: true });
  const previousWalleyBoardHome = process.env.WALLEYBOARD_HOME;

  const fakeChild = createFakeChildProcess();
  let updatedDraftInput: Record<string, unknown> | null = null;
  const recordedEvents: Array<{
    eventType: string;
    payload: Record<string, unknown>;
  }> = [];

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
    ensureSessionContainer() {
      return undefined;
    },
    getSessionContainerInfo() {
      return {
        id: "container-draft-run",
        name: "test-container-draft-run",
        projectId: "project-1",
        ticketId: 0,
        worktreePath: repositoryPath,
      };
    },
    spawnProcessInSession() {
      return fakeChild.child;
    },
  };
  const store = {
    getDraft() {
      return createDraft();
    },
    recordDraftEvent(
      _draftId: string,
      eventType: string,
      payload: Record<string, unknown>,
    ) {
      recordedEvents.push({ eventType, payload });
      return {
        id: `event-${recordedEvents.length}`,
        occurred_at: "2026-04-01T00:00:00.000Z",
        entity_type: "draft",
        entity_id: "draft-1",
        event_type: eventType,
        payload,
      };
    },
    updateDraft(_draftId: string, input: Record<string, unknown>) {
      updatedDraftInput = input;
      return {
        ...createDraft(),
        ...input,
      };
    },
  };
  const eventHub = {
    publish() {},
  };

  try {
    process.env.WALLEYBOARD_HOME = walleyBoardHome;
    const adapterRegistry = new AgentAdapterRegistry([
      {
        id: "codex",
        label: "Fake Agent",
        buildDraftRun(input) {
          assert.equal(
            input.resultSchema.safeParse({
              title: "Refined title",
              description: "Refined description",
              ticket_type: "feature",
              acceptance_criteria: ["criterion"],
            }).success,
            true,
          );
          return {
            command: "test-agent",
            args: ["exec", "--json", "--output-last-message", input.outputPath],
            prompt: "fake prompt",
            outputPath: input.outputPath,
            dockerSpec: {
              imageTag: "example/test-agent:latest",
              dockerfilePath: "apps/backend/docker/codex-runtime.Dockerfile",
              homePath: "/home/test-agent",
              configMountPath: "/home/test-agent/.fake-agent",
            },
          };
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
        buildPullRequestBodyRun() {
          throw new Error("pull request body runs are not used in this test");
        },
        interpretOutputLine(line) {
          return {
            logLine: line,
          };
        },
        parseDraftResult(rawOutput, schema) {
          assert.equal(rawOutput, "");
          return schema.parse({
            title: "Refined title",
            description: "Refined description",
            ticket_type: "feature",
            acceptance_criteria: ["criterion"],
            split_proposal_summary: null,
          });
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

    runtime.runDraftRefinement({
      draft: createDraft(),
      project: createProject(),
      repository: createRepository(repositoryPath),
    });

    await new Promise((r) => setTimeout(r, 50));

    fakeChild.emitExit({ exitCode: 0 });

    assert.deepEqual(updatedDraftInput, {
      title_draft: "Refined title",
      description_draft: "Refined description",
      proposed_ticket_type: "feature",
      proposed_acceptance_criteria: ["criterion"],
      split_proposal_summary: null,
      wizard_status: "awaiting_confirmation",
    });
    assert.equal(
      recordedEvents.some(
        ({ eventType, payload }) =>
          eventType === "draft.refine.completed" &&
          (payload.result as Record<string, unknown>).title_draft ===
            "Refined title",
      ),
      true,
    );
  } finally {
    if (previousWalleyBoardHome === undefined) {
      delete process.env.WALLEYBOARD_HOME;
    } else {
      process.env.WALLEYBOARD_HOME = previousWalleyBoardHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("queued Claude sessions fail before launch when Claude is unavailable", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-execution-runtime-"));
  const worktreePath = join(tempDir, "workspace");
  mkdirSync(worktreePath, { recursive: true });

  const sessionLogs: string[] = [];
  const attemptUpdates: Array<{
    attemptId: string;
    input: Record<string, unknown>;
  }> = [];
  const completedSessions: Array<Record<string, unknown>> = [];
  let queuedSessionClaimed = false;
  let ensureSessionContainerCalls = 0;

  const queuedSession: ExecutionSession = {
    ...createSession(worktreePath),
    agent_adapter: "claude-code",
    status: "queued",
    queue_entered_at: "2026-04-01T00:00:00.000Z",
  };
  const project = createProject({
    agent_adapter: "claude-code",
    draft_analysis_agent_adapter: "claude-code",
    ticket_work_agent_adapter: "claude-code",
  });
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
    assertClaudeCodeAvailable() {
      throw new Error(
        "Claude Code CLI is unavailable: Claude config directory /tmp/.claude is empty.",
      );
    },
    cleanupSessionContainer() {},
    dispose() {},
    ensureSessionContainer() {
      ensureSessionContainerCalls += 1;
    },
  };
  const store = {
    appendSessionLog(_sessionId: string, line: string) {
      sessionLogs.push(line);
      return sessionLogs.length;
    },
    claimNextQueuedSession() {
      if (queuedSessionClaimed) {
        return undefined;
      }

      queuedSessionClaimed = true;
      return {
        ...queuedSession,
        status: "awaiting_input",
        queue_entered_at: null,
      };
    },
    completeSession(_sessionId: string, input: Record<string, unknown>) {
      completedSessions.push(input);
      return {
        ...queuedSession,
        status: input.status,
        last_summary: input.last_summary,
      };
    },
    getProject() {
      return project;
    },
    getRepository() {
      return createRepository(tempDir);
    },
    getTicket() {
      return createTicket();
    },
    updateExecutionAttempt(attemptId: string, input: Record<string, unknown>) {
      attemptUpdates.push({ attemptId, input });
      return undefined;
    },
  };
  const eventHub = {
    publish() {},
  };

  try {
    const runtime = new ExecutionRuntime({
      adapterRegistry: new AgentAdapterRegistry([]),
      dockerRuntime: dockerRuntime as never,
      eventHub: eventHub as never,
      store: store as never,
    });

    runtime.startQueuedSessions(project.id);

    assert.equal(ensureSessionContainerCalls, 0);
    assert.deepEqual(attemptUpdates, [
      {
        attemptId: "attempt-1",
        input: {
          status: "failed",
          end_reason:
            "Queued execution failed to start: Claude Code CLI is unavailable: Claude config directory /tmp/.claude is empty.",
        },
      },
    ]);
    assert.deepEqual(completedSessions, [
      {
        status: "failed",
        last_summary:
          "Queued execution failed to start: Claude Code CLI is unavailable: Claude config directory /tmp/.claude is empty.",
      },
    ]);
    assert.match(
      sessionLogs.join("\n"),
      /Queued execution failed to start: Claude Code CLI is unavailable/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("docker-backed execution suppresses repeated raw Codex errors and reports one failure detail", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-execution-runtime-"));
  const worktreePath = join(tempDir, "workspace");
  const walleyBoardHome = join(tempDir, ".walleyboard-home");
  mkdirSync(worktreePath, { recursive: true });
  const previousWalleyBoardHome = process.env.WALLEYBOARD_HOME;

  const sessionLogs: string[] = [];
  const fakeChild = createFakeChildProcess();

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
    getSessionContainerInfo() {
      return {
        id: "container-session-1",
        name: "test-container-session-1",
        projectId: "project-1",
        ticketId: 14,
        worktreePath,
      };
    },
    spawnProcessInSession(_sessionId: string, command: string) {
      assert.equal(command, "codex");
      return fakeChild.child;
    },
  };
  const store = {
    appendSessionLog(_sessionId: string, line: string) {
      sessionLogs.push(line);
      return sessionLogs.length;
    },
    claimNextQueuedSession() {
      return undefined;
    },
    completeSession() {
      return createSession(worktreePath);
    },
    getRequestedChangeNote() {
      return undefined;
    },
    updateExecutionAttempt() {
      return undefined;
    },
    updateSessionAdapterSessionRef() {
      return createSession(worktreePath);
    },
    updateSessionStatus(_sessionId: string, _status: string, _summary: string) {
      return createSession(worktreePath);
    },
  };
  const eventHub = {
    publish() {},
  };

  try {
    process.env.WALLEYBOARD_HOME = walleyBoardHome;
    const adapterRegistry = new AgentAdapterRegistry([
      {
        id: "codex",
        label: "Codex",
        buildDraftRun() {
          throw new Error("draft runs are not used in this test");
        },
        buildExecutionRun(input) {
          return {
            command: "codex",
            args: [
              "exec",
              "--json",
              "--dangerously-bypass-approvals-and-sandbox",
              "--output-last-message",
              input.outputPath,
              "fake prompt",
            ],
            prompt: "fake prompt",
            outputPath: input.outputPath,
            dockerSpec: {
              imageTag: "example/codex:latest",
              dockerfilePath: "apps/backend/docker/codex-runtime.Dockerfile",
              homePath: "/home/walley",
              configMountPath: "/home/walley/.codex",
            },
          };
        },
        buildMergeConflictRun() {
          throw new Error("merge-conflict runs are not used in this test");
        },
        buildReviewRun() {
          throw new Error("review runs are not used in this test");
        },
        buildPullRequestBodyRun() {
          throw new Error("pull request body runs are not used in this test");
        },
        interpretOutputLine(line) {
          return {
            logLine: `[codex raw] ${line}`,
          };
        },
        parseDraftResult() {
          throw new Error("draft parsing is not used in this test");
        },
        formatExitReason(exitCode, _signal, rawOutput) {
          return rawOutput.length > 0
            ? `Codex exited with code ${exitCode}. Final output: ${rawOutput}`
            : `Codex exited with code ${exitCode}.`;
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

    const noisyLine =
      "ERROR codex_rollout::list reporting a stale rollout path /tmp/stale-rollout";

    fakeChild.emitStdout(`${noisyLine}\n${noisyLine}\n${noisyLine}\n`);
    fakeChild.emitExit({ exitCode: 1 });

    assert.equal(
      sessionLogs.some((line) => line.startsWith("[codex raw]")),
      false,
    );
    assert.deepEqual(
      sessionLogs.filter((line) => line.includes("stale rollout path")),
      [
        `[runtime failure] Codex exited with code 1. Final output: ${noisyLine}`,
      ],
    );
  } finally {
    if (previousWalleyBoardHome === undefined) {
      delete process.env.WALLEYBOARD_HOME;
    } else {
      process.env.WALLEYBOARD_HOME = previousWalleyBoardHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("startExecution resumes into merge recovery when the preserved worktree is mid-merge", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-execution-runtime-"));
  const worktreePath = join(tempDir, "workspace");
  const walleyBoardHome = join(tempDir, ".walleyboard-home");
  const previousWalleyBoardHome = process.env.WALLEYBOARD_HOME;

  execFileSync("git", ["init", worktreePath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  configureGitIdentity(worktreePath);
  runGit(worktreePath, ["checkout", "-b", "main"]);
  execFileSync(
    "bash",
    [
      "-lc",
      `printf 'base\n' > ${JSON.stringify(join(worktreePath, "story.txt"))}`,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  runGit(worktreePath, ["add", "story.txt"]);
  runGit(worktreePath, ["commit", "-m", "initial"]);
  runGit(worktreePath, ["checkout", "-b", "ticket-branch"]);
  execFileSync(
    "bash",
    [
      "-lc",
      `printf 'ticket change\n' > ${JSON.stringify(join(worktreePath, "story.txt"))}`,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  runGit(worktreePath, ["add", "story.txt"]);
  runGit(worktreePath, ["commit", "-m", "ticket change"]);
  runGit(worktreePath, ["checkout", "main"]);
  execFileSync(
    "bash",
    [
      "-lc",
      `printf 'main change\n' > ${JSON.stringify(join(worktreePath, "story.txt"))}`,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  runGit(worktreePath, ["add", "story.txt"]);
  runGit(worktreePath, ["commit", "-m", "main change"]);
  runGit(worktreePath, ["checkout", "ticket-branch"]);
  assert.throws(() => runGit(worktreePath, ["merge", "main"]));

  const sessionLogs: string[] = [];
  let buildExecutionRunCalls = 0;
  let mergeRunInput: {
    conflictedFiles: string[];
    failureMessage: string;
    stage: "merge" | "rebase";
    targetBranch: string;
  } | null = null;
  const { child } = createFakeChildProcess();

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
    getSessionContainerInfo() {
      return {
        id: "container-session-1",
        name: "test-container-session-1",
        projectId: "project-1",
        ticketId: 14,
        worktreePath,
      };
    },
    spawnProcessInSession(_sessionId: string, command: string) {
      assert.equal(command, "test-agent");
      return child;
    },
  };
  const store = {
    appendSessionLog(_sessionId: string, line: string) {
      sessionLogs.push(line);
      return sessionLogs.length;
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
    updateSessionAdapterSessionRef() {
      return createSession(worktreePath);
    },
  };
  const eventHub = {
    publish() {},
  };

  try {
    process.env.WALLEYBOARD_HOME = walleyBoardHome;
    const adapterRegistry = new AgentAdapterRegistry([
      {
        id: "codex",
        label: "Fake Agent",
        buildDraftRun() {
          throw new Error("draft runs are not used in this test");
        },
        buildExecutionRun() {
          buildExecutionRunCalls += 1;
          throw new Error(
            "execution run should not be used for merge recovery",
          );
        },
        buildMergeConflictRun(input) {
          mergeRunInput = {
            conflictedFiles: input.conflictedFiles,
            failureMessage: input.failureMessage,
            stage: input.stage,
            targetBranch: input.targetBranch,
          };
          return {
            command: "test-agent",
            args: ["merge-recovery", input.outputPath, "fake merge prompt"],
            prompt: "fake merge prompt",
            outputPath: input.outputPath,
            dockerSpec: {
              imageTag: "example/test-agent:latest",
              dockerfilePath: "apps/backend/docker/codex-runtime.Dockerfile",
              homePath: "/home/test-agent",
              configMountPath: "/home/test-agent/.fake-agent",
            },
          };
        },
        buildReviewRun() {
          throw new Error("review runs are not used in this test");
        },
        buildPullRequestBodyRun() {
          throw new Error("pull request body runs are not used in this test");
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
      ticket: {
        ...createTicket(),
        target_branch: "main",
        working_branch: "ticket-branch",
      },
      session: createSession(worktreePath),
    });

    assert.equal(buildExecutionRunCalls, 0);
    assert.deepEqual(mergeRunInput, {
      conflictedFiles: ["story.txt"],
      failureMessage:
        "Resume detected an unfinished git merge in the preserved worktree.",
      stage: "merge",
      targetBranch: "main",
    });
    assert.ok(
      sessionLogs.some((line) =>
        line.includes(
          "Completing the in-progress git merge before any new ticket work continues.",
        ),
      ),
    );
  } finally {
    if (previousWalleyBoardHome === undefined) {
      delete process.env.WALLEYBOARD_HOME;
    } else {
      process.env.WALLEYBOARD_HOME = previousWalleyBoardHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});
