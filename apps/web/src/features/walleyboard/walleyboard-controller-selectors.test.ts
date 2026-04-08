import assert from "node:assert/strict";
import test from "node:test";

import type {
  DraftTicketState,
  ExecutionSession,
  Project,
  RepositoryConfig,
  SessionResponse,
  StructuredEvent,
  TicketFrontmatter,
  ValidationCommand,
} from "../../../../../packages/contracts/src/index.js";

import {
  resolveBoardViewState,
  resolveDraftEditorViewState,
  resolveInboxViewState,
  resolveProjectOptionsViewState,
  resolveSessionReviewState,
} from "./walleyboard-controller-selectors.js";

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    slug: "project-1",
    name: "Project One",
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
    max_concurrent_sessions: 1,
    created_at: "2026-04-03T00:00:00.000Z",
    updated_at: "2026-04-03T00:00:00.000Z",
    ...overrides,
  };
}

function createRepository(
  overrides: Partial<RepositoryConfig> = {},
): RepositoryConfig {
  return {
    id: "repo-1",
    project_id: "project-1",
    name: "repo-1",
    path: "/workspace/repo-1",
    target_branch: "main",
    setup_hook: null,
    cleanup_hook: null,
    validation_profile: [],
    extra_env_allowlist: [],
    created_at: "2026-04-03T00:00:00.000Z",
    updated_at: "2026-04-03T00:00:00.000Z",
    ...overrides,
  };
}

function createDraft(
  overrides: Partial<DraftTicketState> = {},
): DraftTicketState {
  return {
    id: "draft-1",
    project_id: "project-1",
    artifact_scope_id: "artifact-1",
    title_draft: "Draft One",
    description_draft: "Draft description",
    proposed_acceptance_criteria: ["criterion-1"],
    wizard_status: "awaiting_confirmation",
    split_proposal_summary: null,
    source_ticket_id: null,
    created_at: "2026-04-03T00:00:00.000Z",
    updated_at: "2026-04-03T00:00:00.000Z",
    proposed_ticket_type: "feature",
    proposed_repo_id: "repo-1",
    confirmed_repo_id: null,
    ...overrides,
  };
}

function createTicket(
  overrides: Partial<TicketFrontmatter> = {},
): TicketFrontmatter {
  return {
    acceptance_criteria: [],
    artifact_scope_id: "artifact-31",
    created_at: "2026-04-03T00:00:00.000Z",
    description: "Ticket description",
    id: 31,
    linked_pr: null,
    project: "project-1",
    repo: "repo-1",
    session_id: "session-31",
    status: "review",
    target_branch: "main",
    ticket_type: "feature",
    title: "Ticket 31",
    updated_at: "2026-04-03T00:00:00.000Z",
    working_branch: "ticket-31",
    ...overrides,
  };
}

function createSession(
  overrides: Partial<ExecutionSession> = {},
): ExecutionSession {
  return {
    adapter_session_ref: null,
    agent_adapter: "codex",
    completed_at: "2026-04-03T00:05:00.000Z",
    current_attempt_id: null,
    id: "session-31",
    last_heartbeat_at: "2026-04-03T00:05:00.000Z",
    last_summary: "Implementation completed.",
    latest_requested_change_note_id: null,
    latest_review_package_id: null,
    plan_status: "not_requested",
    plan_summary: null,
    planning_enabled: false,
    project_id: "project-1",
    queue_entered_at: null,
    repo_id: "repo-1",
    started_at: "2026-04-03T00:00:00.000Z",
    status: "completed",
    ticket_id: 31,
    worktree_path: "/tmp/worktree-31",
    ...overrides,
  };
}

function createValidationCommand(
  overrides: Partial<ValidationCommand> = {},
): ValidationCommand {
  return {
    id: "cmd-1",
    label: "Type check",
    command: "npm run typecheck",
    working_directory: "/workspace",
    timeout_ms: 300_000,
    required_for_review: false,
    shell: true,
    ...overrides,
  };
}

test("resolveBoardViewState filters and groups board items", () => {
  const result = resolveBoardViewState({
    boardSearch: "alpha",
    drafts: [
      createDraft({
        id: "draft-alpha",
        title_draft: "Alpha draft",
        proposed_acceptance_criteria: ["alpha"],
      }),
      createDraft({
        id: "draft-beta",
        title_draft: "Beta draft",
        proposed_acceptance_criteria: ["beta"],
      }),
    ],
    tickets: [
      createTicket({
        id: 41,
        status: "ready",
        title: "Alpha ticket",
        description: "Something alpha",
      }),
      createTicket({
        id: 42,
        status: "done",
        title: "Alpha done ticket",
      }),
    ],
  });

  assert.equal(result.visibleDrafts.length, 1);
  assert.equal(result.visibleDrafts[0]?.id, "draft-alpha");
  assert.equal(result.groupedTickets.ready.length, 1);
  assert.equal(result.groupedTickets.ready[0]?.id, 41);
  assert.equal(result.doneColumnTickets.length, 1);
  assert.equal(result.doneColumnTickets[0]?.id, 42);
});

test("resolveInboxViewState derives unread inbox items from read state", () => {
  const session = createSession({
    id: "session-91",
    status: "failed",
    worktree_path: "/tmp/worktree-91",
  });
  const result = resolveInboxViewState({
    drafts: [createDraft()],
    projects: [createProject()],
    readInboxItemState: {},
    sessionsById: new Map([
      [
        "session-91",
        {
          agent_controls_worktree: false,
          session,
        } satisfies SessionResponse,
      ],
    ]),
    ticketAiReviewActiveById: new Map(),
    ticketAiReviewResolvedById: new Map([[91, true]]),
    tickets: [
      createTicket({
        id: 91,
        session_id: "session-91",
        title: "Review ticket",
      }),
    ],
  });

  assert.equal(result.actionItems.length, 2);
  assert.equal(result.unreadActionItemCount, 2);
  assert.deepEqual(
    [...result.actionItemKeys],
    ["review-91:session-91:none", "draft-draft-1"],
  );
});

test("resolveProjectOptionsViewState computes dirty state and persisted color", () => {
  const project = createProject({
    color: "#2563EB",
    default_review_action: "pull_request",
    draft_analysis_model: "gpt-5.4",
    draft_analysis_reasoning_effort: "medium",
    ticket_work_model: "gpt-5.4-mini",
    ticket_work_reasoning_effort: "low",
  });
  const repository = createRepository({
    validation_profile: [createValidationCommand()],
  });
  const result = resolveProjectOptionsViewState({
    projectDeleteConfirmText: project.slug,
    projectOptionsAutomaticAgentReview: false,
    projectOptionsAutomaticAgentReviewRunLimit: 1,
    projectOptionsBranchChoices: [],
    projectOptionsColor: project.color,
    projectOptionsColorManuallySelected: false,
    projectOptionsDefaultReviewAction: "pull_request",
    projectOptionsDisabledMcpServers: [],
    projectOptionsDraftAgentAdapter: "codex",
    projectOptionsDraftModelCustom: "",
    projectOptionsDraftModelPreset: "gpt-5.4",
    projectOptionsDraftReasoningEffort: "medium",
    projectOptionsProjectId: project.id,
    projectOptionsRepositories: [repository],
    projectOptionsRepositoryTargetBranches: {
      [repository.id]: "main",
    },
    projectOptionsRepositoryValidationCommands: {
      [repository.id]: [createValidationCommand()],
    },
    projectOptionsTicketAgentAdapter: "codex",
    projectOptionsTicketModelCustom: "",
    projectOptionsTicketModelPreset: "gpt-5.4-mini",
    projectOptionsTicketReasoningEffort: "low",
    projectOptionsWorktreeInitCommand: "",
    projectOptionsWorktreeInitRunSequential: false,
    projectOptionsPreviewStartCommand: "",
    projectOptionsWorktreeTeardownCommand: "",
    projectRecords: [project],
  });

  assert.equal(result.canDeleteProject, true);
  assert.equal(result.projectOptionsDirty, false);
  assert.equal(result.projectOptionsPersistedColor, "#2563EB");
  assert.equal(result.projectOptionsColor, "#2563EB");
  assert.equal(result.projectOptionsProject?.id, project.id);
});

test("resolveDraftEditorViewState derives selected draft and new draft state", () => {
  const draft = createDraft({
    id: "draft-21",
    title_draft: "Draft 21",
    description_draft: "Draft 21 description",
    proposed_acceptance_criteria: ["criterion-21"],
  });
  const result = resolveDraftEditorViewState({
    draftEditorAcceptanceCriteria: "criterion-21",
    draftEditorDescription: "Draft 21 description",
    draftEditorProjectId: "project-1",
    draftEditorRepositoriesQueryData: {
      repositories: [createRepository({ id: "repo-21" })],
    },
    draftEditorTicketType: "feature",
    draftEditorTitle: "Draft 21",
    draftEventsQueryData: {
      active_run: true,
      events: [
        {
          id: "event-21",
          event_type: "draft.questions.completed",
          entity_id: "draft-21",
          entity_type: "draft",
          occurred_at: "2026-04-03T00:10:00.000Z",
          payload: {
            result: {
              verdict: "yes",
              summary: "Looks good",
              assumptions: [],
              open_questions: [],
              risks: [],
              suggested_draft_edits: [],
            },
          },
        } satisfies StructuredEvent,
      ],
    },
    draftRecords: [draft],
    inspectorKind: "draft",
    projectRecords: [createProject()],
    repositories: [createRepository()],
    selectedDraftId: draft.id,
    selectedProjectId: "project-1",
  });

  assert.equal(result.selectedDraft?.id, draft.id);
  assert.equal(result.draftFormDirty, false);
  assert.equal(result.draftEditorCanPersist, true);
  assert.equal(result.draftAnalysisActive, true);
  assert.equal(result.latestQuestionsResult?.verdict, "yes");

  const newDraftResult = resolveDraftEditorViewState({
    draftEditorAcceptanceCriteria: "Needs work",
    draftEditorDescription: "New draft description",
    draftEditorProjectId: null,
    draftEditorRepositoriesQueryData: {
      repositories: [createRepository({ id: "repo-21" })],
    },
    draftEditorTicketType: "feature",
    draftEditorTitle: "New draft",
    draftEventsQueryData: undefined,
    draftRecords: [],
    inspectorKind: "new_draft",
    projectRecords: [createProject()],
    repositories: [createRepository()],
    selectedDraftId: null,
    selectedProjectId: "project-1",
  });

  assert.equal(newDraftResult.newDraftFormDirty, true);
  assert.equal(newDraftResult.draftEditorRepositories.length, 1);
});

test("resolveSessionReviewState builds session maps and selected session fallback", () => {
  const session = createSession();
  const result = resolveSessionReviewState({
    latestReviewRun: null,
    reviewPackage: null,
    reviewRuns: [],
    selectedSessionId: session.id,
    selectedTicketId: 31,
    sessionAttempts: [],
    sessionLogs: [],
    sessionQueryData: {
      agent_controls_worktree: true,
      session,
    },
    sessionSummaries: [
      {
        data: {
          agent_controls_worktree: true,
          session,
        },
        error: null,
        isError: false,
        isPending: false,
      },
    ],
    ticketEvents: [],
    ticketWorkspaceDiff: null,
    tickets: [
      createTicket({
        session_id: session.id,
      }),
    ],
  });

  assert.equal(result.session?.id, session.id);
  assert.equal(result.selectedSessionTicket?.id, 31);
  assert.equal(result.selectedSessionTicketSession?.id, session.id);
  assert.equal(result.sessionById.get(session.id)?.id, session.id);
  assert.equal(result.agentControlsWorktreeBySessionId.get(session.id), true);
  assert.equal(
    result.sessionSummaryStateById.get(session.id)?.isPending,
    false,
  );
});
