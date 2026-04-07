import assert from "node:assert/strict";
import test from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import type { Dispatch, SetStateAction } from "react";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type {
  DraftTicketState,
  ExecutionSession,
  Project,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import { deriveInboxState } from "../../lib/inbox-items.js";
import { useInboxAlert } from "./use-inbox-alert.js";
import { useTicketAiReviewStatus } from "./use-ticket-ai-review-status.js";
import {
  useWalleyBoardController,
  type WalleyBoardController,
} from "./use-walleyboard-controller.js";
import { useWalleyBoardMutations } from "./use-walleyboard-mutations.js";

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

class ResizeObserverStub {
  disconnect(): void {}
  observe(): void {}
  unobserve(): void {}
}

function createSocketFactoryStub() {
  return () =>
    ({
      connected: true,
      disconnect() {},
      emit() {},
      on() {},
    }) as const;
}

class AudioStub {
  static playCallCount = 0;

  currentTime = 0;
  preload = "";

  pause(): void {}

  play(): Promise<void> {
    AudioStub.playCallCount += 1;
    return Promise.resolve();
  }
}

function installGlobal(name: string, value: unknown): () => void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true,
  });

  return () => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, name, originalDescriptor);
      return;
    }

    Reflect.deleteProperty(globalThis, name);
  };
}

function installDom() {
  const dom = new JSDOM(
    "<!doctype html><html><head></head><body></body></html>",
    {
      pretendToBeVisual: true,
      url: "http://localhost/",
    },
  );
  const { window } = dom;
  const restoreGlobals = [
    installGlobal("IS_REACT_ACT_ENVIRONMENT", true),
    installGlobal("window", window),
    installGlobal("document", window.document),
    installGlobal("Document", window.Document),
    installGlobal("navigator", window.navigator),
    installGlobal("Element", window.Element),
    installGlobal("HTMLElement", window.HTMLElement),
    installGlobal("MutationObserver", window.MutationObserver),
    installGlobal("Node", window.Node),
    installGlobal("ResizeObserver", ResizeObserverStub),
    installGlobal("ShadowRoot", window.ShadowRoot),
    installGlobal("SVGElement", window.SVGElement),
    installGlobal("Event", window.Event),
    installGlobal("CustomEvent", window.CustomEvent),
    installGlobal(
      "__WALLEYBOARD_SOCKET_IO_FACTORY__",
      createSocketFactoryStub(),
    ),
    installGlobal("Audio", AudioStub),
  ];
  const pendingCallbacks = new Map<number, () => void>();
  let nextAsyncId = 1;
  const scheduleCallback = (
    callback: TimerHandler,
    args: unknown[],
  ): number => {
    const id = nextAsyncId;
    nextAsyncId += 1;
    pendingCallbacks.set(id, () => {
      if (typeof callback === "function") {
        callback(...args);
        return;
      }

      throw new TypeError(
        "String timers are not supported in this test harness",
      );
    });
    return id;
  };
  const clearScheduledCallback = (id: number): void => {
    pendingCallbacks.delete(id);
  };

  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.matchMedia = () =>
    ({
      addEventListener() {},
      addListener() {},
      dispatchEvent() {
        return false;
      },
      matches: false,
      media: "(prefers-color-scheme: light)",
      onchange: null,
      removeEventListener() {},
      removeListener() {},
    }) as MediaQueryList;
  window.setTimeout = ((
    callback: TimerHandler,
    _delay?: number,
    ...args: unknown[]
  ) => scheduleCallback(callback, args)) as typeof window.setTimeout;
  window.clearTimeout = ((id: number) => {
    clearScheduledCallback(id);
  }) as typeof window.clearTimeout;
  window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    scheduleCallback(
      () => callback(Date.now()),
      [],
    )) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) => {
    clearScheduledCallback(id);
  }) as typeof window.cancelAnimationFrame;
  restoreGlobals.push(
    installGlobal("getComputedStyle", window.getComputedStyle.bind(window)),
    installGlobal(
      "setTimeout",
      window.setTimeout.bind(window) as typeof globalThis.setTimeout,
    ),
    installGlobal(
      "clearTimeout",
      window.clearTimeout.bind(window) as typeof globalThis.clearTimeout,
    ),
    installGlobal(
      "requestAnimationFrame",
      window.requestAnimationFrame.bind(window),
    ),
    installGlobal(
      "cancelAnimationFrame",
      window.cancelAnimationFrame.bind(window),
    ),
  );

  const mountNode = window.document.createElement("div");
  window.document.body.appendChild(mountNode);

  return {
    cleanup() {
      pendingCallbacks.clear();
      mountNode.remove();
      for (const restore of restoreGlobals.reverse()) {
        restore();
      }
      dom.window.close();
    },
    flushScheduledCallbacks() {
      const callbacks = Array.from(pendingCallbacks.values());
      pendingCallbacks.clear();
      for (const callback of callbacks) {
        callback();
      }
    },
    mountNode,
  };
}

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

function createTicket(
  overrides: Partial<TicketFrontmatter> = {},
): TicketFrontmatter {
  return {
    acceptance_criteria: [],
    artifact_scope_id: "artifact-scope-31",
    created_at: "2026-04-03T00:00:00.000Z",
    description: "Track notification behavior for human-actionable work.",
    id: 31,
    linked_pr: null,
    project: "project-1",
    repo: "repo-1",
    session_id: "session-31",
    status: "review",
    target_branch: "main",
    ticket_type: "feature",
    title: "Gate review notifications until AI review settles",
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

function createDraft(
  overrides: Partial<DraftTicketState> = {},
): DraftTicketState {
  return {
    id: "draft-1",
    project_id: "project-1",
    artifact_scope_id: "artifact-scope-31",
    title_draft: "Draft title",
    description_draft: "Draft description",
    proposed_repo_id: "repo-1",
    confirmed_repo_id: null,
    proposed_ticket_type: "feature",
    proposed_acceptance_criteria: ["First criterion"],
    wizard_status: "editing",
    split_proposal_summary: null,
    created_at: "2026-04-03T00:00:00.000Z",
    updated_at: "2026-04-03T00:00:00.000Z",
    ...overrides,
  };
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });
}

function noopStateSetter<T>(): Dispatch<SetStateAction<T>> {
  return () => undefined;
}

function requireController(
  controller: WalleyBoardController | null,
): WalleyBoardController {
  if (controller === null) {
    throw new Error("Expected the controller to be available");
  }

  return controller;
}

test("an unresolved automatic AI review does not block alerts for unrelated actionable work", async () => {
  AudioStub.playCallCount = 0;
  const dom = installDom();
  const queryClient = createQueryClient();
  const root = createRoot(dom.mountNode);
  const originalFetch = globalThis.fetch;
  let currentDrafts: DraftTicketState[] = [];
  let latestReviewRunQueriesSettled = true;

  globalThis.fetch = (async () => {
    throw new Error("Unexpected network request during notification test");
  }) as typeof fetch;

  const autoReviewProject = createProject({
    id: "project-auto",
    slug: "project-auto",
    name: "Automatic Review Project",
    automatic_agent_review: true,
  });
  const manualProject = createProject({
    id: "project-manual",
    slug: "project-manual",
    name: "Manual Review Project",
  });
  const autoReviewTicket = createTicket({
    id: 41,
    project: autoReviewProject.id,
    repo: "repo-auto",
    session_id: "session-41",
    title: "Wait for AI review before notifying",
  });
  if (autoReviewTicket.session_id === null) {
    throw new Error("Expected auto-review fixture to include a session id");
  }
  const autoReviewSessionId = autoReviewTicket.session_id;
  const manualDraft = createDraft({
    id: "draft-52",
    project_id: manualProject.id,
    title_draft: "Need human clarification",
    wizard_status: "awaiting_confirmation",
    updated_at: "2026-04-03T00:06:00.000Z",
  });

  queryClient.setQueryData(["sessions", autoReviewSessionId], {
    agent_controls_worktree: false,
    session: createSession({
      id: autoReviewSessionId,
      project_id: autoReviewProject.id,
      repo_id: autoReviewTicket.repo,
      ticket_id: autoReviewTicket.id,
    }),
  });
  queryClient.setQueryData(
    ["tickets", autoReviewTicket.id, "review-run"],
    null,
  );

  function NotificationAiReviewHarness() {
    const tickets = [autoReviewTicket];
    const projects = [autoReviewProject, manualProject];
    const sessionsById = new Map([
      [
        autoReviewSessionId,
        {
          agent_controls_worktree: false,
          session: createSession({
            id: autoReviewSessionId,
            project_id: autoReviewProject.id,
            repo_id: autoReviewTicket.repo,
            ticket_id: autoReviewTicket.id,
          }),
        },
      ],
    ]);
    const {
      ticketAiReviewActiveById,
      ticketAiReviewResolvedById,
      reviewRunQueriesSettled,
    } = useTicketAiReviewStatus(tickets, projects);
    const { items, notificationKeys } = deriveInboxState({
      drafts: currentDrafts,
      projects,
      tickets,
      sessionsById,
      ticketAiReviewActiveById,
      ticketAiReviewResolvedById,
    });

    latestReviewRunQueriesSettled = reviewRunQueriesSettled;
    useInboxAlert({
      actionItemKeys: notificationKeys,
      visibleActionItemKeys: items.map((item) => item.notificationKey),
      inboxQueriesSettled: true,
    });

    return null;
  }

  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <NotificationAiReviewHarness />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });

    assert.equal(AudioStub.playCallCount, 0);
    assert.equal(latestReviewRunQueriesSettled, false);

    currentDrafts = [manualDraft];
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <NotificationAiReviewHarness />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });

    assert.equal(AudioStub.playCallCount, 0);
    await act(async () => {
      dom.flushScheduledCallbacks();
      await Promise.resolve();
    });

    assert.equal(AudioStub.playCallCount, 1);
    assert.equal(latestReviewRunQueriesSettled, false);
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    globalThis.fetch = originalFetch;
    queryClient.clear();
    dom.cleanup();
  }
});

test("review-run hydration does not replay a notification for already-actionable human review", async () => {
  AudioStub.playCallCount = 0;
  const dom = installDom();
  const queryClient = createQueryClient();
  const root = createRoot(dom.mountNode);
  const originalFetch = globalThis.fetch;
  let latestVisibleItemKeys: string[] = [];

  globalThis.fetch = (async () => {
    throw new Error("Unexpected network request during notification test");
  }) as typeof fetch;

  const autoReviewProject = createProject({
    id: "project-auto",
    slug: "project-auto",
    name: "Automatic Review Project",
    automatic_agent_review: true,
  });
  const autoReviewTicket = createTicket({
    id: 61,
    project: autoReviewProject.id,
    repo: "repo-auto",
    session_id: "session-61",
    title: "Do not replay when review-run hydration finishes",
  });
  if (autoReviewTicket.session_id === null) {
    throw new Error("Expected auto-review fixture to include a session id");
  }
  const autoReviewSessionId = autoReviewTicket.session_id;
  const sessionsById = new Map([
    [
      autoReviewSessionId,
      {
        agent_controls_worktree: false,
        session: createSession({
          id: autoReviewSessionId,
          project_id: autoReviewProject.id,
          repo_id: autoReviewTicket.repo,
          ticket_id: autoReviewTicket.id,
          last_summary:
            "Implementation finished and is waiting for human review.",
        }),
      },
    ],
  ]);

  queryClient.setQueryData(
    ["tickets", autoReviewTicket.id, "review-run"],
    null,
  );

  function NotificationHydrationHarness() {
    const { ticketAiReviewActiveById, ticketAiReviewResolvedById } =
      useTicketAiReviewStatus([autoReviewTicket], [autoReviewProject]);
    const { items, notificationKeys } = deriveInboxState({
      drafts: [],
      projects: [autoReviewProject],
      tickets: [autoReviewTicket],
      sessionsById,
      ticketAiReviewActiveById,
      ticketAiReviewResolvedById,
    });

    latestVisibleItemKeys = items.map((item) => item.key);
    useInboxAlert({
      actionItemKeys: notificationKeys,
      visibleActionItemKeys: items.map((item) => item.notificationKey),
      inboxQueriesSettled: true,
    });

    return null;
  }

  async function renderHarness(): Promise<void> {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <NotificationHydrationHarness />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });
  }

  try {
    await renderHarness();

    assert.deepEqual(latestVisibleItemKeys, []);
    assert.equal(AudioStub.playCallCount, 0);

    queryClient.setQueryData(["tickets", autoReviewTicket.id, "review-run"], {
      review_run: {
        id: "review-run-61",
        ticket_id: autoReviewTicket.id,
        review_package_id: "review-package-61",
        implementation_session_id: autoReviewSessionId,
        status: "completed",
        adapter_session_ref: null,
        prompt: "Review ticket #61.",
        report: null,
        failure_message: null,
        created_at: "2026-04-03T00:00:00.000Z",
        updated_at: "2026-04-03T00:02:00.000Z",
        completed_at: "2026-04-03T00:02:00.000Z",
      },
    });
    await renderHarness();

    assert.deepEqual(latestVisibleItemKeys, ["review-61"]);
    assert.equal(AudioStub.playCallCount, 0);
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    globalThis.fetch = originalFetch;
    queryClient.clear();
    dom.cleanup();
  }
});

test("saving an already-actionable draft does not replay the notification sound", async () => {
  AudioStub.playCallCount = 0;
  const dom = installDom();
  const queryClient = createQueryClient();
  const root = createRoot(dom.mountNode);
  let currentDraft = createDraft({
    id: "draft-71",
    title_draft: "Keep the existing notification instance",
    wizard_status: "awaiting_confirmation",
    updated_at: "2026-04-03T00:06:00.000Z",
  });

  function DraftSaveHarness() {
    const { items, notificationKeys } = deriveInboxState({
      drafts: [currentDraft],
      projects: [createProject()],
      tickets: [],
      sessionsById: new Map(),
    });

    useInboxAlert({
      actionItemKeys: notificationKeys,
      visibleActionItemKeys: items.map((item) => item.notificationKey),
      inboxQueriesSettled: true,
    });

    return null;
  }

  async function renderHarness(): Promise<void> {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <DraftSaveHarness />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });
  }

  try {
    await renderHarness();
    assert.equal(AudioStub.playCallCount, 0);

    currentDraft = {
      ...currentDraft,
      description_draft: "Edited while still awaiting confirmation.",
      updated_at: "2026-04-03T00:10:00.000Z",
    };
    await renderHarness();

    assert.equal(AudioStub.playCallCount, 0);
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    queryClient.clear();
    dom.cleanup();
  }
});

test("start-ticket silencing suppresses the next notification instance for that ticket", async () => {
  AudioStub.playCallCount = 0;
  const dom = installDom();
  const queryClient = createQueryClient();
  const root = createRoot(dom.mountNode);
  const originalFetch = globalThis.fetch;
  let currentActionItemKeys: string[] = [];
  let startTicket:
    | ((input: {
        planningEnabled: boolean;
        ticketId: number;
      }) => Promise<unknown>)
    | null = null;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.equal(input, "http://127.0.0.1:4000/tickets/12/start");

    return new Response(
      JSON.stringify({
        ok: true,
        message: "Ticket started",
        resource_refs: {
          project_id: "project-1",
          session_id: "session-12",
          ticket_id: 12,
        },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  }) as typeof fetch;

  function NotificationMutationHarness() {
    const { silenceNextInboxItemKey } = useInboxAlert({
      actionItemKeys: currentActionItemKeys,
      inboxQueriesSettled: true,
    });
    const mutations = useWalleyBoardMutations({
      queryClient,
      pendingDraftEditorSync: null,
      selectedDraftId: null,
      selectedProjectId: "project-1",
      selectedSessionId: null,
      selectProject: () => undefined,
      setArchiveActionFeedback: noopStateSetter(),
      setDefaultBranch: noopStateSetter(),
      setInspectorState: noopStateSetter(),
      setPendingDraftEditorSync: noopStateSetter(),
      setPlanFeedbackBody: noopStateSetter(),
      setProjectColor: noopStateSetter(),
      setProjectDeleteConfirmText: noopStateSetter(),
      setProjectModalOpen: noopStateSetter(),
      setProjectName: noopStateSetter(),
      setProjectOptionsFormError: noopStateSetter(),
      setProjectOptionsProjectId: noopStateSetter(),
      setProjectOptionsRepositoryTargetBranches: noopStateSetter(),
      setRepositoryPath: noopStateSetter(),
      setRequestedChangesBody: noopStateSetter(),
      setResumeReason: noopStateSetter(),
      setTerminalCommand: noopStateSetter(),
      setValidationCommandsText: noopStateSetter(),
      silenceNextInboxItemKey,
      tickets: [],
    });

    startTicket = mutations.startTicketMutation.mutateAsync;
    return null;
  }

  async function renderHarness(): Promise<void> {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <NotificationMutationHarness />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });
  }

  try {
    await renderHarness();
    assert.equal(AudioStub.playCallCount, 0);
    assert.notEqual(startTicket, null);

    await act(async () => {
      await startTicket?.({
        planningEnabled: false,
        ticketId: 12,
      });
    });

    currentActionItemKeys = [
      "session-12:session-12:attempt-1:awaiting_input:not_requested:none",
    ];
    await renderHarness();

    assert.equal(AudioStub.playCallCount, 0);

    currentActionItemKeys = [
      "session-12:session-12:attempt-2:awaiting_input:not_requested:none",
    ];
    await renderHarness();

    assert.equal(AudioStub.playCallCount, 0);
    await act(async () => {
      dom.flushScheduledCallbacks();
      await Promise.resolve();
    });

    assert.equal(AudioStub.playCallCount, 1);
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    globalThis.fetch = originalFetch;
    queryClient.clear();
    dom.cleanup();
  }
});

test("hidden review baselines do not play the notification sound", async () => {
  AudioStub.playCallCount = 0;
  const dom = installDom();
  const queryClient = createQueryClient();
  const root = createRoot(dom.mountNode);
  let currentActionItemKeys: string[] = [];
  const currentVisibleActionItemKeys: string[] = [];

  function HiddenReviewBaselineHarness() {
    useInboxAlert({
      actionItemKeys: currentActionItemKeys,
      visibleActionItemKeys: currentVisibleActionItemKeys,
      inboxQueriesSettled: true,
    });

    return null;
  }

  async function renderHarness(): Promise<void> {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <HiddenReviewBaselineHarness />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });
  }

  try {
    await renderHarness();
    assert.equal(AudioStub.playCallCount, 0);

    currentActionItemKeys = ["review-31:session-31:attempt-1"];
    await renderHarness();

    assert.equal(AudioStub.playCallCount, 0);
    await act(async () => {
      dom.flushScheduledCallbacks();
      await Promise.resolve();
    });
    assert.equal(AudioStub.playCallCount, 0);

    currentActionItemKeys = [];
    await renderHarness();

    assert.equal(AudioStub.playCallCount, 0);
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    queryClient.clear();
    dom.cleanup();
  }
});

test("brief actionable notifications that clear before the grace period stay silent", async () => {
  AudioStub.playCallCount = 0;
  const dom = installDom();
  const queryClient = createQueryClient();
  const root = createRoot(dom.mountNode);
  let currentActionItemKeys: string[] = [];
  let currentVisibleActionItemKeys: string[] = [];

  function GracePeriodHarness() {
    useInboxAlert({
      actionItemKeys: currentActionItemKeys,
      visibleActionItemKeys: currentVisibleActionItemKeys,
      inboxQueriesSettled: true,
    });

    return null;
  }

  async function renderHarness(): Promise<void> {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <GracePeriodHarness />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });
  }

  try {
    await renderHarness();

    currentActionItemKeys = ["draft-31"];
    currentVisibleActionItemKeys = ["draft-31"];
    await renderHarness();

    assert.equal(AudioStub.playCallCount, 0);

    currentActionItemKeys = [];
    currentVisibleActionItemKeys = [];
    await renderHarness();

    await act(async () => {
      dom.flushScheduledCallbacks();
      await Promise.resolve();
    });

    assert.equal(AudioStub.playCallCount, 0);
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    queryClient.clear();
    dom.cleanup();
  }
});

test("opening an inbox item marks that notification instance as read", async () => {
  const dom = installDom();
  const queryClient = createQueryClient();
  const root = createRoot(dom.mountNode);
  const originalFetch = globalThis.fetch;
  const storedProjects = [createProject()];
  const pendingDraft = createDraft({
    id: "draft-81",
    title_draft: "Review this draft once",
    wizard_status: "awaiting_confirmation",
  });
  let latestController: WalleyBoardController | null = null;

  globalThis.fetch = (async () => {
    throw new Error("Unexpected network request during notification test");
  }) as typeof fetch;

  queryClient.setQueryData(["health"], {
    ok: true,
    service: "backend",
    timestamp: "2026-04-03T00:00:00.000Z",
    codex_mcp_servers: ["context7"],
    docker: {
      installed: true,
      available: true,
      client_version: "1.0.0",
      server_version: "1.0.0",
      error: null,
    },
  });
  queryClient.setQueryData(["projects"], {
    projects: storedProjects,
  });
  queryClient.setQueryData(["projects", "project-1", "drafts"], {
    drafts: [pendingDraft],
  });
  queryClient.setQueryData(["projects", "project-1", "tickets"], {
    tickets: [],
  });
  queryClient.setQueryData(["projects", "project-1", "repositories"], {
    repositories: [],
  });
  queryClient.setQueryData(["drafts", pendingDraft.id, "events"], {
    active_run: false,
    events: [],
  });

  function InboxReadHarness() {
    latestController = useWalleyBoardController();
    return (
      <pre>
        {JSON.stringify({
          inspectorKind: latestController.inspectorState.kind,
          unreadCount: latestController.unreadActionItemCount,
        })}
      </pre>
    );
  }

  async function renderHarness(): Promise<void> {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <InboxReadHarness />
        </QueryClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  try {
    await renderHarness();

    const controllerAfterRender = requireController(latestController);
    assert.equal(controllerAfterRender.actionItems.length, 1);
    assert.equal(controllerAfterRender.unreadActionItemCount, 1);

    const inboxItem = controllerAfterRender.actionItems[0];
    assert.notEqual(inboxItem, undefined);

    await act(async () => {
      if (inboxItem) {
        controllerAfterRender.openInboxItem(inboxItem);
      }
      await Promise.resolve();
    });

    const controllerAfterOpen = requireController(latestController);
    assert.equal(controllerAfterOpen.unreadActionItemCount, 0);
    assert.equal(controllerAfterOpen.inspectorState.kind, "draft");

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });

    const remountedRoot = createRoot(dom.mountNode);
    try {
      await act(async () => {
        remountedRoot.render(
          <QueryClientProvider client={queryClient}>
            <InboxReadHarness />
          </QueryClientProvider>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const controllerAfterRemount = requireController(latestController);
      assert.equal(controllerAfterRemount.unreadActionItemCount, 0);
    } finally {
      await act(async () => {
        remountedRoot.unmount();
        await Promise.resolve();
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
    queryClient.clear();
    dom.cleanup();
  }
});
