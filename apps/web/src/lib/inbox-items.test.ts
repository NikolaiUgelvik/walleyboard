import assert from "node:assert/strict";
import test from "node:test";

import type {
  DraftTicketState,
  ExecutionSession,
  Project,
  SessionResponse,
  TicketFrontmatter,
} from "../../../../packages/contracts/src/index.js";

import { deriveInboxItems } from "./inbox-items.js";

function createProject(overrides: Partial<Project> = {}): Project {
  const project: Project = {
    id: "project-1",
    slug: "project-1",
    name: "Project One",
    color: "#2563EB",
    agent_adapter: "codex",
    execution_backend: "host",
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
    created_at: "2026-04-01T10:00:00.000Z",
    updated_at: "2026-04-01T10:00:00.000Z",
    ...overrides,
  };
  return project;
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

function createSessionSummary(
  overrides: Partial<SessionResponse> = {},
): SessionResponse {
  return {
    session: createSession(),
    agent_controls_worktree: false,
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
  const sessionsById = new Map<string, SessionResponse>([
    [
      "session-review",
      createSessionSummary({
        session: createSession({
          id: "session-review",
          ticket_id: 7,
          status: "completed",
          last_summary: "Ready for review.",
        }),
      }),
    ],
    [
      "session-input",
      createSessionSummary({
        session: createSession({
          id: "session-input",
          ticket_id: 8,
          project_id: "project-2",
          status: "awaiting_input",
          last_summary: "Need a decision on the project jump behavior.",
        }),
      }),
    ],
    [
      "session-done",
      createSessionSummary({
        session: createSession({
          id: "session-done",
          ticket_id: 9,
          project_id: "project-2",
          status: "completed",
          last_summary: "Merged already.",
        }),
      }),
    ],
  ]);

  const items = deriveInboxItems({
    drafts: [],
    projects,
    tickets,
    sessionsById,
    ticketAiReviewActiveById: new Map(),
    ticketAiReviewResolvedById: new Map([[7, true]]),
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
        createSessionSummary({
          session: createSession({
            id: "session-plan",
            ticket_id: 14,
            plan_status: "awaiting_feedback",
            plan_summary: "Confirm the cross-project switch before continuing.",
            last_summary: "This should not be shown.",
          }),
        }),
      ],
    ]),
    ticketAiReviewActiveById: new Map(),
    ticketAiReviewResolvedById: new Map([[23, true]]),
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

test("hides review tickets with active linked pull requests from the inbox", () => {
  const items = deriveInboxItems({
    drafts: [],
    projects: [createProject()],
    tickets: [
      createTicket({
        id: 21,
        status: "review",
        session_id: "session-pr-open",
        title: "Wait for GitHub review",
        linked_pr: {
          provider: "github",
          repo_owner: "acme",
          repo_name: "walleyboard",
          number: 12,
          url: "https://github.com/acme/walleyboard/pull/12",
          head_branch: "codex/ticket-21",
          base_branch: "main",
          state: "open",
          review_status: "pending",
          head_sha: "abc123",
          changes_requested_by: null,
          last_changes_requested_head_sha: null,
          last_reconciled_at: "2026-04-01T10:00:00.000Z",
        },
      }),
      createTicket({
        id: 22,
        status: "in_progress",
        session_id: "session-input",
        title: "Needs operator input",
        updated_at: "2026-04-01T11:00:00.000Z",
      }),
    ],
    sessionsById: new Map([
      [
        "session-pr-open",
        createSessionSummary({
          session: createSession({
            id: "session-pr-open",
            ticket_id: 21,
            status: "completed",
            last_summary: "PR opened.",
          }),
        }),
      ],
      [
        "session-input",
        createSessionSummary({
          session: createSession({
            id: "session-input",
            ticket_id: 22,
            status: "awaiting_input",
          }),
        }),
      ],
    ]),
    ticketAiReviewActiveById: new Map(),
    ticketAiReviewResolvedById: new Map([[23, true]]),
  });

  assert.deepEqual(
    items.map((item) => item.key),
    ["session-22"],
  );
});

test("keeps review tickets without an active linked pull request in the inbox", () => {
  const items = deriveInboxItems({
    drafts: [],
    projects: [createProject()],
    tickets: [
      createTicket({
        id: 23,
        status: "review",
        session_id: "session-pr-closed",
        title: "Resume closed PR review",
        linked_pr: {
          provider: "github",
          repo_owner: "acme",
          repo_name: "walleyboard",
          number: 14,
          url: "https://github.com/acme/walleyboard/pull/14",
          head_branch: "codex/ticket-23",
          base_branch: "main",
          state: "closed",
          review_status: "unknown",
          head_sha: "def456",
          changes_requested_by: null,
          last_changes_requested_head_sha: null,
          last_reconciled_at: "2026-04-01T10:00:00.000Z",
        },
      }),
    ],
    sessionsById: new Map([
      [
        "session-pr-closed",
        createSessionSummary({
          session: createSession({
            id: "session-pr-closed",
            ticket_id: 23,
            status: "completed",
            last_summary: "Closed the old PR.",
          }),
        }),
      ],
    ]),
    ticketAiReviewActiveById: new Map(),
    ticketAiReviewResolvedById: new Map([[23, true]]),
  });

  assert.deepEqual(items, [
    {
      key: "review-23",
      color: "blue",
      title: "Review ready for ticket #23",
      message:
        "Resume closed PR review is ready for review and can be merged or sent back for changes.",
      targetKind: "session",
      targetId: "session-pr-closed",
      actionLabel: "Open Review",
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
    ticketAiReviewActiveById: new Map(),
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

test("hides review tickets while an AI review session is still running", () => {
  const items = deriveInboxItems({
    drafts: [],
    projects: [createProject()],
    tickets: [
      createTicket({
        id: 30,
        status: "review",
        session_id: "session-review",
        title: "Wait for AI review to finish",
      }),
    ],
    sessionsById: new Map([
      [
        "session-review",
        createSessionSummary({
          session: createSession({
            id: "session-review",
            ticket_id: 30,
            status: "completed",
          }),
        }),
      ],
    ]),
    ticketAiReviewActiveById: new Map([[30, true]]),
    ticketAiReviewResolvedById: new Map([[30, true]]),
  });

  assert.deepEqual(items, []);
});

test("keeps review tickets out of the inbox until AI review status resolves", () => {
  const items = deriveInboxItems({
    drafts: [],
    projects: [createProject()],
    tickets: [
      createTicket({
        id: 26,
        status: "review",
        session_id: "session-review-pending",
        title: "Wait for AI review status before showing this",
      }),
    ],
    sessionsById: new Map([
      [
        "session-review-pending",
        createSessionSummary({
          session: createSession({
            id: "session-review-pending",
            ticket_id: 26,
            status: "completed",
            last_summary:
              "Implementation completed and AI review lookup is pending.",
          }),
        }),
      ],
    ]),
    ticketAiReviewActiveById: new Map([[26, false]]),
    ticketAiReviewResolvedById: new Map([[26, false]]),
  });

  assert.deepEqual(items, []);
});

test("shows tickets in the inbox again after AI review completes when inbox rules still match", () => {
  const items = deriveInboxItems({
    drafts: [],
    projects: [createProject()],
    tickets: [
      createTicket({
        id: 25,
        status: "review",
        session_id: "session-review-complete",
        title: "Show this after AI review completes",
      }),
    ],
    sessionsById: new Map([
      [
        "session-review-complete",
        createSessionSummary({
          session: createSession({
            id: "session-review-complete",
            ticket_id: 25,
            status: "completed",
            last_summary: "AI review finished without blocking merge.",
          }),
        }),
      ],
    ]),
    ticketAiReviewActiveById: new Map([[25, false]]),
    ticketAiReviewResolvedById: new Map([[25, true]]),
  });

  assert.deepEqual(items, [
    {
      key: "review-25",
      color: "blue",
      title: "Review ready for ticket #25",
      message:
        "Show this after AI review completes is ready for review and can be merged or sent back for changes.",
      targetKind: "session",
      targetId: "session-review-complete",
      actionLabel: "Open Review",
      projectId: "project-1",
      projectName: "Project One",
    },
  ]);
});

test("shows review tickets when the AI review lookup errors after completion", () => {
  const items = deriveInboxItems({
    drafts: [],
    projects: [createProject()],
    tickets: [
      createTicket({
        id: 27,
        status: "review",
        session_id: "session-review-error",
        title: "Do not hide this when the lookup errors",
      }),
    ],
    sessionsById: new Map([
      [
        "session-review-error",
        createSessionSummary({
          session: createSession({
            id: "session-review-error",
            ticket_id: 27,
            status: "completed",
            last_summary: "AI review finished but the status refresh failed.",
          }),
        }),
      ],
    ]),
    ticketAiReviewActiveById: new Map([[27, false]]),
    ticketAiReviewResolvedById: new Map([[27, true]]),
  });

  assert.deepEqual(items, [
    {
      key: "review-27",
      color: "blue",
      title: "Review ready for ticket #27",
      message:
        "Do not hide this when the lookup errors is ready for review and can be merged or sent back for changes.",
      targetKind: "session",
      targetId: "session-review-error",
      actionLabel: "Open Review",
      projectId: "project-1",
      projectName: "Project One",
    },
  ]);
});

test("hides session inbox items while the agent still controls the worktree", () => {
  const items = deriveInboxItems({
    drafts: [],
    projects: [createProject()],
    tickets: [
      createTicket({
        id: 31,
        status: "in_progress",
        session_id: "session-running-handoff",
        title: "Resume work without operator input",
      }),
    ],
    sessionsById: new Map([
      [
        "session-running-handoff",
        createSessionSummary({
          session: createSession({
            id: "session-running-handoff",
            ticket_id: 31,
            status: "awaiting_input",
          }),
          agent_controls_worktree: true,
        }),
      ],
    ]),
  });

  assert.deepEqual(items, []);
});
