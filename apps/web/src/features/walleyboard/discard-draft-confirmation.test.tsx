import assert from "node:assert/strict";
import test from "node:test";

import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import React, { act, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

import type {
  DraftTicketState,
  HealthResponse,
  Project,
  RepositoryConfig,
} from "../../../../../packages/contracts/src/index.js";

import {
  useWalleyBoardController,
  type WalleyBoardController,
} from "./use-walleyboard-controller.js";

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

type ScheduledHandle = {
  id: number;
  hasRef(): boolean;
  ref(): ScheduledHandle;
  unref(): ScheduledHandle;
  [Symbol.toPrimitive](): number;
};

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

async function flushAsyncWork(
  pendingCallbacks: Map<number, () => void>,
): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });

  while (pendingCallbacks.size > 0) {
    const callbacks = Array.from(pendingCallbacks.values());
    pendingCallbacks.clear();

    await act(async () => {
      for (const callback of callbacks) {
        callback();
      }

      await Promise.resolve();
    });
  }
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
  ];
  const pendingCallbacks = new Map<number, () => void>();
  let nextAsyncId = 1;
  const scheduleCallback = (
    callback: TimerHandler,
    args: unknown[],
  ): ScheduledHandle => {
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
    return {
      id,
      hasRef: () => false,
      ref() {
        return this;
      },
      unref() {
        return this;
      },
      [Symbol.toPrimitive]() {
        return id;
      },
    };
  };
  const clearScheduledCallback = (
    handle: number | ScheduledHandle | null | undefined,
  ): void => {
    if (handle === null || handle === undefined) {
      return;
    }

    const id = typeof handle === "number" ? handle : handle.id;
    pendingCallbacks.delete(id);
  };

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
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.setTimeout = ((
    callback: TimerHandler,
    _delay?: number,
    ...args: unknown[]
  ) => scheduleCallback(callback, args)) as unknown as typeof window.setTimeout;
  window.clearTimeout = ((handle: number | ScheduledHandle) => {
    clearScheduledCallback(handle);
  }) as typeof window.clearTimeout;
  window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    scheduleCallback(
      () => callback(Date.now()),
      [],
    )) as unknown as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((handle: number | ScheduledHandle) => {
    clearScheduledCallback(handle);
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
    flushAsyncWork: () => flushAsyncWork(pendingCallbacks),
    mountNode,
    window,
    cleanup() {
      mountNode.remove();
      for (const restore of restoreGlobals.reverse()) {
        restore();
      }
      dom.window.close();
    },
  };
}

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
    pre_worktree_command: null,
    post_worktree_command: null,
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
    name: "walleyboard",
    path: "/workspace",
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
  id: string,
  title: string,
  overrides: Partial<DraftTicketState> = {},
): DraftTicketState {
  return {
    id,
    project_id: "project-1",
    artifact_scope_id: `artifact-${id}`,
    title_draft: title,
    description_draft: "Draft body",
    proposed_repo_id: "repo-1",
    confirmed_repo_id: "repo-1",
    proposed_ticket_type: "feature",
    proposed_acceptance_criteria: [],
    wizard_status: "editing",
    split_proposal_summary: null,
    created_at: "2026-04-03T00:00:00.000Z",
    updated_at: "2026-04-03T00:00:00.000Z",
    ...overrides,
  };
}

function ControllerProbe({
  onController,
}: {
  onController: (controller: WalleyBoardController) => void;
}) {
  const controller = useWalleyBoardController();
  const callbackRef = useRef(onController);
  callbackRef.current = onController;

  useEffect(() => {
    callbackRef.current(controller);
  }, [controller]);

  return null;
}

function seedQueries(
  queryClient: QueryClient,
  options: {
    health?: HealthResponse;
    project?: Project;
    repository?: RepositoryConfig;
    drafts?: DraftTicketState[];
  } = {},
): void {
  const health = options.health ?? createHealth();
  const project = options.project ?? createProject();
  const repository = options.repository ?? createRepository();
  const drafts = options.drafts ?? [];

  queryClient.setQueryData(["health"], health);
  queryClient.setQueryData(["projects"], { projects: [project] });
  queryClient.setQueryData(["projects", project.id, "drafts"], { drafts });
  queryClient.setQueryData(["projects", project.id, "tickets"], {
    tickets: [],
  });
  queryClient.setQueryData(["projects", project.id, "repositories"], {
    repositories: [repository],
  });
  queryClient.setQueryData(["projects", project.id, "repository-branches"], {
    repository_branches: [
      {
        repository_id: repository.id,
        repository_name: repository.name,
        current_target_branch: repository.target_branch,
        branches: ["main"],
        error: null,
      },
    ],
  });
  queryClient.setQueryData(
    [
      "projects",
      project.id,
      "repositories",
      repository.id,
      "workspace",
      "preview",
    ],
    { preview: null },
  );

  for (const draft of drafts) {
    queryClient.setQueryData(["drafts", draft.id, "events"], {
      events: [],
      active_run: false,
    });
  }
}

async function renderControllerHarness(
  harness: ReturnType<typeof installDom>,
  options: {
    drafts?: DraftTicketState[];
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Number.POSITIVE_INFINITY,
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });
  seedQueries(queryClient, { drafts: options.drafts ?? [] });
  const root = createRoot(harness.mountNode);
  const originalFetch = globalThis.fetch;
  let latestController: WalleyBoardController | null = null;

  globalThis.fetch = (async (request) => {
    const url = new URL(
      typeof request === "string"
        ? request
        : request instanceof URL
          ? request.toString()
          : request.url,
    );

    switch (url.pathname) {
      case "/health":
        return Response.json(createHealth());
      case "/projects":
        return Response.json({
          projects: [createProject()],
        });
      case "/projects/project-1/drafts":
        return Response.json({ drafts: options.drafts ?? [] });
      case "/projects/project-1/tickets":
        return Response.json({ tickets: [] });
      case "/projects/project-1/repositories":
        return Response.json({ repositories: [createRepository()] });
      case "/projects/project-1/repository-branches":
        return Response.json({
          repository_branches: [
            {
              repository_id: "repo-1",
              repository_name: "walleyboard",
              current_target_branch: "main",
              branches: ["main"],
              error: null,
            },
          ],
        });
      case "/projects/project-1/repositories/repo-1/workspace/preview":
        return Response.json({ preview: null });
      default:
        if (
          url.pathname.startsWith("/drafts/") &&
          url.pathname.endsWith("/events")
        ) {
          return Response.json({ events: [], active_run: false });
        }
        return Response.json({});
    }
  }) as typeof fetch;

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MantineProvider>
          <ControllerProbe
            onController={(controller) => {
              latestController = controller;
            }}
          />
        </MantineProvider>
      </QueryClientProvider>,
    );
    await Promise.resolve();
  });

  await harness.flushAsyncWork();

  return {
    getController() {
      assert.ok(latestController, "Expected the controller to initialize");
      return latestController;
    },
    root,
    restoreFetch() {
      globalThis.fetch = originalFetch;
    },
  };
}

test("hideInspector shows confirmation modal when editing a dirty existing draft", async () => {
  const harness = installDom();

  try {
    const draft = createDraft("draft-1", "Original title");
    const { getController, root, restoreFetch } = await renderControllerHarness(
      harness,
      {
        drafts: [draft],
      },
    );

    try {
      await act(async () => {
        getController().selectProject("project-1");
      });
      await harness.flushAsyncWork();

      await act(async () => {
        getController().openDraft("draft-1");
      });
      await harness.flushAsyncWork();

      assert.equal(getController().inspectorState.kind, "draft");
      assert.equal(getController().draftFormDirty, false);
      assert.equal(getController().discardDraftConfirmOpen, false);

      await act(async () => {
        getController().setDraftEditorTitle("Modified title");
      });
      await harness.flushAsyncWork();

      assert.equal(getController().draftFormDirty, true);

      await act(async () => {
        getController().hideInspector();
      });
      await harness.flushAsyncWork();

      assert.equal(
        getController().discardDraftConfirmOpen,
        true,
        "Expected confirmation modal to open",
      );
      assert.equal(
        getController().inspectorState.kind,
        "draft",
        "Expected inspector to remain open",
      );
    } finally {
      await act(async () => {
        root.unmount();
      });
      restoreFetch();
    }
  } finally {
    harness.cleanup();
  }
});

test("hideInspector closes immediately when existing draft is not dirty", async () => {
  const harness = installDom();

  try {
    const draft = createDraft("draft-1", "Original title");
    const { getController, root, restoreFetch } = await renderControllerHarness(
      harness,
      {
        drafts: [draft],
      },
    );

    try {
      await act(async () => {
        getController().selectProject("project-1");
      });
      await harness.flushAsyncWork();

      await act(async () => {
        getController().openDraft("draft-1");
      });
      await harness.flushAsyncWork();

      assert.equal(getController().inspectorState.kind, "draft");
      assert.equal(getController().draftFormDirty, false);

      await act(async () => {
        getController().hideInspector();
      });
      await harness.flushAsyncWork();

      assert.equal(
        getController().discardDraftConfirmOpen,
        false,
        "Expected no confirmation modal",
      );
      assert.equal(
        getController().inspectorState.kind,
        "hidden",
        "Expected inspector to close",
      );
    } finally {
      await act(async () => {
        root.unmount();
      });
      restoreFetch();
    }
  } finally {
    harness.cleanup();
  }
});

test("confirmDiscardDraft closes modal and hides inspector", async () => {
  const harness = installDom();

  try {
    const draft = createDraft("draft-1", "Original title");
    const { getController, root, restoreFetch } = await renderControllerHarness(
      harness,
      {
        drafts: [draft],
      },
    );

    try {
      await act(async () => {
        getController().selectProject("project-1");
      });
      await harness.flushAsyncWork();

      await act(async () => {
        getController().openDraft("draft-1");
      });
      await harness.flushAsyncWork();

      await act(async () => {
        getController().setDraftEditorTitle("Modified title");
      });
      await harness.flushAsyncWork();

      await act(async () => {
        getController().hideInspector();
      });
      await harness.flushAsyncWork();

      assert.equal(getController().discardDraftConfirmOpen, true);

      await act(async () => {
        getController().confirmDiscardDraft();
      });
      await harness.flushAsyncWork();

      assert.equal(
        getController().discardDraftConfirmOpen,
        false,
        "Expected confirmation modal to close",
      );
      assert.equal(
        getController().inspectorState.kind,
        "hidden",
        "Expected inspector to close after confirm",
      );
    } finally {
      await act(async () => {
        root.unmount();
      });
      restoreFetch();
    }
  } finally {
    harness.cleanup();
  }
});

test("cancelDiscardDraft closes modal but keeps inspector open", async () => {
  const harness = installDom();

  try {
    const draft = createDraft("draft-1", "Original title");
    const { getController, root, restoreFetch } = await renderControllerHarness(
      harness,
      {
        drafts: [draft],
      },
    );

    try {
      await act(async () => {
        getController().selectProject("project-1");
      });
      await harness.flushAsyncWork();

      await act(async () => {
        getController().openDraft("draft-1");
      });
      await harness.flushAsyncWork();

      await act(async () => {
        getController().setDraftEditorTitle("Modified title");
      });
      await harness.flushAsyncWork();

      await act(async () => {
        getController().hideInspector();
      });
      await harness.flushAsyncWork();

      assert.equal(getController().discardDraftConfirmOpen, true);

      await act(async () => {
        getController().cancelDiscardDraft();
      });
      await harness.flushAsyncWork();

      assert.equal(
        getController().discardDraftConfirmOpen,
        false,
        "Expected confirmation modal to close",
      );
      assert.equal(
        getController().inspectorState.kind,
        "draft",
        "Expected inspector to stay open after cancel",
      );
      assert.equal(
        getController().draftFormDirty,
        true,
        "Expected draft to remain dirty after cancel",
      );
    } finally {
      await act(async () => {
        root.unmount();
      });
      restoreFetch();
    }
  } finally {
    harness.cleanup();
  }
});

test("hideInspector shows confirmation for new draft with content", async () => {
  const harness = installDom();

  try {
    const { getController, root, restoreFetch } =
      await renderControllerHarness(harness);

    try {
      await act(async () => {
        getController().selectProject("project-1");
      });
      await harness.flushAsyncWork();

      await act(async () => {
        getController().openNewDraft();
      });
      await harness.flushAsyncWork();

      assert.equal(getController().inspectorState.kind, "new_draft");

      await act(async () => {
        getController().setDraftEditorTitle("My new draft");
      });
      await harness.flushAsyncWork();

      await act(async () => {
        getController().hideInspector();
      });
      await harness.flushAsyncWork();

      assert.equal(
        getController().discardDraftConfirmOpen,
        true,
        "Expected confirmation modal for new draft with content",
      );
      assert.equal(
        getController().inspectorState.kind,
        "new_draft",
        "Expected inspector to remain open",
      );
    } finally {
      await act(async () => {
        root.unmount();
      });
      restoreFetch();
    }
  } finally {
    harness.cleanup();
  }
});

test("hideInspector closes immediately for empty new draft", async () => {
  const harness = installDom();

  try {
    const { getController, root, restoreFetch } =
      await renderControllerHarness(harness);

    try {
      await act(async () => {
        getController().selectProject("project-1");
      });
      await harness.flushAsyncWork();

      await act(async () => {
        getController().openNewDraft();
      });
      await harness.flushAsyncWork();

      assert.equal(getController().inspectorState.kind, "new_draft");

      await act(async () => {
        getController().hideInspector();
      });
      await harness.flushAsyncWork();

      assert.equal(
        getController().discardDraftConfirmOpen,
        false,
        "Expected no confirmation modal for empty new draft",
      );
      assert.equal(
        getController().inspectorState.kind,
        "hidden",
        "Expected inspector to close",
      );
    } finally {
      await act(async () => {
        root.unmount();
      });
      restoreFetch();
    }
  } finally {
    harness.cleanup();
  }
});
