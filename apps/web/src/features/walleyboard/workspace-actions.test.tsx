import assert from "node:assert/strict";
import test from "node:test";

import React, {
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

import type {
  ExecutionSession,
  Project,
  RepositoryConfig,
  TicketFrontmatter,
  TicketWorkspacePreview,
} from "../../../../../packages/contracts/src/index.js";

import {
  ProjectWorkspaceActions,
  TicketWorkspaceActions,
} from "./BoardView.js";
import { TicketWorkspaceSummaryRow } from "./InspectorPane.js";
import type { RepositoryWorkspacePreview } from "./shared.js";
import type { WalleyBoardController } from "./use-walleyboard-controller.js";
import {
  resolveWorkspaceDiffPanelState,
  resolveWorkspaceTerminalPanelState,
} from "./workspace-modal-state.js";

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function findElementByProp(
  node: ReactNode,
  propName: string,
  propValue: unknown,
): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElementByProp(child, propName, propValue);
      if (match) {
        return match;
      }
    }
    return null;
  }

  if (!isValidElement(node)) {
    return null;
  }

  if ((node.props as Record<string, unknown>)[propName] === propValue) {
    return node;
  }

  return findElementByProp(
    (node.props as { children?: ReactNode }).children ?? null,
    propName,
    propValue,
  );
}

function collectText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map((child) => collectText(child)).join("");
  }

  if (!isValidElement(node)) {
    return "";
  }

  return collectText((node.props as { children?: ReactNode }).children ?? null);
}

function createTicket(
  overrides: Partial<TicketFrontmatter> = {},
): TicketFrontmatter {
  return {
    acceptance_criteria: [],
    artifact_scope_id: "artifact-scope-9",
    created_at: "2026-04-02T00:00:00.000Z",
    description: "Add card actions",
    id: 9,
    linked_pr: null,
    project: "project-1",
    repo: "repo-1",
    session_id: "session-9",
    status: "in_progress",
    target_branch: "main",
    ticket_type: "feature",
    title: "Replace ticket workspace tabs with card action icons",
    updated_at: "2026-04-02T00:00:00.000Z",
    working_branch: "ticket-9",
    ...overrides,
  };
}

function createController(input?: {
  agentControlsWorktree?: boolean;
  preview?: TicketWorkspacePreview | null;
  previewError?: string;
  sessionSummaryError?: string;
  sessionSummaryPending?: boolean;
  sessionQueryError?: string;
  repositoryPreview?: RepositoryWorkspacePreview | null;
  repositoryPreviewError?: string;
  session?: Partial<ExecutionSession> | null;
  selectedSessionTicketSession?: Partial<ExecutionSession> | null;
  sessionQueryPending?: boolean;
  selectedTicket?: TicketFrontmatter;
  workspaceModal?: "activity" | "diff" | "terminal" | null;
}) {
  const openCalls: Array<{ kind: string; ticketId: number }> = [];
  const previewActionCalls: number[] = [];
  let repositoryPreviewActionCalls = 0;
  let repositoryTerminalActionCalls = 0;
  const ticket = input?.selectedTicket ?? createTicket();
  const preview = input?.preview ?? null;
  const repositoryPreview = input?.repositoryPreview ?? null;
  const selectedProject: Project = {
    id: "project-1",
    slug: "project-1",
    name: "Project One",
    agent_adapter: "codex",
    execution_backend: "host",
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
    max_concurrent_sessions: 1,
    created_at: "2026-04-02T00:00:00.000Z",
    updated_at: "2026-04-02T00:00:00.000Z",
  };
  const selectedRepository: RepositoryConfig = {
    id: "repo-1",
    project_id: "project-1",
    name: "repo",
    path: "/tmp/repo",
    target_branch: "main",
    setup_hook: null,
    cleanup_hook: null,
    validation_profile: [],
    extra_env_allowlist: [],
    created_at: "2026-04-02T00:00:00.000Z",
    updated_at: "2026-04-02T00:00:00.000Z",
  };
  const session =
    input?.session === null
      ? null
      : ({
          adapter_session_ref: null,
          agent_adapter: "codex",
          completed_at: null,
          current_attempt_id: null,
          id: ticket.session_id ?? "session-9",
          last_heartbeat_at: "2026-04-02T00:00:00.000Z",
          last_summary: null,
          latest_requested_change_note_id: null,
          latest_review_package_id: null,
          plan_status: "not_requested",
          plan_summary: null,
          planning_enabled: false,
          project_id: ticket.project,
          queue_entered_at: null,
          repo_id: ticket.repo,
          started_at: "2026-04-02T00:00:00.000Z",
          status: "running",
          ticket_id: ticket.id,
          worktree_path: "/tmp/worktree-9",
          ...input?.session,
        } satisfies ExecutionSession);
  const selectedSessionTicketSession =
    input?.selectedSessionTicketSession === null
      ? null
      : session || input?.selectedSessionTicketSession
        ? ({
            ...(session ?? {}),
            adapter_session_ref: null,
            agent_adapter: "codex",
            completed_at: null,
            current_attempt_id: null,
            id: ticket.session_id ?? "session-9",
            last_heartbeat_at: "2026-04-02T00:00:00.000Z",
            last_summary: null,
            latest_requested_change_note_id: null,
            latest_review_package_id: null,
            plan_status: "not_requested",
            plan_summary: null,
            planning_enabled: false,
            project_id: ticket.project,
            queue_entered_at: null,
            repo_id: ticket.repo,
            started_at: "2026-04-02T00:00:00.000Z",
            status: "running",
            ticket_id: ticket.id,
            worktree_path: "/tmp/worktree-9",
            ...input?.selectedSessionTicketSession,
          } satisfies ExecutionSession)
        : null;
  const controller = {
    handleTicketPreviewAction(selected: TicketFrontmatter) {
      previewActionCalls.push(selected.id);
    },
    handleSelectedRepositoryPreviewAction() {
      repositoryPreviewActionCalls += 1;
    },
    openSelectedRepositoryWorkspaceTerminal() {
      repositoryTerminalActionCalls += 1;
    },
    openTicketWorkspaceModal(selected: TicketFrontmatter, kind: string) {
      openCalls.push({ kind, ticketId: selected.id });
    },
    previewActionErrorByTicketId: input?.previewError
      ? { [ticket.id]: input.previewError }
      : {},
    selectedSessionTicket: input?.selectedTicket ?? ticket,
    selectedSessionTicketSession,
    repositoryPreviewActionError: input?.repositoryPreviewError ?? null,
    repositoryPreviewActionPending: false,
    repositoryTerminalPending: false,
    repositoryWorkspacePreview: repositoryPreview,
    startTicketWorkspacePreviewMutation: {
      isPending: false,
      variables: null,
    },
    selectedProject,
    selectedRepository,
    session,
    sessionById:
      ticket.session_id && session
        ? new Map([[ticket.session_id, session]])
        : new Map(),
    sessionSummaryStateById: ticket.session_id
      ? new Map([
          [
            ticket.session_id,
            {
              error: input?.sessionSummaryError ?? null,
              isError: input?.sessionSummaryError != null,
              isPending: input?.sessionSummaryPending ?? false,
            },
          ],
        ])
      : new Map(),
    agentControlsWorktreeBySessionId:
      ticket.session_id && session
        ? new Map([[ticket.session_id, input?.agentControlsWorktree ?? false]])
        : new Map(),
    sessionLogs: [],
    sessionLogsQuery: {
      isPending: false,
      isError: false,
    },
    sessionQuery: {
      error: input?.sessionQueryError
        ? new Error(input.sessionQueryError)
        : null,
      isError: input?.sessionQueryError != null,
      isPending: input?.sessionQueryPending ?? false,
    },
    stopTicketWorkspacePreviewMutation: {
      isPending: false,
      variables: null,
    },
    ticketWorkspacePreviewByTicketId: preview
      ? new Map([[ticket.id, preview]])
      : new Map(),
    ticketWorkspaceDiff: null,
    ticketWorkspaceDiffLayout: "split",
    ticketWorkspaceDiffQuery: {
      error: null,
      isError: false,
      isPending: false,
    },
    setTicketWorkspaceDiffLayout() {},
    workspaceModal: input?.workspaceModal ?? null,
  } as unknown as WalleyBoardController;

  return {
    controller,
    openCalls,
    previewActionCalls,
    repositoryPreviewActionCalls: () => repositoryPreviewActionCalls,
    repositoryTerminalActionCalls: () => repositoryTerminalActionCalls,
    ticket,
  };
}

test("ticket workspace actions switch preview labels and surface preview errors", () => {
  const runningPreview: TicketWorkspacePreview = {
    ticket_id: 9,
    state: "ready",
    preview_url: "http://127.0.0.1:4173",
    backend_url: null,
    started_at: "2026-04-02T00:00:00.000Z",
    error: null,
  };
  const { controller, ticket } = createController({
    preview: runningPreview,
    previewError: "Browser blocked the preview tab.",
  });

  const tree = TicketWorkspaceActions({ controller, ticket });
  const previewAction = findElementByProp(
    tree,
    "aria-label",
    "Turn off dev server",
  );

  assert.ok(previewAction);
  assert.match(collectText(tree), /Browser blocked the preview tab\./);
});

test("ticket workspace actions keep diff and activity available after worktree cleanup", () => {
  const { controller, ticket } = createController({
    selectedTicket: createTicket({ status: "done" }),
    session: { status: "completed", worktree_path: null },
  });

  const tree = TicketWorkspaceActions({ controller, ticket });
  const diffAction = findElementByProp(
    tree,
    "aria-label",
    "Open worktree diff",
  );
  assert.ok(diffAction);
  assert.equal((diffAction.props as { disabled?: boolean }).disabled, false);

  for (const label of ["Open worktree terminal", "Preview"]) {
    const action = findElementByProp(tree, "aria-label", label);
    assert.ok(action);
    assert.equal((action.props as { disabled?: boolean }).disabled, true);
  }

  const activityAction = findElementByProp(
    tree,
    "aria-label",
    "Open activity stream",
  );
  assert.ok(activityAction);
  assert.equal(
    (activityAction.props as { disabled?: boolean }).disabled,
    false,
  );
});

test("ticket workspace terminal action stays available while the agent owns the worktree", () => {
  const { controller, ticket } = createController({
    agentControlsWorktree: true,
    session: { status: "awaiting_input", worktree_path: "/tmp/worktree-9" },
  });

  const tree = TicketWorkspaceActions({ controller, ticket });
  const terminalAction = findElementByProp(
    tree,
    "aria-label",
    "Open worktree terminal",
  );

  assert.ok(terminalAction);
  assert.equal(
    (terminalAction.props as { disabled?: boolean }).disabled,
    false,
  );
});

test("ticket workspace terminal action stays available while session details are still loading", () => {
  const { controller, ticket } = createController({
    session: null,
    sessionSummaryPending: true,
  });

  const tree = TicketWorkspaceActions({ controller, ticket });
  const terminalAction = findElementByProp(
    tree,
    "aria-label",
    "Open worktree terminal",
  );

  assert.ok(terminalAction);
  assert.equal(
    (terminalAction.props as { disabled?: boolean; title?: string }).disabled,
    false,
  );
  assert.equal(
    (terminalAction.props as { disabled?: boolean; title?: string }).title,
    "Terminal status is still loading",
  );
});

test("ticket workspace terminal action stays available when session details fail to load", () => {
  const { controller, ticket } = createController({
    session: null,
    sessionSummaryError: "Session details could not be loaded.",
  });

  const tree = TicketWorkspaceActions({ controller, ticket });
  const terminalAction = findElementByProp(
    tree,
    "aria-label",
    "Open worktree terminal",
  );

  assert.ok(terminalAction);
  assert.equal(
    (terminalAction.props as { disabled?: boolean; title?: string }).disabled,
    false,
  );
  assert.equal(
    (terminalAction.props as { disabled?: boolean; title?: string }).title,
    "Terminal status could not be loaded. Open to view the error.",
  );
});

test("workspace terminal modal uses the selected ticket session while session details are still loading", () => {
  const { controller } = createController({
    selectedSessionTicketSession: {
      status: "awaiting_input",
      worktree_path: "/tmp/worktree-9",
    },
    session: null,
    sessionQueryPending: true,
    workspaceModal: "terminal",
  });

  assert.deepEqual(
    resolveWorkspaceTerminalPanelState({
      selectedSessionTicket: controller.selectedSessionTicket,
      selectedSessionTicketSession: controller.selectedSessionTicketSession,
      session: controller.session,
      sessionQuery: controller.sessionQuery,
    }),
    {
      error: null,
      state: "ready",
      worktreePath: "/tmp/worktree-9",
    },
  );
});

test("workspace terminal modal state surfaces session load failures", () => {
  const { controller } = createController({
    selectedSessionTicketSession: null,
    session: null,
    sessionQueryError: "Session details could not be loaded.",
  });

  assert.deepEqual(
    resolveWorkspaceTerminalPanelState({
      selectedSessionTicket: controller.selectedSessionTicket,
      selectedSessionTicketSession: controller.selectedSessionTicketSession,
      session: controller.session,
      sessionQuery: controller.sessionQuery,
    }),
    {
      error: "Session details could not be loaded.",
      state: "error",
      worktreePath: null,
    },
  );
});

test("ticket workspace activity action opens the activity modal from the card", () => {
  const { controller, openCalls, ticket } = createController();

  const tree = TicketWorkspaceActions({ controller, ticket });
  const activityAction = findElementByProp(
    tree,
    "aria-label",
    "Open activity stream",
  );

  assert.ok(activityAction);
  let stopPropagationCalled = false;
  (
    activityAction.props as {
      onClick: (event: { stopPropagation: () => void }) => void;
    }
  ).onClick({
    stopPropagation() {
      stopPropagationCalled = true;
    },
  });

  assert.equal(stopPropagationCalled, true);
  assert.deepEqual(openCalls, [{ kind: "activity", ticketId: ticket.id }]);
});

test("project workspace actions surface repository preview errors and switch labels", () => {
  const { controller } = createController({
    repositoryPreview: {
      repository_id: "repo-1",
      state: "ready",
      preview_url: "http://127.0.0.1:4173",
      backend_url: null,
      started_at: "2026-04-02T00:00:00.000Z",
      error: null,
    },
    repositoryPreviewError:
      "Preview is running, but the browser blocked opening a new tab.",
  });

  const tree = ProjectWorkspaceActions({ controller });
  assert.ok(tree);

  const previewAction = findElementByProp(
    tree,
    "aria-label",
    "Turn off dev server",
  );

  assert.ok(previewAction);
  assert.match(
    collectText(tree),
    /Preview is running, but the browser blocked opening a new tab\./,
  );
});

test("project workspace actions call the repository preview and terminal handlers", () => {
  const {
    controller,
    repositoryPreviewActionCalls,
    repositoryTerminalActionCalls,
  } = createController();
  const tree = ProjectWorkspaceActions({ controller });
  assert.ok(tree);

  const previewAction = findElementByProp(tree, "aria-label", "Preview");
  assert.ok(previewAction);
  (previewAction.props as { onClick: () => void }).onClick();
  assert.equal(repositoryPreviewActionCalls(), 1);

  const terminalAction = findElementByProp(
    tree,
    "aria-label",
    "Open repository terminal",
  );
  assert.ok(terminalAction);
  (terminalAction.props as { onClick: () => void }).onClick();
  assert.equal(repositoryTerminalActionCalls(), 1);
});

test("ticket workspace summary row opens the activity stream from the inspector", () => {
  let opened = false;
  const tree = TicketWorkspaceSummaryRow({
    activitySummary: "Agent summarized the latest validation run.",
    onOpenActivityStream() {
      opened = true;
    },
  });
  const summaryRow = findElementByProp(
    tree,
    "aria-label",
    "Open activity stream",
  );

  assert.ok(summaryRow);
  assert.equal((summaryRow.props as { role?: string }).role, "button");
  (
    summaryRow.props as {
      onClick: () => void;
    }
  ).onClick();

  assert.equal(opened, true);
});

test("workspace diff modal surfaces diff load failures instead of the empty diff state", () => {
  const state = resolveWorkspaceDiffPanelState({
    ticketWorkspaceDiffQuery: {
      error: new Error("Stored review diff artifact is no longer available."),
      isError: true,
      isPending: false,
    },
  });

  assert.equal(state.isLoading, false);
  assert.equal(
    state.error,
    "Stored review diff artifact is no longer available.",
  );
});

test("ticket workspace summary row supports keyboard activation", () => {
  let opened = false;
  let defaultPrevented = false;
  const tree = TicketWorkspaceSummaryRow({
    activitySummary: "- Validation passed\n- Preview ready",
    onOpenActivityStream() {
      opened = true;
    },
  });
  const summaryRow = findElementByProp(
    tree,
    "aria-label",
    "Open activity stream",
  );

  assert.ok(summaryRow);
  (
    summaryRow.props as {
      onKeyDown: (event: { key: string; preventDefault: () => void }) => void;
    }
  ).onKeyDown({
    key: "Enter",
    preventDefault() {
      defaultPrevented = true;
    },
  });

  assert.equal(defaultPrevented, true);
  assert.equal(opened, true);
});
