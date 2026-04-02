import assert from "node:assert/strict";
import test from "node:test";

import type {
  DraftTicketState,
  ExecutionSession,
  Project,
  TicketFrontmatter,
} from "../../../../packages/contracts/src/index.js";

import { deriveInboxItems } from "./inbox-items.js";

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    slug: "project-1",
    name: "Project One",
    agent_adapter: "codex",
    execution_backend: "host",
    default_target_branch: "main",
    pre_worktree_command: null,
    post_worktree_command: null,
    draft_analysis_model: null,
    draft_analysis_reasoning_effort: null,
    ticket_work_model: null,
    ticket_work_reasoning_effort: null,
    max_concurrent_sessions: 4,
    created_at: "2026-04-01T10:00:00.000Z",
    updated_at: "2026-04-01T10:00:00.000Z",
    ...overrides,
  };
}

function createTicket(
  overrides: Partial<TicketFrontmatter> = {},
): TicketFrontmatter {
  return {
    id: 1,
    project: "project-1",
    repo: "repo-1",
    artifact_scope_id: "artifact-scope-1",
    status: "ready",
    title: "Ticket title",
    description: "Ticket description",
    ticket_type: "feature",
    acceptance_criteria: ["First criterion"],
    working_branch: null,
    target_branch: "main",
    linked_pr: null,
    session_id: null,
    created_at: "2026-04-01T10:00:00.000Z",
    updated_at: "2026-04-01T10:00:00.000Z",
    ...overrides,
  };
}

function createDraft(
  overrides: Partial<DraftTicketState> = {},
): DraftTicketState {
  return {
    id: "draft-1",
    project_id: "project-1",
    artifact_scope_id: "artifact-scope-1",
    title_draft: "Draft title",
    description_draft: "Draft description",
    proposed_repo_id: "repo-1",
    confirmed_repo_id: null,
    proposed_ticket_type: "feature",
    proposed_acceptance_criteria: ["First criterion"],
    wizard_status: "editing",
    split_proposal_summary: null,
    created_at: "2026-04-01T10:00:00.000Z",
    updated_at: "2026-04-01T10:00:00.000Z",
    ...overrides,
  };
}

function createSession(
  overrides: Partial<ExecutionSession> = {},
): ExecutionSession {
  return {
    id: "session-1",
    ticket_id: 1,
    project_id: "project-1",
    repo_id: "repo-1",
    agent_adapter: "codex",
    worktree_path: "/tmp/worktree-1",
    adapter_session_ref: null,
    status: "awaiting_input",
    planning_enabled: false,
    plan_status: "not_requested",
    plan_summary: null,
    current_attempt_id: "attempt-1",
    latest_requested_change_note_id: null,
    latest_review_package_id: null,
    queue_entered_at: "2026-04-01T10:00:00.000Z",
    started_at: "2026-04-01T10:01:00.000Z",
    completed_at: null,
    last_heartbeat_at: "2026-04-01T10:02:00.000Z",
    last_summary: "Needs input from the operator.",
    ...overrides,
  };
}

test("derives mixed-project inbox items with project context and newest-first ordering", () => {
  const projects = [
    createProject(),
    createProject({
      id: "project-2",
      slug: "project-2",
      name: "Project Two",
    }),
  ];
  const tickets = [
    createTicket({
      id: 7,
      project: "project-1",
      status: "review",
      title: "Polish the review flow",
      session_id: "session-review",
      updated_at: "2026-04-01T10:00:00.000Z",
    }),
    createTicket({
      id: 8,
      project: "project-2",
      status: "in_progress",
      title: "Handle project switching from inbox",
      session_id: "session-input",
      updated_at: "2026-04-01T11:00:00.000Z",
    }),
    createTicket({
      id: 9,
      project: "project-2",
      status: "done",
      title: "Already finished work",
      session_id: "session-done",
      updated_at: "2026-04-01T12:00:00.000Z",
    }),
  ];
  const sessionsById = new Map<string, ExecutionSession>([
    [
      "session-review",
      createSession({
        id: "session-review",
        ticket_id: 7,
        status: "completed",
        last_summary: "Ready for review.",
      }),
    ],
    [
      "session-input",
      createSession({
        id: "session-input",
        ticket_id: 8,
        project_id: "project-2",
        status: "awaiting_input",
        last_summary: "Need a decision on the project jump behavior.",
      }),
    ],
    [
      "session-done",
      createSession({
        id: "session-done",
        ticket_id: 9,
        project_id: "project-2",
        status: "completed",
        last_summary: "Merged already.",
      }),
    ],
  ]);

  const items = deriveInboxItems({
    drafts: [],
    projects,
    tickets,
    sessionsById,
  });

  assert.deepEqual(
    items.map((item) => item.title),
    ["Input needed for ticket #8", "Review ready for ticket #7"],
  );
  assert.deepEqual(
    items.map((item) => ({
      actionLabel: item.actionLabel,
      projectId: item.projectId,
      projectName: item.projectName,
      targetId: item.targetId,
      targetKind: item.targetKind,
    })),
    [
      {
        actionLabel: "Open Session",
        projectId: "project-2",
        projectName: "Project Two",
        targetId: "session-input",
        targetKind: "session",
      },
      {
        actionLabel: "Open Review",
        projectId: "project-1",
        projectName: "Project One",
        targetId: "session-review",
        targetKind: "session",
      },
    ],
  );
  assert.equal(
    items[0]?.message,
    "Need a decision on the project jump behavior.",
  );
});

test("prefers plan feedback summaries for awaiting-feedback sessions", () => {
  const items = deriveInboxItems({
    drafts: [],
    projects: [createProject()],
    tickets: [
      createTicket({
        id: 14,
        status: "in_progress",
        session_id: "session-plan",
        title: "Implement global inbox",
      }),
    ],
    sessionsById: new Map([
      [
        "session-plan",
        createSession({
          id: "session-plan",
          ticket_id: 14,
          plan_status: "awaiting_feedback",
          plan_summary: "Confirm the cross-project switch before continuing.",
          last_summary: "This should not be shown.",
        }),
      ],
    ]),
  });

  assert.deepEqual(items, [
    {
      key: "session-14",
      color: "yellow",
      title: "Plan feedback needed for ticket #14",
      message: "Confirm the cross-project switch before continuing.",
      targetKind: "session",
      targetId: "session-plan",
      actionLabel: "Open Session",
      projectId: "project-1",
      projectName: "Project One",
    },
  ]);
});

test("surfaces refined drafts in the inbox with a stable draft key", () => {
  const items = deriveInboxItems({
    drafts: [
      createDraft({
        id: "draft-42",
        title_draft: "Notify when draft refinement completes",
        wizard_status: "awaiting_confirmation",
        updated_at: "2026-04-01T12:00:00.000Z",
      }),
    ],
    projects: [createProject()],
    tickets: [],
    sessionsById: new Map(),
  });

  assert.deepEqual(items, [
    {
      key: "draft-draft-42",
      color: "blue",
      title: "Draft ready to review",
      message:
        "Review the refined draft for **Notify when draft refinement completes**.",
      targetKind: "draft",
      targetId: "draft-42",
      actionLabel: "Open Draft",
      projectId: "project-1",
      projectName: "Project One",
    },
  ]);
});
