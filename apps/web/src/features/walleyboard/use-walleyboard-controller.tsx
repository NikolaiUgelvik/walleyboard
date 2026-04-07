import { useQueries, useQueryClient } from "@tanstack/react-query";
import { type SetStateAction, useEffect } from "react";
import type {
  ExecutionSession,
  Project,
  RepositoryBranchChoices,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import { sanitizeDraftAcceptanceCriteria } from "../../lib/draft-acceptance-criteria.js";
import { resolveDraftEditorSync } from "../../lib/draft-editor-sync.js";
import { deriveInboxState } from "../../lib/inbox-items.js";
import { useAgentReviewHistoryModalState } from "./agent-review-history-modal-state.js";
import {
  resolveNextInspectorState,
  shouldResetProjectOptionsSelection,
} from "./controller-guards.js";
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
import { hasProjectOptionsDirty } from "./project-options-dirty.js";
import { buildSessionSummaryStateById } from "./session-summary-state.js";
import {
  fetchJson,
  readInboxReadState,
  readLastOpenProjectId,
  writeInboxReadState,
  writeLastOpenProjectId,
} from "./shared-api.js";
import type { RepositoriesResponse, SessionResponse } from "./shared-types.js";
import {
  arraysEqual,
  collectRepositoryTargetBranchUpdates,
  defaultProjectColor,
  findLatestRevertableRefineEvent,
  hasRepositoryTargetBranchChanges,
  mergeRepositoryTargetBranches,
  parseDraftEventMeta,
  parseDraftQuestionsResult,
  pickProjectColor,
  repositoryTargetBranchesEqual,
  resolveOptionalProjectCommandValue,
  resolveProjectModelValue,
  resolveProjectOptionsColors,
  resolveProjectReasoningEffortValue,
  resolveVisibleBoardItems,
  shouldRefreshProjectColorSelection,
} from "./shared-utils.js";
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
import { createWorkspaceModalControls } from "./workspace-modal-controls.js";
import {
  resolveSelectedWorkspaceTicketId,
  shouldKeepWorkspaceModalOpen,
} from "./workspace-modal-state.js";

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

  useEffect(() => {
    if (!projectsLoaded) {
      return;
    }

    const firstProjectId = projectRecords[0]?.id ?? null;
    if (selectedProjectId === null) {
      const storedProjectId = readLastOpenProjectId();
      const initialProjectId =
        storedProjectId !== null &&
        projectRecords.some((project) => project.id === storedProjectId)
          ? storedProjectId
          : firstProjectId;

      if (initialProjectId !== null) {
        setSelectedProjectId(initialProjectId);
        setArchiveModalOpen(false);
        setArchiveActionFeedback(null);
      }

      setProjectSelectionHydrated(true);
      return;
    }

    const stillExists = projectRecords.some(
      (project) => project.id === selectedProjectId,
    );
    if (!stillExists) {
      setSelectedProjectId(firstProjectId);
      setArchiveModalOpen(false);
      setArchiveActionFeedback(null);
    }

    setProjectSelectionHydrated(true);
  }, [
    projectRecords,
    projectsLoaded,
    selectedProjectId,
    setArchiveActionFeedback,
    setArchiveModalOpen,
    setProjectSelectionHydrated,
    setSelectedProjectId,
  ]);

  useEffect(() => {
    if (!projectSelectionHydrated) {
      return;
    }

    writeLastOpenProjectId(selectedProjectId);
  }, [projectSelectionHydrated, selectedProjectId]);

  useEffect(() => {
    if (
      !shouldResetProjectOptionsSelection({
        projectOptionsProjectId,
        projects: projectRecords,
        projectsLoaded,
      })
    ) {
      return;
    }

    setProjectOptionsProjectId(null);
    setProjectOptionsColor(defaultProjectColor);
    setProjectOptionsColorManuallySelected(false);
    setProjectOptionsRepositoryTargetBranches({});
    setProjectOptionsFormError(null);
    setProjectDeleteConfirmText("");
  }, [
    projectRecords,
    projectOptionsProjectId,
    projectsLoaded,
    setProjectDeleteConfirmText,
    setProjectOptionsColor,
    setProjectOptionsColorManuallySelected,
    setProjectOptionsProjectId,
    setProjectOptionsFormError,
    setProjectOptionsRepositoryTargetBranches,
  ]);

  useEffect(() => {
    if (
      !shouldRefreshProjectColorSelection({
        projectColorManuallySelected,
        projectColorNeedsRefresh,
        projectModalOpen,
        projectsLoaded,
      })
    ) {
      return;
    }

    setProjectColor(pickProjectColor(projectRecords));
    setProjectColorNeedsRefresh(false);
  }, [
    projectColorManuallySelected,
    projectColorNeedsRefresh,
    projectModalOpen,
    projectRecords,
    projectsLoaded,
    setProjectColor,
    setProjectColorNeedsRefresh,
  ]);

  useEffect(() => {
    if (projectOptionsRepositoriesQuery.data === undefined) {
      return;
    }

    const defaultTargetBranch =
      projectRecords.find((project) => project.id === projectOptionsProjectId)
        ?.default_target_branch ?? null;

    setProjectOptionsRepositoryTargetBranches((current) => {
      const next = mergeRepositoryTargetBranches(
        current,
        projectOptionsRepositoriesQuery.data.repositories,
        defaultTargetBranch,
      );
      return repositoryTargetBranchesEqual(current, next) ? current : next;
    });
  }, [
    projectRecords,
    projectOptionsProjectId,
    projectOptionsRepositoriesQuery.data,
    setProjectOptionsRepositoryTargetBranches,
  ]);

  useEffect(() => {
    const nextInspectorState = resolveNextInspectorState({
      drafts: draftRecords,
      draftsLoaded,
      inspectorState,
      selectedProjectId,
      tickets: ticketRecords,
      ticketsLoaded,
    });
    if (nextInspectorState !== null) {
      setInspectorState(nextInspectorState);
    }
  }, [
    draftRecords,
    draftsLoaded,
    inspectorState,
    selectedProjectId,
    ticketRecords,
    ticketsLoaded,
    setInspectorState,
  ]);

  useProtocolEventSync({
    queryClient,
    selectedDraftId,
    selectedProjectId,
    selectedSessionId,
    setInspectorState,
  });

  useEffect(() => {
    if (
      !shouldKeepWorkspaceModalOpen(
        inspectorState.kind,
        workspaceModal,
        workspaceTerminalContext !== null,
      )
    ) {
      setWorkspaceModal(null);
    }
  }, [
    inspectorState.kind,
    workspaceModal,
    workspaceTerminalContext,
    setWorkspaceModal,
  ]);

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
  const projectOptionsProject =
    projectRecords.find((project) => project.id === projectOptionsProjectId) ??
    null;
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
  const { items: actionItems, notificationKeys: actionItemKeys } =
    deriveInboxState({
      drafts: globalDrafts,
      projects: projectRecords,
      tickets: globalTickets,
      sessionsById: globalSessionById,
      ticketAiReviewActiveById,
      ticketAiReviewResolvedById,
    });
  const unreadActionItemCount = actionItems.filter(
    (item) => readInboxItemState[item.key] !== item.notificationKey,
  ).length;
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
  const draftEditorProject =
    projectRecords.find((project) => project.id === draftEditorProjectId) ??
    null;
  const projectOptionsRepositories =
    projectOptionsRepositoriesQuery.data?.repositories ?? [];
  const projectOptionsBranchChoices =
    projectOptionsBranchesQuery.data?.repository_branches ?? [];
  const projectOptionsBranchesByRepositoryId = new Map<
    string,
    RepositoryBranchChoices
  >(
    projectOptionsBranchChoices.map((repositoryBranches) => [
      repositoryBranches.repository_id,
      repositoryBranches,
    ]),
  );
  const projectOptionsDraftModelValue = resolveProjectModelValue(
    projectOptionsDraftModelPreset,
    projectOptionsDraftModelCustom,
  );
  const projectOptionsDraftReasoningEffortValue =
    resolveProjectReasoningEffortValue(projectOptionsDraftReasoningEffort);
  const projectOptionsTicketModelValue = resolveProjectModelValue(
    projectOptionsTicketModelPreset,
    projectOptionsTicketModelCustom,
  );
  const projectOptionsTicketReasoningEffortValue =
    resolveProjectReasoningEffortValue(projectOptionsTicketReasoningEffort);
  const projectOptionsWorktreeInitCommandValue =
    resolveOptionalProjectCommandValue(projectOptionsWorktreeInitCommand);
  const projectOptionsPreviewStartCommandValue =
    resolveOptionalProjectCommandValue(projectOptionsPreviewStartCommand);
  const projectOptionsWorktreeTeardownCommandValue =
    resolveOptionalProjectCommandValue(projectOptionsWorktreeTeardownCommand);
  const projectOptionsRepositoryBranchesDirty =
    hasRepositoryTargetBranchChanges({
      project: projectOptionsProject,
      repositories: projectOptionsRepositories,
      repositoryTargetBranches: projectOptionsRepositoryTargetBranches,
    });
  const { persistedColor: projectOptionsPersistedColor, swatchColor } =
    resolveProjectOptionsColors({
      color: projectOptionsColor,
      colorManuallySelected: projectOptionsColorManuallySelected,
      project: projectOptionsProject,
    });
  const projectOptionsDirty = hasProjectOptionsDirty({
    color: projectOptionsPersistedColor,
    draftModelValue: projectOptionsDraftModelValue,
    draftReasoningEffortValue: projectOptionsDraftReasoningEffortValue,
    disabledMcpServers: projectOptionsDisabledMcpServers,
    worktreeTeardownCommandValue: projectOptionsWorktreeTeardownCommandValue,
    worktreeInitCommandValue: projectOptionsWorktreeInitCommandValue,
    worktreeInitRunSequential: projectOptionsWorktreeInitRunSequential,
    previewStartCommandValue: projectOptionsPreviewStartCommandValue,
    project: projectOptionsProject,
    projectOptionsAutomaticAgentReview,
    projectOptionsAutomaticAgentReviewRunLimit,
    projectOptionsDefaultReviewAction,
    repositoryBranchesDirty: projectOptionsRepositoryBranchesDirty,
    selectedDraftAgentAdapter: projectOptionsDraftAgentAdapter,
    selectedTicketAgentAdapter: projectOptionsTicketAgentAdapter,
    ticketModelValue: projectOptionsTicketModelValue,
    ticketReasoningEffortValue: projectOptionsTicketReasoningEffortValue,
  });
  const canDeleteProject =
    projectOptionsProject !== null &&
    projectDeleteConfirmText.trim() === projectOptionsProject.slug;
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
  const draftEditorRepositories =
    draftEditorProjectId !== null && draftEditorProjectId === selectedProjectId
      ? repositories
      : (draftEditorRepositoriesQuery.data?.repositories ?? []);
  const draftEditorRepository = draftEditorRepositories[0] ?? null;
  const drafts = draftRecords;
  const { isDraftRefinementActive } = useDraftRefinementActivity(drafts);
  const selectedDraft =
    drafts.find((draft) => draft.id === selectedDraftId) ?? null;
  const selectedDraftRepository =
    selectedDraft === null
      ? null
      : (repositories.find(
          (item) =>
            item.id ===
            (selectedDraft.confirmed_repo_id ?? selectedDraft.proposed_repo_id),
        ) ?? selectedRepository);
  const draftEditorAcceptanceCriteriaLines = sanitizeDraftAcceptanceCriteria(
    draftEditorAcceptanceCriteria,
  );
  const draftEditorCanPersist =
    draftEditorTitle.trim().length > 0 &&
    draftEditorDescription.trim().length > 0;
  const draftFormDirty =
    selectedDraft !== null &&
    (draftEditorTitle !== selectedDraft.title_draft ||
      draftEditorDescription !== selectedDraft.description_draft ||
      draftEditorTicketType !== selectedDraft.proposed_ticket_type ||
      !arraysEqual(
        draftEditorAcceptanceCriteriaLines,
        selectedDraft.proposed_acceptance_criteria,
      ));
  const draftEvents = draftEventsQuery.data?.events ?? [];
  const latestDraftEvent = draftEvents.at(0);
  const latestDraftEventMeta = latestDraftEvent
    ? parseDraftEventMeta(latestDraftEvent)
    : null;
  const latestRevertableRefineEvent =
    findLatestRevertableRefineEvent(draftEvents);
  const draftAnalysisActive = draftEventsQuery.data?.active_run ?? false;
  const latestQuestionsEvent = draftEvents.find(
    (event) => event.event_type === "draft.questions.completed",
  );
  const latestQuestionsResult = latestQuestionsEvent
    ? parseDraftQuestionsResult(latestQuestionsEvent.payload.result)
    : null;
  const session = sessionQuery.data?.session ?? null;
  const sessionAttempts = sessionAttemptsQuery.data?.attempts ?? [];
  const sessionLogs = sessionLogsQuery.data?.logs ?? [];
  const selectedSessionTicket =
    tickets.find((ticket) => ticket.session_id === selectedSessionId) ?? null;
  const ticketEvents = ticketEventsQuery.data?.events ?? [];
  const reviewPackage = reviewPackageQuery.data?.review_package ?? null;
  const latestReviewRun = latestReviewRunQuery.data?.review_run ?? null;
  const reviewRuns = reviewRunsQuery.data?.review_runs ?? [];
  const ticketWorkspaceDiff =
    ticketWorkspaceDiffQuery.data?.workspace_diff ?? null;
  const sessionById = new Map(
    sessionSummaries
      .map((query) => query.data?.session)
      .filter((value): value is ExecutionSession => value !== undefined)
      .map((item) => [item.id, item]),
  );
  const sessionSummaryStateById = buildSessionSummaryStateById({
    sessionSummaries,
    tickets: ticketsQuery.data?.tickets ?? [],
  });
  const agentControlsWorktreeBySessionId = new Map(
    sessionSummaries
      .map((query) => query.data)
      .filter((value): value is SessionResponse => value !== undefined)
      .map((item) => [item.session.id, item.agent_controls_worktree]),
  );
  const { doneColumnTickets, groupedTickets, visibleDrafts, visibleTickets } =
    resolveVisibleBoardItems({
      boardSearch,
      drafts,
      tickets,
    });

  const selectedSessionTicketSession = selectedSessionTicket?.session_id
    ? (sessionById.get(selectedSessionTicket.session_id) ?? session)
    : session;

  const boardLoading =
    (selectedProjectId !== null && draftsQuery.isPending) ||
    (selectedProjectId !== null && ticketsQuery.isPending);
  const boardError = draftsQuery.isError
    ? draftsQuery.error.message
    : ticketsQuery.isError
      ? ticketsQuery.error.message
      : null;

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

  useEffect(() => {
    if (inspectorState.kind === "new_draft") {
      return;
    }

    if (!selectedDraft) {
      const syncResult = resolveDraftEditorSync({
        draftFormDirty,
        editor: {
          sourceId: draftEditorSourceId,
          title: draftEditorTitle,
          description: draftEditorDescription,
          ticketType: draftEditorTicketType,
          acceptanceCriteria: draftEditorAcceptanceCriteria,
        },
        pendingSync: pendingDraftEditorSync,
        selectedDraft: null,
      });
      if (syncResult.nextEditor) {
        setDraftEditorSourceId(syncResult.nextEditor.sourceId);
        setDraftEditorTitle(syncResult.nextEditor.title);
        setDraftEditorDescription(syncResult.nextEditor.description);
        setDraftEditorTicketType(syncResult.nextEditor.ticketType);
        setDraftEditorAcceptanceCriteria(
          syncResult.nextEditor.acceptanceCriteria,
        );
      }
      if (syncResult.nextPendingSync !== undefined) {
        setPendingDraftEditorSync(syncResult.nextPendingSync);
      }
      return;
    }

    const syncResult = resolveDraftEditorSync({
      draftFormDirty,
      editor: {
        sourceId: draftEditorSourceId,
        title: draftEditorTitle,
        description: draftEditorDescription,
        ticketType: draftEditorTicketType,
        acceptanceCriteria: draftEditorAcceptanceCriteria,
      },
      pendingSync: pendingDraftEditorSync,
      selectedDraft,
    });

    if (syncResult.nextEditor) {
      setDraftEditorSourceId(syncResult.nextEditor.sourceId);
      setDraftEditorTitle(syncResult.nextEditor.title);
      setDraftEditorDescription(syncResult.nextEditor.description);
      setDraftEditorTicketType(syncResult.nextEditor.ticketType);
      setDraftEditorAcceptanceCriteria(
        syncResult.nextEditor.acceptanceCriteria,
      );
    }

    if (syncResult.nextPendingSync !== undefined) {
      setPendingDraftEditorSync(syncResult.nextPendingSync);
    }
  }, [
    draftEditorAcceptanceCriteria,
    draftEditorDescription,
    draftEditorSourceId,
    draftEditorTicketType,
    draftEditorTitle,
    draftFormDirty,
    inspectorState.kind,
    pendingDraftEditorSync,
    selectedDraft,
    setPendingDraftEditorSync,
    setDraftEditorAcceptanceCriteria,
    setDraftEditorTitle,
    setDraftEditorTicketType,
    setDraftEditorSourceId,
    setDraftEditorDescription,
  ]);

  useEffect(() => {
    if (inspectorState.kind === "new_draft") {
      return;
    }

    if (inspectorState.kind === "draft") {
      if (selectedDraft) {
        setDraftEditorProjectId(selectedDraft.project_id);
        setDraftEditorArtifactScopeId(selectedDraft.artifact_scope_id);
        setDraftEditorUploadError(null);
      }
      return;
    }

    setDraftEditorProjectId(null);
    setDraftEditorArtifactScopeId(null);
    setDraftEditorUploadError(null);
  }, [
    inspectorState.kind,
    selectedDraft,
    setDraftEditorUploadError,
    setDraftEditorProjectId,
    setDraftEditorArtifactScopeId,
  ]);

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

    const repositoryTargetBranches = collectRepositoryTargetBranchUpdates({
      project: projectOptionsProject,
      repositories: projectOptionsRepositories,
      repositoryTargetBranches: projectOptionsRepositoryTargetBranches,
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

  const deleteTicket = (ticket: TicketFrontmatter): void => {
    const confirmed = window.confirm(
      `Delete ticket #${ticket.id}? This removes local ticket metadata and will try to clean up its worktree and branch.`,
    );
    if (!confirmed) {
      return;
    }

    mutations.deleteTicketMutation.mutate({
      ticketId: ticket.id,
      sessionId: ticket.session_id,
    });
  };

  const editReadyTicket = (ticket: TicketFrontmatter): void => {
    mutations.editReadyTicketMutation.mutate({ ticket });
  };

  const restartTicketFromScratch = (
    ticket: TicketFrontmatter,
    reason?: string,
  ): void => {
    const confirmed = window.confirm(
      `Restart ticket #${ticket.id} from scratch? This deletes the current worktree and local branch, then recreates them from ${ticket.target_branch}.`,
    );
    if (!confirmed) {
      return;
    }

    mutations.restartTicketMutation.mutate({
      ticketId: ticket.id,
      ...(reason && reason.trim().length > 0 ? { reason } : {}),
    });
  };

  const archiveTicket = (ticket: TicketFrontmatter): void => {
    mutations.archiveTicketMutation.mutate({
      ticketId: ticket.id,
      projectId: ticket.project,
      sessionId: ticket.session_id,
    });
  };

  const archiveDoneTickets = (ticketsToArchive: TicketFrontmatter[]): void => {
    if (selectedProjectId === null || ticketsToArchive.length === 0) {
      return;
    }

    mutations.archiveDoneTicketsMutation.mutate({
      projectId: selectedProjectId,
      tickets: ticketsToArchive,
    });
  };

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

  const {
    closeWorkspaceModal,
    hideInspector,
    openDraft,
    openNewDraft,
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
    onConfirmDraft: (input) => {
      mutations.confirmDraftMutation.mutate(input);
    },
    onQuestionDraft: (draftId) => {
      mutations.questionDraftMutation.mutate(draftId);
    },
    onRefineDraft: (draftId) => {
      mutations.refineDraftMutation.mutate(draftId);
    },
    persistNewDraftFromEditor,
  });

  return {
    ...mutations,
    actionItems,
    unreadActionItemCount,
    agentReviewHistoryModalOpen,
    archiveActionFeedback,
    archiveModalOpen,
    archiveDoneTickets,
    archiveTicket,
    agentControlsWorktreeBySessionId,
    archivedTicketsQuery,
    boardError,
    boardLoading,
    boardSearch,
    canDeleteProject,
    closeArchiveModal,
    closeAgentReviewHistoryModal,
    closeProjectOptionsModal,
    defaultBranch,
    deleteTicket,
    editReadyTicket,
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
    drafts,
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
    projectOptionsColor: swatchColor,
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
    restartTicketFromScratch,
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
    selectedSessionId,
    selectedSessionTicket,
    selectedSessionTicketId,
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
