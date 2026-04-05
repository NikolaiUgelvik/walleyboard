import assert from "node:assert/strict";
import test from "node:test";

import type {
  ExecutionAttempt,
  RepositoryConfig,
  ReviewPackage,
  ReviewRun,
  StructuredEvent,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import {
  buildImplementationPrompt,
  buildMergeConflictPrompt,
  buildPlanPrompt,
  buildPullRequestBodyPrompt,
  buildReviewPrompt,
} from "./shared-execution-prompts.js";

function createRepository(): RepositoryConfig {
  return {
    id: "repo-1",
    project_id: "project-1",
    name: "spacegame",
    path: "/tmp/spacegame",
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
    id: 5,
    project: "project-1",
    repo: "repo-1",
    artifact_scope_id: "artifact-scope-1",
    status: "ready",
    title: "Use referenced ticket patches during follow-up work",
    description: "A follow-up ticket should see the old ticket patch path.",
    ticket_type: "feature",
    acceptance_criteria: ["Mention the referenced ticket patch in context."],
    working_branch: "codex/ticket-5",
    target_branch: "main",
    linked_pr: null,
    session_id: "session-1",
    ticket_references: [
      {
        ticket_id: 3,
        title: "Previous dependency",
        status: "done",
      },
    ],
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
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
    validation_results: [
      {
        command_id: "validation-1",
        label: "npm test -- --run tests/main-menu.test.ts",
        status: "passed",
        started_at: "2026-04-01T00:00:00.000Z",
        ended_at: "2026-04-01T00:00:01.200Z",
        exit_code: 0,
        failure_overridden: false,
        summary: "Passed.",
        log_ref: null,
      },
    ],
    remaining_risks: ["Manual gameplay feel is still only code-verified."],
    created_at: "2026-04-01T00:10:00.000Z",
  };
}

function createExecutionAttempt(): ExecutionAttempt {
  return {
    id: "attempt-1",
    session_id: "session-1",
    attempt_number: 1,
    status: "completed",
    prompt_kind: "implementation",
    prompt: "Implement the pull request body generator.",
    pty_pid: null,
    started_at: "2026-04-01T00:00:00.000Z",
    ended_at: "2026-04-01T00:05:00.000Z",
    end_reason: null,
  };
}

function createReviewRun(): ReviewRun {
  return {
    id: "review-run-1",
    ticket_id: 5,
    review_package_id: "review-package-1",
    implementation_session_id: "session-1",
    status: "completed",
    adapter_session_ref: "review-session-1",
    prompt: "Review the implementation carefully.",
    report: {
      summary: "Looks good overall.",
      strengths: [
        "Clear separation between prompt building and orchestration.",
      ],
      actionable_findings: [
        {
          severity: "medium",
          category: "testing",
          title: "Missing fallback assertion",
          details: "There is no regression test for fallback behavior.",
          suggested_fix: "Add a service test that forces generation failure.",
        },
      ],
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
    entity_type: "pull_request",
    entity_id: "5",
    event_type: "pull_request.created",
    payload: {
      ticket_id: 5,
      number: 12,
      url: "https://github.com/acme/repo/pull/12",
    },
  };
}

test("buildPlanPrompt includes referenced ticket patch context", () => {
  const prompt = buildPlanPrompt(
    createTicket(),
    createRepository(),
    ["context7"],
    [
      {
        label: "Referenced ticket #3",
        content: [
          "Ticket: #3",
          "Title: Previous dependency",
          "Status: done",
          "Repository: spacegame",
          "Patch file: /walleyboard-home/review-packages/project-1/ticket-3.patch",
        ].join("\n"),
      },
    ],
  );

  assert.match(prompt, /## Objective/);
  assert.match(prompt, /## Ticket/);
  assert.match(prompt, /## Acceptance Checklist/);
  assert.match(prompt, /## Available MCPs/);
  assert.match(prompt, /- `context7` - enabled/);
  assert.match(prompt, /## Context/);
  assert.match(prompt, /### Referenced ticket #3/);
  assert.match(prompt, /## Guardrails/);
  assert.match(prompt, /## Required Output/);
  assert.ok(prompt.indexOf("## Objective") < prompt.indexOf("## Ticket"));
  assert.ok(
    prompt.indexOf("## Acceptance Checklist") < prompt.indexOf("## Context"),
  );
  assert.match(
    prompt,
    /Patch file: \/walleyboard-home\/review-packages\/project-1\/ticket-3\.patch/,
  );
});

test("buildImplementationPrompt includes referenced ticket patch context", () => {
  const prompt = buildImplementationPrompt(
    createTicket(),
    createRepository(),
    ["chrome-devtools", "context7"],
    [
      {
        label: "Referenced ticket #3",
        content: [
          "Ticket: #3",
          "Title: Previous dependency",
          "Status: done",
          "Repository: spacegame",
          "Patch file: /walleyboard-home/review-packages/project-1/ticket-3.patch",
        ].join("\n"),
      },
    ],
    "Use the prior ticket as the baseline.",
  );

  assert.match(prompt, /## Available MCPs/);
  assert.match(prompt, /- `chrome-devtools` - enabled/);
  assert.match(prompt, /- `context7` - enabled/);
  assert.match(prompt, /## Context/);
  assert.match(prompt, /### Approved Plan/);
  assert.match(prompt, /Use the prior ticket as the baseline\./);
  assert.match(prompt, /## Required Final Response/);
  assert.match(prompt, /Changed files:/);
  assert.match(prompt, /Validation run:/);
  assert.match(prompt, /Remaining risks:/);
  assert.match(prompt, /The change is committed as/);
  assert.match(prompt, /### Referenced ticket #3/);
  assert.match(
    prompt,
    /Patch file: \/walleyboard-home\/review-packages\/project-1\/ticket-3\.patch/,
  );
});

test("buildImplementationPrompt states when no MCPs are enabled", () => {
  const prompt = buildImplementationPrompt(
    createTicket(),
    createRepository(),
    [],
    [],
    null,
  );

  assert.match(prompt, /## Available MCPs/);
  assert.match(prompt, /No MCP servers are enabled for this project\./);
});

test("buildMergeConflictPrompt separates facts from completion criteria", () => {
  const prompt = buildMergeConflictPrompt({
    ticket: createTicket(),
    repository: createRepository(),
    enabledMcpServers: ["context7"],
    recoveryKind: "conflicts",
    targetBranch: "origin/main",
    stage: "merge",
    conflictedFiles: ["src/story.txt", "tests/story.test.ts"],
    failureMessage: "Automatic merge failed after target branch advanced.",
  });

  assert.match(prompt, /## Available MCPs/);
  assert.match(prompt, /- `context7` - enabled/);
  assert.match(prompt, /## Conflict Facts/);
  assert.match(prompt, /### Conflicted Files/);
  assert.match(prompt, /- `src\/story\.txt`/);
  assert.match(prompt, /- `tests\/story\.test\.ts`/);
  assert.match(prompt, /### Git Failure/);
  assert.match(prompt, /## Completion Checklist/);
});

test("buildMergeConflictPrompt states when no MCPs are enabled", () => {
  const prompt = buildMergeConflictPrompt({
    ticket: createTicket(),
    repository: createRepository(),
    enabledMcpServers: [],
    recoveryKind: "target_branch_advanced",
    targetBranch: "origin/main",
    stage: "merge",
    conflictedFiles: [],
    failureMessage: "Target branch moved forward during the final merge.",
  });

  assert.match(prompt, /## Available MCPs/);
  assert.match(prompt, /No MCP servers are enabled for this project\./);
});

test("buildReviewPrompt includes evidence blocks and fenced JSON output", () => {
  const prompt = buildReviewPrompt({
    repository: createRepository(),
    reviewPackage: createReviewPackage(),
    ticket: createTicket(),
  });

  assert.match(prompt, /## Review Goal/);
  assert.match(prompt, /## Ticket Intent/);
  assert.match(prompt, /## Evidence/);
  assert.match(prompt, /- Target branch: `main`/);
  assert.match(prompt, /- Diff patch: `\/tmp\/ticket-5\.patch`/);
  assert.match(prompt, /### Commits/);
  assert.match(prompt, /### Validation Results/);
  assert.match(prompt, /### Known Risks/);
  assert.match(prompt, /trust the repository state and git diff/i);
  assert.match(prompt, /## Output JSON/);
  assert.match(prompt, /```json/);
});

test("buildReviewPrompt omits empty validation and risk sections", () => {
  const prompt = buildReviewPrompt({
    repository: createRepository(),
    reviewPackage: {
      ...createReviewPackage(),
      commit_refs: [],
      validation_results: [],
      remaining_risks: [],
    },
    ticket: createTicket(),
  });

  assert.doesNotMatch(prompt, /### Commits/);
  assert.doesNotMatch(prompt, /### Validation Results/);
  assert.doesNotMatch(prompt, /### Known Risks/);
});

test("buildPullRequestBodyPrompt includes the full canonical timeline context and strict JSON contract", () => {
  const prompt = buildPullRequestBodyPrompt({
    attempts: [createExecutionAttempt()],
    baseBranch: "main",
    headBranch: "codex/ticket-5",
    patch: "diff --git a/src/app.ts b/src/app.ts\n+console.log('hi');",
    repository: createRepository(),
    reviewPackage: createReviewPackage(),
    reviewRuns: [createReviewRun()],
    session: {
      id: "session-1",
      plan_summary: "Plan the PR body generation work.",
      last_summary: "Implementation finished cleanly.",
    },
    sessionLogs: [
      "Starting execution attempt 1",
      "Created review package",
      "Prepared pull request metadata",
    ],
    ticket: createTicket(),
    ticketEvents: [createTicketEvent()],
  });

  assert.match(prompt, /## Pull Request Goal/);
  assert.match(prompt, /- Base branch: main/);
  assert.match(prompt, /- Head branch: codex\/ticket-5/);
  assert.match(prompt, /## Review Package/);
  assert.match(prompt, /### Validation Results/);
  assert.match(prompt, /Label: npm test -- --run tests\/main-menu\.test\.ts/);
  assert.match(prompt, /## Session Summary/);
  assert.match(prompt, /Plan the PR body generation work\./);
  assert.match(prompt, /Implementation finished cleanly\./);
  assert.match(prompt, /## Execution Attempts/);
  assert.match(prompt, /Implement the pull request body generator\./);
  assert.match(prompt, /## Review Runs/);
  assert.match(prompt, /Missing fallback assertion/);
  assert.match(prompt, /## Ticket Events/);
  assert.match(prompt, /pull_request\.created/);
  assert.match(prompt, /## Session Logs/);
  assert.match(prompt, /Prepared pull request metadata/);
  assert.match(prompt, /## Diff Patch/);
  assert.match(prompt, /\+console\.log\('hi'\);/);
  assert.match(prompt, /## Output JSON/);
  assert.match(prompt, /"body": "## Summary\\n- \.\.\."/);
});
