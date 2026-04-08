import type { Dispatch, SetStateAction } from "react";
import { useEffect } from "react";
import type {
  DraftTicketState,
  Project,
  TicketFrontmatter,
  ValidationCommand,
} from "../../../../../packages/contracts/src/index.js";
import {
  type PendingDraftEditorSync,
  resolveDraftEditorSync,
} from "../../lib/draft-editor-sync.js";
import {
  resolveNextInspectorState,
  shouldResetProjectOptionsSelection,
} from "./controller-guards.js";
import { readLastOpenProjectId, writeLastOpenProjectId } from "./shared-api.js";
import type {
  ArchiveActionFeedback,
  InspectorState,
  RepositoriesResponse,
  WorkspaceModalKind,
} from "./shared-types.js";
import {
  defaultProjectColor,
  mergeRepositoryTargetBranches,
  mergeRepositoryValidationCommands,
  pickProjectColor,
  repositoryTargetBranchesEqual,
  repositoryValidationCommandsEqual,
  shouldRefreshProjectColorSelection,
} from "./shared-utils.js";
import { shouldKeepWorkspaceModalOpen } from "./workspace-modal-state.js";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export function resolveProjectSelectionHydration(input: {
  projectRecords: Pick<Project, "id">[];
  selectedProjectId: string | null;
}) {
  const firstProjectId = input.projectRecords[0]?.id ?? null;

  if (input.selectedProjectId === null) {
    const storedProjectId = readLastOpenProjectId();
    const initialProjectId =
      storedProjectId !== null &&
      input.projectRecords.some((project) => project.id === storedProjectId)
        ? storedProjectId
        : firstProjectId;

    return {
      clearArchiveState: initialProjectId !== null,
      nextSelectedProjectId: initialProjectId ?? undefined,
    };
  }

  const stillExists = input.projectRecords.some(
    (project) => project.id === input.selectedProjectId,
  );
  if (stillExists) {
    return {
      clearArchiveState: false,
      nextSelectedProjectId: undefined,
    };
  }

  return {
    clearArchiveState: true,
    nextSelectedProjectId: firstProjectId,
  };
}

export function useProjectSelectionHydration(input: {
  projectRecords: Pick<Project, "id">[];
  projectSelectionHydrated: boolean;
  projectsLoaded: boolean;
  selectedProjectId: string | null;
  setArchiveActionFeedback: StateSetter<ArchiveActionFeedback | null>;
  setArchiveModalOpen: StateSetter<boolean>;
  setProjectSelectionHydrated: StateSetter<boolean>;
  setSelectedProjectId: StateSetter<string | null>;
}) {
  useEffect(() => {
    if (!input.projectsLoaded) {
      return;
    }

    const hydration = resolveProjectSelectionHydration({
      projectRecords: input.projectRecords,
      selectedProjectId: input.selectedProjectId,
    });

    if (hydration.nextSelectedProjectId !== undefined) {
      input.setSelectedProjectId(hydration.nextSelectedProjectId);
    }

    if (hydration.clearArchiveState) {
      input.setArchiveModalOpen(false);
      input.setArchiveActionFeedback(null);
    }

    input.setProjectSelectionHydrated(true);
  }, [
    input.projectRecords,
    input.projectsLoaded,
    input.selectedProjectId,
    input.setArchiveActionFeedback,
    input.setArchiveModalOpen,
    input.setProjectSelectionHydrated,
    input.setSelectedProjectId,
  ]);

  useEffect(() => {
    if (!input.projectSelectionHydrated) {
      return;
    }

    writeLastOpenProjectId(input.selectedProjectId);
  }, [input.projectSelectionHydrated, input.selectedProjectId]);
}

export function useProjectColorRefresh(input: {
  projectColorManuallySelected: boolean;
  projectColorNeedsRefresh: boolean;
  projectModalOpen: boolean;
  projectsLoaded: boolean;
  projectRecords: Project[];
  setProjectColor: StateSetter<string>;
  setProjectColorNeedsRefresh: StateSetter<boolean>;
}) {
  useEffect(() => {
    if (
      !shouldRefreshProjectColorSelection({
        projectColorManuallySelected: input.projectColorManuallySelected,
        projectColorNeedsRefresh: input.projectColorNeedsRefresh,
        projectModalOpen: input.projectModalOpen,
        projectsLoaded: input.projectsLoaded,
      })
    ) {
      return;
    }

    input.setProjectColor(pickProjectColor(input.projectRecords));
    input.setProjectColorNeedsRefresh(false);
  }, [
    input.projectColorManuallySelected,
    input.projectColorNeedsRefresh,
    input.projectModalOpen,
    input.projectRecords,
    input.projectsLoaded,
    input.setProjectColor,
    input.setProjectColorNeedsRefresh,
  ]);
}

export function useProjectOptionsStateSync(input: {
  projectOptionsProjectId: string | null;
  projectOptionsRepositoriesQueryData: RepositoriesResponse | undefined;
  projectRecords: Project[];
  projectsLoaded: boolean;
  setProjectDeleteConfirmText: StateSetter<string>;
  setProjectOptionsColor: StateSetter<string>;
  setProjectOptionsColorManuallySelected: StateSetter<boolean>;
  setProjectOptionsFormError: StateSetter<string | null>;
  setProjectOptionsProjectId: StateSetter<string | null>;
  setProjectOptionsRepositoryTargetBranches: StateSetter<
    Record<string, string>
  >;
  setProjectOptionsRepositoryValidationCommands: StateSetter<
    Record<string, ValidationCommand[]>
  >;
}) {
  useEffect(() => {
    if (
      !shouldResetProjectOptionsSelection({
        projectOptionsProjectId: input.projectOptionsProjectId,
        projects: input.projectRecords,
        projectsLoaded: input.projectsLoaded,
      })
    ) {
      return;
    }

    input.setProjectOptionsProjectId(null);
    input.setProjectOptionsColor(defaultProjectColor);
    input.setProjectOptionsColorManuallySelected(false);
    input.setProjectOptionsRepositoryTargetBranches({});
    input.setProjectOptionsRepositoryValidationCommands({});
    input.setProjectOptionsFormError(null);
    input.setProjectDeleteConfirmText("");
  }, [
    input.projectOptionsProjectId,
    input.projectRecords,
    input.projectsLoaded,
    input.setProjectDeleteConfirmText,
    input.setProjectOptionsColor,
    input.setProjectOptionsColorManuallySelected,
    input.setProjectOptionsFormError,
    input.setProjectOptionsProjectId,
    input.setProjectOptionsRepositoryTargetBranches,
    input.setProjectOptionsRepositoryValidationCommands,
  ]);

  useEffect(() => {
    const repositoriesQueryData = input.projectOptionsRepositoriesQueryData;
    if (repositoriesQueryData === undefined) {
      return;
    }

    const defaultTargetBranch =
      input.projectRecords.find(
        (project) => project.id === input.projectOptionsProjectId,
      )?.default_target_branch ?? null;

    input.setProjectOptionsRepositoryTargetBranches((current) => {
      const next = mergeRepositoryTargetBranches(
        current,
        repositoriesQueryData.repositories,
        defaultTargetBranch,
      );
      return repositoryTargetBranchesEqual(current, next) ? current : next;
    });
  }, [
    input.projectOptionsProjectId,
    input.projectOptionsRepositoriesQueryData,
    input.projectRecords,
    input.setProjectOptionsRepositoryTargetBranches,
  ]);

  useEffect(() => {
    const repositoriesQueryData = input.projectOptionsRepositoriesQueryData;
    if (repositoriesQueryData === undefined) {
      return;
    }

    input.setProjectOptionsRepositoryValidationCommands((current) => {
      const next = mergeRepositoryValidationCommands(
        current,
        repositoriesQueryData.repositories,
      );
      return repositoryValidationCommandsEqual(current, next) ? current : next;
    });
  }, [
    input.projectOptionsRepositoriesQueryData,
    input.setProjectOptionsRepositoryValidationCommands,
  ]);
}

export function useInspectorStateGuard(input: {
  draftRecords: DraftTicketState[];
  draftsLoaded: boolean;
  inspectorState: InspectorState;
  selectedProjectId: string | null;
  setInspectorState: StateSetter<InspectorState>;
  ticketRecords: TicketFrontmatter[];
  ticketsLoaded: boolean;
}) {
  useEffect(() => {
    const nextInspectorState = resolveNextInspectorState({
      drafts: input.draftRecords,
      draftsLoaded: input.draftsLoaded,
      inspectorState: input.inspectorState,
      selectedProjectId: input.selectedProjectId,
      tickets: input.ticketRecords,
      ticketsLoaded: input.ticketsLoaded,
    });
    if (nextInspectorState !== null) {
      input.setInspectorState(nextInspectorState);
    }
  }, [
    input.draftRecords,
    input.draftsLoaded,
    input.inspectorState,
    input.selectedProjectId,
    input.ticketRecords,
    input.ticketsLoaded,
    input.setInspectorState,
  ]);
}

export function useWorkspaceModalGuard(input: {
  hasTerminalContext: boolean;
  inspectorKind: InspectorState["kind"];
  setWorkspaceModal: StateSetter<WorkspaceModalKind | null>;
  workspaceModal: WorkspaceModalKind | null;
}) {
  useEffect(() => {
    if (
      shouldKeepWorkspaceModalOpen(
        input.inspectorKind,
        input.workspaceModal,
        input.hasTerminalContext,
      )
    ) {
      return;
    }

    input.setWorkspaceModal(null);
  }, [
    input.hasTerminalContext,
    input.inspectorKind,
    input.setWorkspaceModal,
    input.workspaceModal,
  ]);
}

export function useDraftEditorSourceSync(input: {
  draftEditorAcceptanceCriteria: string;
  draftEditorDescription: string;
  draftEditorSourceId: string | null;
  draftEditorTicketType: DraftTicketState["proposed_ticket_type"];
  draftEditorTitle: string;
  draftFormDirty: boolean;
  inspectorKind: InspectorState["kind"];
  pendingDraftEditorSync: PendingDraftEditorSync | null;
  selectedDraft: DraftTicketState | null;
  setDraftEditorAcceptanceCriteria: StateSetter<string>;
  setDraftEditorArtifactScopeId: StateSetter<string | null>;
  setDraftEditorDescription: StateSetter<string>;
  setDraftEditorProjectId: StateSetter<string | null>;
  setDraftEditorSourceId: StateSetter<string | null>;
  setDraftEditorTicketType: StateSetter<
    DraftTicketState["proposed_ticket_type"]
  >;
  setDraftEditorTitle: StateSetter<string>;
  setDraftEditorUploadError: StateSetter<string | null>;
  setPendingDraftEditorSync: StateSetter<PendingDraftEditorSync | null>;
}) {
  useEffect(() => {
    if (input.inspectorKind === "new_draft") {
      return;
    }

    const syncResult = resolveDraftEditorSync({
      draftFormDirty: input.draftFormDirty,
      editor: {
        sourceId: input.draftEditorSourceId,
        title: input.draftEditorTitle,
        description: input.draftEditorDescription,
        ticketType: input.draftEditorTicketType,
        acceptanceCriteria: input.draftEditorAcceptanceCriteria,
      },
      pendingSync: input.pendingDraftEditorSync,
      selectedDraft: input.selectedDraft,
    });

    if (syncResult.nextEditor) {
      input.setDraftEditorSourceId(syncResult.nextEditor.sourceId);
      input.setDraftEditorTitle(syncResult.nextEditor.title);
      input.setDraftEditorDescription(syncResult.nextEditor.description);
      input.setDraftEditorTicketType(syncResult.nextEditor.ticketType);
      input.setDraftEditorAcceptanceCriteria(
        syncResult.nextEditor.acceptanceCriteria,
      );
    }

    if (syncResult.nextPendingSync !== undefined) {
      input.setPendingDraftEditorSync(syncResult.nextPendingSync);
    }
  }, [
    input.draftEditorAcceptanceCriteria,
    input.draftEditorDescription,
    input.draftEditorSourceId,
    input.draftEditorTicketType,
    input.draftEditorTitle,
    input.draftFormDirty,
    input.inspectorKind,
    input.pendingDraftEditorSync,
    input.selectedDraft,
    input.setDraftEditorAcceptanceCriteria,
    input.setDraftEditorDescription,
    input.setDraftEditorSourceId,
    input.setDraftEditorTicketType,
    input.setDraftEditorTitle,
    input.setPendingDraftEditorSync,
  ]);

  useEffect(() => {
    if (input.inspectorKind === "new_draft") {
      return;
    }

    if (input.inspectorKind === "draft") {
      if (input.selectedDraft) {
        input.setDraftEditorProjectId(input.selectedDraft.project_id);
        input.setDraftEditorArtifactScopeId(
          input.selectedDraft.artifact_scope_id,
        );
        input.setDraftEditorUploadError(null);
      }
      return;
    }

    input.setDraftEditorProjectId(null);
    input.setDraftEditorArtifactScopeId(null);
    input.setDraftEditorUploadError(null);
  }, [
    input.inspectorKind,
    input.selectedDraft,
    input.setDraftEditorArtifactScopeId,
    input.setDraftEditorProjectId,
    input.setDraftEditorUploadError,
  ]);
}
