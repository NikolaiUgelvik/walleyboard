import type {
  DraftTicketState,
  ExecutionAttempt,
  ExecutionSession,
  Project,
  RepositoryBranchChoices,
  RepositoryConfig,
  ReviewAction,
  ReviewPackage,
  ReviewRun,
  StructuredEvent,
  TicketFrontmatter,
  TicketWorkspaceDiff,
  ValidationCommand,
} from "../../../../../packages/contracts/src/index.js";

import { sanitizeDraftAcceptanceCriteria } from "../../lib/draft-acceptance-criteria.js";
import { deriveInboxState } from "../../lib/inbox-items.js";
import { hasProjectOptionsDirty } from "./project-options-dirty.js";
import { buildSessionSummaryStateById } from "./session-summary-state.js";
import type {
  DraftEventsResponse,
  ProjectModelPreset,
  ProjectReasoningEffortSelection,
  RepositoriesResponse,
  SessionResponse,
} from "./shared-types.js";
import {
  arraysEqual,
  findLatestRevertableRefineEvent,
  hasRepositoryTargetBranchChanges,
  hasRepositoryValidationCommandChanges,
  parseDraftEventMeta,
  parseDraftQuestionsResult,
  resolveOptionalProjectCommandValue,
  resolveProjectModelValue,
  resolveProjectOptionsColors,
  resolveProjectReasoningEffortValue,
  resolveVisibleBoardItems,
} from "./shared-utils.js";

export function resolveBoardViewState(input: {
  boardSearch: string;
  drafts: DraftTicketState[];
  tickets: TicketFrontmatter[];
}) {
  return resolveVisibleBoardItems(input);
}

export function resolveInboxViewState(input: {
  drafts: DraftTicketState[];
  projects: Project[];
  readInboxItemState: Record<string, string>;
  sessionsById: Map<string, SessionResponse>;
  ticketAiReviewActiveById: ReadonlyMap<number, boolean>;
  ticketAiReviewResolvedById: ReadonlyMap<number, boolean>;
  tickets: TicketFrontmatter[];
}) {
  const { items: actionItems, notificationKeys: actionItemKeys } =
    deriveInboxState({
      drafts: input.drafts,
      projects: input.projects,
      tickets: input.tickets,
      sessionsById: input.sessionsById,
      ticketAiReviewActiveById: input.ticketAiReviewActiveById,
      ticketAiReviewResolvedById: input.ticketAiReviewResolvedById,
    });
  const unreadInboxItemKeys = new Set(
    actionItems
      .filter(
        (item) => input.readInboxItemState[item.key] !== item.notificationKey,
      )
      .map((item) => item.key),
  );

  return {
    actionItemKeys,
    actionItems,
    unreadActionItemCount: unreadInboxItemKeys.size,
    unreadInboxItemKeys,
  };
}

export function resolveProjectOptionsViewState(input: {
  projectDeleteConfirmText: string;
  projectOptionsAutomaticAgentReview: boolean;
  projectOptionsAutomaticAgentReviewRunLimit: number;
  projectOptionsBranchChoices: RepositoryBranchChoices[];
  projectOptionsColor: string;
  projectOptionsColorManuallySelected: boolean;
  projectOptionsDefaultReviewAction: ReviewAction;
  projectOptionsDisabledMcpServers: string[];
  projectOptionsDraftAgentAdapter: Project["draft_analysis_agent_adapter"];
  projectOptionsDraftModelCustom: string;
  projectOptionsDraftModelPreset: ProjectModelPreset;
  projectOptionsDraftReasoningEffort: ProjectReasoningEffortSelection;
  projectOptionsProjectId: string | null;
  projectOptionsRepositories: RepositoryConfig[];
  projectOptionsRepositoryTargetBranches: Record<string, string>;
  projectOptionsRepositoryValidationCommands: Record<
    string,
    ValidationCommand[]
  >;
  projectOptionsTicketAgentAdapter: Project["ticket_work_agent_adapter"];
  projectOptionsTicketModelCustom: string;
  projectOptionsTicketModelPreset: ProjectModelPreset;
  projectOptionsTicketReasoningEffort: ProjectReasoningEffortSelection;
  projectOptionsWorktreeInitCommand: string;
  projectOptionsWorktreeInitRunSequential: boolean;
  projectOptionsPreviewStartCommand: string;
  projectOptionsWorktreeTeardownCommand: string;
  projectRecords: Project[];
}) {
  const projectOptionsProject =
    input.projectRecords.find(
      (project) => project.id === input.projectOptionsProjectId,
    ) ?? null;
  const projectOptionsBranchesByRepositoryId = new Map<
    string,
    RepositoryBranchChoices
  >(
    input.projectOptionsBranchChoices.map((repositoryBranches) => [
      repositoryBranches.repository_id,
      repositoryBranches,
    ]),
  );
  const projectOptionsDraftModelValue = resolveProjectModelValue(
    input.projectOptionsDraftModelPreset,
    input.projectOptionsDraftModelCustom,
  );
  const projectOptionsDraftReasoningEffortValue =
    resolveProjectReasoningEffortValue(
      input.projectOptionsDraftReasoningEffort,
    );
  const projectOptionsTicketModelValue = resolveProjectModelValue(
    input.projectOptionsTicketModelPreset,
    input.projectOptionsTicketModelCustom,
  );
  const projectOptionsTicketReasoningEffortValue =
    resolveProjectReasoningEffortValue(
      input.projectOptionsTicketReasoningEffort,
    );
  const projectOptionsWorktreeInitCommandValue =
    resolveOptionalProjectCommandValue(input.projectOptionsWorktreeInitCommand);
  const projectOptionsPreviewStartCommandValue =
    resolveOptionalProjectCommandValue(input.projectOptionsPreviewStartCommand);
  const projectOptionsWorktreeTeardownCommandValue =
    resolveOptionalProjectCommandValue(
      input.projectOptionsWorktreeTeardownCommand,
    );
  const projectOptionsRepositoryBranchesDirty =
    hasRepositoryTargetBranchChanges({
      project: projectOptionsProject,
      repositories: input.projectOptionsRepositories,
      repositoryTargetBranches: input.projectOptionsRepositoryTargetBranches,
    });
  const projectOptionsValidationCommandsDirty =
    hasRepositoryValidationCommandChanges({
      repositories: input.projectOptionsRepositories,
      repositoryValidationCommands:
        input.projectOptionsRepositoryValidationCommands,
    });
  const { persistedColor: projectOptionsPersistedColor, swatchColor } =
    resolveProjectOptionsColors({
      color: input.projectOptionsColor,
      colorManuallySelected: input.projectOptionsColorManuallySelected,
      project: projectOptionsProject,
    });
  const projectOptionsDirty = hasProjectOptionsDirty({
    color: projectOptionsPersistedColor,
    draftModelValue: projectOptionsDraftModelValue,
    draftReasoningEffortValue: projectOptionsDraftReasoningEffortValue,
    disabledMcpServers: input.projectOptionsDisabledMcpServers,
    previewStartCommandValue: projectOptionsPreviewStartCommandValue,
    project: projectOptionsProject,
    projectOptionsAutomaticAgentReview:
      input.projectOptionsAutomaticAgentReview,
    projectOptionsAutomaticAgentReviewRunLimit:
      input.projectOptionsAutomaticAgentReviewRunLimit,
    projectOptionsDefaultReviewAction: input.projectOptionsDefaultReviewAction,
    repositoryBranchesDirty: projectOptionsRepositoryBranchesDirty,
    validationCommandsDirty: projectOptionsValidationCommandsDirty,
    selectedDraftAgentAdapter: input.projectOptionsDraftAgentAdapter,
    selectedTicketAgentAdapter: input.projectOptionsTicketAgentAdapter,
    ticketModelValue: projectOptionsTicketModelValue,
    ticketReasoningEffortValue: projectOptionsTicketReasoningEffortValue,
    worktreeInitCommandValue: projectOptionsWorktreeInitCommandValue,
    worktreeInitRunSequential: input.projectOptionsWorktreeInitRunSequential,
    worktreeTeardownCommandValue: projectOptionsWorktreeTeardownCommandValue,
  });

  return {
    canDeleteProject:
      projectOptionsProject !== null &&
      input.projectDeleteConfirmText.trim() === projectOptionsProject.slug,
    projectOptionsBranchesByRepositoryId,
    projectOptionsBranchChoices: input.projectOptionsBranchChoices,
    projectOptionsDirty,
    projectOptionsDraftModelValue,
    projectOptionsDraftReasoningEffortValue,
    projectOptionsPersistedColor,
    projectOptionsPreviewStartCommandValue,
    projectOptionsProject,
    projectOptionsRepositories: input.projectOptionsRepositories,
    projectOptionsRepositoryBranchesDirty,
    projectOptionsRepositoryValidationCommands:
      input.projectOptionsRepositoryValidationCommands,
    projectOptionsTicketModelValue,
    projectOptionsTicketReasoningEffortValue,
    projectOptionsWorktreeInitCommandValue,
    projectOptionsWorktreeTeardownCommandValue,
    projectOptionsColor: swatchColor,
    projectOptionsValidationCommandsDirty,
  };
}

export function resolveDraftEditorViewState(input: {
  draftEditorAcceptanceCriteria: string;
  draftEditorDescription: string;
  draftEditorProjectId: string | null;
  draftEditorTicketType: DraftTicketState["proposed_ticket_type"];
  draftEditorTitle: string;
  draftEventsQueryData: DraftEventsResponse | undefined;
  draftRecords: DraftTicketState[];
  inspectorKind: "draft" | "hidden" | "new_draft" | "session" | "ticket";
  projectRecords: Project[];
  repositories: RepositoryConfig[];
  draftEditorRepositoriesQueryData: RepositoriesResponse | undefined;
  selectedDraftId: string | null;
  selectedProjectId: string | null;
}) {
  const draftEditorProject =
    input.projectRecords.find(
      (project) => project.id === input.draftEditorProjectId,
    ) ?? null;
  const draftEditorRepositories =
    input.draftEditorProjectId !== null &&
    input.draftEditorProjectId === input.selectedProjectId
      ? input.repositories
      : (input.draftEditorRepositoriesQueryData?.repositories ?? []);
  const draftEditorRepository = draftEditorRepositories[0] ?? null;
  const selectedDraft =
    input.draftRecords.find((draft) => draft.id === input.selectedDraftId) ??
    null;
  const selectedDraftRepository =
    selectedDraft === null
      ? null
      : (input.repositories.find(
          (repository) =>
            repository.id ===
            (selectedDraft.confirmed_repo_id ?? selectedDraft.proposed_repo_id),
        ) ??
        input.repositories[0] ??
        null);
  const draftEditorAcceptanceCriteriaLines = sanitizeDraftAcceptanceCriteria(
    input.draftEditorAcceptanceCriteria,
  );
  const draftEditorCanPersist =
    input.draftEditorTitle.trim().length > 0 &&
    input.draftEditorDescription.trim().length > 0;
  const draftFormDirty =
    selectedDraft !== null &&
    (input.draftEditorTitle !== selectedDraft.title_draft ||
      input.draftEditorDescription !== selectedDraft.description_draft ||
      input.draftEditorTicketType !== selectedDraft.proposed_ticket_type ||
      !arraysEqual(
        draftEditorAcceptanceCriteriaLines,
        selectedDraft.proposed_acceptance_criteria,
      ));
  const newDraftFormDirty =
    input.inspectorKind === "new_draft" &&
    (input.draftEditorTitle.trim().length > 0 ||
      input.draftEditorDescription.trim().length > 0 ||
      input.draftEditorAcceptanceCriteria.trim().length > 0 ||
      input.draftEditorTicketType !== "feature");
  const draftEvents = input.draftEventsQueryData?.events ?? [];
  const latestDraftEvent = draftEvents.at(0) ?? null;
  const latestDraftEventMeta = latestDraftEvent
    ? parseDraftEventMeta(latestDraftEvent)
    : null;
  const latestRevertableRefineEvent =
    findLatestRevertableRefineEvent(draftEvents);
  const draftAnalysisActive = input.draftEventsQueryData?.active_run ?? false;
  const latestQuestionsEvent = draftEvents.find(
    (event) => event.event_type === "draft.questions.completed",
  );
  const latestQuestionsResult = latestQuestionsEvent
    ? parseDraftQuestionsResult(latestQuestionsEvent.payload.result)
    : null;

  return {
    draftAnalysisActive,
    draftEditorAcceptanceCriteriaLines,
    draftEditorCanPersist,
    draftEditorProject,
    draftEditorRepositories,
    draftEditorRepository,
    draftFormDirty,
    draftEvents,
    latestDraftEventMeta,
    latestQuestionsResult,
    latestRevertableRefineEvent,
    newDraftFormDirty,
    selectedDraft,
    selectedDraftRepository,
  };
}

export function resolveSessionReviewState(input: {
  reviewPackage: ReviewPackage | null;
  reviewRuns: ReviewRun[];
  selectedSessionId: string | null;
  selectedTicketId: number | null;
  sessionAttempts: ExecutionAttempt[];
  sessionLogs: string[];
  sessionQueryData: SessionResponse | undefined;
  sessionSummaries: Array<{
    data: SessionResponse | undefined;
    error: { message: string } | null;
    isError: boolean;
    isPending: boolean;
  }>;
  ticketEvents: StructuredEvent[];
  ticketWorkspaceDiff: TicketWorkspaceDiff | null;
  tickets: TicketFrontmatter[];
  latestReviewRun: ReviewRun | null;
}) {
  const session = input.sessionQueryData?.session ?? null;
  const selectedSessionTicket =
    input.tickets.find(
      (ticket) => ticket.session_id === input.selectedSessionId,
    ) ?? null;
  const selectedInspectorTicket =
    input.tickets.find((ticket) => ticket.id === input.selectedTicketId) ??
    null;
  const sessionById = new Map(
    input.sessionSummaries
      .map((query) => query.data?.session)
      .filter((value): value is ExecutionSession => value !== undefined)
      .map((item) => [item.id, item]),
  );
  const sessionSummaryStateById = buildSessionSummaryStateById({
    sessionSummaries: input.sessionSummaries,
    tickets: input.tickets,
  });
  const agentControlsWorktreeBySessionId = new Map(
    input.sessionSummaries
      .map((query) => query.data)
      .filter((value): value is SessionResponse => value !== undefined)
      .map((item) => [item.session.id, item.agent_controls_worktree]),
  );
  const selectedSessionTicketSession = selectedSessionTicket?.session_id
    ? (sessionById.get(selectedSessionTicket.session_id) ?? session)
    : session;

  return {
    agentControlsWorktreeBySessionId,
    latestReviewRun: input.latestReviewRun,
    reviewPackage: input.reviewPackage,
    reviewRuns: input.reviewRuns,
    selectedInspectorTicket,
    selectedSessionTicket,
    selectedSessionTicketSession,
    session,
    sessionAttempts: input.sessionAttempts,
    sessionById,
    sessionLogs: input.sessionLogs,
    sessionSummaryStateById,
    ticketEvents: input.ticketEvents,
    ticketWorkspaceDiff: input.ticketWorkspaceDiff,
  };
}
