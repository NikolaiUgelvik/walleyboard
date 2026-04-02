import assert from "node:assert/strict";
import test from "node:test";

import { isValidElement, type ReactElement, type ReactNode } from "react";

import type {
  ExecutionSession,
  TicketFrontmatter,
  TicketWorkspacePreview,
} from "../../../../../packages/contracts/src/index.js";

import { TicketWorkspaceActions } from "./BoardView.js";
import { TicketWorkspaceSummaryRow } from "./InspectorPane.js";
import type { WalleyBoardController } from "./use-walleyboard-controller.js";

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
  preview?: TicketWorkspacePreview | null;
  previewError?: string;
  session?: Partial<ExecutionSession> | null;
  selectedTicket?: TicketFrontmatter;
}) {
  const openCalls: Array<{ kind: string; ticketId: number }> = [];
  const previewActionCalls: number[] = [];
  const ticket = input?.selectedTicket ?? createTicket();
  const preview = input?.preview ?? null;
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
  const controller = {
    handleTicketPreviewAction(selected: TicketFrontmatter) {
      previewActionCalls.push(selected.id);
    },
    openTicketWorkspaceModal(selected: TicketFrontmatter, kind: string) {
      openCalls.push({ kind, ticketId: selected.id });
    },
    previewActionErrorByTicketId: input?.previewError
      ? { [ticket.id]: input.previewError }
      : {},
    startTicketWorkspacePreviewMutation: {
      isPending: false,
      variables: null,
    },
    session,
    sessionById:
      ticket.session_id && session
        ? new Map([[ticket.session_id, session]])
        : new Map(),
    stopTicketWorkspacePreviewMutation: {
      isPending: false,
      variables: null,
    },
    ticketWorkspacePreviewByTicketId: preview
      ? new Map([[ticket.id, preview]])
      : new Map(),
  } as unknown as WalleyBoardController;

  return { controller, openCalls, previewActionCalls, ticket };
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

test("ticket workspace actions disable controls when the session has no worktree", () => {
  const { controller, ticket } = createController({
    selectedTicket: createTicket({ status: "done" }),
    session: { status: "completed", worktree_path: null },
  });

  const tree = TicketWorkspaceActions({ controller, ticket });
  for (const label of [
    "Open worktree diff",
    "Open worktree terminal",
    "Preview",
    "Open activity stream",
  ]) {
    const action = findElementByProp(tree, "aria-label", label);
    assert.ok(action);
    assert.equal((action.props as { disabled?: boolean }).disabled, true);
  }
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
