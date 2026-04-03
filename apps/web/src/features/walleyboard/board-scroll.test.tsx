import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MantineProvider } from "@mantine/core";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  DraftTicketState,
  HealthResponse,
  Project,
  RepositoryConfig,
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countClass(markup: string, className: string): number {
  return [...markup.matchAll(/class="([^"]*)"/g)].filter((match) =>
    match[1]?.split(/\s+/).includes(className),
  ).length;
}

function extractBlock(source: string, marker: string): string {
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
        return source.slice(blockStart + 1, index);
      }
    }
  }

  throw new Error(`Missing closing brace for ${marker}`);
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

test("board shell keeps scroll ownership at the shell and stretches empty columns", () => {
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
    "overflow-y: auto",
    "overflow-x: hidden",
  ]);
  assertRuleIncludes(desktopRules, ".walleyboard-main", [
    "display: flex",
    "flex-direction: column",
  ]);
  assertRuleIncludes(desktopRules, ".board-scroller", [
    "overflow-x: auto",
    "overflow-y: visible",
  ]);
  assertRuleIncludes(desktopRules, ".board-grid", ["align-items: stretch"]);
  assertRuleIncludes(desktopRules, ".board-column", [
    "height: auto",
    "overflow: visible",
  ]);
  assertRuleIncludes(desktopRules, ".board-column-stack", [
    "overflow-y: visible",
  ]);
  assert.match(
    desktopRules,
    /\.walleyboard-rail,\s*\.walleyboard-main,\s*\.walleyboard-detail\s*\{[^}]*min-height:\s*0\s*;/,
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
