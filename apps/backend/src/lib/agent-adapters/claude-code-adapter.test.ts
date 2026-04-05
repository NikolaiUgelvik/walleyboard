import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { z } from "zod";

import type {
  DraftTicketState,
  ExecutionSession,
  Project,
  RepositoryConfig,
  ReviewPackage,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import { hasMeaningfulContent } from "../execution-runtime/helpers.js";
import {
  buildDraftShellCommand,
  ClaudeCodeAdapter,
  findLastTopLevelJsonStart,
  formatClaudeCodeExitReason,
  interpretClaudeCodeStreamJsonLine,
  parseClaudeCodeJsonResult,
  shellEscape,
  stripAnsi,
} from "./claude-code-adapter.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createProject(overrides: Partial<Project> = {}): Project {
  const project: Project = {
    id: "project-1",
    slug: "project-1",
    name: "Project",
    color: "#2563EB",
    agent_adapter: "claude-code",
    execution_backend: "docker",
    disabled_mcp_servers: [],
    automatic_agent_review: false,
    automatic_agent_review_run_limit: 1,
    default_review_action: "direct_merge",
    default_target_branch: "main",
    preview_start_command: null,
    pre_worktree_command: null,
    post_worktree_command: null,
    draft_analysis_model: null,
    draft_analysis_reasoning_effort: null,
    ticket_work_model: null,
    ticket_work_reasoning_effort: null,
    max_concurrent_sessions: 4,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
  return project;
}

function createRepository(): RepositoryConfig {
  return {
    id: "repo-1",
    project_id: "project-1",
    name: "repo",
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

function resolveWalleyBoardHomeForTest(): string {
  return process.env.WALLEYBOARD_HOME ?? join(homedir(), ".walleyboard");
}

function createWorkspaceOutputPath(name = "output.json"): string {
  return join(
    resolveWalleyBoardHomeForTest(),
    "agent-summaries",
    "project-1",
    name,
  );
}

function createTicket(): TicketFrontmatter {
  return {
    id: 42,
    project: "project-1",
    repo: "repo-1",
    artifact_scope_id: "artifact-scope-1",
    status: "in_progress",
    title: "Add ANSI stripping",
    description: "Strip ANSI codes from PTY output.",
    ticket_type: "feature",
    acceptance_criteria: ["ANSI codes are stripped before JSON.parse."],
    working_branch: "claude-code/ticket-42",
    target_branch: "main",
    linked_pr: null,
    session_id: "session-1",
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
  };
}

function createSession(): ExecutionSession {
  return {
    id: "session-1",
    ticket_id: 42,
    project_id: "project-1",
    repo_id: "repo-1",
    agent_adapter: "claude-code",
    worktree_path: "/tmp/test-repo",
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

const testCliCommand = "claude";

function createAdapter(command?: string): ClaudeCodeAdapter {
  return new ClaudeCodeAdapter(command ?? testCliCommand);
}

function createDraft(): DraftTicketState {
  return {
    id: "draft-1",
    project_id: "project-1",
    artifact_scope_id: "artifact-scope-1",
    title_draft: "Test",
    description_draft: "Description",
    proposed_repo_id: "repo-1",
    confirmed_repo_id: null,
    proposed_ticket_type: "feature",
    proposed_acceptance_criteria: [],
    wizard_status: "editing",
    split_proposal_summary: null,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
  };
}

function createReviewPackage(): ReviewPackage {
  return {
    id: "review-package-1",
    ticket_id: 42,
    session_id: "session-1",
    diff_ref: "/tmp/ticket-42.patch",
    commit_refs: ["61a4523a0f4259c5c06404ce5f0cabed1dc65f1c"],
    change_summary: "Adds ANSI stripping and related tests.",
    validation_results: [
      {
        command_id: "validation-1",
        label:
          "npm test -- --run apps/backend/src/lib/agent-adapters/claude-code-adapter.test.ts",
        status: "passed",
        started_at: "2026-04-01T00:00:00.000Z",
        ended_at: "2026-04-01T00:00:01.000Z",
        exit_code: 0,
        failure_overridden: false,
        summary: "Passed.",
        log_ref: null,
      },
    ],
    remaining_risks: [],
    created_at: "2026-04-01T00:10:00.000Z",
  };
}

function assertClaudeDockerSpec(
  dockerSpec: ReturnType<ClaudeCodeAdapter["buildDraftRun"]>["dockerSpec"],
): void {
  assert.deepEqual(dockerSpec, {
    imageTag: "walleyboard/codex-runtime:ubuntu-24.04-node-24",
    dockerfilePath: "apps/backend/docker/codex-runtime.Dockerfile",
    homePath: "/home/walley",
    configMountPath: "/home/walley/.claude",
  });
}

// ---------------------------------------------------------------------------
// shellEscape
// ---------------------------------------------------------------------------

test("shellEscape: empty string", () => {
  assert.equal(shellEscape(""), "''");
});

test("shellEscape: string with no special chars", () => {
  assert.equal(shellEscape("hello"), "'hello'");
});

test("shellEscape: string with single quotes", () => {
  assert.equal(shellEscape("it's here"), "'it'\\''s here'");
});

test("shellEscape: string with backticks is preserved", () => {
  assert.equal(shellEscape("echo `whoami`"), "'echo `whoami`'");
});

test("shellEscape: string with $() is preserved inside single quotes", () => {
  assert.equal(shellEscape("$(rm -rf /)"), "'$(rm -rf /)'");
});

test("shellEscape: string with newlines is preserved", () => {
  assert.equal(shellEscape("line1\nline2"), "'line1\nline2'");
});

test("shellEscape: NUL bytes are stripped", () => {
  assert.equal(shellEscape("ab\0cd"), "'abcd'");
});

test("shellEscape: NUL bytes and single quotes combined", () => {
  assert.equal(shellEscape("a\0b'c"), "'ab'\\''c'");
});

// ---------------------------------------------------------------------------
// stripAnsi
// ---------------------------------------------------------------------------

test("stripAnsi: clean string is unchanged", () => {
  assert.equal(stripAnsi("hello world"), "hello world");
});

test("stripAnsi: removes color codes", () => {
  assert.equal(stripAnsi("\x1b[31mred text\x1b[0m"), "red text");
});

test("stripAnsi: removes cursor movement", () => {
  assert.equal(stripAnsi("\x1b[2Jhello\x1b[H"), "hello");
});

test("stripAnsi: JSON with ANSI prefix is parseable after stripping", () => {
  const ansiPrefixed = '\x1b[0m{"type":"result","result":"ok"}';
  const stripped = stripAnsi(ansiPrefixed);
  const parsed = JSON.parse(stripped) as Record<string, unknown>;
  assert.equal(parsed.type, "result");
  assert.equal(parsed.result, "ok");
});

test("stripAnsi: multiple ANSI sequences in a string", () => {
  assert.equal(
    stripAnsi("\x1b[1m\x1b[32mgreen bold\x1b[0m normal"),
    "green bold normal",
  );
});

test("stripAnsi: removes private-mode CSI with ? prefix (show/hide cursor)", () => {
  assert.equal(stripAnsi("\x1b[?25hvisible\x1b[?25l"), "visible");
});

test("stripAnsi: removes tilde-terminated CSI (Delete, PgUp, F5)", () => {
  assert.equal(stripAnsi("\x1b[3~\x1b[5~\x1b[15~text"), "text");
});

test("stripAnsi: removes C1 CSI with ? prefix and ~ terminator", () => {
  assert.equal(stripAnsi("\x9b?25hvisible\x9b3~"), "visible");
});

// ---------------------------------------------------------------------------
// buildDraftShellCommand
// ---------------------------------------------------------------------------

test("buildDraftShellCommand: returns bash -c with cli path and redirect", () => {
  const result = buildDraftShellCommand(
    "/usr/local/bin/claude",
    ["-p", "hello world", "--output-format", "json"],
    "/tmp/output.json",
  );
  assert.equal(result.command, "bash");
  assert.equal(result.args.length, 2);
  assert.equal(result.args[0], "-c");
  const shellString = result.args[1] ?? "";
  assert.ok(shellString.includes("/usr/local/bin/claude"));
  assert.ok(shellString.includes(">"));
  assert.ok(shellString.includes("/tmp/output.json"));
});

test("buildDraftShellCommand: special characters in prompt are escaped", () => {
  const result = buildDraftShellCommand(
    "/usr/local/bin/claude",
    ["-p", "it's a $test"],
    "/tmp/out.json",
  );
  const shellString = result.args[1] ?? "";
  // The single quote in "it's" should be properly escaped.
  assert.ok(shellString.includes("'it'\\''s a $test'"));
});

// ---------------------------------------------------------------------------
// parseClaudeCodeJsonResult
// ---------------------------------------------------------------------------

const simpleSchema = z.object({ answer: z.string() });

test("parseClaudeCodeJsonResult: raw JSON string", () => {
  const result = parseClaudeCodeJsonResult('{"answer":"hello"}', simpleSchema);
  assert.equal(result.answer, "hello");
});

test("parseClaudeCodeJsonResult: wrapper object with result key", () => {
  const wrapper = JSON.stringify({
    result: '{"answer":"from wrapper"}',
  });
  const result = parseClaudeCodeJsonResult(wrapper, simpleSchema);
  assert.equal(result.answer, "from wrapper");
});

test("parseClaudeCodeJsonResult: wrapper with markdown-fenced result", () => {
  const wrapper = JSON.stringify({
    result: '```json\n{"answer":"fenced"}\n```',
  });
  const result = parseClaudeCodeJsonResult(wrapper, simpleSchema);
  assert.equal(result.answer, "fenced");
});

test("parseClaudeCodeJsonResult: stream-json NDJSON with result line", () => {
  const ndjson = [
    '{"type":"system","message":"starting"}',
    '{"type":"assistant","message":"working"}',
    '{"type":"result","result":"{\\"answer\\":\\"ndjson\\"}","cost_usd":0.01}',
  ].join("\n");
  const result = parseClaudeCodeJsonResult(ndjson, simpleSchema);
  assert.equal(result.answer, "ndjson");
});

test("parseClaudeCodeJsonResult: NDJSON result with markdown fences", () => {
  const innerJson = '{"answer":"fenced-ndjson"}';
  const ndjson = [
    '{"type":"system","message":"starting"}',
    JSON.stringify({
      type: "result",
      result: `\`\`\`json\n${innerJson}\n\`\`\``,
    }),
  ].join("\n");
  const result = parseClaudeCodeJsonResult(ndjson, simpleSchema);
  assert.equal(result.answer, "fenced-ndjson");
});

test("parseClaudeCodeJsonResult: empty input throws", () => {
  assert.throws(() => parseClaudeCodeJsonResult("", simpleSchema), {
    message: "Claude Code returned no JSON output.",
  });
});

test("parseClaudeCodeJsonResult: whitespace-only input throws", () => {
  assert.throws(() => parseClaudeCodeJsonResult("   \n  ", simpleSchema), {
    message: "Claude Code returned no JSON output.",
  });
});

test("parseClaudeCodeJsonResult: invalid JSON throws", () => {
  assert.throws(
    () => parseClaudeCodeJsonResult("not json at all", simpleSchema),
    { message: "Claude Code did not return valid JSON output." },
  );
});

test("parseClaudeCodeJsonResult: outer markdown fences are stripped", () => {
  const result = parseClaudeCodeJsonResult(
    '```json\n{"answer":"outer-fenced"}\n```',
    simpleSchema,
  );
  assert.equal(result.answer, "outer-fenced");
});

test("parseClaudeCodeJsonResult: hyphenated language tag in markdown fences is stripped", () => {
  const wrapper = JSON.stringify({
    result: '```objective-c\n{"answer":"hyphenated"}\n```',
  });
  const result = parseClaudeCodeJsonResult(wrapper, simpleSchema);
  assert.equal(result.answer, "hyphenated");
});

// ---------------------------------------------------------------------------
// findLastTopLevelJsonStart
// ---------------------------------------------------------------------------

test("findLastTopLevelJsonStart: returns -1 for text with no braces", () => {
  assert.equal(findLastTopLevelJsonStart("no braces here"), -1);
});

test("findLastTopLevelJsonStart: returns 0 for a single JSON object", () => {
  assert.equal(findLastTopLevelJsonStart('{"a":1}'), 0);
});

test("findLastTopLevelJsonStart: finds start of last top-level object after text", () => {
  const text = 'Some reasoning text {"answer":"correct"}';
  const idx = findLastTopLevelJsonStart(text);
  assert.equal(idx, 20);
  assert.equal(text.slice(idx), '{"answer":"correct"}');
});

test("findLastTopLevelJsonStart: handles nested braces correctly", () => {
  const text = '{"outer":{"inner":1}}';
  const idx = findLastTopLevelJsonStart(text);
  // Should find the outermost {, not the nested one.
  assert.equal(idx, 0);
});

test("findLastTopLevelJsonStart: with reasoning text containing nested JSON", () => {
  // Reasoning text includes a nested object reference, then the actual JSON.
  const text =
    'The config has {"nested":true} as a field. Here is the result: {"answer":"final"}';
  const idx = findLastTopLevelJsonStart(text);
  // Should find the last top-level JSON object.
  assert.equal(text.slice(idx), '{"answer":"final"}');
});

test("findLastTopLevelJsonStart: returns -1 for unbalanced braces", () => {
  assert.equal(findLastTopLevelJsonStart("{ unclosed"), -1);
});

test("findLastTopLevelJsonStart: known limitation - braces inside JSON string values cause fail-safe -1", () => {
  // The brace scanner does not track JSON string contexts, so a closing brace
  // inside a string value (e.g. "has } brace") causes the brace count to
  // become unbalanced. This is fail-safe: returning -1 means the caller falls
  // back to other parsing strategies rather than extracting corrupt JSON.
  assert.equal(findLastTopLevelJsonStart('text {"answer":"has } brace"}'), -1);
});

// ---------------------------------------------------------------------------
// parseClaudeCodeJsonResult: reasoning text + embedded JSON (F-2 tests)
// ---------------------------------------------------------------------------

test("parseClaudeCodeJsonResult: wrapper result with reasoning text before JSON", () => {
  const wrapper = JSON.stringify({
    result:
      'Let me analyze the requirements. Here is the result:\n\n{"answer":"from-reasoning"}',
  });
  const result = parseClaudeCodeJsonResult(wrapper, simpleSchema);
  assert.equal(result.answer, "from-reasoning");
});

test("parseClaudeCodeJsonResult: wrapper result with multiple JSON fragments in reasoning", () => {
  // The model mentions a JSON snippet in reasoning, then provides the actual answer.
  // The balanced-brace scan should find the last top-level object.
  const wrapper = JSON.stringify({
    result:
      'I considered {"answer":"wrong"} but decided on {"answer":"correct"}',
  });
  const result = parseClaudeCodeJsonResult(wrapper, simpleSchema);
  assert.equal(result.answer, "correct");
});

test("parseClaudeCodeJsonResult: wrapper result with nested JSON in reasoning does not extract sub-object", () => {
  // If the reasoning mentions an object with nested braces, the balanced scan
  // should not extract just the inner sub-object.
  const wrapper = JSON.stringify({
    result:
      'The config is {"outer":{"sub":"value"}} and then {"answer":"real"}',
  });
  const result = parseClaudeCodeJsonResult(wrapper, simpleSchema);
  assert.equal(result.answer, "real");
});

test("parseClaudeCodeJsonResult: NDJSON with reasoning text before embedded JSON", () => {
  const ndjson = [
    '{"type":"system","message":"starting"}',
    JSON.stringify({
      type: "result",
      result:
        'After analysis, here is the answer:\n{"answer":"ndjson-reasoning"}',
    }),
  ].join("\n");
  const result = parseClaudeCodeJsonResult(ndjson, simpleSchema);
  assert.equal(result.answer, "ndjson-reasoning");
});

test("parseClaudeCodeJsonResult: NDJSON with multiple JSON fragments in reasoning", () => {
  const ndjson = [
    '{"type":"system","message":"starting"}',
    JSON.stringify({
      type: "result",
      result:
        'I tried {"answer":"attempt1"} but the correct one is {"answer":"attempt2"}',
    }),
  ].join("\n");
  const result = parseClaudeCodeJsonResult(ndjson, simpleSchema);
  assert.equal(result.answer, "attempt2");
});

// ---------------------------------------------------------------------------
// F-3 scenario: planContent survives later assistant messages
// ---------------------------------------------------------------------------

test("interpretClaudeCodeStreamJsonLine: planContent is not overwritten by subsequent assistant text", () => {
  // Simulate the production scenario: ExitPlanMode event followed by
  // a regular assistant text event.
  const planText = "# Implementation Plan\n\n1. Create module\n2. Add tests";

  const exitPlanLine = JSON.stringify({
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "toolu_abc",
          name: "ExitPlanMode",
          input: { plan: planText },
        },
      ],
    },
  });

  const followUpLine = JSON.stringify({
    type: "assistant",
    message: {
      content: [
        {
          type: "text",
          text: "The plan is complete and covers all 6 acceptance criteria...",
        },
      ],
    },
  });

  const exitResult = interpretClaudeCodeStreamJsonLine(exitPlanLine);
  const followResult = interpretClaudeCodeStreamJsonLine(followUpLine);

  // ExitPlanMode should set planContent, not outputContent.
  assert.equal(exitResult.planContent, planText);
  assert.equal(exitResult.outputContent, undefined);

  // Follow-up should set outputContent only; planContent should be absent.
  assert.equal(
    followResult.outputContent,
    "The plan is complete and covers all 6 acceptance criteria...",
  );
  assert.equal(followResult.planContent, undefined);
});

// ---------------------------------------------------------------------------
// interpretClaudeCodeStreamJsonLine
// ---------------------------------------------------------------------------

test("interpretClaudeCodeStreamJsonLine: result event with cost", () => {
  const line = JSON.stringify({
    type: "result",
    result: "Task completed",
    cost_usd: 0.0123,
  });
  const result = interpretClaudeCodeStreamJsonLine(line);
  assert.ok(result.logLine.startsWith("[claude-code result]"));
  assert.ok(result.logLine.includes("Task completed"));
  assert.ok(result.logLine.includes("(cost: $0.0123)"));
});

test("interpretClaudeCodeStreamJsonLine: result event sets outputContent", () => {
  const line = JSON.stringify({
    type: "result",
    result: "Final summary of work done",
    cost_usd: 0.05,
  });
  const result = interpretClaudeCodeStreamJsonLine(line);
  assert.equal(result.outputContent, "Final summary of work done");
});

test("interpretClaudeCodeStreamJsonLine: assistant event sets outputContent for plan summary capture", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "thinking..." }] },
  });
  const result = interpretClaudeCodeStreamJsonLine(line);
  assert.equal(result.outputContent, "thinking...");
});

test("interpretClaudeCodeStreamJsonLine: assistant message with content blocks", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "Hello" },
        { type: "text", text: "World" },
      ],
    },
  });
  const result = interpretClaudeCodeStreamJsonLine(line);
  assert.ok(result.logLine.startsWith("[claude-code assistant]"));
  assert.ok(result.logLine.includes("Hello"));
  assert.ok(result.logLine.includes("World"));
  assert.equal(result.outputContent, "Hello\n\nWorld");
});

test("interpretClaudeCodeStreamJsonLine: ExitPlanMode tool_use extracts plan field as planContent", () => {
  const planText =
    "# Plan: Add status bar\n\n## Context\n\nThe TUI needs a persistent status bar.";
  const line = JSON.stringify({
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "I'll finalize the plan now." },
        {
          type: "tool_use",
          id: "toolu_abc",
          name: "ExitPlanMode",
          input: {
            allowedPrompts: [],
            plan: planText,
          },
        },
      ],
    },
  });
  const result = interpretClaudeCodeStreamJsonLine(line);
  // The plan field should be set as planContent (not outputContent) so
  // the runtime can track it separately from generic assistant text.
  assert.equal(result.planContent, planText);
  assert.equal(result.outputContent, undefined);
});

test("interpretClaudeCodeStreamJsonLine: ExitPlanMode without plan field falls back to text outputContent", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "Done planning." },
        {
          type: "tool_use",
          id: "toolu_abc",
          name: "ExitPlanMode",
          input: {},
        },
      ],
    },
  });
  const result = interpretClaudeCodeStreamJsonLine(line);
  assert.equal(result.outputContent, "Done planning.");
  assert.equal(result.planContent, undefined);
});

test("interpretClaudeCodeStreamJsonLine: system message", () => {
  const line = JSON.stringify({
    type: "system",
    message: "Initializing session",
  });
  const result = interpretClaudeCodeStreamJsonLine(line);
  assert.ok(result.logLine.startsWith("[claude-code system]"));
  assert.ok(result.logLine.includes("Initializing session"));
});

test("interpretClaudeCodeStreamJsonLine: empty line returns empty logLine", () => {
  const result = interpretClaudeCodeStreamJsonLine("");
  assert.equal(result.logLine, "");
});

test("interpretClaudeCodeStreamJsonLine: whitespace-only line returns empty logLine", () => {
  const result = interpretClaudeCodeStreamJsonLine("   \n  ");
  assert.equal(result.logLine, "");
});

test("interpretClaudeCodeStreamJsonLine: non-JSON raw text", () => {
  const result = interpretClaudeCodeStreamJsonLine("some raw output");
  assert.ok(result.logLine.startsWith("[claude-code raw]"));
  assert.ok(result.logLine.includes("some raw output"));
});

test("interpretClaudeCodeStreamJsonLine: ANSI-prefixed JSON is parsed correctly", () => {
  const json = JSON.stringify({
    type: "result",
    result: "done",
    cost_usd: 0.05,
  });
  const ansiPrefixed = `\x1b[0m${json}`;
  const result = interpretClaudeCodeStreamJsonLine(ansiPrefixed);
  assert.ok(result.logLine.startsWith("[claude-code result]"));
  assert.ok(result.logLine.includes("done"));
  assert.ok(result.logLine.includes("(cost: $0.0500)"));
});

test("interpretClaudeCodeStreamJsonLine: assistant with string content", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: { content: "plain string content" },
  });
  const result = interpretClaudeCodeStreamJsonLine(line);
  assert.ok(result.logLine.startsWith("[claude-code assistant]"));
  assert.ok(result.logLine.includes("plain string content"));
});

test("interpretClaudeCodeStreamJsonLine: assistant with string message", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: "simple message",
  });
  const result = interpretClaudeCodeStreamJsonLine(line);
  assert.ok(result.logLine.startsWith("[claude-code assistant]"));
  assert.ok(result.logLine.includes("simple message"));
});

test("interpretClaudeCodeStreamJsonLine: generic event type fallback", () => {
  const line = JSON.stringify({
    type: "tool_use",
    message: "Running command",
  });
  const result = interpretClaudeCodeStreamJsonLine(line);
  assert.ok(result.logLine.startsWith("[claude-code tool_use]"));
  assert.ok(result.logLine.includes("Running command"));
});

test("interpretClaudeCodeStreamJsonLine: ANSI-prefixed non-JSON goes through raw fallback with stripped text", () => {
  const result = interpretClaudeCodeStreamJsonLine(
    "\x1b[31mSome raw output\x1b[0m",
  );
  assert.ok(result.logLine.startsWith("[claude-code raw]"));
  assert.ok(result.logLine.includes("Some raw output"));
  assert.ok(!result.logLine.includes("\x1b"));
});

test("interpretClaudeCodeStreamJsonLine: sessionRef is undefined when session_id is absent", () => {
  const line = JSON.stringify({ type: "result", result: "ok" });
  const result = interpretClaudeCodeStreamJsonLine(line);
  assert.equal(result.sessionRef, undefined);
});

test("interpretClaudeCodeStreamJsonLine: sessionRef extracted from result event with session_id", () => {
  const line = JSON.stringify({
    type: "result",
    result: "Done",
    cost_usd: 0.01,
    session_id: "sess-abc-123",
  });
  const result = interpretClaudeCodeStreamJsonLine(line);
  assert.equal(result.sessionRef, "sess-abc-123");
});

test("interpretClaudeCodeStreamJsonLine: sessionRef extracted from system event with session_id", () => {
  const line = JSON.stringify({
    type: "system",
    message: "Initializing",
    session_id: "sess-xyz-456",
  });
  const result = interpretClaudeCodeStreamJsonLine(line);
  assert.equal(result.sessionRef, "sess-xyz-456");
});

test("interpretClaudeCodeStreamJsonLine: sessionRef extracted from assistant event with session_id", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: "Working on it",
    session_id: "sess-asst-789",
  });
  const result = interpretClaudeCodeStreamJsonLine(line);
  assert.equal(result.sessionRef, "sess-asst-789");
});

test("interpretClaudeCodeStreamJsonLine: sessionRef extracted from generic event with session_id", () => {
  const line = JSON.stringify({
    type: "tool_use",
    message: "Running command",
    session_id: "sess-tool-001",
  });
  const result = interpretClaudeCodeStreamJsonLine(line);
  assert.equal(result.sessionRef, "sess-tool-001");
});

test("interpretClaudeCodeStreamJsonLine: non-string session_id is ignored", () => {
  const line = JSON.stringify({
    type: "result",
    result: "ok",
    session_id: 12345,
  });
  const result = interpretClaudeCodeStreamJsonLine(line);
  assert.equal(result.sessionRef, undefined);
});

// ---------------------------------------------------------------------------
// formatClaudeCodeExitReason
// ---------------------------------------------------------------------------

test("formatClaudeCodeExitReason: exit code 0, no signal", () => {
  const result = formatClaudeCodeExitReason(0, null, "");
  assert.equal(result, "Claude Code exited with code 0.");
});

test("formatClaudeCodeExitReason: exit code null, signal SIGTERM", () => {
  const result = formatClaudeCodeExitReason(null, "SIGTERM", "");
  assert.equal(
    result,
    "Claude Code exited with unknown code and signal SIGTERM.",
  );
});

test("formatClaudeCodeExitReason: exit code 1 with raw output", () => {
  const result = formatClaudeCodeExitReason(1, null, "Something failed");
  assert.ok(result.startsWith("Claude Code exited with code 1."));
  assert.ok(result.includes("Final output: Something failed"));
});

test("formatClaudeCodeExitReason: exit code null, signal null, with output", () => {
  const result = formatClaudeCodeExitReason(null, null, "output text");
  assert.ok(result.startsWith("Claude Code exited with unknown code."));
  assert.ok(result.includes("Final output: output text"));
});

test("formatClaudeCodeExitReason: whitespace-only raw output is treated as empty", () => {
  const result = formatClaudeCodeExitReason(0, null, "   ");
  assert.equal(result, "Claude Code exited with code 0.");
});

// ---------------------------------------------------------------------------
// ClaudeCodeAdapter class methods
// ---------------------------------------------------------------------------

test("ClaudeCodeAdapter.resolveModelSelection: no model configured", () => {
  const adapter = createAdapter();
  const project = createProject();
  const selection = adapter.resolveModelSelection(project, "ticket");
  assert.equal(selection.model, null);
  assert.equal(selection.reasoningEffort, null);
});

test("ClaudeCodeAdapter.resolveModelSelection: with model set", () => {
  const adapter = createAdapter();
  const project = createProject({
    ticket_work_model: "claude-sonnet-4-5-20250514",
  });
  const selection = adapter.resolveModelSelection(project, "ticket");
  assert.equal(selection.model, "claude-sonnet-4-5-20250514");
  assert.equal(selection.reasoningEffort, null);
});

test("ClaudeCodeAdapter.resolveModelSelection: draft scope uses draft_analysis_model", () => {
  const adapter = createAdapter();
  const project = createProject({
    draft_analysis_model: "claude-haiku-3-5-20241022",
    ticket_work_model: "claude-sonnet-4-5-20250514",
  });
  const selection = adapter.resolveModelSelection(project, "draft");
  assert.equal(selection.model, "claude-haiku-3-5-20241022");
});

test("ClaudeCodeAdapter.buildDraftRun: refine mode structure", () => {
  const adapter = createAdapter();
  const run = adapter.buildDraftRun({
    draft: createDraft(),
    mode: "refine",
    outputPath: createWorkspaceOutputPath(),
    project: createProject(),
    repository: createRepository(),
    useDockerRuntime: true,
  });
  assert.equal(run.command, "bash");
  assert.equal(run.args[0], "-c");
  const shellCmd = run.args[1] ?? "";
  assert.ok(shellCmd.includes("claude"));
  assert.ok(shellCmd.includes("--output-format"));
  assert.ok(shellCmd.includes("--permission-mode"));
  assert.ok(shellCmd.includes("plan"));
  assert.ok(!shellCmd.includes("dangerously-skip-permissions"));
  assert.equal(
    run.outputPath,
    "/walleyboard-home/agent-summaries/project-1/output.json",
  );
  assertClaudeDockerSpec(run.dockerSpec);
});

test("ClaudeCodeAdapter.buildDraftRun: questions mode structure", () => {
  const adapter = createAdapter();
  const run = adapter.buildDraftRun({
    draft: createDraft(),
    mode: "questions",
    outputPath: createWorkspaceOutputPath(),
    project: createProject(),
    repository: createRepository(),
    useDockerRuntime: true,
  });
  assert.equal(run.command, "bash");
  assert.ok((run.args[1] ?? "").includes("claude"));
  assertClaudeDockerSpec(run.dockerSpec);
});

test("ClaudeCodeAdapter.buildExecutionRun: plan mode", () => {
  const adapter = createAdapter();
  const run = adapter.buildExecutionRun({
    executionMode: "plan",
    extraInstructions: [],
    outputPath: createWorkspaceOutputPath(),
    planSummary: null,
    project: createProject(),
    repository: createRepository(),
    session: createSession(),
    ticket: createTicket(),
    useDockerRuntime: true,
  });
  assert.equal(run.command, testCliCommand);
  assert.ok(run.args.includes("--output-format"));
  assert.ok(run.args.includes("--permission-mode"));
  assert.equal(run.args[run.args.indexOf("--permission-mode") + 1], "plan");
  assert.ok(!run.args.includes("--dangerously-skip-permissions"));
  assertClaudeDockerSpec(run.dockerSpec);
});

test("ClaudeCodeAdapter.buildExecutionRun: implementation mode", () => {
  const adapter = createAdapter();
  const run = adapter.buildExecutionRun({
    executionMode: "implementation",
    extraInstructions: [],
    outputPath: createWorkspaceOutputPath(),
    planSummary: null,
    project: createProject(),
    repository: createRepository(),
    session: createSession(),
    ticket: createTicket(),
    useDockerRuntime: true,
  });
  assert.equal(run.command, testCliCommand);
  assert.ok(run.args.includes("--permission-mode"));
  assert.equal(run.args[run.args.indexOf("--permission-mode") + 1], "dontAsk");
  assert.ok(run.args.includes("--allowedTools"));
  assert.ok(!run.args.includes("--dangerously-skip-permissions"));
  assertClaudeDockerSpec(run.dockerSpec);
});

test("ClaudeCodeAdapter.buildExecutionRun: includes --resume when adapter_session_ref is set", () => {
  const adapter = createAdapter();
  const session = createSession();
  session.adapter_session_ref = "sess-resume-abc";
  const run = adapter.buildExecutionRun({
    executionMode: "implementation",
    extraInstructions: [],
    outputPath: createWorkspaceOutputPath(),
    planSummary: null,
    project: createProject(),
    repository: createRepository(),
    session,
    ticket: createTicket(),
    useDockerRuntime: true,
  });
  const resumeIdx = run.args.indexOf("--resume");
  assert.ok(resumeIdx >= 0, "Expected --resume flag in args");
  assert.equal(run.args[resumeIdx + 1], "sess-resume-abc");
  // --resume should come before -p
  const pIdx = run.args.indexOf("-p");
  assert.ok(resumeIdx < pIdx, "Expected --resume before -p");
});

test("ClaudeCodeAdapter.buildExecutionRun: no --resume when adapter_session_ref is null", () => {
  const adapter = createAdapter();
  const run = adapter.buildExecutionRun({
    executionMode: "implementation",
    extraInstructions: [],
    outputPath: createWorkspaceOutputPath(),
    planSummary: null,
    project: createProject(),
    repository: createRepository(),
    session: createSession(),
    ticket: createTicket(),
    useDockerRuntime: true,
  });
  assert.ok(
    !run.args.includes("--resume"),
    "Should not include --resume when adapter_session_ref is null",
  );
});

test("ClaudeCodeAdapter.buildExecutionRun: no --resume when adapter_session_ref is empty string", () => {
  const adapter = createAdapter();
  const session = createSession();
  session.adapter_session_ref = "   ";
  const run = adapter.buildExecutionRun({
    executionMode: "implementation",
    extraInstructions: [],
    outputPath: createWorkspaceOutputPath(),
    planSummary: null,
    project: createProject(),
    repository: createRepository(),
    session,
    ticket: createTicket(),
    useDockerRuntime: true,
  });
  assert.ok(
    !run.args.includes("--resume"),
    "Should not include --resume when adapter_session_ref is whitespace",
  );
});

test("ClaudeCodeAdapter.buildExecutionRun: permission modes by execution type", () => {
  const adapter = createAdapter();
  for (const mode of ["plan", "implementation"] as const) {
    const run = adapter.buildExecutionRun({
      executionMode: mode,
      extraInstructions: [],
      outputPath: createWorkspaceOutputPath(),
      planSummary: null,
      project: createProject(),
      repository: createRepository(),
      session: createSession(),
      ticket: createTicket(),
      useDockerRuntime: true,
    });
    assert.ok(
      run.args.includes("--permission-mode"),
      `Expected --permission-mode for ${mode} mode`,
    );
    assert.ok(
      !run.args.includes("--dangerously-skip-permissions"),
      `Should not use --dangerously-skip-permissions for ${mode} mode`,
    );
    const permIdx = run.args.indexOf("--permission-mode");
    const expectedMode = mode === "plan" ? "plan" : "dontAsk";
    assert.equal(
      run.args[permIdx + 1],
      expectedMode,
      `Expected permission-mode ${expectedMode} for ${mode} mode`,
    );
  }
});

test("ClaudeCodeAdapter.buildMergeConflictRun: structure", () => {
  const adapter = createAdapter();
  const run = adapter.buildMergeConflictRun({
    conflictedFiles: ["src/index.ts"],
    failureMessage: "CONFLICT in src/index.ts",
    outputPath: createWorkspaceOutputPath(),
    project: createProject(),
    recoveryKind: "conflicts",
    repository: createRepository(),
    session: createSession(),
    stage: "rebase",
    targetBranch: "main",
    ticket: createTicket(),
    useDockerRuntime: true,
  });
  assert.equal(run.command, testCliCommand);
  assert.ok(run.args.includes("--permission-mode"));
  assert.equal(run.args[run.args.indexOf("--permission-mode") + 1], "dontAsk");
  assert.ok(run.args.includes("--allowedTools"));
  assert.ok(!run.args.includes("--dangerously-skip-permissions"));
  assertClaudeDockerSpec(run.dockerSpec);
});

test("ClaudeCodeAdapter.buildMergeConflictRun: includes --resume when adapter_session_ref is set", () => {
  const adapter = createAdapter();
  const session = createSession();
  session.adapter_session_ref = "sess-merge-def";
  const run = adapter.buildMergeConflictRun({
    conflictedFiles: ["src/index.ts"],
    failureMessage: "CONFLICT in src/index.ts",
    outputPath: createWorkspaceOutputPath(),
    project: createProject(),
    recoveryKind: "conflicts",
    repository: createRepository(),
    session,
    stage: "rebase",
    targetBranch: "main",
    ticket: createTicket(),
    useDockerRuntime: true,
  });
  const resumeIdx = run.args.indexOf("--resume");
  assert.ok(resumeIdx >= 0, "Expected --resume flag in args");
  assert.equal(run.args[resumeIdx + 1], "sess-merge-def");
  // --resume should come before -p
  const pIdx = run.args.indexOf("-p");
  assert.ok(resumeIdx < pIdx, "Expected --resume before -p");
});

test("ClaudeCodeAdapter.buildMergeConflictRun: no --resume when adapter_session_ref is null", () => {
  const adapter = createAdapter();
  const run = adapter.buildMergeConflictRun({
    conflictedFiles: ["src/index.ts"],
    failureMessage: "CONFLICT in src/index.ts",
    outputPath: createWorkspaceOutputPath(),
    project: createProject(),
    recoveryKind: "conflicts",
    repository: createRepository(),
    session: createSession(),
    stage: "rebase",
    targetBranch: "main",
    ticket: createTicket(),
    useDockerRuntime: true,
  });
  assert.ok(
    !run.args.includes("--resume"),
    "Should not include --resume when adapter_session_ref is null",
  );
});

test("ClaudeCodeAdapter.buildMergeConflictRun: merge stage", () => {
  const adapter = createAdapter();
  const run = adapter.buildMergeConflictRun({
    conflictedFiles: [],
    failureMessage: "Merge conflict",
    outputPath: createWorkspaceOutputPath(),
    project: createProject(),
    recoveryKind: "conflicts",
    repository: createRepository(),
    session: createSession(),
    stage: "merge",
    targetBranch: "main",
    ticket: createTicket(),
    useDockerRuntime: true,
  });
  assert.equal(run.command, testCliCommand);
  assert.ok(run.args.includes("--output-format"));
  assert.ok(run.args.includes("stream-json"));
});

test("ClaudeCodeAdapter: all run builders return Docker specs", () => {
  const adapter = createAdapter();
  const draftRun = adapter.buildDraftRun({
    draft: createDraft(),
    mode: "refine",
    outputPath: createWorkspaceOutputPath("o.json"),
    project: createProject(),
    repository: createRepository(),
    useDockerRuntime: true,
  });
  const execRun = adapter.buildExecutionRun({
    executionMode: "plan",
    extraInstructions: [],
    outputPath: createWorkspaceOutputPath("o.json"),
    planSummary: null,
    project: createProject(),
    repository: createRepository(),
    session: createSession(),
    ticket: createTicket(),
    useDockerRuntime: true,
  });
  const mergeRun = adapter.buildMergeConflictRun({
    conflictedFiles: [],
    failureMessage: "fail",
    outputPath: createWorkspaceOutputPath("o.json"),
    project: createProject(),
    recoveryKind: "conflicts",
    repository: createRepository(),
    session: createSession(),
    stage: "rebase",
    targetBranch: "main",
    ticket: createTicket(),
    useDockerRuntime: true,
  });
  assertClaudeDockerSpec(draftRun.dockerSpec);
  assertClaudeDockerSpec(execRun.dockerSpec);
  assertClaudeDockerSpec(mergeRun.dockerSpec);
});

test("ClaudeCodeAdapter rejects host execution paths", () => {
  const adapter = createAdapter();
  assert.throws(
    () =>
      adapter.buildExecutionRun({
        executionMode: "plan",
        extraInstructions: [],
        outputPath: createWorkspaceOutputPath(),
        planSummary: null,
        project: createProject(),
        repository: createRepository(),
        session: createSession(),
        ticket: createTicket(),
        useDockerRuntime: false,
      }),
    /Host execution is no longer supported for Claude Code/,
  );
});

test("ClaudeCodeAdapter.interpretOutputLine delegates to interpretClaudeCodeStreamJsonLine", () => {
  const adapter = createAdapter();
  const line = JSON.stringify({ type: "system", message: "test" });
  const result = adapter.interpretOutputLine(line);
  assert.ok(result.logLine.includes("[claude-code system]"));
  assert.ok(result.logLine.includes("test"));
});

test("ClaudeCodeAdapter.formatExitReason delegates to formatClaudeCodeExitReason", () => {
  const adapter = createAdapter();
  const result = adapter.formatExitReason(0, null, "");
  assert.equal(result, "Claude Code exited with code 0.");
});

// ---------------------------------------------------------------------------
// --verbose is required alongside --output-format stream-json in print mode
// ---------------------------------------------------------------------------

test("ClaudeCodeAdapter.buildExecutionRun: includes --verbose with stream-json", () => {
  const adapter = createAdapter();
  const run = adapter.buildExecutionRun({
    executionMode: "plan",
    extraInstructions: [],
    outputPath: createWorkspaceOutputPath(),
    planSummary: null,
    project: createProject(),
    repository: createRepository(),
    session: createSession(),
    ticket: createTicket(),
    useDockerRuntime: true,
  });
  assert.ok(run.args.includes("stream-json"), "should use stream-json format");
  assert.ok(
    run.args.includes("--verbose"),
    "stream-json in print mode requires --verbose",
  );
});

test("ClaudeCodeAdapter.buildMergeConflictRun: includes --verbose with stream-json", () => {
  const adapter = createAdapter();
  const run = adapter.buildMergeConflictRun({
    conflictedFiles: [],
    failureMessage: "fail",
    outputPath: createWorkspaceOutputPath(),
    project: createProject(),
    recoveryKind: "conflicts",
    repository: createRepository(),
    session: createSession(),
    stage: "rebase",
    targetBranch: "main",
    ticket: createTicket(),
    useDockerRuntime: true,
  });
  assert.ok(run.args.includes("stream-json"), "should use stream-json format");
  assert.ok(
    run.args.includes("--verbose"),
    "stream-json in print mode requires --verbose",
  );
});

test("ClaudeCodeAdapter.buildReviewRun uses read-only permissions and the shared review prompt", () => {
  const adapter = createAdapter();
  const run = adapter.buildReviewRun({
    outputPath: createWorkspaceOutputPath("review.json"),
    project: createProject(),
    repository: createRepository(),
    reviewPackage: createReviewPackage(),
    session: createSession(),
    ticket: createTicket(),
    useDockerRuntime: true,
  });

  assert.equal(run.command, "bash");
  assert.match(run.args[1] ?? "", /'--permission-mode' 'plan'/);
  assert.match(run.prompt, /## Review Goal/);
  assert.match(run.prompt, /## Evidence/);
  assert.match(run.prompt, /## Output JSON/);
});

// ---------------------------------------------------------------------------
// Runtime-level plan content priority (F-2: tests the lastPlanContent ??
// lastOutputContent logic that execution-runtime.ts uses to pick the final
// summary). This simulates processAdapterLine without spinning up the full
// runtime, using the same interpreted-line shapes the adapter produces.
// ---------------------------------------------------------------------------

test("runtime plan priority: planContent is preferred over later outputContent", () => {
  // Simulate the sequence that caused the "plan overwritten" bug:
  //   1. ExitPlanMode tool_use -> sets planContent
  //   2. Follow-up assistant text -> sets outputContent
  // The runtime should prefer planContent.

  const planText = "## Plan\n1. Refactor module A\n2. Add tests for module B";
  const followUpText =
    "The plan is complete and covers all 6 acceptance criteria.";

  // Build interpreted lines matching what the adapter produces.
  const exitPlanLine = {
    logLine: "[plan] ExitPlanMode",
    planContent: planText,
    outputContent: undefined as string | undefined,
  };
  const assistantLine = {
    logLine: followUpText,
    planContent: undefined as string | undefined,
    outputContent: followUpText,
  };

  // Replay the same tracking logic as processAdapterLine in execution-runtime.
  let lastPlanContent: string | undefined;
  let lastOutputContent: string | undefined;

  for (const interpreted of [exitPlanLine, assistantLine]) {
    if (hasMeaningfulContent(interpreted.planContent)) {
      lastPlanContent = interpreted.planContent;
    }
    if (hasMeaningfulContent(interpreted.outputContent)) {
      lastOutputContent = interpreted.outputContent;
    }
  }

  const bestOutputContent = lastPlanContent ?? lastOutputContent;
  assert.equal(
    bestOutputContent,
    planText,
    "plan content should take priority over follow-up assistant text",
  );
  // Verify that outputContent was also tracked (it just loses priority).
  assert.equal(lastOutputContent, followUpText);
});

test("runtime plan priority: falls back to outputContent when no planContent exists", () => {
  // When no ExitPlanMode event fires, the runtime should use outputContent.
  const assistantText = "Here is the implementation summary.";

  const assistantLine = {
    logLine: assistantText,
    planContent: undefined as string | undefined,
    outputContent: assistantText,
  };

  let lastPlanContent: string | undefined;
  let lastOutputContent: string | undefined;

  for (const interpreted of [assistantLine]) {
    if (hasMeaningfulContent(interpreted.planContent)) {
      lastPlanContent = interpreted.planContent;
    }
    if (hasMeaningfulContent(interpreted.outputContent)) {
      lastOutputContent = interpreted.outputContent;
    }
  }

  const bestOutputContent = lastPlanContent ?? lastOutputContent;
  assert.equal(
    bestOutputContent,
    assistantText,
    "should fall back to outputContent when no plan was captured",
  );
});
