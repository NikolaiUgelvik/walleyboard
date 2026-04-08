import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  DraftTicketState,
  Project,
  RepositoryConfig,
  ValidationCommand,
} from "../../../../../packages/contracts/src/index.js";
import type {
  ArchiveActionFeedback,
  InspectorState,
  WorkspaceModalKind,
} from "./shared-types.js";
import { defaultProjectColor, projectColorPalette } from "./shared-utils.js";
import {
  resolveProjectSelectionHydration,
  useDraftEditorSourceSync,
  useProjectColorRefresh,
  useProjectOptionsStateSync,
  useProjectSelectionHydration,
  useWorkspaceModalGuard,
} from "./walleyboard-controller-effects.js";

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

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
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
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
    installGlobal("ShadowRoot", window.ShadowRoot),
    installGlobal("SVGElement", window.SVGElement),
  ];
  const mountNode = window.document.createElement("div");
  window.document.body.appendChild(mountNode);

  return {
    cleanup: () => {
      mountNode.remove();
      for (const restoreGlobal of restoreGlobals.reverse()) {
        restoreGlobal();
      }
      dom.window.close();
    },
    mountNode,
    window,
  };
}

async function waitFor(check: () => void): Promise<void> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      check();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  throw lastError;
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

function readState<T>(mountNode: HTMLElement): T {
  return JSON.parse(mountNode.textContent ?? "null") as T;
}

function ProjectSelectionHydrationProbe(input: {
  initialArchiveActionFeedback?: ArchiveActionFeedback | null;
  initialArchiveModalOpen?: boolean;
  initialSelectedProjectId?: string | null;
  projectRecords: Pick<Project, "id">[];
  projectsLoaded: boolean;
}) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    input.initialSelectedProjectId ?? null,
  );
  const [archiveModalOpen, setArchiveModalOpen] = useState(
    input.initialArchiveModalOpen ?? true,
  );
  const [archiveActionFeedback, setArchiveActionFeedback] =
    useState<ArchiveActionFeedback | null>(
      input.initialArchiveActionFeedback ?? {
        tone: "green",
        message: "Archived",
      },
    );
  const [projectSelectionHydrated, setProjectSelectionHydrated] =
    useState(false);

  useProjectSelectionHydration({
    projectRecords: input.projectRecords,
    projectSelectionHydrated,
    projectsLoaded: input.projectsLoaded,
    selectedProjectId,
    setArchiveActionFeedback,
    setArchiveModalOpen,
    setProjectSelectionHydrated,
    setSelectedProjectId,
  });

  return (
    <pre>
      {JSON.stringify({
        archiveActionFeedback,
        archiveModalOpen,
        projectSelectionHydrated,
        selectedProjectId,
      })}
    </pre>
  );
}

function ProjectOptionsStateSyncProbe(input: {
  projectRecords: Project[];
  projectsLoaded: boolean;
  projectOptionsRepositoriesQueryData?: {
    repositories: RepositoryConfig[];
  };
  selectedProjectId?: string | null;
}) {
  const [projectDeleteConfirmText, setProjectDeleteConfirmText] =
    useState("project-2");
  const [projectOptionsProjectId, setProjectOptionsProjectId] = useState<
    string | null
  >(input.selectedProjectId ?? "project-2");
  const [projectOptionsColor, setProjectOptionsColor] = useState("#f43f5e");
  const [
    projectOptionsColorManuallySelected,
    setProjectOptionsColorManuallySelected,
  ] = useState(true);
  const [
    projectOptionsRepositoryTargetBranches,
    setProjectOptionsRepositoryTargetBranches,
  ] = useState<Record<string, string>>({ repo_1: "feature" });
  const [
    projectOptionsRepositoryValidationCommands,
    setProjectOptionsRepositoryValidationCommands,
  ] = useState<Record<string, ValidationCommand[]>>({
    repo_1: [createValidationCommand({ id: "cmd-2" })],
  });
  const [projectOptionsFormError, setProjectOptionsFormError] = useState<
    string | null
  >("boom");

  useProjectOptionsStateSync({
    projectOptionsProjectId,
    projectOptionsRepositoriesQueryData:
      input.projectOptionsRepositoriesQueryData,
    projectRecords: input.projectRecords,
    projectsLoaded: input.projectsLoaded,
    setProjectDeleteConfirmText,
    setProjectOptionsColor,
    setProjectOptionsColorManuallySelected,
    setProjectOptionsFormError,
    setProjectOptionsProjectId,
    setProjectOptionsRepositoryTargetBranches,
    setProjectOptionsRepositoryValidationCommands,
  });

  return (
    <pre>
      {JSON.stringify({
        projectDeleteConfirmText,
        projectOptionsColor,
        projectOptionsColorManuallySelected,
        projectOptionsFormError,
        projectOptionsProjectId,
        projectOptionsRepositoryTargetBranches,
        projectOptionsRepositoryValidationCommands,
      })}
    </pre>
  );
}

function ProjectColorRefreshProbe(input: {
  projectColorManuallySelected?: boolean;
  projectColorNeedsRefresh?: boolean;
  projectModalOpen?: boolean;
  projectRecords: Project[];
  projectsLoaded: boolean;
}) {
  const [projectColor, setProjectColor] = useState("#f43f5e");
  const [projectColorNeedsRefresh, setProjectColorNeedsRefresh] = useState(
    input.projectColorNeedsRefresh ?? true,
  );

  useProjectColorRefresh({
    projectColorManuallySelected: input.projectColorManuallySelected ?? false,
    projectColorNeedsRefresh,
    projectModalOpen: input.projectModalOpen ?? true,
    projectsLoaded: input.projectsLoaded,
    projectRecords: input.projectRecords,
    setProjectColor,
    setProjectColorNeedsRefresh,
  });

  return (
    <pre>
      {JSON.stringify({
        projectColor,
        projectColorNeedsRefresh,
      })}
    </pre>
  );
}

function WorkspaceModalGuardProbe(input: {
  hasTerminalContext?: boolean;
  initialWorkspaceModal: WorkspaceModalKind | null;
  inspectorKind: InspectorState["kind"];
}) {
  const [workspaceModal, setWorkspaceModal] =
    useState<WorkspaceModalKind | null>(input.initialWorkspaceModal);

  useWorkspaceModalGuard({
    hasTerminalContext: input.hasTerminalContext ?? false,
    inspectorKind: input.inspectorKind,
    setWorkspaceModal,
    workspaceModal,
  });

  return <pre>{JSON.stringify({ workspaceModal })}</pre>;
}

function DraftEditorSourceSyncProbe(input: {
  inspectorKind: InspectorState["kind"];
  selectedDraft: DraftTicketState | null;
}) {
  const [draftEditorSourceId, setDraftEditorSourceId] = useState<string | null>(
    null,
  );
  const [draftEditorTitle, setDraftEditorTitle] = useState("Stale title");
  const [draftEditorDescription, setDraftEditorDescription] =
    useState("Stale description");
  const [draftEditorTicketType, setDraftEditorTicketType] =
    useState<DraftTicketState["proposed_ticket_type"]>("bugfix");
  const [draftEditorAcceptanceCriteria, setDraftEditorAcceptanceCriteria] =
    useState("stale");
  const [draftEditorProjectId, setDraftEditorProjectId] = useState<
    string | null
  >("project-stale");
  const [draftEditorArtifactScopeId, setDraftEditorArtifactScopeId] = useState<
    string | null
  >("artifact-stale");
  const [draftEditorUploadError, setDraftEditorUploadError] = useState<
    string | null
  >("upload failed");
  const [pendingDraftEditorSync, setPendingDraftEditorSync] = useState<{
    draftId: string;
    sourceUpdatedAt: string | null;
    title: string;
    description: string;
    ticketType: DraftTicketState["proposed_ticket_type"];
    acceptanceCriteria: string;
  } | null>(null);

  useDraftEditorSourceSync({
    draftEditorAcceptanceCriteria,
    draftEditorDescription,
    draftEditorSourceId,
    draftEditorTicketType,
    draftEditorTitle,
    draftFormDirty: false,
    inspectorKind: input.inspectorKind,
    pendingDraftEditorSync,
    selectedDraft: input.selectedDraft,
    setDraftEditorAcceptanceCriteria,
    setDraftEditorArtifactScopeId,
    setDraftEditorDescription,
    setDraftEditorProjectId,
    setDraftEditorSourceId,
    setDraftEditorTicketType,
    setDraftEditorTitle,
    setDraftEditorUploadError,
    setPendingDraftEditorSync,
  });

  return (
    <pre>
      {JSON.stringify({
        draftEditorAcceptanceCriteria,
        draftEditorArtifactScopeId,
        draftEditorDescription,
        draftEditorProjectId,
        draftEditorSourceId,
        draftEditorTicketType,
        draftEditorTitle,
        draftEditorUploadError,
        pendingDraftEditorSync,
      })}
    </pre>
  );
}

test("resolveProjectSelectionHydration uses the stored project or the first project", () => {
  const dom = installDom();

  try {
    dom.window.localStorage.setItem(
      "walleyboard:last-open-project-id",
      "project-2",
    );

    assert.deepEqual(
      resolveProjectSelectionHydration({
        projectRecords: [{ id: "project-1" }, { id: "project-2" }],
        selectedProjectId: null,
      }),
      {
        clearArchiveState: true,
        nextSelectedProjectId: "project-2",
      },
    );

    dom.window.localStorage.removeItem("walleyboard:last-open-project-id");

    assert.deepEqual(
      resolveProjectSelectionHydration({
        projectRecords: [{ id: "project-1" }, { id: "project-2" }],
        selectedProjectId: null,
      }),
      {
        clearArchiveState: true,
        nextSelectedProjectId: "project-1",
      },
    );

    assert.deepEqual(
      resolveProjectSelectionHydration({
        projectRecords: [{ id: "project-1" }],
        selectedProjectId: "missing-project",
      }),
      {
        clearArchiveState: true,
        nextSelectedProjectId: "project-1",
      },
    );
  } finally {
    dom.cleanup();
  }
});

test("useProjectSelectionHydration restores the selected project and clears archive state", async () => {
  const dom = installDom();
  const root = createRoot(dom.mountNode);

  try {
    dom.window.localStorage.setItem(
      "walleyboard:last-open-project-id",
      "project-2",
    );

    await act(async () => {
      root.render(
        <ProjectSelectionHydrationProbe
          initialArchiveActionFeedback={{
            tone: "red",
            message: "Still open",
          }}
          initialArchiveModalOpen
          projectRecords={[{ id: "project-1" }, { id: "project-2" }]}
          projectsLoaded
        />,
      );
    });

    await waitFor(() => {
      assert.deepEqual(readState<Record<string, unknown>>(dom.mountNode), {
        archiveActionFeedback: null,
        archiveModalOpen: false,
        projectSelectionHydrated: true,
        selectedProjectId: "project-2",
      });
      assert.equal(
        dom.window.localStorage.getItem("walleyboard:last-open-project-id"),
        "project-2",
      );
    });
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.cleanup();
  }
});

test("useProjectOptionsStateSync clears stale selections after project load", async () => {
  const dom = installDom();
  const root = createRoot(dom.mountNode);

  try {
    await act(async () => {
      root.render(
        <ProjectOptionsStateSyncProbe
          projectRecords={[createProject()]}
          projectsLoaded
        />,
      );
    });

    await waitFor(() => {
      assert.deepEqual(readState<Record<string, unknown>>(dom.mountNode), {
        projectDeleteConfirmText: "",
        projectOptionsColor: defaultProjectColor,
        projectOptionsColorManuallySelected: false,
        projectOptionsFormError: null,
        projectOptionsProjectId: null,
        projectOptionsRepositoryTargetBranches: {},
        projectOptionsRepositoryValidationCommands: {},
      });
    });
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.cleanup();
  }
});

test("useProjectColorRefresh picks a replacement project color when refresh is needed", async () => {
  const dom = installDom();
  const root = createRoot(dom.mountNode);
  const originalRandom = Math.random;

  try {
    Math.random = () => 0;

    await act(async () => {
      root.render(
        <ProjectColorRefreshProbe projectRecords={[]} projectsLoaded />,
      );
    });

    await waitFor(() => {
      assert.deepEqual(readState<Record<string, unknown>>(dom.mountNode), {
        projectColor: projectColorPalette[0],
        projectColorNeedsRefresh: false,
      });
    });
  } finally {
    Math.random = originalRandom;
    await act(async () => {
      root.unmount();
    });
    dom.cleanup();
  }
});

test("useWorkspaceModalGuard closes a terminal modal but keeps a diff modal open", async () => {
  const terminalDom = installDom();
  const terminalRoot = createRoot(terminalDom.mountNode);

  try {
    await act(async () => {
      terminalRoot.render(
        <WorkspaceModalGuardProbe
          initialWorkspaceModal="terminal"
          inspectorKind="ticket"
          hasTerminalContext={false}
        />,
      );
    });

    await waitFor(() => {
      assert.deepEqual(
        readState<Record<string, unknown>>(terminalDom.mountNode),
        {
          workspaceModal: null,
        },
      );
    });
  } finally {
    await act(async () => {
      terminalRoot.unmount();
    });
    terminalDom.cleanup();
  }

  const diffDom = installDom();
  const diffRoot = createRoot(diffDom.mountNode);

  try {
    await act(async () => {
      diffRoot.render(
        <WorkspaceModalGuardProbe
          initialWorkspaceModal="diff"
          inspectorKind="ticket"
          hasTerminalContext={false}
        />,
      );
    });

    await waitFor(() => {
      assert.deepEqual(readState<Record<string, unknown>>(diffDom.mountNode), {
        workspaceModal: "diff",
      });
    });
  } finally {
    await act(async () => {
      diffRoot.unmount();
    });
    diffDom.cleanup();
  }
});

test("useDraftEditorSourceSync hydrates the selected draft and clears stale editor state", async () => {
  const dom = installDom();
  const root = createRoot(dom.mountNode);

  try {
    const selectedDraft = createDraft({
      id: "draft-31",
      artifact_scope_id: "artifact-31",
      description_draft: "Updated description",
      proposed_acceptance_criteria: ["criterion-31"],
      proposed_ticket_type: "feature",
      project_id: "project-31",
      title_draft: "Updated title",
    });

    await act(async () => {
      root.render(
        <DraftEditorSourceSyncProbe
          inspectorKind="draft"
          selectedDraft={selectedDraft}
        />,
      );
    });

    await waitFor(() => {
      assert.deepEqual(readState<Record<string, unknown>>(dom.mountNode), {
        draftEditorAcceptanceCriteria: "criterion-31",
        draftEditorArtifactScopeId: "artifact-31",
        draftEditorDescription: "Updated description",
        draftEditorProjectId: "project-31",
        draftEditorSourceId: "draft-31",
        draftEditorTicketType: "feature",
        draftEditorTitle: "Updated title",
        draftEditorUploadError: null,
        pendingDraftEditorSync: null,
      });
    });

    await act(async () => {
      root.render(
        <DraftEditorSourceSyncProbe
          inspectorKind="hidden"
          selectedDraft={null}
        />,
      );
    });

    await waitFor(() => {
      assert.deepEqual(readState<Record<string, unknown>>(dom.mountNode), {
        draftEditorAcceptanceCriteria: "",
        draftEditorArtifactScopeId: null,
        draftEditorDescription: "",
        draftEditorProjectId: null,
        draftEditorSourceId: null,
        draftEditorTicketType: "feature",
        draftEditorTitle: "",
        draftEditorUploadError: null,
        pendingDraftEditorSync: null,
      });
    });
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.cleanup();
  }
});
