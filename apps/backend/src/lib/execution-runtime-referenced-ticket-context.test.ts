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
} from "../../../../packages/contracts/src/index.js";

import { AgentAdapterRegistry } from "./agent-adapters/registry.js";
import type { PromptContextSection } from "./execution-runtime/types.js";
import { ExecutionRuntime } from "./execution-runtime.js";

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

function createDockerRuntime() {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();

  return {
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
        worktreePath: "/tmp/worktree",
      };
    },
    spawnProcessInSession() {
      return Object.assign(emitter, {
        kill() {},
        pid: 1234,
        stderr,
        stdin,
        stdout,
      }) as unknown as ChildProcessWithoutNullStreams;
    },
  };
}

function createAdapterRegistry(input: {
  onBuildExecutionRun(input: {
    executionMode: string;
    extraInstructions: PromptContextSection[];
    outputPath: string;
  }): void;
}) {
  return new AgentAdapterRegistry([
    {
      id: "codex",
      label: "Fake Agent",
      buildDraftRun() {
        throw new Error("draft runs are not used in this test");
      },
      buildExecutionRun(buildInput) {
        input.onBuildExecutionRun({
          executionMode: buildInput.executionMode,
          extraInstructions: buildInput.extraInstructions,
          outputPath: buildInput.outputPath,
        });
        return {
          command: "test-agent",
          args: [
            "exec",
            "--json",
            "--dangerously-bypass-approvals-and-sandbox",
            "--output-last-message",
            buildInput.outputPath,
            "fake prompt",
          ],
          prompt: "fake prompt",
          outputPath: buildInput.outputPath,
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
}

test("startExecution adds referenced ticket patch context before requested changes and resume guidance", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-execution-runtime-"));
  const worktreePath = join(tempDir, "workspace");
  const walleyBoardHome = join(tempDir, ".walleyboard-home");
  mkdirSync(worktreePath, { recursive: true });
  const previousWalleyBoardHome = process.env.WALLEYBOARD_HOME;

  let receivedExtraInstructions: PromptContextSection[] = [];
  const session = createSession(worktreePath);
  session.latest_requested_change_note_id = "note-1";
  const ticket = createTicket({
    ticket_references: [
      {
        ticket_id: 7,
        title: "Original dependency",
        status: "done",
      },
    ],
  });
  const referencedTicket = createTicket({
    id: 7,
    repo: "repo-2",
    session_id: null,
    working_branch: null,
    title: "Original dependency",
    status: "done",
  });
  const referencedRepository = createRepository(join(tempDir, "referenced"), {
    id: "repo-2",
    name: "referenced-repo",
  });

  const store = {
    appendSessionLog() {
      return 0;
    },
    getRequestedChangeNote(noteId: string) {
      return noteId === "note-1"
        ? {
            id: noteId,
            ticket_id: ticket.id,
            review_package_id: null,
            author_type: "user" as const,
            body: "Carry forward the dependency behavior.",
            created_at: "2026-04-01T00:00:00.000Z",
          }
        : undefined;
    },
    getReviewPackage(ticketId: number) {
      return ticketId === referencedTicket.id
        ? {
            id: "review-package-7",
            ticket_id: referencedTicket.id,
            session_id: "session-7",
            diff_ref: join(
              walleyBoardHome,
              "review-packages",
              "project-1",
              "ticket-7.patch",
            ),
            commit_refs: ["abc123"],
            change_summary: "Dependency change summary",
            validation_results: [],
            remaining_risks: [],
            created_at: "2026-04-01T00:05:00.000Z",
          }
        : undefined;
    },
    getRepository(repoId: string) {
      return repoId === referencedRepository.id
        ? referencedRepository
        : createRepository(tempDir);
    },
    getTicket(ticketId: number) {
      return ticketId === referencedTicket.id ? referencedTicket : undefined;
    },
    updateExecutionAttempt() {
      return undefined;
    },
    updateSessionStatus() {
      return session;
    },
  };

  try {
    process.env.WALLEYBOARD_HOME = walleyBoardHome;
    const runtime = new ExecutionRuntime({
      adapterRegistry: createAdapterRegistry({
        onBuildExecutionRun(input) {
          receivedExtraInstructions = input.extraInstructions;
        },
      }),
      dockerRuntime: createDockerRuntime() as never,
      eventHub: { publish() {} } as never,
      store: store as never,
    });

    runtime.startExecution({
      project: createProject(),
      repository: createRepository(tempDir),
      ticket,
      session,
      additionalInstruction: "Resume from the referenced patch.",
    });

    assert.deepEqual(
      receivedExtraInstructions.map((instruction) => instruction.label),
      ["Referenced ticket #7", "Latest requested changes", "Resume guidance"],
    );
    assert.match(
      receivedExtraInstructions[0]?.content ?? "",
      /Repository: referenced-repo/,
    );
    assert.match(
      receivedExtraInstructions[0]?.content ?? "",
      /Patch file: \/walleyboard-home\/review-packages\/project-1\/ticket-7\.patch/,
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

test("startExecution keeps referenced ticket context in plan mode when no patch artifact exists", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-execution-runtime-"));
  const worktreePath = join(tempDir, "workspace");
  const walleyBoardHome = join(tempDir, ".walleyboard-home");
  mkdirSync(worktreePath, { recursive: true });
  const previousWalleyBoardHome = process.env.WALLEYBOARD_HOME;

  let receivedExecutionMode: string | null = null;
  let receivedExtraInstructions: PromptContextSection[] = [];
  const session = {
    ...createSession(worktreePath),
    planning_enabled: true,
    plan_status: "drafting" as const,
  };
  const ticket = createTicket({
    ticket_references: [
      {
        ticket_id: 8,
        title: "Missing patch dependency",
        status: "ready",
      },
    ],
  });
  const referencedTicket = createTicket({
    id: 8,
    repo: "repo-2",
    session_id: null,
    working_branch: null,
    title: "Missing patch dependency",
    status: "ready",
  });
  const referencedRepository = createRepository(join(tempDir, "referenced"), {
    id: "repo-2",
    name: "referenced-repo",
  });

  const store = {
    appendSessionLog() {
      return 0;
    },
    getRequestedChangeNote() {
      return undefined;
    },
    getReviewPackage() {
      return undefined;
    },
    getRepository(repoId: string) {
      return repoId === referencedRepository.id
        ? referencedRepository
        : createRepository(tempDir);
    },
    getTicket(ticketId: number) {
      return ticketId === referencedTicket.id ? referencedTicket : undefined;
    },
    updateExecutionAttempt() {
      return undefined;
    },
    updateSessionStatus() {
      return session;
    },
  };

  try {
    process.env.WALLEYBOARD_HOME = walleyBoardHome;
    const runtime = new ExecutionRuntime({
      adapterRegistry: createAdapterRegistry({
        onBuildExecutionRun(input) {
          receivedExecutionMode = input.executionMode;
          receivedExtraInstructions = input.extraInstructions;
        },
      }),
      dockerRuntime: createDockerRuntime() as never,
      eventHub: { publish() {} } as never,
      store: store as never,
    });

    runtime.startExecution({
      project: createProject(),
      repository: createRepository(tempDir),
      ticket,
      session,
    });

    assert.equal(receivedExecutionMode, "plan");
    assert.deepEqual(
      receivedExtraInstructions.map((instruction) => instruction.label),
      ["Referenced ticket #8"],
    );
    assert.match(
      receivedExtraInstructions[0]?.content ?? "",
      /Patch file: No persisted patch artifact is available yet\./,
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
