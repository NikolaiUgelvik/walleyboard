import { useQueries, useQueryClient } from "@tanstack/react-query";
import { type SetStateAction, useState } from "react";
import type {
  Project,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import { useAgentReviewHistoryModalState } from "./agent-review-history-modal-state.js";
import { createDraftEditorController } from "./draft-editor-controller.js";
import {
  useDraftRefinementActivity,
  useGlobalDrafts,
} from "./draft-queries.js";
import { createNewDraftActionHandlers } from "./new-draft-actions.js";
import {
  closeProjectCreationModal,
  openProjectCreationModal,
  populateProjectOptionsModal,
  resetProjectOptionsModal,
} from "./project-configuration-controls.js";
import {
  fetchJson,
  readInboxReadState,
  writeInboxReadState,
} from "./shared-api.js";
import type { RepositoriesResponse, SessionResponse } from "./shared-types.js";
import {
  collectRepositoryTargetBranchUpdates,
  collectRepositoryValidationCommandUpdates,
  computeMarkAllReadState,
  defaultProjectColor,
} from "./shared-utils.js";
import { createTicketActions } from "./ticket-actions.js";
import { navigateToTicketReference } from "./ticket-reference-navigation.js";
import { useInboxAlert } from "./use-inbox-alert.js";
import { useProtocolEventSync } from "./use-protocol-event-sync.js";
import { useSelectedRepositoryWorkspace } from "./use-selected-repository-workspace.js";
import { useTicketAiReviewStatus } from "./use-ticket-ai-review-status.js";
import { useTicketDiffLineSummary } from "./use-ticket-diff-line-summary.js";
import { useTicketReviewQueries } from "./use-ticket-review-queries.js";
import { useTicketWorkspacePreview } from "./use-ticket-workspace-preview.js";
import {
  useDraftEditorState,
  useDraftInspectorState,
  useProjectCreationState,
  useProjectOptionsState,
  useProjectSelectionState,
  useSessionActionState,
  useWorkspaceState,
} from "./use-walleyboard-local-state.js";
import { useWalleyBoardMutationWiring } from "./use-walleyboard-mutation-wiring.js";
import { useWalleyBoardServerState } from "./use-walleyboard-server-state.js";
import {
  useDraftEditorSourceSync,
  useInspectorStateGuard,
  useProjectColorRefresh,
  useProjectOptionsStateSync,
  useProjectSelectionHydration,
  useWorkspaceModalGuard,
} from "./walleyboard-controller-effects.js";
import {
  resolveBoardViewState,
  resolveDraftEditorViewState,
  resolveInboxViewState,
  resolveProjectOptionsViewState,
  resolveSessionReviewState,
} from "./walleyboard-controller-selectors.js";
import { createWorkspaceModalControls } from "./workspace-modal-controls.js";
import { resolveSelectedWorkspaceTicketId } from "./workspace-modal-state.js";

export function useWalleyBoardController() {
  const queryClient = useQueryClient();
  const {
    archiveActionFeedback,
    archiveModalOpen,
    projectSelectionHydrated,
    readInboxItemState,
    selectedProjectId,
    setArchiveActionFeedback,
    setArchiveModalOpen,
    setProjectSelectionHydrated,
    setReadInboxItemState,
    setSelectedProjectId,
  } = useProjectSelectionState({
    readInboxItemState: readInboxReadState(),
  });
  const {
    projectModalOpen,
    projectOptionsDraftAgentAdapter,
    projectOptionsTicketAgentAdapter,
    projectOptionsAutomaticAgentReview,
    projectOptionsAutomaticAgentReviewRunLimit,
    projectOptionsColor,
    projectOptionsColorManuallySelected,
    projectOptionsDefaultReviewAction,
    projectOptionsDisabledMcpServers,
    projectOptionsDraftModelCustom,
    projectOptionsDraftModelPreset,
    projectOptionsDraftReasoningEffort,
    projectOptionsFormError,
    projectOptionsWorktreeTeardownCommand,
    projectOptionsWorktreeInitCommand,
    projectOptionsWorktreeInitRunSequential,
    projectOptionsPreviewStartCommand,
    projectOptionsProjectId,
    projectOptionsRepositoryTargetBranches,
    projectOptionsRepositoryValidationCommands,
    projectOptionsTicketModelCustom,
    projectOptionsTicketModelPreset,
    projectOptionsTicketReasoningEffort,
    setProjectModalOpen,
    setProjectOptionsDraftAgentAdapter,
    setProjectOptionsTicketAgentAdapter,
    setProjectOptionsAutomaticAgentReview,
    setProjectOptionsAutomaticAgentReviewRunLimit,
    setProjectOptionsColor,
    setProjectOptionsColorManuallySelected,
    setProjectOptionsDefaultReviewAction,
    setProjectOptionsDisabledMcpServers,
    setProjectOptionsDraftModelCustom,
    setProjectOptionsDraftModelPreset,
    setProjectOptionsDraftReasoningEffort,
    setProjectOptionsFormError,
    setProjectOptionsWorktreeTeardownCommand,
    setProjectOptionsWorktreeInitCommand,
    setProjectOptionsWorktreeInitRunSequential,
    setProjectOptionsPreviewStartCommand,
    setProjectOptionsProjectId,
    setProjectOptionsRepositoryTargetBranches,
    setProjectOptionsRepositoryValidationCommands,
    setProjectOptionsTicketModelCustom,
    setProjectOptionsTicketModelPreset,
    setProjectOptionsTicketReasoningEffort,
  } = useProjectOptionsState();
  const {
    defaultBranch,
    projectColor,
    projectColorManuallySelected,
    projectColorNeedsRefresh,
    projectDeleteConfirmText,
    projectName,
    repositoryPath,
    setDefaultBranch,
    setProjectColor,
    setProjectColorManuallySelected,
    setProjectColorNeedsRefresh,
    setProjectDeleteConfirmText,
    setProjectName,
    setRepositoryPath,
    setValidationCommandsText,
    validationCommandsText,
  } = useProjectCreationState({ projectColor: defaultProjectColor });
  const {
    draftEditorAcceptanceCriteria,
    draftEditorArtifactScopeId,
    draftEditorDescription,
    draftEditorProjectId,
    draftEditorSourceId,
    draftEditorTicketType,
    draftEditorTitle,
    draftEditorUploadError,
    pendingDraftEditorSync,
    pendingNewDraftAction,
    setDraftEditorAcceptanceCriteria,
    setDraftEditorArtifactScopeId,
    setDraftEditorDescription,
    setDraftEditorProjectId,
    setDraftEditorSourceId,
    setDraftEditorTicketType,
    setDraftEditorTitle,
    setDraftEditorUploadError,
    setPendingDraftEditorSync,
    setPendingNewDraftAction,
  } = useDraftEditorState();
  const { boardSearch, inspectorState, setBoardSearch, setInspectorState } =
    useDraftInspectorState();
  const {
    planFeedbackBody,
    requestedChangesBody,
    resumeReason,
    setPlanFeedbackBody,
    setRequestedChangesBody,
    setResumeReason,
    setTerminalCommand,
    terminalCommand,
  } = useSessionActionState();
  const {
    setTicketWorkspaceDiffLayout,
    setWorkspaceModal,
    setWorkspaceTerminalContext,
    setWorkspaceTicket,
    ticketWorkspaceDiffLayout,
    workspaceModal,
    workspaceTerminalContext,
    workspaceTicket,
  } = useWorkspaceState();
  const selectedDraftId =
    inspectorState.kind === "draft" ? inspectorState.draftId : null;
  const selectedSessionId =
    inspectorState.kind === "session" ? inspectorState.sessionId : null;
  const selectedTicketId =
    inspectorState.kind === "ticket" ? inspectorState.ticketId : null;
  const inspectorVisible = inspectorState.kind !== "hidden";

  const selectProject = (projectId: string | null): void => {
    setSelectedProjectId(projectId);
    setArchiveModalOpen(false);
    setArchiveActionFeedback(null);
  };

  const {
    archivedTicketsQuery,
    draftEditorRepositoriesQuery,
    draftEventsQuery,
    draftsQuery,
    globalTicketsQueries,
    healthQuery,
    projectOptionsBranchesQuery,
    projectOptionsRepositoriesQuery,
    projectsQuery,
    repositoriesQuery,
    sessionLogsQuery,
    sessionQuery,
    sessionSummaries,
    ticketsQuery,
  } = useWalleyBoardServerState({
    archiveModalOpen,
    draftEditorProjectId,
    projectModalOpen,
    projectOptionsProjectId,
    selectedDraftId,
    selectedProjectId,
    selectedSessionId,
  });
  const dockerHealth = healthQuery.data?.docker ?? null;
  const codexMcpServers = healthQuery.data?.codex_mcp_servers ?? [];
  const projectRecords = projectsQuery.data?.projects ?? [];
  const projectsLoaded = projectsQuery.data !== undefined;
  const draftRecords = draftsQuery.data?.drafts ?? [];
  const draftsLoaded = draftsQuery.data !== undefined;
  const ticketRecords = ticketsQuery.data?.tickets ?? [];
  const ticketsLoaded = ticketsQuery.data !== undefined;

  const globalTickets = globalTicketsQueries.flatMap(
    (query) => query.data?.tickets ?? [],
  );
  const { globalDrafts, globalDraftsQueries } = useGlobalDrafts(projectRecords);

  const globalSessionSummaries = useQueries({
    queries: globalTickets
      .filter(
        (
          ticket,
        ): ticket is TicketFrontmatter & {
          session_id: string;
        } => ticket.session_id !== null,
      )
      .map((ticket) => ({
        queryKey: ["sessions", ticket.session_id],
        queryFn: () =>
          fetchJson<SessionResponse>(`/sessions/${ticket.session_id}`),
        refetchInterval: 2_000,
      })),
  });

  useProjectSelectionHydration({
    projectRecords,
    projectSelectionHydrated,
    projectsLoaded,
    selectedProjectId,
    setArchiveActionFeedback,
    setArchiveModalOpen,
    setProjectSelectionHydrated,
    setSelectedProjectId,
  });

  useProjectOptionsStateSync({
    projectOptionsProjectId,
    projectOptionsRepositoriesQueryData: projectOptionsRepositoriesQuery.data,
    projectRecords,
    projectsLoaded,
    setProjectDeleteConfirmText,
    setProjectOptionsColor,
    setProjectOptionsColorManuallySelected,
    setProjectOptionsFormError,
    setProjectOptionsProjectId,
    setProjectOptionsRepositoryTargetBranches,
    setProjectOptionsRepositoryValidationCommands,
  });

  useProjectColorRefresh({
    projectColorManuallySelected,
    projectColorNeedsRefresh,
    projectModalOpen,
    projectsLoaded,
    projectRecords,
    setProjectColor,
    setProjectColorNeedsRefresh,
  });

  useInspectorStateGuard({
    draftRecords,
    draftsLoaded,
    inspectorState,
    selectedProjectId,
    setInspectorState,
    ticketRecords,
    ticketsLoaded,
  });

  useProtocolEventSync({
    queryClient,
    selectedDraftId,
    selectedProjectId,
    selectedSessionId,
    setInspectorState,
  });

  useWorkspaceModalGuard({
    hasTerminalContext: workspaceTerminalContext !== null,
    inspectorKind: inspectorState.kind,
    setWorkspaceModal,
    workspaceModal,
  });

  const tickets = ticketRecords;
  const ticketDiffLineSummaryByTicketId = useTicketDiffLineSummary(tickets);
  const { ticketAiReviewActiveById, ticketAiReviewResolvedById } =
    useTicketAiReviewStatus(globalTickets, projectRecords);
  const selectedSessionTicketId =
    tickets.find((ticket) => ticket.session_id === selectedSessionId)?.id ??
    null;
  const selectedSessionTicketStatus =
    tickets.find((ticket) => ticket.session_id === selectedSessionId)?.status ??
    null;
  const selectedWorkspaceTicketId = resolveSelectedWorkspaceTicketId({
    selectedSessionTicketId,
    workspaceModal,
    workspaceTicketId: workspaceTicket?.id ?? null,
  });
  const {
    agentReviewHistoryModalOpen,
    closeAgentReviewHistoryModal,
    openAgentReviewHistoryModal,
  } = useAgentReviewHistoryModalState({
    inspectorKind: inspectorState.kind,
    selectedSessionTicketStatus,
  });

  const {
    reviewPackageQuery,
    latestReviewRunQuery,
    reviewRunsQuery,
    sessionAttemptsQuery,
    ticketWorkspaceDiffQuery,
    ticketEventsQuery,
  } = useTicketReviewQueries({
    selectedSessionId,
    selectedSessionTicketId,
    selectedSessionTicketStatus,
    selectedWorkspaceTicketId,
    workspaceModal,
  });

  const globalSessionById = new Map(
    globalSessionSummaries
      .map((query) => query.data)
      .filter((value): value is SessionResponse => value !== undefined)
      .map((item) => [item.session.id, item]),
  );
  const {
    actionItemKeys,
    actionItems,
    unreadActionItemCount,
    unreadInboxItemKeys,
  } = resolveInboxViewState({
    drafts: globalDrafts,
    projects: projectRecords,
    readInboxItemState,
    sessionsById: globalSessionById,
    ticketAiReviewActiveById,
    ticketAiReviewResolvedById,
    tickets: globalTickets,
  });
  const inboxQueriesSettled =
    projectsLoaded &&
    globalDraftsQueries.every((query) => !query.isPending) &&
    globalTicketsQueries.every((query) => !query.isPending) &&
    globalSessionSummaries.every((query) => !query.isPending);
  const { silenceNextInboxItemKey } = useInboxAlert({
    actionItemKeys,
    visibleActionItemKeys: actionItems.map((item) => item.notificationKey),
    inboxQueriesSettled,
  });
  const mutations = useWalleyBoardMutationWiring({
    queryClient,
    pendingDraftEditorSync,
    selectedDraftId,
    selectedProjectId,
    selectedSessionId,
    selectProject,
    setArchiveActionFeedback,
    setDefaultBranch,
    setInspectorState,
    setPendingDraftEditorSync,
    setPlanFeedbackBody,
    setProjectColor,
    setProjectDeleteConfirmText,
    setProjectModalOpen,
    setProjectName,
    setProjectOptionsFormError,
    setProjectOptionsProjectId,
    setProjectOptionsRepositoryTargetBranches,
    setRepositoryPath,
    setRequestedChangesBody,
    setResumeReason,
    silenceNextInboxItemKey,
    setTerminalCommand,
    setValidationCommandsText,
    tickets,
  });
  const {
    handleTicketPreviewAction,
    previewActionErrorByTicketId,
    ticketWorkspacePreviewByTicketId,
  } = useTicketWorkspacePreview({
    startPreviewMutation: mutations.startTicketWorkspacePreviewMutation,
    stopPreviewMutation: mutations.stopTicketWorkspacePreviewMutation,
    tickets,
  });

  const selectedProject =
    projectRecords.find((project) => project.id === selectedProjectId) ?? null;
  const repositories = repositoriesQuery.data?.repositories ?? [];
  const selectedRepository = repositories[0] ?? null;
  const {
    handleSelectedRepositoryPreviewAction,
    openSelectedRepositoryWorkspaceTerminal,
    repositoryPreviewActionError,
    repositoryPreviewActionPending,
    repositoryTerminalPending,
    repositoryWorkspacePreview,
    repositoryWorkspacePreviewQuery,
  } = useSelectedRepositoryWorkspace({
    repositories,
    selectedProjectId,
    selectedRepository,
    setWorkspaceModal,
    setWorkspaceTerminalContext,
    setWorkspaceTicket,
  });
  const { doneColumnTickets, groupedTickets, visibleDrafts, visibleTickets } =
    resolveBoardViewState({
      boardSearch,
      drafts: draftRecords,
      tickets,
    });
  const {
    canDeleteProject,
    projectOptionsBranchesByRepositoryId,
    projectOptionsBranchChoices,
    projectOptionsColor: projectOptionsSwatchColor,
    projectOptionsDirty,
    projectOptionsDraftModelValue,
    projectOptionsDraftReasoningEffortValue,
    projectOptionsPersistedColor,
    projectOptionsPreviewStartCommandValue,
    projectOptionsProject,
    projectOptionsRepositories,
    projectOptionsRepositoryBranchesDirty,
    projectOptionsTicketModelValue,
    projectOptionsTicketReasoningEffortValue,
    projectOptionsWorktreeInitCommandValue,
    projectOptionsWorktreeTeardownCommandValue,
  } = resolveProjectOptionsViewState({
    projectDeleteConfirmText,
    projectOptionsAutomaticAgentReview,
    projectOptionsAutomaticAgentReviewRunLimit,
    projectOptionsBranchChoices:
      projectOptionsBranchesQuery.data?.repository_branches ?? [],
    projectOptionsColor,
    projectOptionsColorManuallySelected,
    projectOptionsDefaultReviewAction,
    projectOptionsDisabledMcpServers,
    projectOptionsDraftAgentAdapter,
    projectOptionsDraftModelCustom,
    projectOptionsDraftModelPreset,
    projectOptionsDraftReasoningEffort,
    projectOptionsProjectId,
    projectOptionsRepositories:
      projectOptionsRepositoriesQuery.data?.repositories ?? [],
    projectOptionsRepositoryTargetBranches,
    projectOptionsRepositoryValidationCommands,
    projectOptionsTicketAgentAdapter,
    projectOptionsTicketModelCustom,
    projectOptionsTicketModelPreset,
    projectOptionsTicketReasoningEffort,
    projectOptionsWorktreeInitCommand,
    projectOptionsWorktreeInitRunSequential,
    projectOptionsPreviewStartCommand,
    projectOptionsWorktreeTeardownCommand,
    projectRecords,
  });
  const {
    draftAnalysisActive,
    draftEditorAcceptanceCriteriaLines,
    draftEditorCanPersist,
    draftEditorProject,
    draftEditorRepositories,
    draftEditorRepository,
    draftEvents,
    draftFormDirty,
    latestDraftEventMeta,
    latestQuestionsResult,
    latestRevertableRefineEvent,
    newDraftFormDirty,
    selectedDraft,
    selectedDraftRepository,
  } = resolveDraftEditorViewState({
    draftEditorAcceptanceCriteria,
    draftEditorDescription,
    draftEditorProjectId,
    draftEditorRepositoriesQueryData: draftEditorRepositoriesQuery.data,
    draftEditorTicketType,
    draftEditorTitle,
    draftEventsQueryData: draftEventsQuery.data,
    draftRecords,
    inspectorKind: inspectorState.kind,
    projectRecords,
    repositories,
    selectedDraftId,
    selectedProjectId,
  });
  useDraftEditorSourceSync({
    draftEditorAcceptanceCriteria,
    draftEditorDescription,
    draftEditorSourceId,
    draftEditorTicketType,
    draftEditorTitle,
    draftFormDirty,
    inspectorKind: inspectorState.kind,
    pendingDraftEditorSync,
    selectedDraft,
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
  const {
    initializeNewDraftEditor,
    persistNewDraftFromEditor,
    uploadDraftEditorImage,
  } = createDraftEditorController({
    createDraftMutation: mutations.createDraftMutation,
    draftEditorAcceptanceCriteria,
    draftEditorArtifactScopeId,
    draftEditorDescription,
    draftEditorProjectId,
    draftEditorTicketType,
    draftEditorTitle,
    queryClient,
    setDraftEditorAcceptanceCriteria,
    setDraftEditorArtifactScopeId,
    setDraftEditorDescription,
    setDraftEditorProjectId,
    setDraftEditorSourceId,
    setDraftEditorTicketType,
    setDraftEditorTitle,
    setDraftEditorUploadError,
    setPendingDraftEditorSync,
    setPendingNewDraftAction,
    uploadDraftArtifactMutation: mutations.uploadDraftArtifactMutation,
  });
  const {
    session,
    sessionAttempts,
    sessionById,
    sessionLogs,
    sessionSummaryStateById,
    ticketEvents,
    ticketWorkspaceDiff,
    reviewPackage,
    latestReviewRun,
    reviewRuns,
    selectedSessionTicket,
    selectedInspectorTicket,
    selectedSessionTicketSession,
    agentControlsWorktreeBySessionId,
  } = resolveSessionReviewState({
    latestReviewRun: latestReviewRunQuery.data?.review_run ?? null,
    reviewPackage: reviewPackageQuery.data?.review_package ?? null,
    reviewRuns: reviewRunsQuery.data?.review_runs ?? [],
    selectedSessionId,
    selectedTicketId,
    sessionAttempts: sessionAttemptsQuery.data?.attempts ?? [],
    sessionLogs: sessionLogsQuery.data?.logs ?? [],
    sessionQueryData: sessionQuery.data,
    sessionSummaries,
    ticketEvents: ticketEventsQuery.data?.events ?? [],
    ticketWorkspaceDiff: ticketWorkspaceDiffQuery.data?.workspace_diff ?? null,
    tickets,
  });
  const { isDraftRefinementActive } = useDraftRefinementActivity(draftRecords);

  const boardLoading =
    (selectedProjectId !== null && draftsQuery.isPending) ||
    (selectedProjectId !== null && ticketsQuery.isPending);
  const boardError = draftsQuery.isError
    ? draftsQuery.error.message
    : ticketsQuery.isError
      ? ticketsQuery.error.message
      : null;

  const closeProjectOptionsModal = (): void => {
    resetProjectOptionsModal({
      resetDeleteProjectMutation: mutations.deleteProjectMutation.reset,
      resetUpdateProjectMutation: mutations.updateProjectMutation.reset,
      setProjectDeleteConfirmText,
      setProjectOptionsDraftAgentAdapter,
      setProjectOptionsTicketAgentAdapter,
      setProjectOptionsAutomaticAgentReview,
      setProjectOptionsAutomaticAgentReviewRunLimit,
      setProjectOptionsColor,
      setProjectOptionsColorManuallySelected,
      setProjectOptionsDefaultReviewAction,
      setProjectOptionsDisabledMcpServers,
      setProjectOptionsFormError,
      setProjectOptionsPreviewStartCommand,
      setProjectOptionsProjectId,
      setProjectOptionsRepositoryTargetBranches,
      setProjectOptionsRepositoryValidationCommands,
    });
  };

  const openProjectModal = (): void => {
    openProjectCreationModal({
      projectRecords,
      projectsFetching: projectsQuery.isFetching,
      projectsLoaded,
      resetCreateProjectMutation: mutations.createProjectMutation.reset,
      setProjectColor,
      setProjectColorManuallySelected,
      setProjectColorNeedsRefresh,
      setProjectModalOpen,
    });
  };

  const closeProjectModal = (): void => {
    closeProjectCreationModal({
      resetCreateProjectMutation: mutations.createProjectMutation.reset,
      setProjectColorManuallySelected,
      setProjectColorNeedsRefresh,
      setProjectModalOpen,
    });
  };

  const openProjectOptions = (project: Project): void => {
    const cachedRepositories =
      queryClient.getQueryData<RepositoriesResponse>([
        "projects",
        project.id,
        "repositories",
      ])?.repositories ?? [];

    populateProjectOptionsModal({
      cachedRepositories,
      project,
      resetDeleteProjectMutation: mutations.deleteProjectMutation.reset,
      resetUpdateProjectMutation: mutations.updateProjectMutation.reset,
      setProjectDeleteConfirmText,
      setProjectOptionsDraftAgentAdapter,
      setProjectOptionsTicketAgentAdapter,
      setProjectOptionsAutomaticAgentReview,
      setProjectOptionsAutomaticAgentReviewRunLimit,
      setProjectOptionsColor,
      setProjectOptionsColorManuallySelected,
      setProjectOptionsDefaultReviewAction,
      setProjectOptionsDisabledMcpServers,
      setProjectOptionsDraftModelCustom,
      setProjectOptionsDraftModelPreset,
      setProjectOptionsDraftReasoningEffort,
      setProjectOptionsFormError,
      setProjectOptionsWorktreeTeardownCommand,
      setProjectOptionsWorktreeInitCommand,
      setProjectOptionsWorktreeInitRunSequential,
      setProjectOptionsPreviewStartCommand,
      setProjectOptionsProjectId,
      setProjectOptionsRepositoryTargetBranches,
      setProjectOptionsRepositoryValidationCommands,
      setProjectOptionsTicketModelCustom,
      setProjectOptionsTicketModelPreset,
      setProjectOptionsTicketReasoningEffort,
    });
  };

  const refreshProjectOptionsBranches = (): void => {
    setProjectOptionsFormError(null);
    void Promise.all([
      projectOptionsRepositoriesQuery.refetch(),
      projectOptionsBranchesQuery.refetch(),
    ]);
  };

  const saveProjectOptions = (): void => {
    if (!projectOptionsProject) {
      return;
    }

    if (
      projectOptionsDraftModelPreset === "custom" &&
      projectOptionsDraftModelValue === null
    ) {
      setProjectOptionsFormError(
        "Enter a model ID for the custom draft analysis model.",
      );
      return;
    }

    if (
      projectOptionsTicketModelPreset === "custom" &&
      projectOptionsTicketModelValue === null
    ) {
      setProjectOptionsFormError(
        "Enter a model ID for the custom ticket work model.",
      );
      return;
    }

    const allValidationCommands = Object.values(
      projectOptionsRepositoryValidationCommands,
    ).flat();
    const hasEmptyValidationCommand = allValidationCommands.some(
      (cmd) => cmd.label.trim().length === 0 || cmd.command.trim().length === 0,
    );
    if (hasEmptyValidationCommand) {
      setProjectOptionsFormError(
        "Every validation command must have a label and a command.",
      );
      return;
    }

    const repositoryTargetBranches = collectRepositoryTargetBranchUpdates({
      project: projectOptionsProject,
      repositories: projectOptionsRepositories,
      repositoryTargetBranches: projectOptionsRepositoryTargetBranches,
    });
    const repositoryValidationCommands =
      collectRepositoryValidationCommandUpdates({
        repositories: projectOptionsRepositories,
        repositoryValidationCommands:
          projectOptionsRepositoryValidationCommands,
      });
    setProjectOptionsFormError(null);
    mutations.updateProjectMutation.mutate({
      draftAgentAdapter: projectOptionsDraftAgentAdapter,
      ticketAgentAdapter: projectOptionsTicketAgentAdapter,
      projectId: projectOptionsProject.id,
      color: projectOptionsPersistedColor,
      disabledMcpServers: [...projectOptionsDisabledMcpServers].sort(
        (left, right) => left.localeCompare(right),
      ),
      automaticAgentReview: projectOptionsAutomaticAgentReview,
      automaticAgentReviewRunLimit: projectOptionsAutomaticAgentReviewRunLimit,
      defaultReviewAction: projectOptionsDefaultReviewAction,
      previewStartCommand: projectOptionsPreviewStartCommandValue,
      worktreeInitCommand: projectOptionsWorktreeInitCommandValue,
      worktreeTeardownCommand: projectOptionsWorktreeTeardownCommandValue,
      worktreeInitRunSequential: projectOptionsWorktreeInitRunSequential,
      draftAnalysisModel: projectOptionsDraftModelValue,
      draftAnalysisReasoningEffort: projectOptionsDraftReasoningEffortValue,
      ticketWorkModel: projectOptionsTicketModelValue,
      ticketWorkReasoningEffort: projectOptionsTicketReasoningEffortValue,
      repositoryTargetBranches,
      repositoryValidationCommands,
    });
  };

  const markAllInboxItemsAsRead = (): void => {
    setReadInboxItemState((currentState) => {
      const result = computeMarkAllReadState(currentState, actionItems);
      if (result === null) {
        return currentState;
      }
      writeInboxReadState(result);
      return result;
    });
  };

  const openInboxItem = (item: (typeof actionItems)[number]): void => {
    setReadInboxItemState((currentState) => {
      if (currentState[item.key] === item.notificationKey) {
        return currentState;
      }

      const nextState = {
        ...currentState,
        [item.key]: item.notificationKey,
      };
      writeInboxReadState(nextState);
      return nextState;
    });
    selectProject(item.projectId);
    setInspectorState(
      item.targetKind === "draft"
        ? {
            kind: "draft",
            draftId: item.targetId,
          }
        : {
            kind: "session",
            sessionId: item.targetId,
          },
    );
  };

  const ticketActions = createTicketActions({
    isDraftRefinementActive,
    mutations,
    selectedProjectId,
    visibleDrafts,
  });

  const setArchiveModalVisibility = (open: boolean): void => {
    setArchiveActionFeedback(null);
    setArchiveModalOpen(open);
    if (!open) {
      mutations.restoreTicketMutation.reset();
    }
  };

  const openArchiveModal = (): void => {
    setArchiveModalVisibility(true);
  };

  const closeArchiveModal = (): void => {
    setArchiveModalVisibility(false);
  };

  const [discardDraftConfirmOpen, setDiscardDraftConfirmOpen] = useState(false);

  const {
    closeWorkspaceModal,
    hideInspector: forceHideInspector,
    openDraft,
    openNewDraft,
    openTicket,
    openTicketSession,
    openTicketWorkspaceModal,
  } = createWorkspaceModalControls({
    initializeNewDraftEditor,
    selectedProjectId,
    session,
    sessionById,
    setInspectorState,
    setWorkspaceModal,
    setWorkspaceTerminalContext,
    setWorkspaceTicket,
  });

  const hideInspector = (): void => {
    if (
      (inspectorState.kind === "draft" && draftFormDirty) ||
      newDraftFormDirty
    ) {
      setDiscardDraftConfirmOpen(true);
      return;
    }
    forceHideInspector();
  };

  const confirmDiscardDraft = (): void => {
    setDiscardDraftConfirmOpen(false);
    forceHideInspector();
  };

  const cancelDiscardDraft = (): void => {
    setDiscardDraftConfirmOpen(false);
  };

  const openArchivedTicketDiff = (ticket: TicketFrontmatter): void => {
    setArchiveActionFeedback(null);
    setArchiveModalOpen(false);
    setWorkspaceTicket(ticket);
    setWorkspaceModal("diff");
  };

  const {
    handleConfirmNewDraft,
    handleQuestionNewDraft,
    handleRefineNewDraft,
    handleSaveNewDraft,
  } = createNewDraftActionHandlers({
    draftEditorAcceptanceCriteriaLines,
    draftEditorDescription,
    draftEditorProject,
    draftEditorRepository,
    draftEditorTicketType,
    draftEditorTitle,
    onConfirmDraft: async (input) => {
      await mutations.confirmDraftMutation.mutateAsync(input);
    },
    onQuestionDraft: async (draftId) => {
      await mutations.questionDraftMutation.mutateAsync(draftId);
    },
    onRefineDraft: async (draftId) => {
      await mutations.refineDraftMutation.mutateAsync(draftId);
    },
    persistNewDraftFromEditor,
    setPendingNewDraftAction,
  });

  return {
    ...mutations,
    actionItems,
    markAllInboxItemsAsRead,
    unreadActionItemCount,
    unreadInboxItemKeys,
    agentReviewHistoryModalOpen,
    archiveActionFeedback,
    archiveModalOpen,
    ...ticketActions,
    agentControlsWorktreeBySessionId,
    archivedTicketsQuery,
    boardError,
    boardLoading,
    boardSearch,
    cancelDiscardDraft,
    canDeleteProject,
    closeArchiveModal,
    closeAgentReviewHistoryModal,
    closeProjectOptionsModal,
    confirmDiscardDraft,
    defaultBranch,
    discardDraftConfirmOpen,
    codexMcpServers,
    dockerHealth,
    doneColumnTickets,
    draftAnalysisActive,
    draftEditorAcceptanceCriteria,
    draftEditorAcceptanceCriteriaLines,
    draftEditorArtifactScopeId,
    draftEditorCanPersist,
    draftEditorDescription,
    draftEditorProject,
    draftEditorProjectId,
    draftEditorRepositories,
    draftEditorRepository,
    draftEditorSourceId,
    draftEditorTicketType,
    draftEditorTitle,
    draftEditorUploadError,
    draftEvents,
    draftEventsQuery,
    draftFormDirty,
    draftsQuery,
    drafts: draftRecords,
    globalTickets,
    groupedTickets,
    handleConfirmNewDraft,
    handleQuestionNewDraft,
    handleRefineNewDraft,
    handleSaveNewDraft,
    handleSelectedRepositoryPreviewAction,
    healthQuery,
    hideInspector,
    initializeNewDraftEditor,
    inspectorState,
    inspectorVisible,
    isDraftRefinementActive,
    latestDraftEventMeta,
    latestQuestionsResult,
    latestRevertableRefineEvent,
    openArchiveModal,
    openAgentReviewHistoryModal,
    openArchivedTicketDiff,
    openInboxItem,
    openSelectedRepositoryWorkspaceTerminal,
    openTicketWorkspaceModal,
    openDraft,
    openNewDraft,
    openProjectModal,
    openProjectOptions,
    openTicket,
    openTicketSession,
    pendingDraftEditorSync,
    pendingNewDraftAction,
    planFeedbackBody,
    previewActionErrorByTicketId,
    projectColor,
    projectDeleteConfirmText,
    projectModalOpen,
    projectName,
    projectOptionsBranchChoices,
    projectOptionsBranchesByRepositoryId,
    projectOptionsBranchesQuery,
    projectOptionsAutomaticAgentReview,
    projectOptionsAutomaticAgentReviewRunLimit,
    projectOptionsColor: projectOptionsSwatchColor,
    projectOptionsDefaultReviewAction,
    projectOptionsDisabledMcpServers,
    projectOptionsDirty,
    projectOptionsDraftAgentAdapter,
    projectOptionsTicketAgentAdapter,
    projectOptionsDraftModelCustom,
    projectOptionsDraftModelPreset,
    projectOptionsDraftModelValue,
    projectOptionsDraftReasoningEffort,
    projectOptionsDraftReasoningEffortValue,
    projectOptionsFormError,
    projectOptionsWorktreeTeardownCommand,
    projectOptionsWorktreeTeardownCommandValue,
    projectOptionsWorktreeInitCommand,
    projectOptionsWorktreeInitCommandValue,
    projectOptionsWorktreeInitRunSequential,
    projectOptionsPersistedColor,
    projectOptionsPreviewStartCommand,
    projectOptionsPreviewStartCommandValue,
    projectOptionsProject,
    projectOptionsProjectId,
    projectOptionsRepositories,
    projectOptionsRepositoriesQuery,
    projectOptionsRepositoryBranchesDirty,
    projectOptionsRepositoryTargetBranches,
    projectOptionsRepositoryValidationCommands,
    projectOptionsTicketModelCustom,
    projectOptionsTicketModelPreset,
    projectOptionsTicketModelValue,
    projectOptionsTicketReasoningEffort,
    projectOptionsTicketReasoningEffortValue,
    projectsQuery,
    refreshProjectOptionsBranches,
    repositories,
    repositoriesQuery,
    repositoryPreviewActionError,
    repositoryPreviewActionPending,
    repositoryPath,
    repositoryTerminalPending,
    repositoryWorkspacePreview,
    repositoryWorkspacePreviewQuery,
    requestedChangesBody,
    resumeReason,
    latestReviewRun,
    latestReviewRunQuery,
    navigateToTicketReference: (ticketId: number) =>
      navigateToTicketReference({
        globalTickets,
        selectProject,
        selectedProjectId,
        setBoardSearch,
        setInspectorState,
        ticketId,
        tickets,
      }),
    reviewPackage,
    reviewPackageQuery,
    reviewRuns,
    reviewRunsQuery,
    saveProjectOptions,
    selectProject,
    selectedDraft,
    selectedDraftId,
    selectedDraftRepository,
    selectedProject,
    selectedProjectId,
    selectedRepository,
    selectedInspectorTicket,
    selectedSessionId,
    selectedSessionTicket,
    selectedSessionTicketId,
    selectedTicketId,
    selectedSessionTicketSession,
    session,
    sessionAttempts,
    sessionAttemptsQuery,
    sessionById,
    sessionSummaryStateById,
    ticketEvents,
    ticketEventsQuery,
    sessionLogs,
    sessionLogsQuery,
    sessionQuery,
    closeProjectModal,
    closeWorkspaceModal,
    workspaceModal,
    workspaceTerminalContext,
    setArchiveModalOpen,
    setBoardSearch,
    setDefaultBranch,
    setDraftEditorAcceptanceCriteria,
    setDraftEditorDescription,
    setDraftEditorSourceId,
    setDraftEditorTicketType,
    setDraftEditorTitle,
    setInspectorState,
    setPendingDraftEditorSync,
    setPlanFeedbackBody,
    setProjectColor: (value: SetStateAction<string>) => {
      setProjectColorManuallySelected(true);
      setProjectColorNeedsRefresh(false);
      setProjectColor(value);
    },
    setProjectDeleteConfirmText,
    setProjectModalOpen,
    setProjectName,
    setProjectOptionsColor: (value: SetStateAction<string>) => {
      setProjectOptionsColorManuallySelected(true);
      setProjectOptionsColor(value);
    },
    setProjectOptionsDraftAgentAdapter,
    setProjectOptionsTicketAgentAdapter,
    setProjectOptionsAutomaticAgentReview,
    setProjectOptionsAutomaticAgentReviewRunLimit,
    setProjectOptionsDefaultReviewAction,
    setProjectOptionsDisabledMcpServers,
    setProjectOptionsDraftModelCustom,
    setProjectOptionsDraftModelPreset,
    setProjectOptionsDraftReasoningEffort,
    setProjectOptionsFormError,
    setProjectOptionsWorktreeTeardownCommand,
    setProjectOptionsWorktreeInitCommand,
    setProjectOptionsWorktreeInitRunSequential,
    setProjectOptionsPreviewStartCommand,
    setProjectOptionsRepositoryTargetBranches,
    setProjectOptionsRepositoryValidationCommands,
    setProjectOptionsTicketModelCustom,
    setProjectOptionsTicketModelPreset,
    setProjectOptionsTicketReasoningEffort,
    setRepositoryPath,
    setRequestedChangesBody,
    setResumeReason,
    setTerminalCommand,
    setTicketWorkspaceDiffLayout,
    setValidationCommandsText,
    sessionSummaries,
    terminalCommand,
    handleTicketPreviewAction,
    uploadDraftEditorImage,
    ticketAiReviewActiveById,
    ticketDiffLineSummaryByTicketId,
    ticketWorkspaceDiff,
    ticketWorkspaceDiffLayout,
    ticketWorkspaceDiffQuery,
    ticketWorkspacePreviewByTicketId,
    tickets,
    ticketsQuery,
    validationCommandsText,
    visibleDrafts,
    visibleTickets,
  };
}
export type WalleyBoardController = ReturnType<typeof useWalleyBoardController>;
