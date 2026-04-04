import { useQueries, useQueryClient } from "@tanstack/react-query";
import { type ClipboardEvent, useEffect, useState } from "react";
import type {
  ExecutionSession,
  Project,
  RepositoryBranchChoices,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import {
  buildPendingDraftEditorSync,
  emptyDraftEditorFields,
  resolveDraftEditorSync,
} from "../../lib/draft-editor-sync.js";
import { deriveInboxItems } from "../../lib/inbox-items.js";
import { useAgentReviewHistoryModalState } from "./agent-review-history-modal-state.js";
import {
  resolveNextInspectorState,
  shouldResetProjectOptionsSelection,
} from "./controller-guards.js";
import {
  useDraftRefinementActivity,
  useGlobalDrafts,
} from "./draft-queries.js";
import { hasProjectOptionsDirty } from "./project-options-dirty.js";
import { buildSessionSummaryStateById } from "./session-summary-state.js";
import {
  blobToBase64,
  buildMarkdownImageInsertion,
  fetchJson,
  readLastOpenProjectId,
  writeDiffLayoutPreference,
  writeLastOpenProjectId,
} from "./shared-api.js";
import type {
  ArchiveActionFeedback,
  DraftsResponse,
  NewDraftAction,
  RepositoriesResponse,
  SessionResponse,
} from "./shared-types.js";
import {
  arraysEqual,
  collectRepositoryTargetBranchUpdates,
  findLatestRevertableRefineEvent,
  hasRepositoryTargetBranchChanges,
  mapRepositoryTargetBranches,
  mergeRepositoryTargetBranches,
  parseDraftEventMeta,
  parseDraftQuestionsResult,
  repositoryTargetBranchesEqual,
  resolveOptionalProjectCommandValue,
  resolveProjectCustomModelValue,
  resolveProjectModelPreset,
  resolveProjectModelValue,
  resolveProjectReasoningEffortSelection,
  resolveProjectReasoningEffortValue,
  resolveVisibleBoardItems,
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
  useDraftWorkspaceState,
  useProjectOptionsState,
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
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [projectSelectionHydrated, setProjectSelectionHydrated] =
    useState(false);
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [archiveActionFeedback, setArchiveActionFeedback] =
    useState<ArchiveActionFeedback | null>(null);
  const {
    projectModalOpen,
    projectOptionsAgentAdapter,
    projectOptionsAutomaticAgentReview,
    projectOptionsAutomaticAgentReviewRunLimit,
    projectOptionsDefaultReviewAction,
    projectOptionsDraftModelCustom,
    projectOptionsDraftModelPreset,
    projectOptionsDraftReasoningEffort,
    projectOptionsExecutionBackend,
    projectOptionsFormError,
    projectOptionsPostWorktreeCommand,
    projectOptionsPreWorktreeCommand,
    projectOptionsPreviewStartCommand,
    projectOptionsProjectId,
    projectOptionsRepositoryTargetBranches,
    projectOptionsTicketModelCustom,
    projectOptionsTicketModelPreset,
    projectOptionsTicketReasoningEffort,
    setProjectModalOpen,
    setProjectOptionsAgentAdapter,
    setProjectOptionsAutomaticAgentReview,
    setProjectOptionsAutomaticAgentReviewRunLimit,
    setProjectOptionsDefaultReviewAction,
    setProjectOptionsDraftModelCustom,
    setProjectOptionsDraftModelPreset,
    setProjectOptionsDraftReasoningEffort,
    setProjectOptionsExecutionBackend,
    setProjectOptionsFormError,
    setProjectOptionsPostWorktreeCommand,
    setProjectOptionsPreWorktreeCommand,
    setProjectOptionsPreviewStartCommand,
    setProjectOptionsProjectId,
    setProjectOptionsRepositoryTargetBranches,
    setProjectOptionsTicketModelCustom,
    setProjectOptionsTicketModelPreset,
    setProjectOptionsTicketReasoningEffort,
  } = useProjectOptionsState();
  const [projectDeleteConfirmText, setProjectDeleteConfirmText] = useState("");
  const [projectName, setProjectName] = useState("");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [validationCommandsText, setValidationCommandsText] = useState("");
  const {
    boardSearch,
    draftEditorAcceptanceCriteria,
    draftEditorArtifactScopeId,
    draftEditorDescription,
    draftEditorProjectId,
    draftEditorSourceId,
    draftEditorTicketType,
    draftEditorTitle,
    draftEditorUploadError,
    inspectorState,
    pendingDraftEditorSync,
    pendingNewDraftAction,
    planFeedbackBody,
    requestedChangesBody,
    resumeReason,
    setBoardSearch,
    setDraftEditorAcceptanceCriteria,
    setDraftEditorArtifactScopeId,
    setDraftEditorDescription,
    setDraftEditorProjectId,
    setDraftEditorSourceId,
    setDraftEditorTicketType,
    setDraftEditorTitle,
    setDraftEditorUploadError,
    setInspectorState,
    setPendingDraftEditorSync,
    setPendingNewDraftAction,
    setPlanFeedbackBody,
    setRequestedChangesBody,
    setResumeReason,
    setTerminalCommand,
    setTicketWorkspaceDiffLayout,
    setWorkspaceModal,
    setWorkspaceTerminalContext,
    setWorkspaceTicket,
    terminalCommand,
    ticketWorkspaceDiffLayout,
    workspaceModal,
    workspaceTerminalContext,
    workspaceTicket,
  } = useDraftWorkspaceState();
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
    projectOptionsProjectId,
    selectedDraftId,
    selectedProjectId,
    selectedSessionId,
  });
  const dockerHealth = healthQuery.data?.docker ?? null;
  const claudeCodeHealth = healthQuery.data?.claude_code ?? null;
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
  }, [projectRecords, projectsLoaded, selectedProjectId]);

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
    setProjectOptionsRepositoryTargetBranches({});
    setProjectOptionsFormError(null);
    setProjectDeleteConfirmText("");
  }, [
    projectRecords,
    projectOptionsProjectId,
    projectsLoaded,
    setProjectOptionsProjectId,
    setProjectOptionsFormError,
    setProjectOptionsRepositoryTargetBranches,
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

  useEffect(() => {
    writeDiffLayoutPreference(ticketWorkspaceDiffLayout);
  }, [ticketWorkspaceDiffLayout]);

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
  const {
    reviewRunQueriesSettled,
    ticketAiReviewActiveById,
    ticketAiReviewResolvedById,
  } = useTicketAiReviewStatus(globalTickets);
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
    ticketWorkspaceDiffQuery,
  } = useTicketReviewQueries({
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
  const actionItems = deriveInboxItems({
    drafts: globalDrafts,
    projects: projectRecords,
    tickets: globalTickets,
    sessionsById: globalSessionById,
    ticketAiReviewActiveById,
    ticketAiReviewResolvedById,
  });
  const actionItemKeys = actionItems.map((item) => item.key);
  const inboxQueriesSettled =
    projectsLoaded &&
    globalDraftsQueries.every((query) => !query.isPending) &&
    globalTicketsQueries.every((query) => !query.isPending) &&
    globalSessionSummaries.every((query) => !query.isPending) &&
    reviewRunQueriesSettled;
  const { silenceNextInboxItemKey } = useInboxAlert({
    actionItemKeys,
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
  const projectOptionsPreWorktreeCommandValue =
    resolveOptionalProjectCommandValue(projectOptionsPreWorktreeCommand);
  const projectOptionsPreviewStartCommandValue =
    resolveOptionalProjectCommandValue(projectOptionsPreviewStartCommand);
  const projectOptionsPostWorktreeCommandValue =
    resolveOptionalProjectCommandValue(projectOptionsPostWorktreeCommand);
  const projectOptionsRepositoryBranchesDirty =
    hasRepositoryTargetBranchChanges({
      project: projectOptionsProject,
      repositories: projectOptionsRepositories,
      repositoryTargetBranches: projectOptionsRepositoryTargetBranches,
    });
  const projectOptionsDirty = hasProjectOptionsDirty({
    draftModelValue: projectOptionsDraftModelValue,
    draftReasoningEffortValue: projectOptionsDraftReasoningEffortValue,
    executionBackend: projectOptionsExecutionBackend,
    postWorktreeCommandValue: projectOptionsPostWorktreeCommandValue,
    preWorktreeCommandValue: projectOptionsPreWorktreeCommandValue,
    previewStartCommandValue: projectOptionsPreviewStartCommandValue,
    project: projectOptionsProject,
    projectOptionsAutomaticAgentReview,
    projectOptionsAutomaticAgentReviewRunLimit,
    projectOptionsDefaultReviewAction,
    repositoryBranchesDirty: projectOptionsRepositoryBranchesDirty,
    selectedAgentAdapter: projectOptionsAgentAdapter,
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
  const draftEditorAcceptanceCriteriaLines = draftEditorAcceptanceCriteria
    .split("\n")
    .filter((line) => line.trim().length > 0);
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
  const sessionLogs = sessionLogsQuery.data?.logs ?? [];
  const selectedSessionTicket =
    tickets.find((ticket) => ticket.session_id === selectedSessionId) ?? null;
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

  const initializeNewDraftEditor = (projectId: string | null): void => {
    setDraftEditorProjectId(projectId);
    setDraftEditorSourceId(emptyDraftEditorFields.sourceId);
    setDraftEditorArtifactScopeId(null);
    setDraftEditorTitle(emptyDraftEditorFields.title);
    setDraftEditorDescription(emptyDraftEditorFields.description);
    setDraftEditorTicketType(emptyDraftEditorFields.ticketType);
    setDraftEditorAcceptanceCriteria(emptyDraftEditorFields.acceptanceCriteria);
    setDraftEditorUploadError(null);
    setPendingDraftEditorSync(null);
    setPendingNewDraftAction(null);
  };

  const persistNewDraftFromEditor = async (
    action: NewDraftAction,
  ): Promise<string | null> => {
    if (!draftEditorProjectId) {
      return null;
    }

    setPendingNewDraftAction(action);

    try {
      const ack = await mutations.createDraftMutation.mutateAsync({
        projectId: draftEditorProjectId,
        artifactScopeId: draftEditorArtifactScopeId,
        title: draftEditorTitle,
        description: draftEditorDescription,
        proposedTicketType: draftEditorTicketType,
        proposedAcceptanceCriteria: draftEditorAcceptanceCriteriaLines,
      });

      const draftId =
        (ack as { resource_refs?: { draft_id?: string | null } }).resource_refs
          ?.draft_id ?? null;
      if (action === "refine" && draftId) {
        const createdDraft = queryClient
          .getQueryData<DraftsResponse>([
            "projects",
            draftEditorProjectId,
            "drafts",
          ])
          ?.drafts.find((draft) => draft.id === draftId);
        setPendingDraftEditorSync(
          buildPendingDraftEditorSync({
            acceptanceCriteria: draftEditorAcceptanceCriteria,
            description: draftEditorDescription,
            draftId,
            sourceUpdatedAt: createdDraft?.updated_at ?? null,
            ticketType: draftEditorTicketType,
            title: draftEditorTitle,
          }),
        );
      }

      return draftId;
    } catch {
      return null;
    } finally {
      setPendingNewDraftAction(null);
    }
  };

  const handleDraftDescriptionPaste = async (
    file: File,
    selection: { start: number; end: number },
  ): Promise<{ cursorOffset: number; value: string } | null> => {
    if (!draftEditorProjectId) {
      return null;
    }
    setDraftEditorUploadError(null);

    try {
      const response = await mutations.uploadDraftArtifactMutation.mutateAsync({
        projectId: draftEditorProjectId,
        artifactScopeId: draftEditorArtifactScopeId,
        mimeType: file.type,
        dataBase64: await blobToBase64(file),
      });
      const insertion = buildMarkdownImageInsertion(
        draftEditorDescription,
        response.markdown_image,
        selection.start,
        selection.end,
      );

      setDraftEditorArtifactScopeId(response.artifact_scope_id);
      return insertion;
    } catch (error) {
      setDraftEditorUploadError(
        error instanceof Error ? error.message : "Unable to paste screenshot",
      );
      return null;
    }
  };

  const handleDraftDescriptionTextareaPaste = (
    event: ClipboardEvent<HTMLTextAreaElement>,
  ): void => {
    const imageItem = Array.from(event.clipboardData.items).find((item) =>
      item.type.startsWith("image/"),
    );
    if (!imageItem) {
      return;
    }

    const file = imageItem.getAsFile();
    if (!file) {
      return;
    }

    event.preventDefault();
    const target = event.currentTarget;
    void (async () => {
      const result = await handleDraftDescriptionPaste(file, {
        start: target.selectionStart,
        end: target.selectionEnd,
      });
      if (!result) {
        return;
      }

      setDraftEditorDescription(result.value);
      window.requestAnimationFrame(() => {
        target.selectionStart = result.cursorOffset;
        target.selectionEnd = result.cursorOffset;
        target.focus();
      });
    })();
  };

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
    setProjectOptionsProjectId(null);
    setProjectOptionsAgentAdapter("codex");
    setProjectOptionsExecutionBackend("host");
    setProjectOptionsAutomaticAgentReview(false);
    setProjectOptionsAutomaticAgentReviewRunLimit(1);
    setProjectOptionsDefaultReviewAction("direct_merge");
    setProjectOptionsPreviewStartCommand("");
    setProjectOptionsRepositoryTargetBranches({});
    setProjectOptionsFormError(null);
    setProjectDeleteConfirmText("");
    mutations.updateProjectMutation.reset();
    mutations.deleteProjectMutation.reset();
  };

  const openProjectOptions = (project: Project): void => {
    const cachedRepositories =
      queryClient.getQueryData<RepositoriesResponse>([
        "projects",
        project.id,
        "repositories",
      ])?.repositories ?? [];

    setProjectOptionsProjectId(project.id);
    setProjectOptionsAgentAdapter(project.agent_adapter);
    setProjectOptionsExecutionBackend(project.execution_backend);
    setProjectOptionsAutomaticAgentReview(project.automatic_agent_review);
    setProjectOptionsAutomaticAgentReviewRunLimit(
      project.automatic_agent_review_run_limit,
    );
    setProjectOptionsDefaultReviewAction(project.default_review_action);
    setProjectOptionsDraftModelPreset(
      resolveProjectModelPreset(project.draft_analysis_model),
    );
    setProjectOptionsDraftModelCustom(
      resolveProjectCustomModelValue(project.draft_analysis_model),
    );
    setProjectOptionsDraftReasoningEffort(
      resolveProjectReasoningEffortSelection(
        project.draft_analysis_reasoning_effort,
      ),
    );
    setProjectOptionsTicketModelPreset(
      resolveProjectModelPreset(project.ticket_work_model),
    );
    setProjectOptionsTicketModelCustom(
      resolveProjectCustomModelValue(project.ticket_work_model),
    );
    setProjectOptionsTicketReasoningEffort(
      resolveProjectReasoningEffortSelection(
        project.ticket_work_reasoning_effort,
      ),
    );
    setProjectOptionsPreviewStartCommand(project.preview_start_command ?? "");
    setProjectOptionsPreWorktreeCommand(project.pre_worktree_command ?? "");
    setProjectOptionsPostWorktreeCommand(project.post_worktree_command ?? "");
    setProjectOptionsRepositoryTargetBranches(
      mapRepositoryTargetBranches(
        cachedRepositories,
        project.default_target_branch,
      ),
    );
    setProjectOptionsFormError(null);
    setProjectDeleteConfirmText("");
    mutations.updateProjectMutation.reset();
    mutations.deleteProjectMutation.reset();
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
      agentAdapter: projectOptionsAgentAdapter,
      projectId: projectOptionsProject.id,
      executionBackend:
        projectOptionsAgentAdapter === "claude-code"
          ? "host"
          : projectOptionsExecutionBackend,
      automaticAgentReview: projectOptionsAutomaticAgentReview,
      automaticAgentReviewRunLimit: projectOptionsAutomaticAgentReviewRunLimit,
      defaultReviewAction: projectOptionsDefaultReviewAction,
      previewStartCommand: projectOptionsPreviewStartCommandValue,
      preWorktreeCommand: projectOptionsPreWorktreeCommandValue,
      postWorktreeCommand: projectOptionsPostWorktreeCommandValue,
      draftAnalysisModel: projectOptionsDraftModelValue,
      draftAnalysisReasoningEffort: projectOptionsDraftReasoningEffortValue,
      ticketWorkModel: projectOptionsTicketModelValue,
      ticketWorkReasoningEffort: projectOptionsTicketReasoningEffortValue,
      repositoryTargetBranches,
    });
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

  const openArchiveModal = (): void => {
    setArchiveActionFeedback(null);
    setArchiveModalOpen(true);
  };

  const closeArchiveModal = (): void => {
    setArchiveModalOpen(false);
    setArchiveActionFeedback(null);
    mutations.restoreTicketMutation.reset();
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

  const handleSaveNewDraft = (): void => {
    void persistNewDraftFromEditor("save");
  };

  const handleRefineNewDraft = (): void => {
    void (async () => {
      const draftId = await persistNewDraftFromEditor("refine");
      if (!draftId) {
        return;
      }

      mutations.refineDraftMutation.mutate(draftId);
    })();
  };

  const handleQuestionNewDraft = (): void => {
    void (async () => {
      const draftId = await persistNewDraftFromEditor("questions");
      if (!draftId) {
        return;
      }

      mutations.questionDraftMutation.mutate(draftId);
    })();
  };

  const handleConfirmNewDraft = (): void => {
    if (!draftEditorProject || !draftEditorRepository) {
      return;
    }

    void (async () => {
      const draftId = await persistNewDraftFromEditor("confirm");
      if (!draftId) {
        return;
      }

      mutations.confirmDraftMutation.mutate({
        draftId,
        title: draftEditorTitle,
        description: draftEditorDescription,
        ticketType: draftEditorTicketType,
        acceptanceCriteria: draftEditorAcceptanceCriteriaLines,
        repository: draftEditorRepository,
        project: draftEditorProject,
      });
    })();
  };

  return {
    ...mutations,
    actionItems,
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
    claudeCodeHealth,
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
    handleDraftDescriptionTextareaPaste,
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
    openSelectedRepositoryWorkspaceTerminal,
    openTicketWorkspaceModal,
    openDraft,
    openNewDraft,
    openProjectOptions,
    openTicketSession,
    pendingDraftEditorSync,
    pendingNewDraftAction,
    planFeedbackBody,
    previewActionErrorByTicketId,
    projectDeleteConfirmText,
    projectModalOpen,
    projectName,
    projectOptionsBranchChoices,
    projectOptionsBranchesByRepositoryId,
    projectOptionsBranchesQuery,
    projectOptionsAutomaticAgentReview,
    projectOptionsAutomaticAgentReviewRunLimit,
    projectOptionsDefaultReviewAction,
    projectOptionsDirty,
    projectOptionsAgentAdapter,
    projectOptionsDraftModelCustom,
    projectOptionsDraftModelPreset,
    projectOptionsDraftModelValue,
    projectOptionsDraftReasoningEffort,
    projectOptionsDraftReasoningEffortValue,
    projectOptionsExecutionBackend,
    projectOptionsFormError,
    projectOptionsPostWorktreeCommand,
    projectOptionsPostWorktreeCommandValue,
    projectOptionsPreWorktreeCommand,
    projectOptionsPreWorktreeCommandValue,
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
    sessionById,
    sessionSummaryStateById,
    sessionLogs,
    sessionLogsQuery,
    sessionQuery,
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
    setProjectDeleteConfirmText,
    setProjectModalOpen,
    setProjectName,
    setProjectOptionsAgentAdapter,
    setProjectOptionsAutomaticAgentReview,
    setProjectOptionsAutomaticAgentReviewRunLimit,
    setProjectOptionsDefaultReviewAction,
    setProjectOptionsDraftModelCustom,
    setProjectOptionsDraftModelPreset,
    setProjectOptionsDraftReasoningEffort,
    setProjectOptionsExecutionBackend,
    setProjectOptionsFormError,
    setProjectOptionsPostWorktreeCommand,
    setProjectOptionsPreWorktreeCommand,
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
