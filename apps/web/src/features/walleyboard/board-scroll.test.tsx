import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MantineProvider } from "@mantine/core";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  DraftTicketState,
  HealthResponse,
  Project,
  RepositoryConfig,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import { BoardView } from "./BoardView.js";
import { InspectorPane } from "./InspectorPane.js";
import { ProjectRail } from "./ProjectRail.js";
import { boardColumns } from "./shared.js";
import type { WalleyBoardController } from "./use-walleyboard-controller.js";

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const stylesheet = readFileSync(
  new URL("../../app-shell.css", import.meta.url),
  "utf8",
);

class ResizeObserverStub {
  disconnect(): void {}
  observe(): void {}
  unobserve(): void {}
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
    installGlobal("navigator", window.navigator),
    installGlobal("Element", window.Element),
    installGlobal("HTMLElement", window.HTMLElement),
    installGlobal("MutationObserver", window.MutationObserver),
    installGlobal("Node", window.Node),
    installGlobal("ResizeObserver", ResizeObserverStub),
    installGlobal("ShadowRoot", window.ShadowRoot),
    installGlobal("SVGElement", window.SVGElement),
  ];

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
  window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    window.setTimeout(
      () => callback(Date.now()),
      0,
    )) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) => {
    window.clearTimeout(id);
  }) as typeof window.cancelAnimationFrame;
  restoreGlobals.push(
    installGlobal("getComputedStyle", window.getComputedStyle.bind(window)),
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
    cleanup: () => {
      mountNode.remove();
      for (const restore of restoreGlobals.reverse()) {
        restore();
      }
      dom.window.close();
    },
    mountNode,
    window,
  };
}

function installStylesheet(document: Document, cssText: string): () => void {
  const styleTag = document.createElement("style");
  styleTag.textContent = cssText;
  document.head.append(styleTag);

  return () => {
    styleTag.remove();
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countClass(markup: string, className: string): number {
  return [...markup.matchAll(/class="([^"]*)"/g)].filter((match) =>
    match[1]?.split(/\s+/).includes(className),
  ).length;
}

function extractWorkbenchHeaderMarkup(markup: string): string {
  const headerStart = markup.indexOf('class="workbench-header"');
  assert.notEqual(headerStart, -1, "Expected board markup to include a header");

  const toolbarStart = markup.indexOf('class="workbench-toolbar"', headerStart);
  assert.notEqual(
    toolbarStart,
    -1,
    "Expected board markup to include the toolbar after the header",
  );

  return markup.slice(headerStart, toolbarStart);
}

function extractBlock(source: string, marker: string): string {
  const { blockEnd, blockStart } = findBlockRange(source, marker);

  return source.slice(blockStart + 1, blockEnd);
}

function findBlockRange(
  source: string,
  marker: string,
): {
  blockEnd: number;
  blockStart: number;
  markerIndex: number;
} {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Missing CSS block for ${marker}`);

  const blockStart = source.indexOf("{", markerIndex);
  assert.notEqual(blockStart, -1, `Missing opening brace for ${marker}`);

  let depth = 1;
  for (let index = blockStart + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          blockEnd: index,
          blockStart,
          markerIndex,
        };
      }
    }
  }

  throw new Error(`Missing closing brace for ${marker}`);
}

function installMediaStylesheet(
  document: Document,
  marker: string,
): () => void {
  const { blockEnd, markerIndex } = findBlockRange(stylesheet, marker);
  const mediaBlock = extractBlock(stylesheet, marker);
  const mediaStylesheet =
    stylesheet.slice(0, markerIndex) +
    mediaBlock +
    stylesheet.slice(blockEnd + 1);

  return installStylesheet(document, mediaStylesheet);
}

function installDesktopStylesheet(document: Document): () => void {
  return installMediaStylesheet(document, "@media (min-width: 901px)");
}

function installNarrowStylesheet(document: Document): () => void {
  return installMediaStylesheet(document, "@media (max-width: 900px)");
}

async function waitForElement(
  document: Document,
  selector: string,
  delayMs = 10,
  timeoutMs = 500,
): Promise<HTMLElement> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) {
      return element;
    }

    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${selector}`);
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

function assertRuleIncludes(
  source: string,
  selector: string,
  declarations: string[],
): void {
  const rulePattern = new RegExp(
    `${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`,
    "m",
  );
  const match = source.match(rulePattern);
  assert.ok(match, `Missing CSS rule for ${selector}`);
  const declarationsBlock = match[1];
  assert.ok(declarationsBlock, `Missing declarations for ${selector}`);

  for (const declaration of declarations) {
    assert.match(
      declarationsBlock,
      new RegExp(`${escapeRegExp(declaration)}\\s*;`),
      `Missing declaration ${declaration} in ${selector}`,
    );
  }
}

function createProject(): Project {
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
  };
}

function createRepository(): RepositoryConfig {
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
  };
}

function createDraft(id: string, title: string): DraftTicketState {
  return {
    id,
    project_id: "project-1",
    artifact_scope_id: `artifact-${id}`,
    title_draft: title,
    description_draft: "Draft body",
    proposed_repo_id: "repo-1",
    confirmed_repo_id: "repo-1",
    proposed_ticket_type: "feature",
    proposed_acceptance_criteria: ["Board scrolls as one surface"],
    wizard_status: "editing",
    split_proposal_summary: null,
    created_at: "2026-04-03T00:00:00.000Z",
    updated_at: "2026-04-03T00:00:00.000Z",
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

function createTicket(
  overrides: Partial<TicketFrontmatter> = {},
): TicketFrontmatter {
  return {
    acceptance_criteria: ["Keep the ticket editable before start."],
    artifact_scope_id: "artifact-ticket-24",
    created_at: "2026-04-03T00:00:00.000Z",
    description: "Move a ready ticket back into the draft editor.",
    id: 24,
    linked_pr: null,
    project: "project-1",
    repo: "repo-1",
    session_id: null,
    status: "ready",
    target_branch: "main",
    ticket_type: "feature",
    title: "Allow editing ready tickets",
    updated_at: "2026-04-03T00:00:00.000Z",
    working_branch: null,
    ...overrides,
  };
}

function createMutationStub() {
  return {
    isPending: false,
    isError: false,
    variables: null,
    error: null,
    mutate: () => undefined,
  };
}

function createWalleyBoardController(): WalleyBoardController {
  const project = createProject();
  const repository = createRepository();
  const drafts = [
    createDraft("draft-1", "Capture draft 1"),
    createDraft("draft-2", "Capture draft 2"),
    createDraft("draft-3", "Capture draft 3"),
  ];

  return {
    actionItems: [],
    unreadActionItemCount: 0,
    unreadInboxItemKeys: new Set<string>(),
    archiveActionFeedback: null,
    archiveDoneTickets: () => undefined,
    archiveDoneTicketsMutation: createMutationStub(),
    archiveTicketMutation: createMutationStub(),
    archiveModalOpen: false,
    archivedTicketsQuery: {
      isPending: false,
      isError: false,
      data: { tickets: [] },
      error: null,
    },
    boardError: null,
    boardLoading: false,
    boardSearch: "",
    closeArchiveModal: () => undefined,
    closeProjectOptionsModal: () => undefined,
    closeWorkspaceModal: () => undefined,
    doneColumnTickets: [],
    groupedTickets: {
      ready: [],
      in_progress: [],
      review: [],
      done: [],
    },
    healthQuery: {
      data: createHealth(),
    },
    hideInspector: () => undefined,
    inspectorState: { kind: "hidden" },
    inspectorVisible: false,
    isDraftRefinementActive: () => false,
    openArchiveModal: () => undefined,
    openArchivedTicketDiff: () => undefined,
    openDraft: () => undefined,
    openInboxItem: () => undefined,
    openNewDraft: () => undefined,
    openProjectOptions: () => undefined,
    projectOptionsProject: null,
    projectsQuery: {
      isPending: false,
      isError: false,
      data: { projects: [project] },
      error: null,
    },
    repositories: [repository],
    restoreTicketMutation: createMutationStub(),
    selectedDraftId: null,
    selectedProject: project,
    selectedProjectId: project.id,
    selectedRepository: repository,
    selectedSessionId: null,
    selectedSessionTicket: null,
    selectProject: () => undefined,
    session: null,
    sessionById: new Map(),
    sessionLogs: [],
    sessionLogsQuery: {
      isPending: false,
      isError: false,
      error: null,
    },
    sessionQuery: {
      isPending: false,
      isError: false,
      error: null,
    },
    setBoardSearch: () => undefined,
    setInspectorState: () => undefined,
    setProjectModalOpen: () => undefined,
    setTicketWorkspaceDiffLayout: () => undefined,
    stopAgentReviewMutation: createMutationStub(),
    updateVisibleTicketIds: () => undefined,
    ticketDiffLineSummaryByTicketId: new Map(),
    ticketWorkspaceDiff: null,
    ticketWorkspaceDiffLayout: "split",
    ticketWorkspaceDiffQuery: {
      isPending: false,
      isError: false,
      error: null,
      data: null,
    },
    visibleDrafts: drafts,
    workspaceModal: null,
  } as unknown as WalleyBoardController;
}

test("board uses a shared vertical scroller while the shell stays fixed", () => {
  const controller = createWalleyBoardController();
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <div className="walleyboard-shell">
        <div className="walleyboard-layout">
          <ProjectRail controller={controller} />
          <BoardView controller={controller} />
          <InspectorPane controller={controller} />
        </div>
      </div>
    </MantineProvider>,
  );
  const desktopRules = extractBlock(stylesheet, "@media (min-width: 901px)");

  assert.match(markup, /\bwalleyboard-shell\b/);
  assert.match(markup, /\bwalleyboard-layout\b/);
  assert.match(markup, /\bwalleyboard-rail\b/);
  assert.match(markup, /\bwalleyboard-main\b/);
  assert.equal(countClass(markup, "board-scroll-shell"), 1);
  assert.equal(countClass(markup, "board-column"), boardColumns.length);
  assert.equal(countClass(markup, "board-column-stack"), boardColumns.length);
  assert.equal(countClass(markup, "board-card"), 3);
  assert.equal(countClass(markup, "board-empty"), boardColumns.length - 1);

  assertRuleIncludes(stylesheet, ".board-empty", ["flex: 1"]);
  assertRuleIncludes(desktopRules, ".walleyboard-shell", [
    "height: 100dvh",
    "overflow-x: hidden",
    "overflow-y: hidden",
  ]);
  assertRuleIncludes(desktopRules, ".walleyboard-layout", [
    "height: 100%",
    "min-height: 100%",
  ]);
  assertRuleIncludes(desktopRules, ".walleyboard-main", [
    "display: flex",
    "flex-direction: column",
  ]);
  assertRuleIncludes(stylesheet, ".board-scroll-shell", [
    "flex: 1",
    "min-height: 0",
  ]);
  assertRuleIncludes(desktopRules, ".board-scroller", [
    "overflow-x: auto",
    "overflow-y: auto",
  ]);
  assertRuleIncludes(stylesheet, ".board-scroll-inner", [
    "min-width: 1360px",
    "position: relative",
  ]);
  assertRuleIncludes(stylesheet, ".board-grid", ["position: sticky", "top: 0"]);
  assertRuleIncludes(desktopRules, ".board-grid", [
    "min-height: 0",
    "align-items: stretch",
  ]);
  assert.doesNotMatch(
    desktopRules,
    /\.board-column-stack\s*\{[^}]*overflow-y:\s*auto\s*;/,
  );
  assert.match(
    desktopRules,
    /\.walleyboard-rail,\s*\.walleyboard-main,\s*\.walleyboard-detail\s*\{[^}]*min-height:\s*0\s*;/,
  );
  assert.match(
    desktopRules,
    /\.walleyboard-rail,\s*\.walleyboard-detail\s*\{[^}]*overflow-y:\s*auto\s*;/,
  );
});

test("narrow layout keeps the board region constrained to the shared scroller", () => {
  const narrowRules = extractBlock(stylesheet, "@media (max-width: 900px)");

  assertRuleIncludes(stylesheet, ".walleyboard-shell", [
    "height: 100dvh",
    "overflow-x: hidden",
    "overflow-y: hidden",
  ]);
  assertRuleIncludes(stylesheet, ".walleyboard-layout", [
    "height: 100%",
    "min-height: 100%",
  ]);
  assertRuleIncludes(stylesheet, ".walleyboard-main", [
    "display: flex",
    "flex-direction: column",
  ]);
  assertRuleIncludes(stylesheet, ".workbench-shell", [
    "flex: 1",
    "min-height: 0",
  ]);
  assertRuleIncludes(stylesheet, ".board-scroller", [
    "flex: 1",
    "min-height: 0",
    "overflow-x: auto",
    "overflow-y: auto",
  ]);
  assertRuleIncludes(stylesheet, ".board-grid", [
    "min-height: 0",
    "align-items: stretch",
  ]);
  assertRuleIncludes(narrowRules, ".walleyboard-layout", [
    "grid-template-columns: 1fr",
    "grid-template-rows: auto minmax(0, 1fr) auto",
  ]);
  assertRuleIncludes(narrowRules, ".board-column", [
    "min-height: auto",
    "height: auto",
  ]);
  assert.doesNotMatch(
    stylesheet,
    /\.board-column-stack\s*\{[^}]*overflow-y:\s*auto\s*;/,
  );
});

test("project rail renders compact tiles with initials, titles, and the create tile", () => {
  const controller = createWalleyBoardController();
  const project = {
    ...createProject(),
    name: "Web App",
    color: "#0EA5E9",
  };
  const secondProject = {
    ...createProject(),
    id: "project-2",
    slug: "project-2",
    name: "Platform Ops",
    color: "#22C55E",
  };
  Object.assign(controller as Record<string, unknown>, {
    actionItems: [
      {
        key: "session-17",
        notificationKey: "session-17:attempt-1",
        title: "Needs review",
        message: "Agent work is waiting for a decision.",
        projectId: project.id,
        projectColor: project.color,
        projectName: project.name,
        targetId: "session-17",
        targetKind: "session",
        actionLabel: "Open session",
        color: "yellow",
      },
    ],
    unreadActionItemCount: 1,
    projectsQuery: {
      isPending: false,
      isError: false,
      data: { projects: [project, secondProject] },
      error: null,
    },
    selectedProject: project,
  });

  const markup = renderToStaticMarkup(
    <MantineProvider>
      <ProjectRail controller={controller} />
    </MantineProvider>,
  );

  assert.match(
    markup,
    /aria-label="Open notifications, 1 actionable notification item"/,
  );
  assert.match(markup, /data-attention="true"/);
  assert.match(markup, /aria-label="Open project Web App"/);
  assert.match(markup, /title="Web App"/);
  assert.match(markup, />WA</);
  assert.match(markup, /aria-label="Open project Platform Ops"/);
  assert.match(markup, />PO</);
  assert.match(markup, /aria-label="Create project"/);
  assert.match(markup, /--project-tile-color:#D97706/i);
  assert.match(markup, /--project-tile-color:#64748B/i);
  assert.match(markup, /--project-tile-color:#0EA5E9/i);
  assert.match(markup, /class="project-tile-badge" data-unread="true">1</);
});

test("inbox badge shows the exact actionable count and hides at zero", async () => {
  const harness = installDom();
  const root = createRoot(harness.mountNode);
  const controller = createWalleyBoardController();
  const actionItems = Array.from({ length: 12 }, (_, index) => {
    const sequence = index + 1;
    const isSession = index % 2 === 0;

    return {
      key: isSession ? `session-${sequence}` : `draft-${sequence}`,
      notificationKey: isSession
        ? `session-${sequence}:attempt-1`
        : `draft-${sequence}:version-1`,
      title: isSession ? `Session item ${sequence}` : `Draft item ${sequence}`,
      message: isSession
        ? "Agent work is waiting for a decision."
        : "This draft is waiting for a decision.",
      projectId: "project-1",
      projectColor: isSession ? "#F97316" : "#2563EB",
      projectName: "Project One",
      targetId: isSession ? `session-${sequence}` : `draft-${sequence}`,
      targetKind: isSession ? "session" : "draft",
      actionLabel: isSession ? "Open session" : "Open draft",
      color: isSession ? "yellow" : "blue",
    };
  });

  Object.assign(controller as Record<string, unknown>, {
    actionItems,
    unreadActionItemCount: actionItems.length,
  });

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <ProjectRail controller={controller} />
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    assert.equal(
      harness.window.document.querySelector(".project-tile-badge")?.textContent,
      "12",
    );
    assert.equal(
      harness.window.document
        .querySelector("button.project-tile")
        ?.getAttribute("aria-label"),
      "Open notifications, 12 actionable notification items",
    );

    Object.assign(controller as Record<string, unknown>, {
      actionItems: [],
      unreadActionItemCount: 0,
    });

    await act(async () => {
      root.render(
        <MantineProvider>
          <ProjectRail controller={controller} />
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    assert.equal(
      harness.window.document.querySelector(".project-tile-badge"),
      null,
    );
    assert.equal(
      harness.window.document
        .querySelector("button.project-tile")
        ?.getAttribute("aria-label"),
      "Open notifications",
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    harness.cleanup();
  }
});

test("inbox badge cools off when only read notifications remain and create stays gray", () => {
  const controller = createWalleyBoardController();
  Object.assign(controller as Record<string, unknown>, {
    actionItems: [
      {
        key: "draft-44",
        notificationKey: "draft-44:version-1",
        title: "Clarify acceptance criteria",
        message: "This draft is waiting for a decision.",
        projectId: "project-1",
        projectColor: "#2563EB",
        projectName: "Project One",
        targetId: "draft-44",
        targetKind: "draft",
        actionLabel: "Open draft",
        color: "blue",
      },
    ],
    unreadActionItemCount: 0,
  });

  const markup = renderToStaticMarkup(
    <MantineProvider>
      <ProjectRail controller={controller} />
    </MantineProvider>,
  );

  assert.match(markup, /data-attention="false"/);
  assert.match(markup, /class="project-tile-badge" data-unread="false">1</);
  assert.match(markup, /--project-tile-color:#64748B/i);
  assert.doesNotMatch(markup, /--project-tile-color:#D97706/i);
});

test("project rail disambiguates duplicate initials without relying on hover text", () => {
  const controller = createWalleyBoardController();
  Object.assign(controller as Record<string, unknown>, {
    projectsQuery: {
      isPending: false,
      isError: false,
      data: {
        projects: [
          {
            ...createProject(),
            name: "Web App",
            color: "#0EA5E9",
          },
          {
            ...createProject(),
            id: "project-2",
            slug: "project-2",
            name: "Workspace Automation",
            color: "#22C55E",
          },
        ],
      },
      error: null,
    },
  });

  const markup = renderToStaticMarkup(
    <MantineProvider>
      <ProjectRail controller={controller} />
    </MantineProvider>,
  );

  assert.match(markup, /title="Web App"/);
  assert.match(markup, /title="Workspace Automation"/);
  assert.match(markup, />WEB</);
  assert.match(markup, />WOR</);
});

test("inbox tile opens a floating overlay and selects inbox items", async () => {
  const harness = installDom();
  const root = createRoot(harness.mountNode);
  let openedInboxItemKey: string | null = null;
  const controller = createWalleyBoardController();
  const inboxItem = {
    key: "draft-44",
    notificationKey: "draft-44:version-1",
    title: "Clarify acceptance criteria",
    message: "This draft is waiting for a decision.",
    projectId: "project-1",
    projectColor: "#2563EB",
    projectName: "Project One",
    targetId: "draft-44",
    targetKind: "draft" as const,
    actionLabel: "Open draft",
    color: "blue" as const,
  };

  Object.assign(controller as Record<string, unknown>, {
    actionItems: [inboxItem],
    unreadActionItemCount: 1,
    openInboxItem: (item: { key: string }) => {
      openedInboxItemKey = item.key;
    },
  });

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <ProjectRail controller={controller} />
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    const inboxButton = harness.window.document.querySelector<HTMLElement>(
      'button.project-tile[aria-label^="Open notifications"]',
    );
    assert.ok(inboxButton, "Expected the inbox tile to render");

    await act(async () => {
      inboxButton.dispatchEvent(
        new harness.window.MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
      await new Promise((resolve) => harness.window.setTimeout(resolve, 0));
    });

    const overlayItem = await waitForElement(
      harness.window.document,
      "button.project-inbox-item",
    );
    assert.ok(overlayItem, "Expected the inbox overlay to open");
    assert.match(
      overlayItem.getAttribute("style") ?? "",
      /--project-inbox-accent:\s*#2563EB/i,
    );
    assert.match(
      harness.window.document.body.textContent ?? "",
      /Clarify acceptance criteria/,
    );

    await act(async () => {
      overlayItem.dispatchEvent(
        new harness.window.MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    assert.equal(openedInboxItemKey, "draft-44");
  } finally {
    await act(async () => {
      root.unmount();
    });
    harness.cleanup();
  }
});

test("board header keeps the selected project name and inline controls without repository summary or status badges", () => {
  const controller = createWalleyBoardController();
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <BoardView controller={controller} />
    </MantineProvider>,
  );
  const headerMarkup = extractWorkbenchHeaderMarkup(markup);

  assert.doesNotMatch(markup, />Project board</);
  assert.match(markup, />Project One</);
  assert.match(markup, />System</);
  assert.match(markup, />Preview</);
  assert.match(markup, />Terminal</);
  assert.equal((headerMarkup.match(/--group-wrap:nowrap/g) ?? []).length, 2);
  assert.match(headerMarkup, /class="workbench-header-title"/);
  assert.match(
    headerMarkup,
    /overflow:hidden;text-overflow:ellipsis;white-space:nowrap/,
  );
  assert.doesNotMatch(markup, />walleyboard • 0 validation command\(s\)</);
  assert.doesNotMatch(markup, />backend</);
  assert.doesNotMatch(markup, />0 running</);
  assert.doesNotMatch(markup, />0 queued</);
  assert.doesNotMatch(markup, />0 in review</);
});

test("board header keeps repository preview errors inline with the selected-project controls", () => {
  const controller = createWalleyBoardController();
  Object.assign(controller as Record<string, unknown>, {
    repositoryPreviewActionError:
      "Preview is running, but the browser blocked opening a new tab.",
    repositoryWorkspacePreview: {
      repository_id: "repo-1",
      state: "ready",
      preview_url: "http://127.0.0.1:4173",
      backend_url: null,
      started_at: "2026-04-03T00:00:00.000Z",
      error: null,
    },
  });
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <BoardView controller={controller} />
    </MantineProvider>,
  );
  const headerMarkup = extractWorkbenchHeaderMarkup(markup);

  assert.equal((headerMarkup.match(/--group-wrap:nowrap/g) ?? []).length, 2);
  assert.match(
    headerMarkup,
    /title="Preview is running, but the browser blocked opening a new tab\."/,
  );
  assert.doesNotMatch(
    headerMarkup,
    />Preview is running, but the browser blocked opening a new tab\.</,
  );
});

test("board header keeps the empty-state prompt when no project is selected", () => {
  const controller = createWalleyBoardController();
  Object.assign(controller as Record<string, unknown>, {
    selectedProject: null,
    selectedProjectId: null,
    selectedRepository: null,
  });
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <BoardView controller={controller} />
    </MantineProvider>,
  );
  const headerMarkup = extractWorkbenchHeaderMarkup(markup);

  assert.doesNotMatch(markup, />Project board</);
  assert.match(markup, />Select a project</);
  assert.match(markup, />System</);
  assert.equal((headerMarkup.match(/--group-wrap:nowrap/g) ?? []).length, 1);
  assert.match(
    markup,
    />Choose a project from the left rail to bring its drafts,\s*tickets, and sessions into the board\.</,
  );
  assert.doesNotMatch(markup, />Preview</);
  assert.doesNotMatch(markup, />Terminal</);
});

test("ticket cards expose stable ids for ticket reference targets", () => {
  const controller = createWalleyBoardController();
  Object.assign(controller as Record<string, unknown>, {
    archiveTicketMutation: createMutationStub(),
    createPullRequestMutation: createMutationStub(),
    deleteTicketMutation: createMutationStub(),
    editReadyTicketMutation: createMutationStub(),
    groupedTickets: {
      draft: [],
      ready: [createTicket()],
      in_progress: [],
      review: [],
      done: [],
    },
    handleTicketPreviewAction: () => undefined,
    mergeTicketMutation: createMutationStub(),
    openTicketSession: () => undefined,
    openTicketWorkspaceModal: () => undefined,
    previewActionErrorByTicketId: {},
    restartTicketMutation: createMutationStub(),
    resumeTicketMutation: createMutationStub(),
    sessionSummaryStateById: new Map(),
    startAgentReviewMutation: createMutationStub(),
    startTicketMutation: createMutationStub(),
    startTicketWorkspacePreviewMutation: createMutationStub(),
    stopTicketMutation: createMutationStub(),
    stopTicketWorkspacePreviewMutation: createMutationStub(),
    ticketAiReviewActiveById: new Map(),
    ticketWorkspacePreviewByTicketId: new Map(),
    visibleDrafts: [],
  });

  const markup = renderToStaticMarkup(
    <MantineProvider>
      <BoardView controller={controller} />
    </MantineProvider>,
  );

  assert.match(markup, /id="ticket-24"/);
  assert.match(markup, /tabindex="-1"/);
});

test("linked pull request badges show state-specific icons plus number and status on cards and in the inspector", () => {
  const openLinkedPr = {
    base_branch: "main",
    changes_requested_by: null,
    head_branch: "ticket-37",
    head_sha: "abc123",
    last_changes_requested_head_sha: null,
    last_reconciled_at: "2026-04-03T00:00:00.000Z",
    number: 37,
    provider: "github" as const,
    repo_name: "repo",
    repo_owner: "example",
    review_status: "unknown" as const,
    state: "open" as const,
    url: "https://github.com/example/repo/pull/37",
  };
  const closedLinkedPr = {
    ...openLinkedPr,
    head_branch: "ticket-38",
    number: 38,
    review_status: "approved" as const,
    state: "closed" as const,
    url: "https://github.com/example/repo/pull/38",
  };
  const mergedLinkedPr = {
    ...openLinkedPr,
    head_branch: "ticket-39",
    number: 39,
    review_status: "approved" as const,
    state: "merged" as const,
    url: "https://github.com/example/repo/pull/39",
  };
  const openTicket = createTicket({
    id: 37,
    linked_pr: openLinkedPr,
    session_id: "session-37",
    status: "review",
    title: "Show linked pull request status in the badge",
  });
  const closedTicket = createTicket({
    id: 38,
    linked_pr: closedLinkedPr,
    session_id: "session-38",
    status: "review",
    title: "Show closed pull request status in the badge",
  });
  const mergedTicket = createTicket({
    id: 39,
    linked_pr: mergedLinkedPr,
    session_id: "session-39",
    status: "done",
    title: "Show merged pull request status in the badge",
  });

  const boardController = createWalleyBoardController();
  Object.assign(boardController as Record<string, unknown>, {
    archiveTicketMutation: createMutationStub(),
    createPullRequestMutation: createMutationStub(),
    deleteTicketMutation: createMutationStub(),
    editReadyTicketMutation: createMutationStub(),
    groupedTickets: {
      draft: [],
      ready: [],
      in_progress: [],
      review: [openTicket, closedTicket],
      done: [mergedTicket],
    },
    handleTicketPreviewAction: () => undefined,
    mergeTicketMutation: createMutationStub(),
    openTicketSession: () => undefined,
    openTicketWorkspaceModal: () => undefined,
    previewActionErrorByTicketId: {},
    restartTicketMutation: createMutationStub(),
    resumeTicketMutation: createMutationStub(),
    sessionSummaryStateById: new Map(),
    startAgentReviewMutation: createMutationStub(),
    startTicketMutation: createMutationStub(),
    startTicketWorkspacePreviewMutation: createMutationStub(),
    stopTicketMutation: createMutationStub(),
    stopTicketWorkspacePreviewMutation: createMutationStub(),
    ticketAiReviewActiveById: new Map(),
    ticketWorkspacePreviewByTicketId: new Map(),
    visibleDrafts: [],
  });

  const boardMarkup = renderToStaticMarkup(
    <MantineProvider>
      <BoardView controller={boardController} />
    </MantineProvider>,
  );

  assert.match(boardMarkup, /tabler-icon-git-pull-request/);
  assert.match(boardMarkup, /tabler-icon-git-pull-request-closed/);
  assert.match(boardMarkup, /tabler-icon-git-merge/);
  assert.match(boardMarkup, /#37 OPEN/);
  assert.match(boardMarkup, /#38 CLOSED/);
  assert.match(boardMarkup, /#39 MERGED/);
  assert.doesNotMatch(boardMarkup, />PR #37</);
  assert.doesNotMatch(boardMarkup, /#38 APPROVED/);
  assert.doesNotMatch(boardMarkup, /#39 APPROVED/);

  const inspectorController = createWalleyBoardController();
  const inspectorSession = {
    adapter_session_ref: null,
    agent_adapter: "codex" as const,
    completed_at: null,
    current_attempt_id: null,
    id: "session-39",
    last_heartbeat_at: "2026-04-03T00:00:00.000Z",
    last_summary: null,
    latest_requested_change_note_id: null,
    latest_review_package_id: null,
    plan_status: "not_requested" as const,
    plan_summary: null,
    planning_enabled: false,
    project_id: mergedTicket.project,
    queue_entered_at: null,
    repo_id: mergedTicket.repo,
    started_at: "2026-04-03T00:00:00.000Z",
    status: "running" as const,
    ticket_id: mergedTicket.id,
    worktree_path: "/tmp/worktree-37",
  };
  Object.assign(inspectorController as Record<string, unknown>, {
    createPullRequestMutation: createMutationStub(),
    deleteTicket: () => undefined,
    deleteTicketMutation: createMutationStub(),
    inspectorState: { kind: "session" },
    inspectorVisible: true,
    latestReviewRun: null,
    latestReviewRunQuery: { isPending: false },
    mergeTicketMutation: createMutationStub(),
    openAgentReviewHistoryModal: () => undefined,
    openTicketWorkspaceModal: () => undefined,
    planFeedbackBody: "",
    planFeedbackMutation: createMutationStub(),
    requestChangesMutation: createMutationStub(),
    requestedChangesBody: "",
    restartTicketFromScratch: () => undefined,
    restartTicketMutation: createMutationStub(),
    resumeReason: "",
    resumeTicketMutation: createMutationStub(),
    reviewPackage: null,
    reviewPackageQuery: { isPending: false },
    selectedSessionId: "session-39",
    selectedSessionTicket: mergedTicket,
    selectedSessionTicketSession: inspectorSession,
    sessionInputMutation: createMutationStub(),
    session: inspectorSession,
    sessionById: new Map([[inspectorSession.id, inspectorSession]]),
    setPlanFeedbackBody: () => undefined,
    setRequestedChangesBody: () => undefined,
    setResumeReason: () => undefined,
    startAgentReviewMutation: createMutationStub(),
    stopTicketMutation: createMutationStub(),
  });

  const inspectorMarkup = renderToStaticMarkup(
    <MantineProvider>
      <InspectorPane controller={inspectorController} />
    </MantineProvider>,
  );

  assert.match(inspectorMarkup, /tabler-icon-git-merge/);
  assert.match(inspectorMarkup, /#39 MERGED/);
  assert.doesNotMatch(inspectorMarkup, />PR #39</);
});

test("ticket cards show inline diff summaries for in-progress, review, and done tickets above the description preview", () => {
  const controller = createWalleyBoardController();
  const readyTicket = createTicket({
    id: 11,
    description: "Ready ticket description preview",
    session_id: "session-ready",
    status: "ready",
    title: "Ready ticket",
  });
  const inProgressTicket = createTicket({
    id: 12,
    description: "In-progress ticket description preview",
    session_id: "session-progress",
    status: "in_progress",
    title: "In-progress ticket",
  });
  const reviewTicket = createTicket({
    id: 13,
    description: "Review ticket description preview",
    session_id: "session-review",
    status: "review",
    title: "Review ticket",
  });
  const doneTicket = createTicket({
    id: 14,
    description: "Done ticket description preview",
    session_id: "session-done",
    status: "done",
    title: "Done ticket",
  });

  Object.assign(controller as Record<string, unknown>, {
    archiveTicketMutation: createMutationStub(),
    createPullRequestMutation: createMutationStub(),
    deleteTicketMutation: createMutationStub(),
    editReadyTicketMutation: createMutationStub(),
    groupedTickets: {
      draft: [],
      ready: [readyTicket],
      in_progress: [inProgressTicket],
      review: [reviewTicket],
      done: [doneTicket],
    },
    handleTicketPreviewAction: () => undefined,
    mergeTicketMutation: createMutationStub(),
    openTicketSession: () => undefined,
    openTicketWorkspaceModal: () => undefined,
    previewActionErrorByTicketId: {},
    restartTicketMutation: createMutationStub(),
    resumeTicketMutation: createMutationStub(),
    sessionSummaryStateById: new Map(),
    startAgentReviewMutation: createMutationStub(),
    startTicketMutation: createMutationStub(),
    startTicketWorkspacePreviewMutation: createMutationStub(),
    stopTicketMutation: createMutationStub(),
    stopTicketWorkspacePreviewMutation: createMutationStub(),
    ticketAiReviewActiveById: new Map(),
    updateVisibleTicketIds: () => undefined,
    ticketDiffLineSummaryByTicketId: new Map([
      [readyTicket.id, { additions: 99, deletions: 1, files: 9 }],
      [inProgressTicket.id, { additions: 12, deletions: 4, files: 2 }],
      [reviewTicket.id, { additions: 7, deletions: 3, files: 1 }],
      [doneTicket.id, { additions: 20, deletions: 5, files: 4 }],
    ]),
    ticketWorkspacePreviewByTicketId: new Map(),
    visibleDrafts: [],
  });

  const markup = renderToStaticMarkup(
    <MantineProvider>
      <BoardView controller={controller} />
    </MantineProvider>,
  );

  assert.match(markup, /\+12<\/span> <span[^>]*>-4<\/span>/);
  assert.match(markup, /\+7<\/span> <span[^>]*>-3<\/span>/);
  assert.match(markup, /\+20<\/span> <span[^>]*>-5<\/span>/);
  assert.doesNotMatch(markup, /\+99<\/span> <span[^>]*>-1<\/span>/);
  assert.doesNotMatch(markup, /files changed/);
  assert.doesNotMatch(markup, /file changed/);

  assert.ok(
    markup.indexOf("+12") <
      markup.indexOf("In-progress ticket description preview"),
  );
  assert.ok(
    markup.indexOf("+7") < markup.indexOf("Review ticket description preview"),
  );
  assert.ok(
    markup.indexOf("+20") < markup.indexOf("Done ticket description preview"),
  );
});

test("done ticket cards omit inline diff summaries when no diff data is available", () => {
  const controller = createWalleyBoardController();
  const doneTicket = createTicket({
    id: 52,
    description: "Done ticket without persisted diff data",
    status: "done",
    title: "Done without diff totals",
  });

  Object.assign(controller as Record<string, unknown>, {
    archiveTicketMutation: createMutationStub(),
    createPullRequestMutation: createMutationStub(),
    deleteTicketMutation: createMutationStub(),
    editReadyTicketMutation: createMutationStub(),
    groupedTickets: {
      draft: [],
      ready: [],
      in_progress: [],
      review: [],
      done: [doneTicket],
    },
    handleTicketPreviewAction: () => undefined,
    mergeTicketMutation: createMutationStub(),
    openTicketSession: () => undefined,
    openTicketWorkspaceModal: () => undefined,
    previewActionErrorByTicketId: {},
    restartTicketMutation: createMutationStub(),
    resumeTicketMutation: createMutationStub(),
    sessionSummaryStateById: new Map(),
    startAgentReviewMutation: createMutationStub(),
    startTicketMutation: createMutationStub(),
    startTicketWorkspacePreviewMutation: createMutationStub(),
    stopTicketMutation: createMutationStub(),
    stopTicketWorkspacePreviewMutation: createMutationStub(),
    ticketAiReviewActiveById: new Map(),
    updateVisibleTicketIds: () => undefined,
    ticketDiffLineSummaryByTicketId: new Map(),
    ticketWorkspacePreviewByTicketId: new Map(),
    visibleDrafts: [],
  });

  const markup = renderToStaticMarkup(
    <MantineProvider>
      <BoardView controller={controller} />
    </MantineProvider>,
  );

  assert.match(markup, /Done without diff totals/);
  assert.doesNotMatch(markup, /\+\d+<\/span> <span[^>]*>-\d+<\/span>/);
});

test("ticket cards place workspace controls under metadata and move statuses into the summary row", () => {
  const controller = createWalleyBoardController();
  const ticket = createTicket({
    id: 41,
    description: "Reposition the card controls without changing behavior.",
    session_id: "session-41",
    status: "in_progress",
    title: "Reposition ticket card controls",
  });

  Object.assign(controller as Record<string, unknown>, {
    archiveTicketMutation: createMutationStub(),
    createPullRequestMutation: createMutationStub(),
    deleteTicketMutation: createMutationStub(),
    editReadyTicketMutation: createMutationStub(),
    groupedTickets: {
      draft: [],
      ready: [],
      in_progress: [ticket],
      review: [],
      done: [],
    },
    handleTicketPreviewAction: () => undefined,
    mergeTicketMutation: createMutationStub(),
    openTicketSession: () => undefined,
    openTicketWorkspaceModal: () => undefined,
    previewActionErrorByTicketId: {},
    restartTicketMutation: createMutationStub(),
    resumeTicketMutation: createMutationStub(),
    sessionById: new Map([
      [
        ticket.session_id,
        {
          adapter_session_ref: null,
          agent_adapter: "codex",
          completed_at: null,
          current_attempt_id: null,
          id: ticket.session_id,
          last_heartbeat_at: "2026-04-03T00:00:00.000Z",
          last_summary: null,
          latest_requested_change_note_id: null,
          latest_review_package_id: null,
          plan_status: "not_requested",
          plan_summary: null,
          planning_enabled: false,
          project_id: ticket.project,
          queue_entered_at: null,
          repo_id: ticket.repo,
          started_at: "2026-04-03T00:00:00.000Z",
          status: "running",
          ticket_id: ticket.id,
          worktree_path: "/tmp/worktree-41",
        },
      ],
    ]),
    sessionSummaryStateById: new Map(),
    startAgentReviewMutation: createMutationStub(),
    startTicketMutation: createMutationStub(),
    startTicketWorkspacePreviewMutation: createMutationStub(),
    stopTicketMutation: createMutationStub(),
    stopTicketWorkspacePreviewMutation: createMutationStub(),
    ticketAiReviewActiveById: new Map(),
    updateVisibleTicketIds: () => undefined,
    ticketDiffLineSummaryByTicketId: new Map([
      [ticket.id, { additions: 12, deletions: 4, files: 2 }],
    ]),
    ticketWorkspacePreviewByTicketId: new Map(),
    visibleDrafts: [],
  });

  const markup = renderToStaticMarkup(
    <MantineProvider>
      <BoardView controller={controller} />
    </MantineProvider>,
  );

  const metadataIndex = markup.indexOf("feature • main");
  const actionsIndex = markup.indexOf("ticket-workspace-action-group");
  const menuIndex = markup.indexOf("More actions for ticket 41");
  const sessionStatusIndex = markup.indexOf("Running");
  const diffSummaryIndex = markup.indexOf("+12");
  const descriptionIndex = markup.indexOf(
    "Reposition the card controls without changing behavior.",
  );

  assert.ok(metadataIndex !== -1);
  assert.ok(actionsIndex !== -1);
  assert.ok(menuIndex !== -1);
  assert.ok(sessionStatusIndex !== -1);
  assert.ok(diffSummaryIndex !== -1);
  assert.ok(descriptionIndex !== -1);

  assert.ok(menuIndex < descriptionIndex);
  assert.ok(metadataIndex < actionsIndex);
  assert.ok(metadataIndex < diffSummaryIndex);
  assert.ok(diffSummaryIndex < actionsIndex);
  assert.ok(actionsIndex < sessionStatusIndex);
  assert.ok(sessionStatusIndex < descriptionIndex);
  assert.ok(diffSummaryIndex < descriptionIndex);
});

test("ticket cards keep the session status badge when only controller.session is populated", () => {
  const controller = createWalleyBoardController();
  const ticket = createTicket({
    id: 43,
    description: "Show the running badge while the session map is still empty.",
    session_id: "session-43",
    status: "in_progress",
    title: "Keep the session status badge visible",
  });

  Object.assign(controller as Record<string, unknown>, {
    archiveTicketMutation: createMutationStub(),
    createPullRequestMutation: createMutationStub(),
    deleteTicketMutation: createMutationStub(),
    editReadyTicketMutation: createMutationStub(),
    groupedTickets: {
      draft: [],
      ready: [],
      in_progress: [ticket],
      review: [],
      done: [],
    },
    handleTicketPreviewAction: () => undefined,
    mergeTicketMutation: createMutationStub(),
    openTicketSession: () => undefined,
    openTicketWorkspaceModal: () => undefined,
    previewActionErrorByTicketId: {},
    restartTicketMutation: createMutationStub(),
    resumeTicketMutation: createMutationStub(),
    session: {
      adapter_session_ref: null,
      agent_adapter: "codex",
      completed_at: null,
      current_attempt_id: null,
      id: ticket.session_id,
      last_heartbeat_at: "2026-04-03T00:00:00.000Z",
      last_summary: null,
      latest_requested_change_note_id: null,
      latest_review_package_id: null,
      plan_status: "not_requested",
      plan_summary: null,
      planning_enabled: false,
      project_id: ticket.project,
      queue_entered_at: null,
      repo_id: ticket.repo,
      started_at: "2026-04-03T00:00:00.000Z",
      status: "running",
      ticket_id: ticket.id,
      worktree_path: "/tmp/worktree-43",
    },
    sessionById: new Map(),
    sessionSummaryStateById: new Map(),
    startAgentReviewMutation: createMutationStub(),
    startTicketMutation: createMutationStub(),
    startTicketWorkspacePreviewMutation: createMutationStub(),
    stopTicketMutation: createMutationStub(),
    stopTicketWorkspacePreviewMutation: createMutationStub(),
    ticketAiReviewActiveById: new Map(),
    updateVisibleTicketIds: () => undefined,
    ticketDiffLineSummaryByTicketId: new Map([
      [ticket.id, { additions: 5, deletions: 2, files: 1 }],
    ]),
    ticketWorkspacePreviewByTicketId: new Map(),
    visibleDrafts: [],
  });

  const markup = renderToStaticMarkup(
    <MantineProvider>
      <BoardView controller={controller} />
    </MantineProvider>,
  );

  const actionsIndex = markup.indexOf("ticket-workspace-action-group");
  const sessionStatusIndex = markup.indexOf("Running");
  const diffSummaryIndex = markup.indexOf("+5");
  const descriptionIndex = markup.indexOf(
    "Show the running badge while the session map is still empty.",
  );

  assert.ok(actionsIndex !== -1);
  assert.ok(sessionStatusIndex !== -1);
  assert.ok(diffSummaryIndex !== -1);
  assert.ok(descriptionIndex !== -1);
  assert.ok(diffSummaryIndex < actionsIndex);
  assert.ok(actionsIndex < sessionStatusIndex);
  assert.ok(sessionStatusIndex < descriptionIndex);
  assert.ok(diffSummaryIndex < descriptionIndex);
});

test("ticket cards hide completed session badges and keep waiting and failed badges", () => {
  const controller = createWalleyBoardController();
  const completedTicket = createTicket({
    id: 50,
    description:
      "Finished implementation stays visible without a session badge.",
    session_id: "session-50",
    status: "done",
    title: "Hide the finished session badge",
  });
  const queuedTicket = createTicket({
    id: 51,
    description: "Queued execution still needs a visible waiting state.",
    session_id: "session-51",
    status: "in_progress",
    title: "Keep the waiting badge visible",
  });
  const failedTicket = createTicket({
    id: 52,
    description: "Failed execution still needs a visible error state.",
    session_id: "session-52",
    status: "in_progress",
    title: "Keep the failed badge visible",
  });

  Object.assign(controller as Record<string, unknown>, {
    archiveTicketMutation: createMutationStub(),
    createPullRequestMutation: createMutationStub(),
    deleteTicketMutation: createMutationStub(),
    editReadyTicketMutation: createMutationStub(),
    groupedTickets: {
      draft: [],
      ready: [],
      in_progress: [queuedTicket, failedTicket],
      review: [],
      done: [completedTicket],
    },
    handleTicketPreviewAction: () => undefined,
    mergeTicketMutation: createMutationStub(),
    openTicketSession: () => undefined,
    openTicketWorkspaceModal: () => undefined,
    previewActionErrorByTicketId: {},
    restartTicketMutation: createMutationStub(),
    resumeTicketMutation: createMutationStub(),
    session: null,
    sessionById: new Map([
      [
        completedTicket.session_id,
        {
          adapter_session_ref: null,
          agent_adapter: "codex",
          completed_at: "2026-04-03T00:10:00.000Z",
          current_attempt_id: null,
          id: completedTicket.session_id,
          last_heartbeat_at: "2026-04-03T00:10:00.000Z",
          last_summary: null,
          latest_requested_change_note_id: null,
          latest_review_package_id: null,
          plan_status: "not_requested",
          plan_summary: null,
          planning_enabled: false,
          project_id: completedTicket.project,
          queue_entered_at: null,
          repo_id: completedTicket.repo,
          started_at: "2026-04-03T00:00:00.000Z",
          status: "completed",
          ticket_id: completedTicket.id,
          worktree_path: "/tmp/worktree-50",
        },
      ],
      [
        queuedTicket.session_id,
        {
          adapter_session_ref: null,
          agent_adapter: "codex",
          completed_at: null,
          current_attempt_id: null,
          id: queuedTicket.session_id,
          last_heartbeat_at: "2026-04-03T00:01:00.000Z",
          last_summary: null,
          latest_requested_change_note_id: null,
          latest_review_package_id: null,
          plan_status: "not_requested",
          plan_summary: null,
          planning_enabled: false,
          project_id: queuedTicket.project,
          queue_entered_at: "2026-04-03T00:01:00.000Z",
          repo_id: queuedTicket.repo,
          started_at: null,
          status: "queued",
          ticket_id: queuedTicket.id,
          worktree_path: "/tmp/worktree-51",
        },
      ],
      [
        failedTicket.session_id,
        {
          adapter_session_ref: null,
          agent_adapter: "codex",
          completed_at: "2026-04-03T00:02:00.000Z",
          current_attempt_id: null,
          id: failedTicket.session_id,
          last_heartbeat_at: "2026-04-03T00:02:00.000Z",
          last_summary: null,
          latest_requested_change_note_id: null,
          latest_review_package_id: null,
          plan_status: "not_requested",
          plan_summary: null,
          planning_enabled: false,
          project_id: failedTicket.project,
          queue_entered_at: null,
          repo_id: failedTicket.repo,
          started_at: "2026-04-03T00:01:30.000Z",
          status: "failed",
          ticket_id: failedTicket.id,
          worktree_path: "/tmp/worktree-52",
        },
      ],
    ]),
    sessionSummaryStateById: new Map(),
    startAgentReviewMutation: createMutationStub(),
    startTicketMutation: createMutationStub(),
    startTicketWorkspacePreviewMutation: createMutationStub(),
    stopTicketMutation: createMutationStub(),
    stopTicketWorkspacePreviewMutation: createMutationStub(),
    ticketAiReviewActiveById: new Map(),
    updateVisibleTicketIds: () => undefined,
    ticketDiffLineSummaryByTicketId: new Map(),
    ticketWorkspacePreviewByTicketId: new Map(),
    visibleDrafts: [],
  });

  const markup = renderToStaticMarkup(
    <MantineProvider>
      <BoardView controller={controller} />
    </MantineProvider>,
  );

  assert.equal(markup.includes(">Completed<"), false);
  assert.equal(markup.includes(">Queued<"), true);
  assert.equal(markup.includes(">Failed<"), true);
  assert.equal(markup.includes("Waiting for a running slot"), true);
});

test("ticket cards pin the overflow trigger in a dedicated header slot during AI review", async () => {
  const harness = installDom();
  const controller = createWalleyBoardController();
  const ticket = createTicket({
    id: 42,
    description: "Keep the menu pinned while AI review is active.",
    session_id: "session-42",
    status: "in_progress",
    title: "Pin overflow trigger to the card corner",
  });

  Object.assign(controller as Record<string, unknown>, {
    archiveTicketMutation: createMutationStub(),
    createPullRequestMutation: createMutationStub(),
    deleteTicketMutation: createMutationStub(),
    editReadyTicketMutation: createMutationStub(),
    groupedTickets: {
      draft: [],
      ready: [],
      in_progress: [ticket],
      review: [],
      done: [],
    },
    handleTicketPreviewAction: () => undefined,
    mergeTicketMutation: createMutationStub(),
    openTicketSession: () => undefined,
    openTicketWorkspaceModal: () => undefined,
    previewActionErrorByTicketId: {},
    restartTicketMutation: createMutationStub(),
    resumeTicketMutation: createMutationStub(),
    sessionById: new Map([
      [
        ticket.session_id,
        {
          adapter_session_ref: null,
          agent_adapter: "codex",
          completed_at: null,
          current_attempt_id: null,
          id: ticket.session_id,
          last_heartbeat_at: "2026-04-03T00:00:00.000Z",
          last_summary: null,
          latest_requested_change_note_id: null,
          latest_review_package_id: null,
          plan_status: "not_requested",
          plan_summary: null,
          planning_enabled: false,
          project_id: ticket.project,
          queue_entered_at: null,
          repo_id: ticket.repo,
          started_at: "2026-04-03T00:00:00.000Z",
          status: "running",
          ticket_id: ticket.id,
          worktree_path: "/tmp/worktree-42",
        },
      ],
    ]),
    sessionSummaryStateById: new Map(),
    startAgentReviewMutation: createMutationStub(),
    startTicketMutation: createMutationStub(),
    startTicketWorkspacePreviewMutation: createMutationStub(),
    stopTicketMutation: createMutationStub(),
    stopTicketWorkspacePreviewMutation: createMutationStub(),
    ticketAiReviewActiveById: new Map([[ticket.id, true]]),
    updateVisibleTicketIds: () => undefined,
    ticketDiffLineSummaryByTicketId: new Map([
      [ticket.id, { additions: 8, deletions: 3, files: 1 }],
    ]),
    ticketWorkspacePreviewByTicketId: new Map(),
    visibleDrafts: [],
  });

  const root = createRoot(harness.mountNode);

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <BoardView controller={controller} />
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    const card = harness.mountNode.querySelector<HTMLElement>("#ticket-42");
    const header = card?.querySelector<HTMLElement>(".board-card-header");
    const headerMain = card?.querySelector<HTMLElement>(
      ".board-card-header-main",
    );
    const headerMenu = card?.querySelector<HTMLElement>(
      ".board-card-header-menu",
    );
    const aiReviewRow = card?.querySelector<HTMLElement>(
      ".board-card-ai-review",
    );
    const menuButton = headerMenu?.querySelector<HTMLButtonElement>(
      '[aria-label="More actions for ticket 42"]',
    );

    assert.ok(card, "Expected the ticket card");
    assert.ok(header, "Expected the dedicated ticket-card header");
    assert.ok(headerMain, "Expected the header main content slot");
    assert.ok(headerMenu, "Expected the dedicated header menu slot");
    assert.ok(aiReviewRow, "Expected the AI review row below the header");
    assert.equal(header?.children.length, 2);
    assert.equal(header?.firstElementChild, headerMain);
    assert.equal(header?.lastElementChild, headerMenu);
    assert.ok(menuButton, "Expected the overflow trigger inside the menu slot");
    assert.equal(headerMenu.contains(aiReviewRow), false);
    assert.match(aiReviewRow.textContent ?? "", /AI review in progress/);
  } finally {
    await act(async () => {
      root.unmount();
    });
    harness.cleanup();
  }
});

test("review tickets disable merge and create pull request actions while AI review runs", async () => {
  const harness = installDom();
  const controller = createWalleyBoardController();
  const ticket = createTicket({
    description: "Merge should stay blocked while AI review is active.",
    id: 58,
    session_id: "session-58",
    status: "review",
    title: "Disable merge while AI review runs",
    working_branch: "ticket-58",
  });

  Object.assign(controller as Record<string, unknown>, {
    createPullRequestMutation: createMutationStub(),
    deleteTicketMutation: createMutationStub(),
    editReadyTicketMutation: createMutationStub(),
    groupedTickets: {
      draft: [],
      ready: [],
      in_progress: [],
      review: [ticket],
      done: [],
    },
    handleTicketPreviewAction: () => undefined,
    mergeTicketMutation: createMutationStub(),
    openTicketSession: () => undefined,
    openTicketWorkspaceModal: () => undefined,
    previewActionErrorByTicketId: {},
    restartTicketMutation: createMutationStub(),
    resumeTicketMutation: createMutationStub(),
    selectedProject: createProject(),
    sessionSummaryStateById: new Map(),
    startAgentReviewMutation: createMutationStub(),
    startTicketMutation: createMutationStub(),
    startTicketWorkspacePreviewMutation: createMutationStub(),
    stopAgentReviewMutation: createMutationStub(),
    stopTicketMutation: createMutationStub(),
    stopTicketWorkspacePreviewMutation: createMutationStub(),
    ticketAiReviewActiveById: new Map([[ticket.id, true]]),
    ticketWorkspacePreviewByTicketId: new Map(),
    visibleDrafts: [],
  });

  const root = createRoot(harness.mountNode);

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <BoardView controller={controller} />
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    const mergeButton = [...harness.mountNode.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Merge") ?? false,
    ) as HTMLButtonElement | undefined;
    assert.ok(mergeButton, "Expected the review card merge button");
    assert.equal(
      mergeButton.disabled,
      true,
      "Expected merge to be disabled while AI review runs",
    );

    const menuButton = harness.mountNode.querySelector(
      `[aria-label="More actions for ticket ${ticket.id}"]`,
    );
    assert.ok(menuButton, "Expected the review ticket overflow button");

    await act(async () => {
      menuButton.dispatchEvent(
        new harness.window.MouseEvent("mousedown", {
          bubbles: true,
        }),
      );
      menuButton.dispatchEvent(
        new harness.window.MouseEvent("click", {
          bubbles: true,
        }),
      );
      await new Promise((resolve) => harness.window.setTimeout(resolve, 0));
    });

    let createPullRequestAction: HTMLButtonElement | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      createPullRequestAction = [
        ...harness.window.document.querySelectorAll("button"),
      ].find(
        (button) =>
          button.textContent?.includes("Create pull request") ?? false,
      ) as HTMLButtonElement | null;
      if (createPullRequestAction) {
        break;
      }

      await act(async () => {
        await new Promise((resolve) => harness.window.setTimeout(resolve, 0));
      });
    }

    assert.ok(
      createPullRequestAction,
      "Expected the overflow menu create pull request action",
    );
    assert.equal(
      createPullRequestAction?.disabled,
      true,
      "Expected create pull request to be disabled while AI review runs",
    );
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    harness.cleanup();
  }
});

test("review tickets disable create pull request and merge actions while AI review runs", async () => {
  const harness = installDom();
  const controller = createWalleyBoardController();
  const ticket = createTicket({
    description:
      "Create pull request should stay blocked while AI review runs.",
    id: 59,
    session_id: "session-59",
    status: "review",
    title: "Disable create pull request while AI review runs",
    working_branch: "ticket-59",
  });

  Object.assign(controller as Record<string, unknown>, {
    createPullRequestMutation: createMutationStub(),
    deleteTicketMutation: createMutationStub(),
    editReadyTicketMutation: createMutationStub(),
    groupedTickets: {
      draft: [],
      ready: [],
      in_progress: [],
      review: [ticket],
      done: [],
    },
    handleTicketPreviewAction: () => undefined,
    mergeTicketMutation: createMutationStub(),
    openTicketSession: () => undefined,
    openTicketWorkspaceModal: () => undefined,
    previewActionErrorByTicketId: {},
    restartTicketMutation: createMutationStub(),
    resumeTicketMutation: createMutationStub(),
    selectedProject: {
      ...createProject(),
      default_review_action: "pull_request",
    },
    sessionSummaryStateById: new Map(),
    startAgentReviewMutation: createMutationStub(),
    startTicketMutation: createMutationStub(),
    startTicketWorkspacePreviewMutation: createMutationStub(),
    stopAgentReviewMutation: createMutationStub(),
    stopTicketMutation: createMutationStub(),
    stopTicketWorkspacePreviewMutation: createMutationStub(),
    ticketAiReviewActiveById: new Map([[ticket.id, true]]),
    ticketWorkspacePreviewByTicketId: new Map(),
    visibleDrafts: [],
  });

  const root = createRoot(harness.mountNode);

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <BoardView controller={controller} />
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    const createPullRequestButton = [
      ...harness.mountNode.querySelectorAll("button"),
    ].find(
      (button) => button.textContent?.includes("Create pull request") ?? false,
    ) as HTMLButtonElement | undefined;
    assert.ok(
      createPullRequestButton,
      "Expected the review card create pull request button",
    );
    assert.equal(
      createPullRequestButton.disabled,
      true,
      "Expected create pull request to be disabled while AI review runs",
    );

    const menuButton = harness.mountNode.querySelector(
      `[aria-label="More actions for ticket ${ticket.id}"]`,
    );
    assert.ok(menuButton, "Expected the review ticket overflow button");

    await act(async () => {
      menuButton.dispatchEvent(
        new harness.window.MouseEvent("mousedown", {
          bubbles: true,
        }),
      );
      menuButton.dispatchEvent(
        new harness.window.MouseEvent("click", {
          bubbles: true,
        }),
      );
      await new Promise((resolve) => harness.window.setTimeout(resolve, 0));
    });

    let mergeAction: HTMLButtonElement | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      mergeAction = [
        ...harness.window.document.querySelectorAll("button"),
      ].find(
        (button) => button.textContent?.includes("Merge") ?? false,
      ) as HTMLButtonElement | null;
      if (mergeAction) {
        break;
      }

      await act(async () => {
        await new Promise((resolve) => harness.window.setTimeout(resolve, 0));
      });
    }

    assert.ok(mergeAction, "Expected the overflow menu merge action");
    assert.equal(
      mergeAction?.disabled,
      true,
      "Expected merge to be disabled while AI review runs",
    );
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    harness.cleanup();
  }
});

test("review tickets expose stop AI review from the overflow menu and reuse the stop-review mutation", async () => {
  const harness = installDom();
  const controller = createWalleyBoardController();
  const ticket = createTicket({
    description: "AI review should be stoppable from the menu.",
    id: 60,
    session_id: "session-60",
    status: "review",
    title: "Stop AI review from overflow menu",
    working_branch: "ticket-60",
  });
  const stopAgentReviewCalls: number[] = [];

  Object.assign(controller as Record<string, unknown>, {
    createPullRequestMutation: createMutationStub(),
    deleteTicketMutation: createMutationStub(),
    editReadyTicketMutation: createMutationStub(),
    groupedTickets: {
      draft: [],
      ready: [],
      in_progress: [],
      review: [ticket],
      done: [],
    },
    handleTicketPreviewAction: () => undefined,
    mergeTicketMutation: createMutationStub(),
    openTicketSession: () => undefined,
    openTicketWorkspaceModal: () => undefined,
    previewActionErrorByTicketId: {},
    restartTicketMutation: createMutationStub(),
    resumeTicketMutation: createMutationStub(),
    selectedProject: createProject(),
    sessionSummaryStateById: new Map(),
    startAgentReviewMutation: createMutationStub(),
    startTicketMutation: createMutationStub(),
    startTicketWorkspacePreviewMutation: createMutationStub(),
    stopAgentReviewMutation: {
      ...createMutationStub(),
      mutate: (ticketId: number) => {
        stopAgentReviewCalls.push(ticketId);
      },
    },
    stopTicketMutation: createMutationStub(),
    stopTicketWorkspacePreviewMutation: createMutationStub(),
    ticketAiReviewActiveById: new Map([[ticket.id, true]]),
    ticketWorkspacePreviewByTicketId: new Map(),
    visibleDrafts: [],
  });

  const root = createRoot(harness.mountNode);

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <BoardView controller={controller} />
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    const menuButton = harness.mountNode.querySelector(
      `[aria-label="More actions for ticket ${ticket.id}"]`,
    );
    assert.ok(menuButton, "Expected the review ticket overflow button");

    await act(async () => {
      menuButton.dispatchEvent(
        new harness.window.MouseEvent("mousedown", {
          bubbles: true,
        }),
      );
      menuButton.dispatchEvent(
        new harness.window.MouseEvent("click", {
          bubbles: true,
        }),
      );
      await new Promise((resolve) => harness.window.setTimeout(resolve, 0));
    });

    let stopAiReviewAction: HTMLElement | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      stopAiReviewAction = [
        ...harness.window.document.querySelectorAll("button"),
      ].find(
        (button) => button.textContent?.includes("Stop AI review") ?? false,
      ) as HTMLElement | null;
      if (stopAiReviewAction) {
        break;
      }

      await act(async () => {
        await new Promise((resolve) => harness.window.setTimeout(resolve, 0));
      });
    }

    assert.ok(
      stopAiReviewAction,
      "Expected the review ticket overflow menu to include Stop AI review",
    );

    await act(async () => {
      stopAiReviewAction?.dispatchEvent(
        new harness.window.MouseEvent("click", {
          bubbles: true,
        }),
      );
      await Promise.resolve();
    });

    assert.deepEqual(stopAgentReviewCalls, [ticket.id]);
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    harness.cleanup();
  }
});

test("review tickets hide stop AI review from the overflow menu when no AI review is active", async () => {
  const harness = installDom();
  const controller = createWalleyBoardController();
  const ticket = createTicket({
    description: "Do not show AI review stop when nothing is running.",
    id: 61,
    session_id: "session-61",
    status: "review",
    title: "Hide stop AI review when inactive",
    working_branch: "ticket-61",
  });

  Object.assign(controller as Record<string, unknown>, {
    createPullRequestMutation: createMutationStub(),
    deleteTicketMutation: createMutationStub(),
    editReadyTicketMutation: createMutationStub(),
    groupedTickets: {
      draft: [],
      ready: [],
      in_progress: [],
      review: [ticket],
      done: [],
    },
    handleTicketPreviewAction: () => undefined,
    mergeTicketMutation: createMutationStub(),
    openTicketSession: () => undefined,
    openTicketWorkspaceModal: () => undefined,
    previewActionErrorByTicketId: {},
    restartTicketMutation: createMutationStub(),
    resumeTicketMutation: createMutationStub(),
    selectedProject: createProject(),
    sessionSummaryStateById: new Map(),
    startAgentReviewMutation: createMutationStub(),
    startTicketMutation: createMutationStub(),
    startTicketWorkspacePreviewMutation: createMutationStub(),
    stopAgentReviewMutation: createMutationStub(),
    stopTicketMutation: createMutationStub(),
    stopTicketWorkspacePreviewMutation: createMutationStub(),
    ticketAiReviewActiveById: new Map(),
    ticketWorkspacePreviewByTicketId: new Map(),
    visibleDrafts: [],
  });

  const root = createRoot(harness.mountNode);

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <BoardView controller={controller} />
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    const menuButton = harness.mountNode.querySelector(
      `[aria-label="More actions for ticket ${ticket.id}"]`,
    );
    assert.ok(menuButton, "Expected the review ticket overflow button");

    await act(async () => {
      menuButton.dispatchEvent(
        new harness.window.MouseEvent("mousedown", {
          bubbles: true,
        }),
      );
      menuButton.dispatchEvent(
        new harness.window.MouseEvent("click", {
          bubbles: true,
        }),
      );
      await new Promise((resolve) => harness.window.setTimeout(resolve, 0));
    });

    let stopAiReviewAction: HTMLElement | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      stopAiReviewAction = [
        ...harness.window.document.querySelectorAll("button"),
      ].find(
        (button) => button.textContent?.includes("Stop AI review") ?? false,
      ) as HTMLElement | null;
      if (stopAiReviewAction) {
        break;
      }

      await act(async () => {
        await new Promise((resolve) => harness.window.setTimeout(resolve, 0));
      });
    }

    assert.equal(
      stopAiReviewAction ?? null,
      null,
      "Expected Stop AI review to stay hidden when no AI review is active",
    );
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    harness.cleanup();
  }
});

test("ready tickets expose an edit action in the overflow menu", async () => {
  const harness = installDom();
  const controller = createWalleyBoardController();
  Object.assign(controller as Record<string, unknown>, {
    archiveTicketMutation: createMutationStub(),
    createPullRequestMutation: createMutationStub(),
    deleteTicketMutation: createMutationStub(),
    editReadyTicket: () => undefined,
    editReadyTicketMutation: createMutationStub(),
    groupedTickets: {
      draft: [],
      ready: [createTicket()],
      in_progress: [],
      review: [],
      done: [],
    },
    handleTicketPreviewAction: () => undefined,
    mergeTicketMutation: createMutationStub(),
    openTicketSession: () => undefined,
    openTicketWorkspaceModal: () => undefined,
    previewActionErrorByTicketId: {},
    restartTicketMutation: createMutationStub(),
    resumeTicketMutation: createMutationStub(),
    sessionSummaryStateById: new Map(),
    startAgentReviewMutation: createMutationStub(),
    startTicketMutation: createMutationStub(),
    startTicketWorkspacePreviewMutation: createMutationStub(),
    stopTicketMutation: createMutationStub(),
    stopTicketWorkspacePreviewMutation: createMutationStub(),
    ticketAiReviewActiveById: new Map(),
    ticketWorkspacePreviewByTicketId: new Map(),
    visibleDrafts: [],
  });

  const root = createRoot(harness.mountNode);

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <BoardView controller={controller} />
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    const menuButton = harness.mountNode.querySelector(
      '[aria-label="More actions for ticket 24"]',
    );
    assert.ok(menuButton, "Expected the ready ticket overflow button");

    await act(async () => {
      menuButton.dispatchEvent(
        new harness.window.MouseEvent("mousedown", {
          bubbles: true,
        }),
      );
      menuButton.dispatchEvent(
        new harness.window.MouseEvent("click", {
          bubbles: true,
        }),
      );
      await new Promise((resolve) => harness.window.setTimeout(resolve, 0));
    });

    let hasEditAction = false;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if ((harness.window.document.body.textContent ?? "").includes("Edit")) {
        hasEditAction = true;
        break;
      }

      await act(async () => {
        await new Promise((resolve) => harness.window.setTimeout(resolve, 0));
      });
    }

    assert.ok(
      hasEditAction,
      "Expected the ready ticket menu to include an Edit action",
    );
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    harness.cleanup();
  }
});

test("in-progress tickets hide the standalone stop button until the overflow menu opens", () => {
  const controller = createWalleyBoardController();
  const ticket = createTicket({
    description: "Stop should only live in the menu now.",
    session_id: "session-progress",
    status: "in_progress",
    title: "Move stop into overflow menu",
  });

  Object.assign(controller as Record<string, unknown>, {
    archiveTicketMutation: createMutationStub(),
    createPullRequestMutation: createMutationStub(),
    deleteTicketMutation: createMutationStub(),
    editReadyTicketMutation: createMutationStub(),
    groupedTickets: {
      draft: [],
      ready: [],
      in_progress: [ticket],
      review: [],
      done: [],
    },
    handleTicketPreviewAction: () => undefined,
    mergeTicketMutation: createMutationStub(),
    openTicketSession: () => undefined,
    openTicketWorkspaceModal: () => undefined,
    previewActionErrorByTicketId: {},
    restartTicketMutation: createMutationStub(),
    resumeTicketMutation: createMutationStub(),
    sessionById: new Map([
      [
        ticket.session_id,
        {
          id: ticket.session_id,
          status: "running",
        },
      ],
    ]),
    sessionSummaryStateById: new Map(),
    startAgentReviewMutation: createMutationStub(),
    startTicketMutation: createMutationStub(),
    startTicketWorkspacePreviewMutation: createMutationStub(),
    stopTicketMutation: createMutationStub(),
    stopTicketWorkspacePreviewMutation: createMutationStub(),
    ticketAiReviewActiveById: new Map(),
    ticketWorkspacePreviewByTicketId: new Map(),
    visibleDrafts: [],
  });

  const markup = renderToStaticMarkup(
    <MantineProvider>
      <BoardView controller={controller} />
    </MantineProvider>,
  );

  assert.doesNotMatch(markup, />Stop</);
});

test("in-progress tickets expose stop from the overflow menu and reuse the stop mutation", async () => {
  const harness = installDom();
  const controller = createWalleyBoardController();
  const ticket = createTicket({
    description: "Stop should be triggered from the menu.",
    session_id: "session-progress",
    status: "in_progress",
    title: "Move stop into overflow menu",
  });
  const stopCalls: Array<{ ticketId: number }> = [];
  const stopTicketMutation = {
    ...createMutationStub(),
    mutate: (variables: { ticketId: number }) => {
      stopCalls.push(variables);
    },
  };

  Object.assign(controller as Record<string, unknown>, {
    archiveTicketMutation: createMutationStub(),
    createPullRequestMutation: createMutationStub(),
    deleteTicketMutation: createMutationStub(),
    editReadyTicketMutation: createMutationStub(),
    groupedTickets: {
      draft: [],
      ready: [],
      in_progress: [ticket],
      review: [],
      done: [],
    },
    handleTicketPreviewAction: () => undefined,
    mergeTicketMutation: createMutationStub(),
    openTicketSession: () => undefined,
    openTicketWorkspaceModal: () => undefined,
    previewActionErrorByTicketId: {},
    restartTicketMutation: createMutationStub(),
    resumeTicketMutation: createMutationStub(),
    sessionById: new Map([
      [
        ticket.session_id,
        {
          id: ticket.session_id,
          status: "running",
        },
      ],
    ]),
    sessionSummaryStateById: new Map(),
    startAgentReviewMutation: createMutationStub(),
    startTicketMutation: createMutationStub(),
    startTicketWorkspacePreviewMutation: createMutationStub(),
    stopTicketMutation,
    stopTicketWorkspacePreviewMutation: createMutationStub(),
    ticketAiReviewActiveById: new Map(),
    ticketWorkspacePreviewByTicketId: new Map(),
    visibleDrafts: [],
  });

  const root = createRoot(harness.mountNode);

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <BoardView controller={controller} />
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    assert.equal(
      [...harness.mountNode.querySelectorAll("button")].some(
        (button) => button.textContent?.includes("Stop") ?? false,
      ),
      false,
    );

    const menuButton = harness.mountNode.querySelector(
      `[aria-label="More actions for ticket ${ticket.id}"]`,
    );
    assert.ok(menuButton, "Expected the in-progress ticket overflow button");

    await act(async () => {
      menuButton.dispatchEvent(
        new harness.window.MouseEvent("mousedown", {
          bubbles: true,
        }),
      );
      menuButton.dispatchEvent(
        new harness.window.MouseEvent("click", {
          bubbles: true,
        }),
      );
      await new Promise((resolve) => harness.window.setTimeout(resolve, 0));
    });

    let stopAction: HTMLElement | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      stopAction = [...harness.window.document.querySelectorAll("button")].find(
        (button) => button.textContent?.includes("Stop") ?? false,
      ) as HTMLElement | null;
      if (stopAction) {
        break;
      }

      await act(async () => {
        await new Promise((resolve) => harness.window.setTimeout(resolve, 0));
      });
    }

    assert.ok(
      stopAction,
      "Expected the in-progress ticket menu to include Stop",
    );

    await act(async () => {
      stopAction?.dispatchEvent(
        new harness.window.MouseEvent("click", {
          bubbles: true,
        }),
      );
      await Promise.resolve();
    });

    assert.deepEqual(stopCalls, [{ ticketId: ticket.id }]);
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    harness.cleanup();
  }
});

test("in-progress ticket stop keeps loading feedback visible after the menu action is clicked", async () => {
  const harness = installDom();
  const controller = createWalleyBoardController();
  const ticket = createTicket({
    description: "Stop should retain its feedback states.",
    session_id: "session-progress",
    status: "in_progress",
    title: "Move stop into overflow menu",
  });
  let rerenderBoard: (() => Promise<void>) | null = null;
  const stopTicketMutation: {
    error: Error | null;
    isError: boolean;
    isPending: boolean;
    mutate: (variables: { ticketId: number }) => void;
    variables: { ticketId: number } | null;
  } = {
    error: null,
    isError: false,
    isPending: false,
    variables: null,
    mutate: (variables: { ticketId: number }) => {
      stopTicketMutation.isPending = true;
      stopTicketMutation.variables = variables;
      void rerenderBoard?.();
    },
  };

  Object.assign(controller as Record<string, unknown>, {
    archiveTicketMutation: createMutationStub(),
    createPullRequestMutation: createMutationStub(),
    deleteTicketMutation: createMutationStub(),
    editReadyTicketMutation: createMutationStub(),
    groupedTickets: {
      draft: [],
      ready: [],
      in_progress: [ticket],
      review: [],
      done: [],
    },
    handleTicketPreviewAction: () => undefined,
    mergeTicketMutation: createMutationStub(),
    openTicketSession: () => undefined,
    openTicketWorkspaceModal: () => undefined,
    previewActionErrorByTicketId: {},
    restartTicketMutation: createMutationStub(),
    resumeTicketMutation: createMutationStub(),
    sessionById: new Map([
      [
        ticket.session_id,
        {
          id: ticket.session_id,
          status: "running",
        },
      ],
    ]),
    sessionSummaryStateById: new Map(),
    startAgentReviewMutation: createMutationStub(),
    startTicketMutation: createMutationStub(),
    startTicketWorkspacePreviewMutation: createMutationStub(),
    stopTicketMutation,
    stopTicketWorkspacePreviewMutation: createMutationStub(),
    ticketAiReviewActiveById: new Map(),
    ticketWorkspacePreviewByTicketId: new Map(),
    visibleDrafts: [],
  });

  const root = createRoot(harness.mountNode);

  try {
    rerenderBoard = async () => {
      await act(async () => {
        root.render(
          <MantineProvider>
            <BoardView controller={controller} />
          </MantineProvider>,
        );
        await Promise.resolve();
      });
    };

    await rerenderBoard();

    const menuButton = harness.mountNode.querySelector(
      `[aria-label="More actions for ticket ${ticket.id}"]`,
    );
    assert.ok(menuButton, "Expected the in-progress ticket overflow button");

    await act(async () => {
      menuButton.dispatchEvent(
        new harness.window.MouseEvent("mousedown", {
          bubbles: true,
        }),
      );
      menuButton.dispatchEvent(
        new harness.window.MouseEvent("click", {
          bubbles: true,
        }),
      );
      await new Promise((resolve) => harness.window.setTimeout(resolve, 0));
    });

    let stopAction: HTMLElement | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      stopAction = [...harness.window.document.querySelectorAll("button")].find(
        (button) => button.textContent?.includes("Stop") ?? false,
      ) as HTMLElement | null;
      if (stopAction) {
        break;
      }

      await act(async () => {
        await new Promise((resolve) => harness.window.setTimeout(resolve, 0));
      });
    }

    assert.ok(
      stopAction,
      "Expected the in-progress ticket menu to include Stop",
    );

    await act(async () => {
      stopAction?.dispatchEvent(
        new harness.window.MouseEvent("click", {
          bubbles: true,
        }),
      );
      await Promise.resolve();
    });

    let hasStoppingLabel = false;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (
        (harness.window.document.body.textContent ?? "").includes("Stopping...")
      ) {
        hasStoppingLabel = true;
        break;
      }

      await act(async () => {
        await new Promise((resolve) => harness.window.setTimeout(resolve, 0));
      });
    }

    assert.ok(
      hasStoppingLabel,
      "Expected the in-progress ticket menu to show the pending stop label",
    );
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    harness.cleanup();
  }
});

test("in-progress ticket stop errors still render on the card", async () => {
  const harness = installDom();
  const controller = createWalleyBoardController();
  const ticket = createTicket({
    description: "Stop should retain its feedback states.",
    session_id: "session-progress",
    status: "in_progress",
    title: "Move stop into overflow menu",
  });
  const stopTicketMutation = {
    ...createMutationStub(),
    error: new Error("Stop failed"),
    isError: true,
    variables: { ticketId: ticket.id },
  };

  Object.assign(controller as Record<string, unknown>, {
    archiveTicketMutation: createMutationStub(),
    createPullRequestMutation: createMutationStub(),
    deleteTicketMutation: createMutationStub(),
    editReadyTicketMutation: createMutationStub(),
    groupedTickets: {
      draft: [],
      ready: [],
      in_progress: [ticket],
      review: [],
      done: [],
    },
    handleTicketPreviewAction: () => undefined,
    mergeTicketMutation: createMutationStub(),
    openTicketSession: () => undefined,
    openTicketWorkspaceModal: () => undefined,
    previewActionErrorByTicketId: {},
    restartTicketMutation: createMutationStub(),
    resumeTicketMutation: createMutationStub(),
    sessionById: new Map([
      [
        ticket.session_id,
        {
          id: ticket.session_id,
          status: "running",
        },
      ],
    ]),
    sessionSummaryStateById: new Map(),
    startAgentReviewMutation: createMutationStub(),
    startTicketMutation: createMutationStub(),
    startTicketWorkspacePreviewMutation: createMutationStub(),
    stopTicketMutation,
    stopTicketWorkspacePreviewMutation: createMutationStub(),
    ticketAiReviewActiveById: new Map(),
    ticketWorkspacePreviewByTicketId: new Map(),
    visibleDrafts: [],
  });

  const root = createRoot(harness.mountNode);

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <BoardView controller={controller} />
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    assert.match(harness.mountNode.textContent ?? "", /Stop failed/);
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    harness.cleanup();
  }
});

test("inspector-open layout keeps the shell fixed and leaves board scrolling to the shared board pane", async () => {
  const harness = installDom();
  const controller = createWalleyBoardController();
  Object.assign(controller as Record<string, unknown>, {
    inspectorState: { kind: "session" },
    inspectorVisible: true,
  });
  const cleanupStylesheet = installDesktopStylesheet(harness.window.document);
  const root = createRoot(harness.mountNode);

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <div className="walleyboard-shell">
            <div className="walleyboard-layout walleyboard-layout--with-detail">
              <ProjectRail controller={controller} />
              <BoardView controller={controller} />
              <InspectorPane controller={controller} />
            </div>
          </div>
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    const shell = harness.mountNode.querySelector(".walleyboard-shell");
    const layout = harness.mountNode.querySelector(
      ".walleyboard-layout--with-detail",
    );
    const detail = harness.mountNode.querySelector(".walleyboard-detail");
    const boardScroller = harness.mountNode.querySelector(".board-scroller");

    assert.ok(shell, "Expected the board shell to render");
    assert.ok(layout, "Expected the inspector-open layout class to render");
    assert.ok(detail, "Expected the inspector detail pane to render");
    assert.ok(boardScroller, "Expected the shared board scroller to render");
    assert.match(
      detail.textContent ?? "",
      /Session details are not available yet\./,
      "Expected the session inspector content to render",
    );
    assert.equal(
      harness.window.getComputedStyle(shell).overflowY,
      "hidden",
      "Expected the board shell to stay fixed on desktop",
    );
    assert.equal(
      harness.window.getComputedStyle(detail).overflowY,
      "auto",
      "Expected the detail pane to own its own vertical scrolling",
    );
    assert.equal(
      harness.window.getComputedStyle(boardScroller).overflowY,
      "auto",
      "Expected the board scroller to own the vertical scrolling",
    );

    const columnStack = harness.mountNode.querySelector(".board-column-stack");
    assert.ok(columnStack, "Expected a board column stack to render");
    assert.notEqual(
      harness.window.getComputedStyle(columnStack).overflowY,
      "auto",
      "Expected board column stacks to avoid independent vertical scrolling",
    );
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    cleanupStylesheet();
    harness.cleanup();
  }
});

test("session inspector removes the old ticket panel header copy", () => {
  const controller = createWalleyBoardController();
  const ticket = createTicket({
    id: 43,
    session_id: "session-43",
    status: "in_progress",
    title: "Ship inspector header cleanup",
  });
  const session = {
    adapter_session_ref: null,
    agent_adapter: "codex" as const,
    completed_at: null,
    current_attempt_id: null,
    id: "session-43",
    last_heartbeat_at: "2026-04-03T00:00:00.000Z",
    last_summary: null,
    latest_requested_change_note_id: null,
    latest_review_package_id: null,
    plan_status: "not_requested" as const,
    plan_summary: null,
    planning_enabled: false,
    project_id: ticket.project,
    queue_entered_at: null,
    repo_id: ticket.repo,
    started_at: "2026-04-03T00:00:00.000Z",
    status: "running" as const,
    ticket_id: ticket.id,
    worktree_path: "/tmp/worktree-43",
  };

  Object.assign(controller as Record<string, unknown>, {
    createPullRequestMutation: createMutationStub(),
    deleteTicket: () => undefined,
    deleteTicketMutation: createMutationStub(),
    inspectorState: { kind: "session" },
    inspectorVisible: true,
    latestReviewRun: null,
    latestReviewRunQuery: { isPending: false },
    mergeTicketMutation: createMutationStub(),
    openAgentReviewHistoryModal: () => undefined,
    openTicketWorkspaceModal: () => undefined,
    planFeedbackBody: "",
    planFeedbackMutation: createMutationStub(),
    requestChangesMutation: createMutationStub(),
    requestedChangesBody: "",
    restartTicketFromScratch: () => undefined,
    restartTicketMutation: createMutationStub(),
    resumeReason: "",
    resumeTicketMutation: createMutationStub(),
    reviewPackage: null,
    reviewPackageQuery: { isPending: false },
    selectedProject: controller.selectedProject,
    selectedSessionId: session.id,
    selectedSessionTicket: ticket,
    selectedSessionTicketSession: session,
    sessionInputMutation: createMutationStub(),
    session,
    sessionById: new Map([[session.id, session]]),
    setPlanFeedbackBody: () => undefined,
    setRequestedChangesBody: () => undefined,
    setResumeReason: () => undefined,
    startAgentReviewMutation: createMutationStub(),
    stopTicketMutation: createMutationStub(),
  });

  const markup = renderToStaticMarkup(
    <MantineProvider>
      <InspectorPane controller={controller} />
    </MantineProvider>,
  );

  assert.match(markup, /Ship inspector header cleanup/);
  assert.doesNotMatch(markup, /Ticket session/);
  assert.doesNotMatch(
    markup,
    /Diff, terminal, preview, and full activity moved to the ticket card actions\./,
  );
  assert.doesNotMatch(markup, />Execution</);
});

test("session inspector disables merge and create pull request while AI review runs", async () => {
  const harness = installDom();
  const controller = createWalleyBoardController();
  const ticket = createTicket({
    id: 62,
    session_id: "session-62",
    status: "review",
    title: "Disable inspector review actions during AI review",
    working_branch: "ticket-62",
  });
  const session = {
    adapter_session_ref: null,
    agent_adapter: "codex" as const,
    completed_at: "2026-04-03T00:10:00.000Z",
    current_attempt_id: null,
    id: "session-62",
    last_heartbeat_at: "2026-04-03T00:10:00.000Z",
    last_summary: "Review package ready.",
    latest_requested_change_note_id: null,
    latest_review_package_id: "review-package-62",
    plan_status: "not_requested" as const,
    plan_summary: null,
    planning_enabled: false,
    project_id: ticket.project,
    queue_entered_at: null,
    repo_id: ticket.repo,
    started_at: "2026-04-03T00:00:00.000Z",
    status: "completed" as const,
    ticket_id: ticket.id,
    worktree_path: "/tmp/worktree-62",
  };

  Object.assign(controller as Record<string, unknown>, {
    createPullRequestMutation: createMutationStub(),
    deleteTicket: () => undefined,
    deleteTicketMutation: createMutationStub(),
    inspectorState: { kind: "session" },
    inspectorVisible: true,
    latestReviewRun: {
      id: "review-run-62",
      ticket_id: ticket.id,
      review_package_id: "review-package-62",
      implementation_session_id: session.id,
      status: "running",
      adapter_session_ref: null,
      prompt: "Review the current implementation.",
      report: null,
      failure_message: null,
      created_at: "2026-04-03T00:10:00.000Z",
      updated_at: "2026-04-03T00:10:00.000Z",
      completed_at: null,
    },
    latestReviewRunQuery: { isPending: false },
    mergeTicketMutation: createMutationStub(),
    openAgentReviewHistoryModal: () => undefined,
    openTicketWorkspaceModal: () => undefined,
    planFeedbackBody: "",
    planFeedbackMutation: createMutationStub(),
    requestChangesMutation: createMutationStub(),
    requestedChangesBody: "",
    restartTicketFromScratch: () => undefined,
    restartTicketMutation: createMutationStub(),
    reviewPackage: {
      id: "review-package-62",
      ticket_id: ticket.id,
      session_id: session.id,
      diff_ref: "/tmp/review-package-62.patch",
      commit_refs: ["abc123"],
      change_summary: "Ready for review.",
      validation_results: [],
      remaining_risks: [],
      created_at: "2026-04-03T00:10:00.000Z",
    },
    reviewPackageQuery: { isPending: false },
    selectedProject: {
      ...createProject(),
      default_review_action: "pull_request",
    },
    selectedSessionId: session.id,
    selectedSessionTicket: ticket,
    selectedSessionTicketSession: session,
    sessionInputMutation: createMutationStub(),
    session,
    sessionById: new Map([[session.id, session]]),
    setPlanFeedbackBody: () => undefined,
    setRequestedChangesBody: () => undefined,
    setResumeReason: () => undefined,
    startAgentReviewMutation: createMutationStub(),
    stopAgentReviewMutation: createMutationStub(),
    stopTicketMutation: createMutationStub(),
  });

  const root = createRoot(harness.mountNode);

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <InspectorPane controller={controller} />
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    const createPullRequestButton = [
      ...harness.mountNode.querySelectorAll("button"),
    ].find(
      (button) => button.textContent?.includes("Create pull request") ?? false,
    ) as HTMLButtonElement | undefined;
    const mergeButton = [...harness.mountNode.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Merge") ?? false,
    ) as HTMLButtonElement | undefined;

    assert.ok(
      createPullRequestButton,
      "Expected the inspector create pull request button",
    );
    assert.ok(mergeButton, "Expected the inspector merge button");
    assert.equal(
      createPullRequestButton.disabled,
      true,
      "Expected create pull request to be disabled during AI review",
    );
    assert.equal(
      mergeButton.disabled,
      true,
      "Expected merge to be disabled during AI review",
    );
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    harness.cleanup();
  }
});

test("narrow inspector-open layout keeps board scrolling on the shared board pane", async () => {
  const harness = installDom();
  const controller = createWalleyBoardController();
  Object.assign(controller as Record<string, unknown>, {
    inspectorState: { kind: "session" },
    inspectorVisible: true,
  });
  const cleanupStylesheet = installNarrowStylesheet(harness.window.document);
  const root = createRoot(harness.mountNode);

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <div className="walleyboard-shell">
            <div className="walleyboard-layout walleyboard-layout--with-detail">
              <ProjectRail controller={controller} />
              <BoardView controller={controller} />
              <InspectorPane controller={controller} />
            </div>
          </div>
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    const shell = harness.mountNode.querySelector(".walleyboard-shell");
    const boardScroller = harness.mountNode.querySelector(".board-scroller");
    const detail = harness.mountNode.querySelector(".walleyboard-detail");
    const columnStack = harness.mountNode.querySelector(".board-column-stack");

    assert.ok(shell, "Expected the board shell to render");
    assert.ok(boardScroller, "Expected the shared board scroller to render");
    assert.ok(detail, "Expected the inspector detail pane to render");
    assert.ok(columnStack, "Expected a board column stack to render");
    assert.equal(
      harness.window.getComputedStyle(shell).overflowY,
      "hidden",
      "Expected the board shell to stay fixed on narrow layouts",
    );
    assert.equal(
      harness.window.getComputedStyle(detail).overflowY,
      "auto",
      "Expected the detail pane to keep internal vertical scrolling",
    );
    assert.equal(
      harness.window.getComputedStyle(boardScroller).overflowY,
      "auto",
      "Expected the board scroller to own the vertical scrolling",
    );
    assert.notEqual(
      harness.window.getComputedStyle(columnStack).overflowY,
      "auto",
      "Expected board column stacks to avoid independent vertical scrolling",
    );
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    cleanupStylesheet();
    harness.cleanup();
  }
});

test("narrow selected-project header compacts workspace actions instead of overflowing labels", async () => {
  const harness = installDom();
  const controller = createWalleyBoardController();
  const cleanupStylesheet = installNarrowStylesheet(harness.window.document);
  const root = createRoot(harness.mountNode);

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <BoardView controller={controller} />
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    const headerRow = harness.mountNode.querySelector(
      ".workbench-header-row--selected",
    );
    const headerControls = harness.mountNode.querySelector(
      ".workbench-header-controls",
    );
    const actionButton = harness.mountNode.querySelector(
      ".project-workspace-action-button",
    );
    const actionLabel = harness.mountNode.querySelector(
      ".project-workspace-action-label",
    );

    assert.ok(headerRow, "Expected the selected-project header row to render");
    assert.ok(
      headerControls,
      "Expected the selected-project control cluster to render",
    );
    assert.ok(actionButton, "Expected a compact workspace action button");
    assert.ok(actionLabel, "Expected a workspace action label span");
    assert.equal(
      harness.window.getComputedStyle(headerRow).gap,
      "8px",
      "Expected the selected-project header to tighten its gaps on narrow screens",
    );
    assert.equal(
      harness.window.getComputedStyle(headerControls).gap,
      "6px",
      "Expected the control cluster to tighten its gaps on narrow screens",
    );
    assert.equal(
      harness.window.getComputedStyle(actionButton).minWidth,
      "36px",
      "Expected narrow-screen workspace actions to collapse to icon-width buttons",
    );
    assert.equal(
      harness.window.getComputedStyle(actionLabel).display,
      "none",
      "Expected narrow-screen workspace actions to hide text labels",
    );
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    cleanupStylesheet();
    harness.cleanup();
  }
});

test("board scroller preserves its scroll position across rerenders with uneven columns", async () => {
  const harness = installDom();
  const controller = createWalleyBoardController();
  Object.assign(controller as Record<string, unknown>, {
    archiveTicketMutation: createMutationStub(),
    createPullRequestMutation: createMutationStub(),
    deleteTicketMutation: createMutationStub(),
    editReadyTicketMutation: createMutationStub(),
    groupedTickets: {
      ready: [],
      in_progress: [],
      review: [],
      done: [
        createTicket({ id: 31, status: "done", title: "Done 1" }),
        createTicket({ id: 32, status: "done", title: "Done 2" }),
        createTicket({ id: 33, status: "done", title: "Done 3" }),
        createTicket({ id: 34, status: "done", title: "Done 4" }),
        createTicket({ id: 35, status: "done", title: "Done 5" }),
      ],
    },
    mergeTicketMutation: createMutationStub(),
    previewActionErrorByTicketId: {},
    restartTicketMutation: createMutationStub(),
    resumeTicketMutation: createMutationStub(),
    sessionSummaryStateById: new Map(),
    startAgentReviewMutation: createMutationStub(),
    startTicketMutation: createMutationStub(),
    startTicketWorkspacePreviewMutation: createMutationStub(),
    stopTicketMutation: createMutationStub(),
    stopTicketWorkspacePreviewMutation: createMutationStub(),
    ticketAiReviewActiveById: new Map(),
    ticketWorkspacePreviewByTicketId: new Map(),
    visibleDrafts: [createDraft("draft-short", "Single short draft")],
  });
  const cleanupStylesheet = installDesktopStylesheet(harness.window.document);
  const root = createRoot(harness.mountNode);

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <div className="walleyboard-shell">
            <div className="walleyboard-layout">
              <ProjectRail controller={controller} />
              <BoardView controller={controller} />
              <InspectorPane controller={controller} />
            </div>
          </div>
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    const boardScroller =
      harness.mountNode.querySelector<HTMLElement>(".board-scroller");
    const firstColumnStack = harness.mountNode.querySelector<HTMLElement>(
      ".board-column-stack",
    );
    const firstColumnViewport = firstColumnStack?.querySelector<HTMLElement>(
      ".mantine-ScrollArea-viewport",
    );

    assert.ok(boardScroller, "Expected the board scroller to render");
    assert.ok(firstColumnStack, "Expected the first column stack to render");
    assert.ok(
      firstColumnViewport,
      "Expected the first column viewport to render",
    );

    Object.defineProperty(boardScroller, "clientHeight", {
      configurable: true,
      value: 300,
    });
    Object.defineProperty(boardScroller, "scrollHeight", {
      configurable: true,
      value: 1440,
    });
    Object.defineProperty(boardScroller, "scrollTop", {
      configurable: true,
      value: 0,
      writable: true,
    });
    Object.defineProperty(firstColumnViewport, "scrollHeight", {
      configurable: true,
      value: 1440,
    });
    Object.defineProperty(firstColumnViewport, "scrollTop", {
      configurable: true,
      value: 0,
      writable: true,
    });

    await act(async () => {
      boardScroller.scrollTop = 180;
      boardScroller.dispatchEvent(new harness.window.Event("scroll"));
      await Promise.resolve();
    });

    await act(async () => {
      root.render(
        <MantineProvider>
          <div className="walleyboard-shell">
            <div className="walleyboard-layout">
              <ProjectRail controller={controller} />
              <BoardView controller={controller} />
              <InspectorPane controller={controller} />
            </div>
          </div>
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    assert.equal(
      boardScroller.scrollTop,
      180,
      "Expected rerendering the uneven board to preserve the DOM scroller position",
    );
    assert.equal(
      firstColumnViewport.scrollTop,
      180,
      "Expected the first column viewport to stay aligned with the DOM scroller",
    );
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    cleanupStylesheet();
    harness.cleanup();
  }
});

test("board columns do not pin content with inline min-height", async () => {
  const harness = installDom();
  const controller = createWalleyBoardController();
  const cleanupStylesheet = installDesktopStylesheet(harness.window.document);
  const root = createRoot(harness.mountNode);

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <div className="walleyboard-shell">
            <div className="walleyboard-layout">
              <ProjectRail controller={controller} />
              <BoardView controller={controller} />
              <InspectorPane controller={controller} />
            </div>
          </div>
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    const columnContents = [
      ...harness.mountNode.querySelectorAll<HTMLElement>(
        ".board-column-content",
      ),
    ];

    assert.ok(columnContents.length > 0, "Expected board columns to render");
    assert.ok(
      columnContents.every(
        (columnContent) => columnContent.style.minHeight === "",
      ),
      "Expected board columns to rely on natural content height instead of inline min-height pinning",
    );
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    cleanupStylesheet();
    harness.cleanup();
  }
});

test("board scroller ignores tiny column overflow deltas", async () => {
  const harness = installDom();
  const controller = createWalleyBoardController();
  const cleanupStylesheet = installDesktopStylesheet(harness.window.document);
  const root = createRoot(harness.mountNode);

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <div className="walleyboard-shell">
            <div className="walleyboard-layout">
              <ProjectRail controller={controller} />
              <BoardView controller={controller} />
              <InspectorPane controller={controller} />
            </div>
          </div>
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    const boardScroller =
      harness.mountNode.querySelector<HTMLElement>(".board-scroller");
    const boardScrollInner = harness.mountNode.querySelector<HTMLElement>(
      ".board-scroll-inner",
    );
    const columnViewports = [
      ...harness.mountNode.querySelectorAll<HTMLElement>(
        ".mantine-ScrollArea-viewport",
      ),
    ];

    assert.ok(boardScroller, "Expected the board scroller to render");
    assert.ok(boardScrollInner, "Expected the board scroll inner to render");
    assert.equal(
      columnViewports.length,
      boardColumns.length,
      "Expected a viewport for each board column",
    );

    Object.defineProperty(boardScroller, "clientHeight", {
      configurable: true,
      value: 316,
    });
    for (const [index, viewport] of columnViewports.entries()) {
      Object.defineProperty(viewport, "clientHeight", {
        configurable: true,
        value: 300,
      });
      Object.defineProperty(viewport, "scrollHeight", {
        configurable: true,
        value: index === 0 || index === columnViewports.length - 1 ? 303 : 300,
      });
    }

    Object.assign(controller as Record<string, unknown>, {
      visibleDrafts: [
        ...controller.visibleDrafts,
        createDraft("draft-4", "Trigger a board metric refresh"),
      ],
    });

    await act(async () => {
      root.render(
        <MantineProvider>
          <div className="walleyboard-shell">
            <div className="walleyboard-layout">
              <ProjectRail controller={controller} />
              <BoardView controller={controller} />
              <InspectorPane controller={controller} />
            </div>
          </div>
        </MantineProvider>,
      );
      await Promise.resolve();
    });

    assert.equal(
      boardScrollInner.style.height,
      "300px",
      "Expected tiny layout rounding deltas to avoid creating shared-scroll overflow",
    );
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    cleanupStylesheet();
    harness.cleanup();
  }
});
