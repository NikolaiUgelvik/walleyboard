import assert from "node:assert/strict";
import test from "node:test";

import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import React, { act, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import type {
  HealthResponse,
  Project,
  RepositoryConfig,
} from "../../../../../packages/contracts/src/index.js";

import { ProjectConfigurationModals } from "./ProjectConfigurationModals.js";
import {
  collectRepositoryTargetBranchUpdates,
  collectRepositoryValidationCommandUpdates,
  projectColorPalette,
} from "./shared-utils.js";
import {
  useWalleyBoardController,
  type WalleyBoardController,
} from "./use-walleyboard-controller.js";
import { useWalleyBoardServerState } from "./use-walleyboard-server-state.js";
import { WorkspaceTerminalContent } from "./WorkspaceTerminalContent.js";

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

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Number.POSITIVE_INFINITY,
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });
}

function seedWalleyBoardQueries(
  queryClient: QueryClient,
  health: HealthResponse,
  projects: Project[],
  repository: RepositoryConfig,
): void {
  queryClient.setQueryData(["health"], health);
  queryClient.setQueryData(["projects"], {
    projects,
  });
  const project = projects[0];
  if (!project) {
    return;
  }

  queryClient.setQueryData(["projects", project.id, "drafts"], {
    drafts: [],
  });
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
    {
      preview: null,
    },
  );
}
function ControllerModalHarness({
  mode,
  onCreateProject,
  onController,
  onUpdateProject,
}: {
  mode: "create" | "edit";
  onCreateProject?: (
    input: Parameters<
      WalleyBoardController["createProjectMutation"]["mutate"]
    >[0],
  ) => void;
  onController?: (controller: WalleyBoardController) => void;
  onUpdateProject?: (
    input: Parameters<
      WalleyBoardController["updateProjectMutation"]["mutate"]
    >[0],
  ) => void;
}) {
  const controller = useWalleyBoardController();
  const openedModalRef = useRef(false);

  useEffect(() => {
    onController?.(controller);
  }, [controller, onController]);

  useEffect(() => {
    if (openedModalRef.current) {
      return;
    }

    if (mode === "create") {
      openedModalRef.current = true;
      controller.openProjectModal();
      return;
    }

    const project = controller.projectsQuery.data?.projects[0] ?? null;
    if (project === null) {
      return;
    }

    openedModalRef.current = true;
    controller.openProjectOptions(project);
  }, [controller, mode]);

  const wrappedController = {
    ...controller,
    createProjectMutation: {
      ...controller.createProjectMutation,
      mutate: (
        input: Parameters<
          WalleyBoardController["createProjectMutation"]["mutate"]
        >[0],
      ) => {
        onCreateProject?.(input);
      },
    },
    updateProjectMutation: {
      ...controller.updateProjectMutation,
      mutate: (
        input: Parameters<
          WalleyBoardController["updateProjectMutation"]["mutate"]
        >[0],
      ) => {
        onUpdateProject?.(input);
      },
    },
    saveProjectOptions: () => {
      const project = controller.projectOptionsProject;
      if (project === null) {
        return;
      }

      onUpdateProject?.({
        draftAgentAdapter: controller.projectOptionsDraftAgentAdapter,
        ticketAgentAdapter: controller.projectOptionsTicketAgentAdapter,
        projectId: project.id,
        color: controller.projectOptionsPersistedColor,
        disabledMcpServers: controller.projectOptionsDisabledMcpServers,
        automaticAgentReview: controller.projectOptionsAutomaticAgentReview,
        automaticAgentReviewRunLimit:
          controller.projectOptionsAutomaticAgentReviewRunLimit,
        defaultReviewAction: controller.projectOptionsDefaultReviewAction,
        previewStartCommand: controller.projectOptionsPreviewStartCommandValue,
        worktreeInitCommand: controller.projectOptionsWorktreeInitCommandValue,
        worktreeTeardownCommand:
          controller.projectOptionsWorktreeTeardownCommandValue,
        worktreeInitRunSequential:
          controller.projectOptionsWorktreeInitRunSequential,
        draftAnalysisModel: controller.projectOptionsDraftModelValue,
        draftAnalysisReasoningEffort:
          controller.projectOptionsDraftReasoningEffortValue,
        ticketWorkModel: controller.projectOptionsTicketModelValue,
        ticketWorkReasoningEffort:
          controller.projectOptionsTicketReasoningEffortValue,
        repositoryTargetBranches: collectRepositoryTargetBranchUpdates({
          project,
          repositories: controller.projectOptionsRepositories,
          repositoryTargetBranches:
            controller.projectOptionsRepositoryTargetBranches,
        }),
        repositoryValidationCommands: collectRepositoryValidationCommandUpdates(
          {
            repositories: controller.projectOptionsRepositories,
            repositoryValidationCommands:
              controller.projectOptionsRepositoryValidationCommands,
          },
        ),
      });
    },
  } satisfies WalleyBoardController;

  return <ProjectConfigurationModals controller={wrappedController} />;
}

function ServerStateHarness({
  projectModalOpen,
  projectOptionsProjectId,
  selectedProjectId,
}: {
  projectModalOpen: boolean;
  projectOptionsProjectId: string | null;
  selectedProjectId: string | null;
}) {
  useWalleyBoardServerState({
    archiveModalOpen: false,
    draftEditorProjectId: null,
    projectModalOpen,
    projectOptionsProjectId,
    selectedDraftId: null,
    selectedProjectId,
    selectedSessionId: null,
  });

  return null;
}

async function renderControllerModalHarness(input: {
  harness: ReturnType<typeof installDom>;
  mode: "create" | "edit";
  onCreateProject?: (
    payload: Parameters<
      WalleyBoardController["createProjectMutation"]["mutate"]
    >[0],
  ) => void;
  onUpdateProject?: (
    payload: Parameters<
      WalleyBoardController["updateProjectMutation"]["mutate"]
    >[0],
  ) => void;
  projects?: Project[];
  health?: HealthResponse;
  project?: Project;
  projectsFetchGate?: Promise<void>;
  repository?: RepositoryConfig;
  seedProjectsQuery?: boolean;
}) {
  const queryClient = createQueryClient();
  const health = input.health ?? createHealth();
  const project = input.project ?? createProject();
  const projects = input.projects ?? [project];
  const repository = input.repository ?? createRepository();
  if (input.seedProjectsQuery ?? true) {
    seedWalleyBoardQueries(queryClient, health, projects, repository);
  } else {
    queryClient.setQueryData(["health"], health);
  }
  const root = createRoot(input.harness.mountNode);
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
        return Response.json(health);
      case "/projects":
        if (input.projectsFetchGate) {
          await input.projectsFetchGate;
        }
        return Response.json({
          projects,
        });
      case `/projects/${project.id}/drafts`:
        return Response.json({ drafts: [] });
      case `/projects/${project.id}/tickets`:
        return Response.json({ tickets: [] });
      case `/projects/${project.id}/repositories`:
        return Response.json({
          repositories: [repository],
        });
      case `/projects/${project.id}/repository-branches`:
        return Response.json({
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
      case `/projects/${project.id}/repositories/${repository.id}/workspace/preview`:
        return Response.json({
          preview: null,
        });
      default:
        throw new Error(`Unexpected fetch during modal test: ${url.pathname}`);
    }
  }) as typeof fetch;

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MantineProvider>
          <ControllerModalHarness
            mode={input.mode}
            onController={(controller) => {
              latestController = controller;
            }}
            {...(input.onCreateProject
              ? { onCreateProject: input.onCreateProject }
              : {})}
            {...(input.onUpdateProject
              ? { onUpdateProject: input.onUpdateProject }
              : {})}
          />
        </MantineProvider>
      </QueryClientProvider>,
    );
    await Promise.resolve();
  });

  await act(async () => {
    await Promise.resolve();
  });

  return {
    getController() {
      assert.ok(latestController, "Expected the controller to initialize");
      return latestController;
    },
    queryClient,
    root,
    restoreFetch() {
      globalThis.fetch = originalFetch;
    },
  };
}

test("repository terminal tabs preserve each tab instance and resolved path across tab switches", async () => {
  const harness = installDom();
  const root = createRoot(harness.mountNode);
  const mounts = new Map<string, number>();
  const unmounts = new Map<string, number>();

  const TerminalStub = ({
    socketPath,
    worktreePath,
  }: {
    socketPath: string;
    surfaceLabel: "ticket" | "repository";
    worktreePath: string | null;
  }) => {
    const [resolvedPath, setResolvedPath] = useState<string | null>(
      "starting...",
    );

    useEffect(() => {
      mounts.set(socketPath, (mounts.get(socketPath) ?? 0) + 1);

      return () => {
        unmounts.set(socketPath, (unmounts.get(socketPath) ?? 0) + 1);
      };
    }, [socketPath]);

    return (
      <div data-socket-path={socketPath}>
        <button type="button" onClick={() => setResolvedPath(worktreePath)}>
          Resolve {socketPath}
        </button>
        <span>{resolvedPath}</span>
      </div>
    );
  };

  const workspaceTerminalContext = {
    kind: "repository_tabs" as const,
    repositories: [
      {
        id: "repo-1",
        label: "repo",
        socketPath: "/projects/project-1/repositories/repo-1/terminal",
        worktreePath: "/tmp/repo",
      },
      {
        id: "repo-2",
        label: "api",
        socketPath: "/projects/project-1/repositories/repo-2/terminal",
        worktreePath: "/tmp/api",
      },
    ],
    surfaceLabel: "repository" as const,
  };

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <WorkspaceTerminalContent
            selectedSessionTicket={null}
            workspaceTerminalContext={workspaceTerminalContext}
            workspaceTerminalPanelState={{
              error: null,
              state: "preparing",
              worktreePath: null,
            }}
            TerminalComponent={TerminalStub}
            terminalInstanceKey={0}
          />
        </MantineProvider>,
      );
    });
    await harness.flushAsyncWork();

    const tabs = Array.from(
      harness.window.document.querySelectorAll<HTMLElement>('[role="tab"]'),
    );
    const repoTab = tabs.find((tab) => tab.textContent?.trim() === "repo");
    const apiTab = tabs.find((tab) => tab.textContent?.trim() === "api");
    assert.ok(repoTab);
    assert.ok(apiTab);

    const repoResolveButton = harness.window.document.querySelector(
      'div[data-socket-path="/projects/project-1/repositories/repo-1/terminal"] button',
    );
    assert.ok(repoResolveButton);
    await act(async () => {
      repoResolveButton.dispatchEvent(
        new harness.window.MouseEvent("click", {
          bubbles: true,
        }),
      );
    });
    await harness.flushAsyncWork();

    assert.equal(
      mounts.get("/projects/project-1/repositories/repo-1/terminal"),
      1,
    );
    assert.equal(
      mounts.get("/projects/project-1/repositories/repo-2/terminal") ?? 0,
      0,
    );

    await act(async () => {
      apiTab.dispatchEvent(
        new harness.window.MouseEvent("click", {
          bubbles: true,
        }),
      );
    });
    await harness.flushAsyncWork();

    const apiResolveButton = harness.window.document.querySelector(
      'div[data-socket-path="/projects/project-1/repositories/repo-2/terminal"] button',
    );
    assert.ok(apiResolveButton);
    assert.equal(
      mounts.get("/projects/project-1/repositories/repo-2/terminal"),
      1,
    );
    await act(async () => {
      apiResolveButton.dispatchEvent(
        new harness.window.MouseEvent("click", {
          bubbles: true,
        }),
      );
    });
    await harness.flushAsyncWork();

    await act(async () => {
      repoTab.dispatchEvent(
        new harness.window.MouseEvent("click", {
          bubbles: true,
        }),
      );
    });
    await harness.flushAsyncWork();

    const repoTerminal = harness.window.document.querySelector(
      'div[data-socket-path="/projects/project-1/repositories/repo-1/terminal"]',
    );
    assert.ok(repoTerminal);
    assert.match(repoTerminal.textContent ?? "", /\/tmp\/repo/);
    assert.equal(
      mounts.get("/projects/project-1/repositories/repo-1/terminal"),
      1,
    );
    assert.equal(
      unmounts.get("/projects/project-1/repositories/repo-1/terminal") ?? 0,
      0,
    );
    assert.equal(
      unmounts.get("/projects/project-1/repositories/repo-2/terminal") ?? 0,
      0,
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    harness.cleanup();
  }
});

test("repository branches are not fetched while the project options modal is closed", async () => {
  const harness = installDom();
  const queryClient = createQueryClient();
  const health = createHealth();
  const project = createProject();
  const repository = createRepository();
  const root = createRoot(harness.mountNode);
  const originalFetch = globalThis.fetch;
  let repositoryBranchesFetchCount = 0;

  queryClient.setQueryData(["health"], health);
  queryClient.setQueryData(["projects"], { projects: [project] });
  queryClient.setQueryData(["projects", project.id, "drafts"], {
    drafts: [],
  });
  queryClient.setQueryData(["projects", project.id, "tickets"], {
    tickets: [],
  });
  queryClient.setQueryData(["projects", project.id, "repositories"], {
    repositories: [repository],
  });

  globalThis.fetch = (async (request) => {
    const url = new URL(
      typeof request === "string"
        ? request
        : request instanceof URL
          ? request.toString()
          : request.url,
    );

    if (url.pathname === `/projects/${project.id}/repository-branches`) {
      repositoryBranchesFetchCount += 1;
    }

    throw new Error(
      `Unexpected fetch during server-state test: ${url.pathname}`,
    );
  }) as typeof fetch;

  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ServerStateHarness
            projectModalOpen={false}
            projectOptionsProjectId={project.id}
            selectedProjectId={project.id}
          />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });

    assert.equal(repositoryBranchesFetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    root.unmount();
    harness.cleanup();
  }
});

test("repository branches are fetched while the project options modal is open", async () => {
  const harness = installDom();
  const queryClient = createQueryClient();
  const health = createHealth();
  const project = createProject();
  const repository = createRepository();
  const root = createRoot(harness.mountNode);
  const originalFetch = globalThis.fetch;
  let repositoryBranchesFetchCount = 0;

  queryClient.setQueryData(["health"], health);
  queryClient.setQueryData(["projects"], { projects: [project] });
  queryClient.setQueryData(["projects", project.id, "drafts"], {
    drafts: [],
  });
  queryClient.setQueryData(["projects", project.id, "tickets"], {
    tickets: [],
  });
  queryClient.setQueryData(["projects", project.id, "repositories"], {
    repositories: [repository],
  });

  globalThis.fetch = (async (request) => {
    const url = new URL(
      typeof request === "string"
        ? request
        : request instanceof URL
          ? request.toString()
          : request.url,
    );

    if (url.pathname === `/projects/${project.id}/repository-branches`) {
      repositoryBranchesFetchCount += 1;
      return Response.json({
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
    }

    throw new Error(
      `Unexpected fetch during server-state test: ${url.pathname}`,
    );
  }) as typeof fetch;

  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ServerStateHarness
            projectModalOpen={true}
            projectOptionsProjectId={project.id}
            selectedProjectId={project.id}
          />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });

    await act(async () => {
      await Promise.resolve();
    });

    assert.equal(repositoryBranchesFetchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    root.unmount();
    harness.cleanup();
  }
});

test("create project modal submits the selected color through the controller workflow", async () => {
  const harness = installDom();
  let createPayload:
    | Parameters<WalleyBoardController["createProjectMutation"]["mutate"]>[0]
    | null = null;

  try {
    const { getController, restoreFetch, root } =
      await renderControllerModalHarness({
        harness,
        mode: "create",
        onCreateProject: (payload) => {
          createPayload = payload;
        },
      });

    try {
      const nameInput = harness.window.document.querySelector<HTMLInputElement>(
        'input[name="projectName"]',
      );
      const colorSwatches = Array.from(
        harness.window.document.querySelectorAll<HTMLButtonElement>(
          'button[role="radio"][aria-label^="Project color "]',
        ),
      );
      const repositoryInput =
        harness.window.document.querySelector<HTMLInputElement>(
          'input[name="repositoryPath"]',
        );
      const submitButton = Array.from(
        harness.window.document.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.trim() === "Add Project");

      assert.ok(nameInput, "Expected the project name field");
      assert.equal(colorSwatches.length, projectColorPalette.length);
      assert.equal(
        harness.window.document.querySelector('input[type="color"]'),
        null,
      );
      assert.ok(repositoryInput, "Expected the repository path field");
      assert.ok(submitButton, "Expected the create project submit button");

      await act(async () => {
        const controller = getController();
        controller.setProjectName("WalleyBoard");
        controller.setProjectColor("#F97316");
        controller.setRepositoryPath("/workspace");
      });

      assert.equal(nameInput.value, "WalleyBoard");
      assert.equal(repositoryInput.value, "/workspace");
      assert.equal(
        harness.window.document
          .querySelector(
            'button[role="radio"][aria-label="Project color #F97316"]',
          )
          ?.getAttribute("aria-checked"),
        "true",
      );

      await act(async () => {
        submitButton.dispatchEvent(
          new harness.window.MouseEvent("click", { bubbles: true }),
        );
        await Promise.resolve();
      });

      assert.deepEqual(createPayload, {
        color: "#F97316",
        defaultTargetBranch: "main",
        name: "WalleyBoard",
        repositoryPath: "/workspace",
        validationCommands: [],
      });
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

test("create project modal auto-selects a random unused swatch", async () => {
  const harness = installDom();
  const originalRandom = Math.random;

  try {
    Math.random = () => 0;
    const { getController, restoreFetch, root } =
      await renderControllerModalHarness({
        harness,
        mode: "create",
        projects: [createProject({ color: projectColorPalette[0] })],
      });

    try {
      assert.equal(getController().projectColor, projectColorPalette[1]);
      assert.equal(
        harness.window.document
          .querySelector(
            `button[role="radio"][aria-label="Project color ${projectColorPalette[1]}"]`,
          )
          ?.getAttribute("aria-checked"),
        "true",
      );
    } finally {
      await act(async () => {
        root.unmount();
      });
      restoreFetch();
    }
  } finally {
    Math.random = originalRandom;
    harness.cleanup();
  }
});

test("create project modal refreshes its auto-selected swatch after the projects query resolves", async () => {
  const harness = installDom();
  const originalRandom = Math.random;
  let releaseProjectsFetch: (() => void) | null = null;

  try {
    Math.random = () => 0;
    const projectsFetchGate = new Promise<void>((resolve) => {
      releaseProjectsFetch = resolve;
    });
    const { getController, restoreFetch, root } =
      await renderControllerModalHarness({
        harness,
        mode: "create",
        projects: [createProject({ color: projectColorPalette[0] })],
        projectsFetchGate,
        seedProjectsQuery: false,
      });

    try {
      assert.equal(getController().projectColor, projectColorPalette[0]);

      await act(async () => {
        releaseProjectsFetch?.();
        await Promise.resolve();
      });
      await harness.flushAsyncWork();

      assert.equal(getController().projectsQuery.data?.projects.length, 1);
      assert.equal(getController().projectColor, projectColorPalette[1]);
      assert.equal(
        harness.window.document
          .querySelector(
            `button[role="radio"][aria-label="Project color ${projectColorPalette[1]}"]`,
          )
          ?.getAttribute("aria-checked"),
        "true",
      );
    } finally {
      await act(async () => {
        root.unmount();
      });
      restoreFetch();
    }
  } finally {
    Math.random = originalRandom;
    harness.cleanup();
  }
});

test("edit project modal submits the updated color through the controller workflow", async () => {
  const harness = installDom();
  let updatePayload:
    | Parameters<WalleyBoardController["updateProjectMutation"]["mutate"]>[0]
    | null = null;

  try {
    const project = createProject({
      name: "WalleyBoard",
      color: "#0EA5E9",
    });
    const repository = createRepository({
      project_id: project.id,
    });
    const { getController, restoreFetch, root } =
      await renderControllerModalHarness({
        harness,
        mode: "edit",
        onUpdateProject: (payload) => {
          updatePayload = payload;
        },
        project,
        repository,
      });

    try {
      const colorSwatches = Array.from(
        harness.window.document.querySelectorAll<HTMLButtonElement>(
          'button[role="radio"][aria-label^="Project color "]',
        ),
      );
      assert.equal(colorSwatches.length, projectColorPalette.length);
      assert.equal(
        harness.window.document.querySelector('input[type="color"]'),
        null,
      );

      await act(async () => {
        getController().setProjectOptionsColor("#F97316");
      });

      assert.equal(
        harness.window.document
          .querySelector(
            'button[role="radio"][aria-label="Project color #F97316"]',
          )
          ?.getAttribute("aria-checked"),
        "true",
      );

      const saveButton = Array.from(
        harness.window.document.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.trim() === "Save Options");
      assert.ok(saveButton, "Expected the save options button");
      assert.equal(saveButton.disabled, false);

      await act(async () => {
        saveButton.dispatchEvent(
          new harness.window.MouseEvent("click", { bubbles: true }),
        );
        await Promise.resolve();
      });

      assert.deepEqual(updatePayload, {
        draftAgentAdapter: "codex",
        ticketAgentAdapter: "codex",
        automaticAgentReview: false,
        automaticAgentReviewRunLimit: 1,
        color: "#F97316",
        defaultReviewAction: "direct_merge",
        disabledMcpServers: [],
        draftAnalysisModel: null,
        draftAnalysisReasoningEffort: null,
        worktreeTeardownCommand: null,
        worktreeInitCommand: null,
        worktreeInitRunSequential: false,
        previewStartCommand: null,
        projectId: project.id,
        repositoryTargetBranches: [],
        repositoryValidationCommands: [],
        ticketWorkModel: null,
        ticketWorkReasoningEffort: null,
      });
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

test("edit project modal clamps an existing non-palette color to the default swatch", async () => {
  const harness = installDom();
  let updatePayload: {
    automaticAgentReview: boolean;
    color: string;
  } | null = null;

  try {
    const project = createProject({
      color: "#123456" as Project["color"],
    });
    const repository = createRepository({
      project_id: project.id,
    });
    const { getController, restoreFetch, root } =
      await renderControllerModalHarness({
        harness,
        mode: "edit",
        onUpdateProject: (payload) => {
          updatePayload = payload;
        },
        project,
        repository,
      });

    try {
      const saveButton = Array.from(
        harness.window.document.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.trim() === "Save Options");
      assert.ok(saveButton, "Expected the save options button");
      assert.equal(saveButton.disabled, true);
      assert.equal(
        harness.window.document
          .querySelector(
            `button[role="radio"][aria-label="Project color ${projectColorPalette[0]}"]`,
          )
          ?.getAttribute("aria-checked"),
        "true",
      );

      await act(async () => {
        getController().setProjectOptionsAutomaticAgentReview(true);
      });

      assert.equal(saveButton.disabled, false);

      await act(async () => {
        saveButton.dispatchEvent(
          new harness.window.MouseEvent("click", { bubbles: true }),
        );
        await Promise.resolve();
      });

      assert.ok(updatePayload, "Expected the project options save payload");
      const savedPayload = updatePayload as {
        automaticAgentReview: boolean;
        color: string;
      };
      assert.equal(savedPayload.color, projectColorPalette[0]);
      assert.equal(savedPayload.automaticAgentReview, true);
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

test("edit project modal renders Codex MCP server settings", async () => {
  const harness = installDom();

  try {
    const project = createProject({
      disabled_mcp_servers: ["sentry"],
    });
    const repository = createRepository({
      project_id: project.id,
    });
    const { restoreFetch, root } = await renderControllerModalHarness({
      harness,
      mode: "edit",
      project,
      repository,
    });

    try {
      const modalText = harness.window.document.body.textContent ?? "";

      assert.match(modalText, /Codex MCP servers/);
      assert.match(modalText, /context7/);
      assert.match(modalText, /sentry/);
      assert.match(
        modalText,
        /These toggles currently apply to Docker-backed Codex runs/,
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

test("edit project modal preserves the selected Claude Code adapter without health overrides", async () => {
  const harness = installDom();
  let updatePayload: {
    draftAgentAdapter: Project["draft_analysis_agent_adapter"];
    ticketAgentAdapter: Project["ticket_work_agent_adapter"];
  } | null = null;

  try {
    const project = createProject({
      agent_adapter: "claude-code",
      draft_analysis_agent_adapter: "claude-code",
      ticket_work_agent_adapter: "claude-code",
    });
    const repository = createRepository({
      project_id: project.id,
    });
    const { getController, restoreFetch, root } =
      await renderControllerModalHarness({
        harness,
        mode: "edit",
        onUpdateProject: (payload) => {
          updatePayload = payload;
        },
        project,
        repository,
      });

    try {
      const agentInput =
        harness.window.document.querySelector<HTMLInputElement>(
          'input[role="combobox"]',
        );
      assert.ok(agentInput, "Expected the project options agent CLI field");
      assert.equal(agentInput.value, "Claude Code");

      const modalText = harness.window.document.body.textContent ?? "";
      assert.doesNotMatch(modalText, /Claude Code is currently unavailable/);

      await act(async () => {
        getController().setProjectOptionsColor("#F97316");
        await Promise.resolve();
      });

      const saveButton = Array.from(
        harness.window.document.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.trim() === "Save Options");
      assert.ok(saveButton, "Expected the save options button");

      await act(async () => {
        saveButton.dispatchEvent(
          new harness.window.MouseEvent("click", { bubbles: true }),
        );
        await Promise.resolve();
      });

      assert.ok(updatePayload, "Expected the modal save to emit an update");
      const emittedPayload = updatePayload as {
        draftAgentAdapter: Project["draft_analysis_agent_adapter"];
        ticketAgentAdapter: Project["ticket_work_agent_adapter"];
      };
      assert.equal(emittedPayload.draftAgentAdapter, "claude-code");
      assert.equal(emittedPayload.ticketAgentAdapter, "claude-code");
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

test("edit project modal no longer shows Claude-specific health status", async () => {
  const harness = installDom();
  let updatePayload: {
    draftAgentAdapter: Project["draft_analysis_agent_adapter"];
    ticketAgentAdapter: Project["ticket_work_agent_adapter"];
  } | null = null;

  try {
    const project = createProject({
      agent_adapter: "claude-code",
      draft_analysis_agent_adapter: "claude-code",
      ticket_work_agent_adapter: "claude-code",
    });
    const repository = createRepository({
      project_id: project.id,
    });
    const { getController, restoreFetch, root } =
      await renderControllerModalHarness({
        harness,
        mode: "edit",
        onUpdateProject: (payload) => {
          updatePayload = payload;
        },
        project,
        repository,
      });

    try {
      const agentInput =
        harness.window.document.querySelector<HTMLInputElement>(
          'input[role="combobox"]',
        );
      assert.ok(agentInput, "Expected the project options agent CLI field");
      assert.equal(agentInput.value, "Claude Code");

      const modalText = harness.window.document.body.textContent ?? "";
      assert.doesNotMatch(modalText, /Claude Code CLI is available/);

      await act(async () => {
        getController().setProjectOptionsColor("#F97316");
        await Promise.resolve();
      });

      const saveButton = Array.from(
        harness.window.document.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.trim() === "Save Options");
      assert.ok(saveButton, "Expected the save options button");

      await act(async () => {
        saveButton.dispatchEvent(
          new harness.window.MouseEvent("click", { bubbles: true }),
        );
        await Promise.resolve();
      });

      assert.ok(updatePayload, "Expected the modal save to emit an update");
      const emittedPayload = updatePayload as {
        draftAgentAdapter: Project["draft_analysis_agent_adapter"];
        ticketAgentAdapter: Project["ticket_work_agent_adapter"];
      };
      assert.equal(emittedPayload.draftAgentAdapter, "claude-code");
      assert.equal(emittedPayload.ticketAgentAdapter, "claude-code");
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
