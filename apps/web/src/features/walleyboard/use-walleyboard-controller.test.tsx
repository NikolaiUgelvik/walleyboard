import assert from "node:assert/strict";
import test from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  ExecutionSession,
  HealthResponse,
  Project,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import {
  computeMarkAllReadState,
  useWalleyBoardController,
} from "./use-walleyboard-controller.js";
import { setOptimisticRunningReviewRun } from "./use-walleyboard-mutations.js";

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function createHealth(): HealthResponse {
  return {
    ok: true,
    service: "backend",
    timestamp: "2026-04-03T00:00:00.000Z",
    codex_mcp_servers: ["context7", "sentry"],
    docker: {
      installed: true,
      available: true,
      client_version: "1.0.0",
      server_version: "1.0.0",
      error: null,
    },
  };
}

function createProject(overrides: Partial<Project> = {}): Project {
  const project: Project = {
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
  return project;
}

function createTicket(
  overrides: Partial<TicketFrontmatter> = {},
): TicketFrontmatter {
  return {
    acceptance_criteria: [],
    artifact_scope_id: "artifact-scope-31",
    created_at: "2026-04-03T00:00:00.000Z",
    description: "Hide cross-project review tickets while AI review runs.",
    id: 31,
    linked_pr: null,
    project: "project-2",
    repo: "repo-2",
    session_id: "session-31",
    status: "review",
    target_branch: "main",
    ticket_type: "feature",
    title: "Hide AI review from the global inbox",
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
    last_summary: "Implementation completed and AI review is running.",
    latest_requested_change_note_id: null,
    latest_review_package_id: null,
    plan_status: "not_requested",
    plan_summary: null,
    planning_enabled: false,
    project_id: "project-2",
    queue_entered_at: null,
    repo_id: "repo-2",
    started_at: "2026-04-03T00:00:00.000Z",
    status: "completed",
    ticket_id: 31,
    worktree_path: "/tmp/worktree-31",
    ...overrides,
  };
}

function ActionItemsProbe() {
  const controller = useWalleyBoardController();
  return (
    <pre>{JSON.stringify(controller.actionItems.map((item) => item.key))}</pre>
  );
}

test("keeps cross-project running AI reviews out of the inbox", () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });

  queryClient.setQueryData(["health"], createHealth());
  queryClient.setQueryData(["projects"], {
    projects: [
      createProject(),
      createProject({
        id: "project-2",
        slug: "project-2",
        name: "Project Two",
      }),
    ],
  });
  queryClient.setQueryData(["projects", "project-1", "drafts"], {
    drafts: [],
  });
  queryClient.setQueryData(["projects", "project-2", "drafts"], {
    drafts: [],
  });
  queryClient.setQueryData(["projects", "project-1", "tickets"], {
    tickets: [],
  });

  const projectTwoTicket = createTicket();
  queryClient.setQueryData(["projects", "project-2", "tickets"], {
    tickets: [projectTwoTicket],
  });
  queryClient.setQueryData(["sessions", projectTwoTicket.session_id], {
    session: createSession(),
  });
  queryClient.setQueryData(["tickets", projectTwoTicket.id, "review-run"], {
    review_run: {
      id: "review-run-31",
      ticket_id: 31,
      review_package_id: "review-package-31",
      implementation_session_id: "session-31",
      status: "running",
      adapter_session_ref: null,
      report: null,
      failure_message: null,
      created_at: "2026-04-03T00:05:00.000Z",
      updated_at: "2026-04-03T00:05:00.000Z",
      completed_at: null,
    },
  });

  const markup = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ActionItemsProbe />
    </QueryClientProvider>,
  );

  assert.doesNotMatch(markup, /review-31/);
});

test("hides a review inbox item immediately after agent review starts from cached null state", () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });

  queryClient.setQueryData(["health"], createHealth());
  queryClient.setQueryData(["projects"], {
    projects: [
      createProject(),
      createProject({
        id: "project-2",
        slug: "project-2",
        name: "Project Two",
      }),
    ],
  });
  queryClient.setQueryData(["projects", "project-1", "drafts"], {
    drafts: [],
  });
  queryClient.setQueryData(["projects", "project-2", "drafts"], {
    drafts: [],
  });
  queryClient.setQueryData(["projects", "project-1", "tickets"], {
    tickets: [],
  });

  const projectTwoTicket = createTicket();
  queryClient.setQueryData(["projects", "project-2", "tickets"], {
    tickets: [projectTwoTicket],
  });
  queryClient.setQueryData(["sessions", projectTwoTicket.session_id], {
    session: createSession({
      last_summary: "Implementation completed and is waiting for review.",
    }),
  });
  queryClient.setQueryData(
    ["tickets", projectTwoTicket.id, "review-run"],
    null,
  );

  const visibleMarkup = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ActionItemsProbe />
    </QueryClientProvider>,
  );

  assert.match(visibleMarkup, /review-31/);

  setOptimisticRunningReviewRun({
    queryClient,
    ticketId: projectTwoTicket.id,
    implementationSessionId: projectTwoTicket.session_id,
  });

  const hiddenMarkup = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ActionItemsProbe />
    </QueryClientProvider>,
  );

  assert.doesNotMatch(hiddenMarkup, /review-31/);
});

test("computeMarkAllReadState marks all unread items as read", () => {
  const currentState: Record<string, string> = {
    "item-a": "old-key-a",
    "item-b": "key-b",
  };
  const actionItems = [
    { key: "item-a", notificationKey: "new-key-a" },
    { key: "item-b", notificationKey: "key-b" },
    { key: "item-c", notificationKey: "key-c" },
  ];

  const result = computeMarkAllReadState(currentState, actionItems);

  assert.deepEqual(result, {
    "item-a": "new-key-a",
    "item-b": "key-b",
    "item-c": "key-c",
  });
});

test("computeMarkAllReadState returns null when all items are already read", () => {
  const currentState: Record<string, string> = {
    "item-a": "key-a",
    "item-b": "key-b",
  };
  const actionItems = [
    { key: "item-a", notificationKey: "key-a" },
    { key: "item-b", notificationKey: "key-b" },
  ];

  const result = computeMarkAllReadState(currentState, actionItems);

  assert.equal(result, null);
});

test("computeMarkAllReadState preserves existing read state for other keys", () => {
  const currentState: Record<string, string> = {
    "item-a": "key-a",
    "stale-item": "stale-key",
  };
  const actionItems = [{ key: "item-a", notificationKey: "new-key-a" }];

  const result = computeMarkAllReadState(currentState, actionItems);

  assert.deepEqual(result, {
    "item-a": "new-key-a",
    "stale-item": "stale-key",
  });
});
