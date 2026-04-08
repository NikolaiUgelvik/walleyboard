import assert from "node:assert/strict";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import type {
  DraftTicketState,
  Project,
  RepositoryConfig,
} from "../../../../../packages/contracts/src/index.js";
import {
  type AgentCliAdapter,
  AgentJsonParseError,
} from "../agent-adapters/types.js";
import type { DraftRefineSessionPersistence } from "../store.js";
import {
  type DraftAnalysisDeps,
  startDraftAnalysis,
} from "./draft-analysis.js";

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
      pid: 321,
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

function createProject(slug: string): Project {
  return {
    id: "project-1",
    slug,
    name: "Test Project",
    color: "#2563EB",
    agent_adapter: "claude-code",
    draft_analysis_agent_adapter: "claude-code",
    ticket_work_agent_adapter: "claude-code",
    execution_backend: "docker",
    disabled_mcp_servers: [],
    automatic_agent_review: false,
    automatic_agent_review_run_limit: 1,
    default_review_action: "direct_merge",
    default_target_branch: null,
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
  };
}

function createRepository(): RepositoryConfig {
  return {
    id: "repo-1",
    project_id: "project-1",
    name: "test-repo",
    path: "/tmp/test-repo",
    target_branch: "main",
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
    artifact_scope_id: "scope-1",
    title_draft: "Test draft",
    description_draft: "Original description",
    proposed_repo_id: "repo-1",
    confirmed_repo_id: "repo-1",
    proposed_ticket_type: "feature",
    proposed_acceptance_criteria: ["criterion 1"],
    wizard_status: "editing",
    split_proposal_summary: null,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
  };
}

const validAgentResult = {
  title: "Refined title",
  description: "Refined description",
  ticket_type: "feature",
  acceptance_criteria: ["refined criterion"],
  split_proposal_summary: null,
};

function createTestHarness() {
  const tempDir = mkdtempSync(join(tmpdir(), "walleyboard-draft-analysis-"));
  const oldWalleyboardHome = process.env.WALLEYBOARD_HOME;
  process.env.WALLEYBOARD_HOME = tempDir;

  const fakeChildren: ReturnType<typeof createFakeChildProcess>[] = [];
  let spawnCallCount = 0;

  const events: { type: string; payload: Record<string, unknown> }[] = [];
  const buildDraftRunCalls: Record<string, unknown>[] = [];
  let parseDraftResultCallCount = 0;
  let parseDraftResultBehavior: (callIndex: number) => unknown = () => {
    throw new Error("parseDraftResult not configured");
  };

  const draft = createDraft();
  const project = createProject("test-proj");
  const repository = createRepository();

  const sessionRepoActions: { method: string; args: unknown[] }[] = [];

  const adapter: AgentCliAdapter = {
    id: "claude-code",
    label: "Claude Code",
    buildDraftRun(input) {
      buildDraftRunCalls.push({
        adapterSessionRef: input.adapterSessionRef,
        retryAttempt: input.retryAttempt,
        instruction: input.instruction,
      });
      return {
        command: "claude",
        args: ["--json"],
        prompt: "test prompt",
        outputPath: input.outputPath,
        dockerSpec: {
          imageTag: "example/claude:latest",
          dockerfilePath: "apps/backend/docker/claude-code-runtime.Dockerfile",
          homePath: "/home/walley",
          configMountPath: "/home/walley/.claude",
        },
      };
    },
    buildExecutionRun() {
      throw new Error("not used");
    },
    buildMergeConflictRun() {
      throw new Error("not used");
    },
    buildReviewRun() {
      throw new Error("not used");
    },
    buildPullRequestBodyRun() {
      throw new Error("not used");
    },
    interpretOutputLine(line) {
      return { logLine: line, sessionRef: "sess-captured-ref" };
    },
    parseDraftResult<T>(_rawOutput: string, _schema: unknown): T {
      const callIndex = parseDraftResultCallCount++;
      return parseDraftResultBehavior(callIndex) as T;
    },
    formatExitReason(exitCode) {
      return `Claude Code exited with code ${exitCode}`;
    },
    resolveModelSelection() {
      return { model: null, reasoningEffort: null };
    },
  };

  const dockerRuntime = {
    ensureSessionContainer() {},
    getSessionContainerInfo() {
      return {
        id: "container-1",
        name: "test-container",
        projectId: "project-1",
        ticketId: 0,
        worktreePath: "/tmp/test-repo",
      };
    },
    spawnProcessInSession(
      _sessionId: string,
      _command: string,
      _args: string[],
    ) {
      const fake = createFakeChildProcess();
      fakeChildren.push(fake);
      spawnCallCount++;
      return fake.child;
    },
  } as never;

  const draftRefineSessionRepo: DraftRefineSessionPersistence = {
    create(input) {
      sessionRepoActions.push({ method: "create", args: [input] });
      return {
        id: "session-1",
        draft_id: input.draftId,
        project_id: input.projectId,
        repository_id: input.repositoryId,
        adapter_session_ref: null,
        attempt_count: 0,
        status: "running",
        created_at: "2026-04-01T00:00:00.000Z",
        last_attempt_at: "2026-04-01T00:00:00.000Z",
      };
    },
    recordAttempt(id, input) {
      sessionRepoActions.push({
        method: "recordAttempt",
        args: [id, input],
      });
      return {
        id,
        draft_id: "draft-1",
        project_id: "project-1",
        repository_id: "repo-1",
        adapter_session_ref: input.adapterSessionRef,
        attempt_count: input.attemptCount,
        status: "running",
        created_at: "2026-04-01T00:00:00.000Z",
        last_attempt_at: new Date().toISOString(),
      };
    },
    complete(id, status) {
      sessionRepoActions.push({ method: "complete", args: [id, status] });
    },
  };

  const activeDraftRuns = new Map<
    string,
    { kill(signal?: NodeJS.Signals): unknown }
  >();

  const store = {
    recordDraftEvent(
      _draftId: string,
      eventType: string,
      payload: Record<string, unknown>,
    ) {
      events.push({ type: eventType, payload });
      return {
        id: `event-${events.length}`,
        scope_type: "draft",
        scope_id: "draft-1",
        event_type: eventType,
        payload,
        created_at: new Date().toISOString(),
      };
    },
    getDraft() {
      return draft;
    },
    updateDraft(_draftId: string, input: Record<string, unknown>) {
      return { ...draft, ...input };
    },
  } as never;

  const deps: DraftAnalysisDeps = {
    activeDraftRuns,
    adapter,
    cleanupExecutionEnvironment() {},
    cleanupHostSidecar() {},
    dockerRuntime,
    draftRefineSessionRepo,
    eventHub: { publish() {} } as never,
    registerHostSidecar() {},
    store,
  };

  return {
    activeDraftRuns,
    buildDraftRunCalls,
    cleanup() {
      process.env.WALLEYBOARD_HOME = oldWalleyboardHome;
      rmSync(tempDir, { recursive: true, force: true });
    },
    deps,
    draft,
    events,
    fakeChildren,
    get spawnCallCount() {
      return spawnCallCount;
    },
    parseDraftResultCallCount: () => parseDraftResultCallCount,
    project,
    repository,
    sessionRepoActions,
    setParseDraftResultBehavior(fn: (callIndex: number) => unknown) {
      parseDraftResultBehavior = fn;
    },
    writeOutputForChild(childIndex: number) {
      const call = buildDraftRunCalls[childIndex];
      if (!call) {
        throw new Error(`No buildDraftRun call at index ${childIndex}`);
      }
    },
  };
}

test("retries on JSON parse failure and succeeds on second attempt", async () => {
  const h = createTestHarness();
  try {
    h.setParseDraftResultBehavior((callIndex) => {
      if (callIndex === 0) {
        throw new AgentJsonParseError("Claude Code");
      }
      return validAgentResult;
    });

    const promise = startDraftAnalysis(h.deps, {
      mode: "refine",
      draft: h.draft,
      project: h.project,
      repository: h.repository,
      instruction: "Focus on error handling.",
    });

    await new Promise((r) => setTimeout(r, 100));
    assert.equal(h.spawnCallCount, 1);

    h.fakeChildren[0]?.emitStdout('{"session_id":"sess-captured-ref"}\n');
    h.fakeChildren[0]?.emitExit({ exitCode: 0 });

    await new Promise((r) => setTimeout(r, 100));
    assert.equal(h.spawnCallCount, 2);

    h.fakeChildren[1]?.emitStdout("output\n");
    h.fakeChildren[1]?.emitExit({ exitCode: 0 });

    await promise;

    assert.equal(h.buildDraftRunCalls.length, 2);
    assert.equal(h.buildDraftRunCalls[0]?.adapterSessionRef, undefined);
    assert.equal(h.buildDraftRunCalls[0]?.retryAttempt, undefined);
    assert.equal(
      h.buildDraftRunCalls[1]?.adapterSessionRef,
      "sess-captured-ref",
    );
    assert.equal(h.buildDraftRunCalls[1]?.retryAttempt, 1);

    const retryEvent = h.events.find((e) => e.type === "draft.refine.retrying");
    assert.ok(retryEvent, "expected draft.refine.retrying event");
    assert.equal(retryEvent.payload.attempt_number, 1);
    assert.equal(retryEvent.payload.resumed, true);

    const completedEvent = h.events.find(
      (e) => e.type === "draft.refine.completed",
    );
    assert.ok(completedEvent, "expected draft.refine.completed event");
    assert.equal(completedEvent.payload.attempt_number, 1);
    assert.equal(completedEvent.payload.resumed, true);

    const recordAttemptAction = h.sessionRepoActions.find(
      (a) => a.method === "recordAttempt",
    );
    assert.ok(recordAttemptAction, "expected recordAttempt call");

    const completeAction = h.sessionRepoActions.find(
      (a) => a.method === "complete" && (a.args as string[])[1] === "completed",
    );
    assert.ok(completeAction, "expected complete('completed') call");
  } finally {
    h.cleanup();
  }
});

test("fails after exhausting all 3 retry attempts", async () => {
  const h = createTestHarness();
  try {
    h.setParseDraftResultBehavior(() => {
      throw new AgentJsonParseError("Claude Code");
    });

    const promise = startDraftAnalysis(h.deps, {
      mode: "refine",
      draft: h.draft,
      project: h.project,
      repository: h.repository,
    });

    await new Promise((r) => setTimeout(r, 100));
    assert.equal(h.spawnCallCount, 1);
    h.fakeChildren[0]?.emitStdout("line\n");
    h.fakeChildren[0]?.emitExit({ exitCode: 0 });

    await new Promise((r) => setTimeout(r, 100));
    assert.equal(h.spawnCallCount, 2);
    h.fakeChildren[1]?.emitStdout("line\n");
    h.fakeChildren[1]?.emitExit({ exitCode: 0 });

    await new Promise((r) => setTimeout(r, 100));
    assert.equal(h.spawnCallCount, 3);
    h.fakeChildren[2]?.emitStdout("line\n");
    h.fakeChildren[2]?.emitExit({ exitCode: 0 });

    await promise;

    const retryEvents = h.events.filter(
      (e) => e.type === "draft.refine.retrying",
    );
    assert.equal(retryEvents.length, 2);
    assert.equal(retryEvents[0]?.payload.attempt_number, 1);
    assert.equal(retryEvents[1]?.payload.attempt_number, 2);

    const failedEvent = h.events.find((e) => e.type === "draft.refine.failed");
    assert.ok(failedEvent, "expected draft.refine.failed event");
    assert.equal(failedEvent.payload.attempt_number, 2);

    assert.equal(h.buildDraftRunCalls.length, 3);

    const completeAction = h.sessionRepoActions.find(
      (a) => a.method === "complete" && (a.args as string[])[1] === "failed",
    );
    assert.ok(completeAction, "expected complete('failed') call");
  } finally {
    h.cleanup();
  }
});

test("stale first-attempt closures do not fire after retry handoff", async () => {
  const h = createTestHarness();
  try {
    h.setParseDraftResultBehavior((callIndex) => {
      if (callIndex === 0) {
        throw new AgentJsonParseError("Claude Code");
      }
      return validAgentResult;
    });

    const promise = startDraftAnalysis(h.deps, {
      mode: "refine",
      draft: h.draft,
      project: h.project,
      repository: h.repository,
    });

    await new Promise((r) => setTimeout(r, 100));
    h.fakeChildren[0]?.emitStdout("line\n");
    h.fakeChildren[0]?.emitExit({ exitCode: 0 });

    await new Promise((r) => setTimeout(r, 100));
    assert.equal(h.spawnCallCount, 2);

    h.fakeChildren[1]?.emitStdout("line\n");
    h.fakeChildren[1]?.emitExit({ exitCode: 0 });

    await promise;

    const failedEvents = h.events.filter(
      (e) => e.type === "draft.refine.failed",
    );
    assert.equal(
      failedEvents.length,
      0,
      "first attempt closures must not emit a spurious failed event after retry handoff",
    );
  } finally {
    h.cleanup();
  }
});
