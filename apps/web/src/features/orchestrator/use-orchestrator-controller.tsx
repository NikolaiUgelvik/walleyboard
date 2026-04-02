import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ClipboardEvent, useEffect, useRef, useState } from "react";
import type {
  AgentAdapter,
  DraftTicketState,
  ExecutionBackend,
  ExecutionSession,
  HealthResponse,
  Project,
  RepositoryBranchChoices,
  RepositoryBranchesResponse,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import {
  type PendingDraftEditorSync,
  emptyDraftEditorFields,
  resolveDraftEditorSync,
} from "../../lib/draft-editor-sync.js";
import { hasNewInboxItems } from "../../lib/inbox-alert.js";
import { deriveInboxItems } from "../../lib/inbox-items.js";
import {
  type ArchiveActionFeedback,
  type DraftEventsResponse,
  type DraftsResponse,
  type InspectorState,
  type NewDraftAction,
  type ProjectModelPreset,
  type ProjectReasoningEffortSelection,
  type ProjectsResponse,
  type RepositoriesResponse,
  type ReviewPackageResponse,
  type SessionLogsResponse,
  type SessionResponse,
  type TicketWorkspaceDiffResponse,
  type TicketWorkspacePreviewResponse,
  type TicketsResponse,
  arraysEqual,
  blobToBase64,
  buildMarkdownImageInsertion,
  diffLayoutStorageKey,
  draftMatchesSearch,
  fetchJson,
  findLatestRevertableRefineEvent,
  focusElementById,
  mapRepositoryTargetBranches,
  mergeRepositoryTargetBranches,
  normalizeText,
  parseDraftEventMeta,
  parseDraftQuestionsResult,
  readDiffLayoutPreference,
  readLastOpenProjectId,
  repositoryTargetBranchesEqual,
  resolveOptionalProjectCommandValue,
  resolveProjectCustomModelValue,
  resolveProjectModelPreset,
  resolveProjectModelValue,
  resolveProjectReasoningEffortSelection,
  resolveProjectReasoningEffortValue,
  ticketMatchesSearch,
  writeLastOpenProjectId,
} from "./shared.js";
import { useOrchestratorMutations } from "./use-orchestrator-mutations.js";
import { useProtocolEventSync } from "./use-protocol-event-sync.js";

export function useOrchestratorController() {
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [projectSelectionHydrated, setProjectSelectionHydrated] =
    useState(false);
  const [inspectorState, setInspectorState] = useState<InspectorState>({
    kind: "hidden",
  });
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [archiveActionFeedback, setArchiveActionFeedback] =
    useState<ArchiveActionFeedback | null>(null);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectOptionsProjectId, setProjectOptionsProjectId] = useState<
    string | null
  >(null);
  const [projectOptionsAgentAdapter, setProjectOptionsAgentAdapter] =
    useState<AgentAdapter>("codex");
  const [projectOptionsExecutionBackend, setProjectOptionsExecutionBackend] =
    useState<ExecutionBackend>("host");
  const [projectOptionsDraftModelPreset, setProjectOptionsDraftModelPreset] =
    useState<ProjectModelPreset>("default");
  const [projectOptionsDraftModelCustom, setProjectOptionsDraftModelCustom] =
    useState("");
  const [
    projectOptionsDraftReasoningEffort,
    setProjectOptionsDraftReasoningEffort,
  ] = useState<ProjectReasoningEffortSelection>("default");
  const [projectOptionsTicketModelPreset, setProjectOptionsTicketModelPreset] =
    useState<ProjectModelPreset>("default");
  const [projectOptionsTicketModelCustom, setProjectOptionsTicketModelCustom] =
    useState("");
  const [
    projectOptionsTicketReasoningEffort,
    setProjectOptionsTicketReasoningEffort,
  ] = useState<ProjectReasoningEffortSelection>("default");
  const [
    projectOptionsPreWorktreeCommand,
    setProjectOptionsPreWorktreeCommand,
  ] = useState("");
  const [
    projectOptionsPostWorktreeCommand,
    setProjectOptionsPostWorktreeCommand,
  ] = useState("");
  const [
    projectOptionsRepositoryTargetBranches,
    setProjectOptionsRepositoryTargetBranches,
  ] = useState<Record<string, string>>({});
  const [projectOptionsFormError, setProjectOptionsFormError] = useState<
    string | null
  >(null);
  const [projectDeleteConfirmText, setProjectDeleteConfirmText] = useState("");
  const [projectName, setProjectName] = useState("");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [validationCommandsText, setValidationCommandsText] = useState("");
  const [draftEditorProjectId, setDraftEditorProjectId] = useState<
    string | null
  >(null);
  const [draftEditorSourceId, setDraftEditorSourceId] = useState<string | null>(
    null,
  );
  const [draftEditorArtifactScopeId, setDraftEditorArtifactScopeId] = useState<
    string | null
  >(null);
  const [draftEditorTitle, setDraftEditorTitle] = useState("");
  const [draftEditorDescription, setDraftEditorDescription] = useState("");
  const [draftEditorTicketType, setDraftEditorTicketType] =
    useState<DraftTicketState["proposed_ticket_type"]>(null);
  const [draftEditorAcceptanceCriteria, setDraftEditorAcceptanceCriteria] =
    useState("");
  const [draftEditorUploadError, setDraftEditorUploadError] = useState<
    string | null
  >(null);
  const [pendingDraftEditorSync, setPendingDraftEditorSync] =
    useState<PendingDraftEditorSync | null>(null);
  const [pendingNewDraftAction, setPendingNewDraftAction] =
    useState<NewDraftAction | null>(null);
  const [requestedChangesBody, setRequestedChangesBody] = useState("");
  const [planFeedbackBody, setPlanFeedbackBody] = useState("");
  const [resumeReason, setResumeReason] = useState("");
  const [terminalCommand, setTerminalCommand] = useState("");
  const [ticketWorkspaceTab, setTicketWorkspaceTab] = useState<
    "diff" | "terminal" | "preview" | "activity"
  >("diff");
  const [ticketWorkspaceDiffLayout, setTicketWorkspaceDiffLayout] = useState<
    "split" | "stacked"
  >(() => readDiffLayoutPreference());
  const [boardSearch, setBoardSearch] = useState("");
  const inboxAlertAudioRef = useRef<HTMLAudioElement | null>(null);
  const previousInboxItemKeysRef = useRef<string[] | null>(null);
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

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => fetchJson<HealthResponse>("/health"),
    retry: false,
  });
  const dockerHealth = healthQuery.data?.docker ?? null;

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => fetchJson<ProjectsResponse>("/projects"),
    retry: false,
  });

  const globalTicketsQueries = useQueries({
    queries: (projectsQuery.data?.projects ?? []).map((project) => ({
      queryKey: ["projects", project.id, "tickets"],
      queryFn: () =>
        fetchJson<TicketsResponse>(`/projects/${project.id}/tickets`),
      refetchInterval: 2_000,
    })),
  });

  const globalTickets = globalTicketsQueries.flatMap(
    (query) => query.data?.tickets ?? [],
  );

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

  const repositoriesQuery = useQuery({
    queryKey: ["projects", selectedProjectId, "repositories"],
    queryFn: () =>
      fetchJson<RepositoriesResponse>(
        `/projects/${selectedProjectId}/repositories`,
      ),
    enabled: selectedProjectId !== null,
  });

  const draftEditorRepositoriesQuery = useQuery({
    queryKey: [
      "projects",
      draftEditorProjectId,
      "repositories",
      "draft-editor",
    ],
    queryFn: () =>
      fetchJson<RepositoriesResponse>(
        `/projects/${draftEditorProjectId}/repositories`,
      ),
    enabled:
      draftEditorProjectId !== null &&
      draftEditorProjectId !== selectedProjectId,
  });

  const projectOptionsRepositoriesQuery = useQuery({
    queryKey: ["projects", projectOptionsProjectId, "repositories"],
    queryFn: () =>
      fetchJson<RepositoriesResponse>(
        `/projects/${projectOptionsProjectId}/repositories`,
      ),
    enabled: projectOptionsProjectId !== null,
  });

  const projectOptionsBranchesQuery = useQuery({
    queryKey: ["projects", projectOptionsProjectId, "repository-branches"],
    queryFn: () =>
      fetchJson<RepositoryBranchesResponse>(
        `/projects/${projectOptionsProjectId}/repository-branches`,
      ),
    enabled: projectOptionsProjectId !== null,
    retry: false,
  });

  const draftsQuery = useQuery({
    queryKey: ["projects", selectedProjectId, "drafts"],
    queryFn: () =>
      fetchJson<DraftsResponse>(`/projects/${selectedProjectId}/drafts`),
    enabled: selectedProjectId !== null,
    refetchInterval: selectedProjectId === null ? false : 2_000,
  });

  const ticketsQuery = useQuery({
    queryKey: ["projects", selectedProjectId, "tickets"],
    queryFn: () =>
      fetchJson<TicketsResponse>(`/projects/${selectedProjectId}/tickets`),
    enabled: selectedProjectId !== null,
    refetchInterval: selectedProjectId === null ? false : 2_000,
  });

  const archivedTicketsQuery = useQuery({
    queryKey: ["projects", selectedProjectId, "tickets", "archived"],
    queryFn: () =>
      fetchJson<TicketsResponse>(
        `/projects/${selectedProjectId}/archived-tickets`,
      ),
    enabled: selectedProjectId !== null && archiveModalOpen,
    refetchInterval:
      selectedProjectId === null || !archiveModalOpen ? false : 2_000,
  });

  const draftEventsQuery = useQuery({
    queryKey: ["drafts", selectedDraftId, "events"],
    queryFn: () =>
      fetchJson<DraftEventsResponse>(`/drafts/${selectedDraftId}/events`),
    enabled: selectedDraftId !== null,
    refetchInterval: selectedDraftId === null ? false : 2_000,
    retry: false,
  });

  const sessionSummaries = useQueries({
    queries: (ticketsQuery.data?.tickets ?? [])
      .filter((ticket) => ticket.session_id !== null)
      .map((ticket) => ({
        queryKey: ["sessions", ticket.session_id],
        queryFn: () =>
          fetchJson<SessionResponse>(`/sessions/${ticket.session_id}`),
        enabled: ticket.session_id !== null,
        refetchInterval: 2_000,
      })),
  });

  useEffect(() => {
    if (projectsQuery.data === undefined) {
      return;
    }

    const projects = projectsQuery.data.projects;
    const firstProjectId = projects[0]?.id ?? null;
    if (selectedProjectId === null) {
      const storedProjectId = readLastOpenProjectId();
      const initialProjectId =
        storedProjectId !== null &&
        projects.some((project) => project.id === storedProjectId)
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

    const stillExists = projects.some(
      (project) => project.id === selectedProjectId,
    );
    if (!stillExists) {
      setSelectedProjectId(firstProjectId);
      setArchiveModalOpen(false);
      setArchiveActionFeedback(null);
    }

    setProjectSelectionHydrated(true);
  }, [projectsQuery.data, selectedProjectId]);

  useEffect(() => {
    if (!projectSelectionHydrated) {
      return;
    }

    writeLastOpenProjectId(selectedProjectId);
  }, [projectSelectionHydrated, selectedProjectId]);

  useEffect(() => {
    if (projectOptionsProjectId === null) {
      return;
    }

    const stillExists =
      projectsQuery.data?.projects.some(
        (project) => project.id === projectOptionsProjectId,
      ) ?? false;
    if (!stillExists) {
      setProjectOptionsProjectId(null);
      setProjectOptionsRepositoryTargetBranches({});
      setProjectOptionsFormError(null);
      setProjectDeleteConfirmText("");
    }
  }, [projectOptionsProjectId, projectsQuery.data?.projects]);

  useEffect(() => {
    if (projectOptionsRepositoriesQuery.data === undefined) {
      return;
    }

    const defaultTargetBranch =
      projectsQuery.data?.projects.find(
        (project) => project.id === projectOptionsProjectId,
      )?.default_target_branch ?? null;

    setProjectOptionsRepositoryTargetBranches((current) => {
      const next = mergeRepositoryTargetBranches(
        current,
        projectOptionsRepositoriesQuery.data.repositories,
        defaultTargetBranch,
      );
      return repositoryTargetBranchesEqual(current, next) ? current : next;
    });
  }, [
    projectOptionsProjectId,
    projectOptionsRepositoriesQuery.data,
    projectsQuery.data,
  ]);

  useEffect(() => {
    if (inspectorState.kind === "draft") {
      const stillExists =
        draftsQuery.data?.drafts.some(
          (draft) => draft.id === inspectorState.draftId,
        ) ?? false;
      if (!stillExists) {
        setInspectorState({ kind: "hidden" });
      }
      return;
    }

    if (inspectorState.kind === "session") {
      const stillExists =
        ticketsQuery.data?.tickets.some(
          (ticket) => ticket.session_id === inspectorState.sessionId,
        ) ?? false;
      if (!stillExists) {
        setInspectorState({ kind: "hidden" });
      }
      return;
    }

    if (inspectorState.kind === "new_draft" && selectedProjectId === null) {
      setInspectorState({ kind: "hidden" });
    }
  }, [
    draftsQuery.data?.drafts,
    inspectorState,
    selectedProjectId,
    ticketsQuery.data?.tickets,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      diffLayoutStorageKey,
      ticketWorkspaceDiffLayout,
    );
  }, [ticketWorkspaceDiffLayout]);

  useEffect(() => {
    if (typeof Audio === "undefined") {
      return;
    }

    const audio = new Audio("/alert.mp3");
    audio.preload = "auto";
    inboxAlertAudioRef.current = audio;

    return () => {
      audio.pause();
      inboxAlertAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (selectedSessionId !== null) {
      setTicketWorkspaceTab("diff");
    }
  }, [selectedSessionId]);
  useProtocolEventSync({
    queryClient,
    selectedDraftId,
    selectedProjectId,
    selectedSessionId,
    setInspectorState,
  });

  const sessionQuery = useQuery({
    queryKey: ["sessions", selectedSessionId],
    queryFn: () => fetchJson<SessionResponse>(`/sessions/${selectedSessionId}`),
    enabled: selectedSessionId !== null,
    refetchInterval: selectedSessionId === null ? false : 2_000,
  });

  const sessionLogsQuery = useQuery({
    queryKey: ["sessions", selectedSessionId, "logs"],
    queryFn: () =>
      fetchJson<SessionLogsResponse>(`/sessions/${selectedSessionId}/logs`),
    enabled: selectedSessionId !== null,
    refetchInterval: selectedSessionId === null ? false : 2_000,
  });

  const selectedSessionTicketId =
    ticketsQuery.data?.tickets.find(
      (ticket) => ticket.session_id === selectedSessionId,
    )?.id ?? null;
  const selectedSessionTicketStatus =
    ticketsQuery.data?.tickets.find(
      (ticket) => ticket.session_id === selectedSessionId,
    )?.status ?? null;
  const projectOptionsProject =
    projectsQuery.data?.projects.find(
      (project) => project.id === projectOptionsProjectId,
    ) ?? null;

  const reviewPackageQuery = useQuery({
    queryKey: ["tickets", selectedSessionTicketId, "review-package"],
    queryFn: () =>
      fetchJson<ReviewPackageResponse>(
        `/tickets/${selectedSessionTicketId}/review-package`,
      ),
    enabled:
      selectedSessionTicketId !== null &&
      selectedSessionTicketStatus === "review",
  });

  const ticketWorkspaceDiffQuery = useQuery({
    queryKey: ["tickets", selectedSessionTicketId, "workspace", "diff"],
    queryFn: () =>
      fetchJson<TicketWorkspaceDiffResponse>(
        `/tickets/${selectedSessionTicketId}/workspace/diff`,
      ),
    enabled:
      selectedSessionTicketId !== null &&
      sessionQuery.data?.session.worktree_path != null,
    retry: false,
  });

  const ticketWorkspacePreviewQuery = useQuery({
    queryKey: ["tickets", selectedSessionTicketId, "workspace", "preview"],
    queryFn: () =>
      fetchJson<TicketWorkspacePreviewResponse>(
        `/tickets/${selectedSessionTicketId}/workspace/preview`,
      ),
    enabled:
      selectedSessionTicketId !== null &&
      sessionQuery.data?.session.worktree_path != null,
    retry: false,
  });

  const tickets = ticketsQuery.data?.tickets ?? [];
  const mutations = useOrchestratorMutations({
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
    setTerminalCommand,
    setValidationCommandsText,
    tickets,
  });

  const selectedProject =
    projectsQuery.data?.projects.find(
      (project) => project.id === selectedProjectId,
    ) ?? null;
  const draftEditorProject =
    projectsQuery.data?.projects.find(
      (project) => project.id === draftEditorProjectId,
    ) ?? null;
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
  const projectOptionsPostWorktreeCommandValue =
    resolveOptionalProjectCommandValue(projectOptionsPostWorktreeCommand);
  const projectOptionsRepositoryBranchesDirty =
    projectOptionsProject !== null &&
    projectOptionsRepositories.some((repository) => {
      const currentTargetBranch =
        repository.target_branch ??
        projectOptionsProject.default_target_branch ??
        "";
      const selectedTargetBranch =
        projectOptionsRepositoryTargetBranches[repository.id] ??
        currentTargetBranch;
      return selectedTargetBranch !== currentTargetBranch;
    });
  const projectOptionsDirty =
    projectOptionsProject !== null &&
    (projectOptionsAgentAdapter !== projectOptionsProject.agent_adapter ||
      projectOptionsExecutionBackend !==
        projectOptionsProject.execution_backend ||
      projectOptionsPreWorktreeCommandValue !==
        projectOptionsProject.pre_worktree_command ||
      projectOptionsPostWorktreeCommandValue !==
        projectOptionsProject.post_worktree_command ||
      projectOptionsDraftModelValue !==
        projectOptionsProject.draft_analysis_model ||
      projectOptionsDraftReasoningEffortValue !==
        projectOptionsProject.draft_analysis_reasoning_effort ||
      projectOptionsTicketModelValue !==
        projectOptionsProject.ticket_work_model ||
      projectOptionsTicketReasoningEffortValue !==
        projectOptionsProject.ticket_work_reasoning_effort ||
      projectOptionsRepositoryBranchesDirty);
  const canDeleteProject =
    projectOptionsProject !== null &&
    projectDeleteConfirmText.trim() === projectOptionsProject.slug;
  const repositories = repositoriesQuery.data?.repositories ?? [];
  const selectedRepository = repositories[0] ?? null;
  const draftEditorRepositories =
    draftEditorProjectId !== null && draftEditorProjectId === selectedProjectId
      ? repositories
      : (draftEditorRepositoriesQuery.data?.repositories ?? []);
  const draftEditorRepository = draftEditorRepositories[0] ?? null;
  const drafts = draftsQuery.data?.drafts ?? [];
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
  const ticketWorkspaceDiff =
    ticketWorkspaceDiffQuery.data?.workspace_diff ?? null;
  const ticketWorkspacePreview =
    ticketWorkspacePreviewQuery.data?.preview ?? null;
  const sessionById = new Map(
    sessionSummaries
      .map((query) => query.data?.session)
      .filter((value): value is ExecutionSession => value !== undefined)
      .map((item) => [item.id, item]),
  );
  const globalSessionById = new Map(
    globalSessionSummaries
      .map((query) => query.data?.session)
      .filter((value): value is ExecutionSession => value !== undefined)
      .map((item) => [item.id, item]),
  );

  useEffect(() => {
    if (
      ticketWorkspaceTab !== "preview" ||
      !selectedSessionTicket ||
      !session?.worktree_path ||
      mutations.startTicketWorkspacePreviewMutation.isPending
    ) {
      return;
    }

    if (
      ticketWorkspacePreview?.state === "ready" ||
      ticketWorkspacePreview?.state === "starting" ||
      ticketWorkspacePreview?.state === "failed"
    ) {
      return;
    }

    mutations.startTicketWorkspacePreviewMutation.mutate(
      selectedSessionTicket.id,
    );
  }, [
    mutations.startTicketWorkspacePreviewMutation,
    selectedSessionTicket,
    session?.worktree_path,
    ticketWorkspacePreview?.state,
    ticketWorkspaceTab,
  ]);

  const searchNeedle = normalizeText(boardSearch);
  const visibleDrafts = drafts.filter((draft) =>
    draftMatchesSearch(draft, searchNeedle),
  );
  const visibleTickets = tickets.filter((ticket) =>
    ticketMatchesSearch(ticket, searchNeedle),
  );

  const groupedTickets = {
    draft: [] as TicketFrontmatter[],
    ready: [] as TicketFrontmatter[],
    in_progress: [] as TicketFrontmatter[],
    review: [] as TicketFrontmatter[],
    done: [] as TicketFrontmatter[],
  };

  for (const ticket of visibleTickets) {
    groupedTickets[ticket.status].push(ticket);
  }

  const doneColumnTickets = groupedTickets.done;

  const actionItems = deriveInboxItems({
    projects: projectsQuery.data?.projects ?? [],
    tickets: globalTickets,
    sessionsById: globalSessionById,
  });
  const actionItemKeys = actionItems.map((item) => item.key);
  const inboxQueriesSettled =
    projectsQuery.data !== undefined &&
    globalTicketsQueries.every((query) => !query.isPending) &&
    globalSessionSummaries.every((query) => !query.isPending);

  useEffect(() => {
    if (!inboxQueriesSettled) {
      return;
    }

    const previousInboxItemKeys = previousInboxItemKeysRef.current;
    previousInboxItemKeysRef.current = actionItemKeys;
    if (!hasNewInboxItems(previousInboxItemKeys, actionItemKeys)) {
      return;
    }

    const audio = inboxAlertAudioRef.current;
    if (!audio) {
      return;
    }

    audio.currentTime = 0;
    void audio.play().catch(() => {});
  }, [actionItemKeys, inboxQueriesSettled]);

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

  const runningSessionCount = Array.from(sessionById.values()).filter(
    (activeSession) => activeSession.status === "running",
  ).length;
  const queuedSessionCount = Array.from(sessionById.values()).filter(
    (activeSession) => activeSession.status === "queued",
  ).length;
  const reviewCount = tickets.filter(
    (ticket) => ticket.status === "review",
  ).length;

  const capturePendingDraftEditorSync = (input: {
    draftId: string;
    sourceUpdatedAt: string | null;
  }): PendingDraftEditorSync => ({
    draftId: input.draftId,
    sourceUpdatedAt: input.sourceUpdatedAt,
    title: draftEditorTitle,
    description: draftEditorDescription,
    ticketType: draftEditorTicketType,
    acceptanceCriteria: draftEditorAcceptanceCriteria,
  });

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
          capturePendingDraftEditorSync({
            draftId,
            sourceUpdatedAt: createdDraft?.updated_at ?? null,
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
  }, [inspectorState.kind, selectedDraft]);

  const closeProjectOptionsModal = (): void => {
    setProjectOptionsProjectId(null);
    setProjectOptionsAgentAdapter("codex");
    setProjectOptionsExecutionBackend("host");
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

    const repositoryTargetBranches = projectOptionsRepositories.flatMap(
      (repository) => {
        const currentTargetBranch =
          repository.target_branch ??
          projectOptionsProject.default_target_branch ??
          "";
        const selectedTargetBranch =
          projectOptionsRepositoryTargetBranches[repository.id] ??
          currentTargetBranch;

        if (
          selectedTargetBranch.trim().length === 0 ||
          selectedTargetBranch === currentTargetBranch
        ) {
          return [];
        }

        return [
          {
            repositoryId: repository.id,
            targetBranch: selectedTargetBranch,
          },
        ];
      },
    );

    setProjectOptionsFormError(null);
    mutations.updateProjectMutation.mutate({
      agentAdapter: projectOptionsAgentAdapter,
      projectId: projectOptionsProject.id,
      executionBackend: projectOptionsExecutionBackend,
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

  const openNewDraft = (): void => {
    initializeNewDraftEditor(selectedProjectId);
    setInspectorState({ kind: "new_draft" });
    window.requestAnimationFrame(() => focusElementById("draft-title"));
  };

  const hideInspector = (): void => {
    setInspectorState({ kind: "hidden" });
  };

  const openTicketSession = (ticket: TicketFrontmatter): void => {
    if (!ticket.session_id) {
      return;
    }

    setInspectorState({ kind: "session", sessionId: ticket.session_id });
  };

  const openDraft = (draftId: string): void => {
    setInspectorState({ kind: "draft", draftId });
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
    archiveActionFeedback,
    archiveModalOpen,
    archiveDoneTickets,
    archiveTicket,
    archivedTicketsQuery,
    boardError,
    boardLoading,
    boardSearch,
    canDeleteProject,
    capturePendingDraftEditorSync,
    closeArchiveModal,
    closeProjectOptionsModal,
    defaultBranch,
    deleteTicket,
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
    healthQuery,
    hideInspector,
    inboxAlertAudioRef,
    initializeNewDraftEditor,
    inspectorState,
    inspectorVisible,
    latestDraftEventMeta,
    latestQuestionsResult,
    latestRevertableRefineEvent,
    openArchiveModal,
    openDraft,
    openNewDraft,
    openProjectOptions,
    openTicketSession,
    pendingDraftEditorSync,
    pendingNewDraftAction,
    planFeedbackBody,
    projectDeleteConfirmText,
    projectModalOpen,
    projectName,
    projectOptionsBranchChoices,
    projectOptionsBranchesByRepositoryId,
    projectOptionsBranchesQuery,
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
    queuedSessionCount,
    refreshProjectOptionsBranches,
    repositories,
    repositoriesQuery,
    repositoryPath,
    restartTicketFromScratch,
    requestedChangesBody,
    resumeReason,
    reviewCount,
    reviewPackage,
    reviewPackageQuery,
    runningSessionCount,
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
    sessionLogs,
    sessionLogsQuery,
    sessionQuery,
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
    setProjectOptionsDraftModelCustom,
    setProjectOptionsDraftModelPreset,
    setProjectOptionsDraftReasoningEffort,
    setProjectOptionsExecutionBackend,
    setProjectOptionsFormError,
    setProjectOptionsPostWorktreeCommand,
    setProjectOptionsPreWorktreeCommand,
    setProjectOptionsRepositoryTargetBranches,
    setProjectOptionsTicketModelCustom,
    setProjectOptionsTicketModelPreset,
    setProjectOptionsTicketReasoningEffort,
    setRepositoryPath,
    setRequestedChangesBody,
    setResumeReason,
    setTerminalCommand,
    setTicketWorkspaceDiffLayout,
    setTicketWorkspaceTab,
    setValidationCommandsText,
    sessionSummaries,
    terminalCommand,
    ticketWorkspaceDiff,
    ticketWorkspaceDiffLayout,
    ticketWorkspaceDiffQuery,
    ticketWorkspacePreview,
    ticketWorkspacePreviewQuery,
    ticketWorkspaceTab,
    tickets,
    ticketsQuery,
    validationCommandsText,
    visibleDrafts,
    visibleTickets,
  };
}

export type OrchestratorController = ReturnType<
  typeof useOrchestratorController
>;
