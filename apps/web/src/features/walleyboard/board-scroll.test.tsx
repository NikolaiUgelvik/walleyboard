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
    docker: {
      installed: true,
      available: true,
      client_version: "1.0.0",
      server_version: "1.0.0",
      error: null,
    },
    claude_code: {
      available: false,
      configured_path: null,
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
    archiveActionFeedback: null,
    archiveDoneTickets: () => undefined,
    archiveDoneTicketsMutation: createMutationStub(),
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
  assertRuleIncludes(desktopRules, ".board-scroller", [
    "overflow-x: auto",
    "overflow-y: auto",
  ]);
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
  assertRuleIncludes(narrowRules, ".board-column", ["min-height: auto"]);
  assert.doesNotMatch(
    stylesheet,
    /\.board-column-stack\s*\{[^}]*overflow-y:\s*auto\s*;/,
  );
});

test("board header keeps the selected project and repository summary without status badges", () => {
  const controller = createWalleyBoardController();
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <BoardView controller={controller} />
    </MantineProvider>,
  );

  assert.match(markup, />Project One</);
  assert.match(markup, />walleyboard • 0 validation command\(s\)</);
  assert.doesNotMatch(markup, />backend</);
  assert.doesNotMatch(markup, />0 running</);
  assert.doesNotMatch(markup, />0 queued</);
  assert.doesNotMatch(markup, />0 in review</);
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

test("ticket cards show diff line summaries only for in-progress and review tickets above the description preview", () => {
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

  assert.match(markup, />2 files changed</);
  assert.match(markup, />1 file changed</);
  assert.doesNotMatch(markup, />9 files changed</);
  assert.doesNotMatch(markup, />4 files changed</);

  assert.ok(
    markup.indexOf("2 files changed") <
      markup.indexOf("In-progress ticket description preview"),
  );
  assert.ok(
    markup.indexOf("1 file changed") <
      markup.indexOf("Review ticket description preview"),
  );
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
      /Ticket session/,
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
      "Expected the board scroller to own the shared vertical scrolling",
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
      "Expected the board scroller to own the shared vertical scrolling",
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
