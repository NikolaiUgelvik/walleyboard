import type { WalleyBoardController } from "./use-walleyboard-controller.js";

export type WalleyBoardShellState = Pick<
  WalleyBoardController,
  "inspectorVisible" | "selectedProject"
>;

export type ProjectRailController = Pick<
  WalleyBoardController,
  | "actionItems"
  | "markAllInboxItemsAsRead"
  | "openInboxItem"
  | "openProjectModal"
  | "openProjectOptions"
  | "projectsQuery"
  | "readInboxItemState"
  | "selectProject"
  | "selectedProjectId"
  | "unreadActionItemCount"
>;

export type BoardViewController = Pick<
  WalleyBoardController,
  | "archiveActionFeedback"
  | "archiveDoneTickets"
  | "archiveDoneTicketsMutation"
  | "archiveModalOpen"
  | "archiveTicket"
  | "archiveTicketMutation"
  | "boardError"
  | "boardLoading"
  | "boardSearch"
  | "createPullRequestMutation"
  | "deleteTicket"
  | "deleteTicketMutation"
  | "doneColumnTickets"
  | "editReadyTicket"
  | "editReadyTicketMutation"
  | "groupedTickets"
  | "handleSelectedRepositoryPreviewAction"
  | "handleTicketPreviewAction"
  | "hideInspector"
  | "inspectorState"
  | "isDraftRefinementActive"
  | "mergeTicketMutation"
  | "navigateToTicketReference"
  | "openArchiveModal"
  | "openDraft"
  | "openNewDraft"
  | "openSelectedRepositoryWorkspaceTerminal"
  | "openTicketSession"
  | "openTicketWorkspaceModal"
  | "previewActionErrorByTicketId"
  | "repositories"
  | "repositoryPreviewActionError"
  | "repositoryPreviewActionPending"
  | "repositoryTerminalPending"
  | "repositoryWorkspacePreview"
  | "restartTicketFromScratch"
  | "restartTicketMutation"
  | "resumeTicketMutation"
  | "selectedDraftId"
  | "selectedProject"
  | "selectedRepository"
  | "selectedSessionId"
  | "session"
  | "sessionById"
  | "sessionSummaryStateById"
  | "setBoardSearch"
  | "startAgentReviewMutation"
  | "startTicketMutation"
  | "startTicketWorkspacePreviewMutation"
  | "stopAgentReviewMutation"
  | "stopTicketMutation"
  | "stopTicketWorkspacePreviewMutation"
  | "ticketAiReviewActiveById"
  | "ticketDiffLineSummaryByTicketId"
  | "ticketWorkspacePreviewByTicketId"
  | "visibleDrafts"
>;

export type InspectorPaneController = Pick<
  WalleyBoardController,
  | "confirmDraftMutation"
  | "createDraftMutation"
  | "createPullRequestMutation"
  | "deleteDraftMutation"
  | "deleteTicket"
  | "deleteTicketMutation"
  | "draftAnalysisActive"
  | "draftEditorAcceptanceCriteria"
  | "draftEditorAcceptanceCriteriaLines"
  | "draftEditorCanPersist"
  | "draftEditorDescription"
  | "draftEditorProject"
  | "draftEditorRepository"
  | "draftEditorTicketType"
  | "draftEditorTitle"
  | "draftEditorUploadError"
  | "draftEvents"
  | "draftEventsQuery"
  | "draftFormDirty"
  | "globalTickets"
  | "handleConfirmNewDraft"
  | "handleQuestionNewDraft"
  | "handleRefineNewDraft"
  | "handleSaveNewDraft"
  | "hideInspector"
  | "inspectorState"
  | "inspectorVisible"
  | "isDraftRefinementActive"
  | "latestQuestionsResult"
  | "latestRevertableRefineEvent"
  | "latestReviewRun"
  | "latestReviewRunQuery"
  | "mergeTicketMutation"
  | "navigateToTicketReference"
  | "openAgentReviewHistoryModal"
  | "openTicketWorkspaceModal"
  | "pendingNewDraftAction"
  | "planFeedbackBody"
  | "planFeedbackMutation"
  | "questionDraftMutation"
  | "refineDraftMutation"
  | "repositories"
  | "requestChangesMutation"
  | "requestedChangesBody"
  | "restartTicketFromScratch"
  | "restartTicketMutation"
  | "resumeReason"
  | "resumeTicketMutation"
  | "revertDraftRefineMutation"
  | "reviewPackage"
  | "reviewPackageQuery"
  | "saveDraftMutation"
  | "selectedDraft"
  | "selectedDraftRepository"
  | "selectedProject"
  | "selectedSessionId"
  | "selectedSessionTicket"
  | "selectedSessionTicketSession"
  | "session"
  | "sessionInputMutation"
  | "sessionLogs"
  | "sessionLogsQuery"
  | "sessionQuery"
  | "setDraftEditorAcceptanceCriteria"
  | "setDraftEditorDescription"
  | "setDraftEditorTicketType"
  | "setDraftEditorTitle"
  | "setPendingDraftEditorSync"
  | "setPlanFeedbackBody"
  | "setRequestedChangesBody"
  | "setResumeReason"
  | "startAgentReviewMutation"
  | "stopAgentReviewMutation"
  | "stopTicketMutation"
  | "uploadDraftEditorImage"
  | "uploadDraftArtifactMutation"
>;

export type WalleyBoardModalsController = Pick<
  WalleyBoardController,
  | "agentReviewHistoryModalOpen"
  | "archiveActionFeedback"
  | "archiveModalOpen"
  | "archivedTicketsQuery"
  | "cancelDiscardDraft"
  | "canDeleteProject"
  | "closeAgentReviewHistoryModal"
  | "closeArchiveModal"
  | "confirmDiscardDraft"
  | "closeProjectModal"
  | "closeProjectOptionsModal"
  | "closeWorkspaceModal"
  | "codexMcpServers"
  | "createProjectMutation"
  | "defaultBranch"
  | "deleteProjectMutation"
  | "discardDraftConfirmOpen"
  | "dockerHealth"
  | "healthQuery"
  | "openArchivedTicketDiff"
  | "projectColor"
  | "projectDeleteConfirmText"
  | "projectModalOpen"
  | "projectName"
  | "projectOptionsDraftAgentAdapter"
  | "projectOptionsTicketAgentAdapter"
  | "projectOptionsAutomaticAgentReview"
  | "projectOptionsAutomaticAgentReviewRunLimit"
  | "projectOptionsBranchesByRepositoryId"
  | "projectOptionsBranchesQuery"
  | "projectOptionsColor"
  | "projectOptionsDefaultReviewAction"
  | "projectOptionsDirty"
  | "projectOptionsDisabledMcpServers"
  | "projectOptionsDraftModelCustom"
  | "projectOptionsDraftModelPreset"
  | "projectOptionsDraftReasoningEffort"
  | "projectOptionsFormError"
  | "projectOptionsWorktreeTeardownCommand"
  | "projectOptionsWorktreeInitCommand"
  | "projectOptionsWorktreeInitRunSequential"
  | "projectOptionsPreviewStartCommand"
  | "projectOptionsProject"
  | "projectOptionsRepositories"
  | "projectOptionsRepositoriesQuery"
  | "projectOptionsRepositoryTargetBranches"
  | "projectOptionsRepositoryValidationCommands"
  | "projectOptionsTicketModelCustom"
  | "projectOptionsTicketModelPreset"
  | "projectOptionsTicketReasoningEffort"
  | "refreshProjectOptionsBranches"
  | "restoreTicketMutation"
  | "reviewRuns"
  | "reviewRunsQuery"
  | "repositoryPath"
  | "saveProjectOptions"
  | "selectedSessionTicket"
  | "selectedSessionTicketSession"
  | "session"
  | "sessionAttempts"
  | "sessionAttemptsQuery"
  | "sessionLogs"
  | "sessionLogsQuery"
  | "sessionQuery"
  | "setDefaultBranch"
  | "setProjectColor"
  | "setProjectDeleteConfirmText"
  | "setProjectName"
  | "setProjectOptionsDraftAgentAdapter"
  | "setProjectOptionsTicketAgentAdapter"
  | "setProjectOptionsAutomaticAgentReview"
  | "setProjectOptionsAutomaticAgentReviewRunLimit"
  | "setProjectOptionsColor"
  | "setProjectOptionsDefaultReviewAction"
  | "setProjectOptionsDisabledMcpServers"
  | "setProjectOptionsDraftModelCustom"
  | "setProjectOptionsDraftModelPreset"
  | "setProjectOptionsDraftReasoningEffort"
  | "setProjectOptionsFormError"
  | "setProjectOptionsWorktreeTeardownCommand"
  | "setProjectOptionsWorktreeInitCommand"
  | "setProjectOptionsWorktreeInitRunSequential"
  | "setProjectOptionsPreviewStartCommand"
  | "setProjectOptionsRepositoryTargetBranches"
  | "setProjectOptionsRepositoryValidationCommands"
  | "setProjectOptionsTicketModelCustom"
  | "setProjectOptionsTicketModelPreset"
  | "setProjectOptionsTicketReasoningEffort"
  | "setRepositoryPath"
  | "setTicketWorkspaceDiffLayout"
  | "setValidationCommandsText"
  | "ticketEvents"
  | "ticketEventsQuery"
  | "ticketWorkspaceDiff"
  | "ticketWorkspaceDiffLayout"
  | "ticketWorkspaceDiffQuery"
  | "updateProjectMutation"
  | "validationCommandsText"
  | "workspaceModal"
  | "workspaceTerminalContext"
>;

export type WalleyBoardViewState = {
  boardView: BoardViewController;
  inspectorPane: InspectorPaneController;
  modals: WalleyBoardModalsController;
  projectRail: ProjectRailController;
  shell: WalleyBoardShellState;
};

export function createWalleyBoardViewState(
  controller: WalleyBoardController,
): WalleyBoardViewState {
  const shell: WalleyBoardShellState = {
    inspectorVisible: controller.inspectorVisible,
    selectedProject: controller.selectedProject,
  };

  const projectRail: ProjectRailController = {
    actionItems: controller.actionItems,
    markAllInboxItemsAsRead: controller.markAllInboxItemsAsRead,
    openInboxItem: controller.openInboxItem,
    openProjectModal: controller.openProjectModal,
    openProjectOptions: controller.openProjectOptions,
    projectsQuery: controller.projectsQuery,
    readInboxItemState: controller.readInboxItemState,
    selectProject: controller.selectProject,
    selectedProjectId: controller.selectedProjectId,
    unreadActionItemCount: controller.unreadActionItemCount,
  };

  const boardView: BoardViewController = {
    archiveActionFeedback: controller.archiveActionFeedback,
    archiveDoneTickets: controller.archiveDoneTickets,
    archiveDoneTicketsMutation: controller.archiveDoneTicketsMutation,
    archiveModalOpen: controller.archiveModalOpen,
    archiveTicket: controller.archiveTicket,
    archiveTicketMutation: controller.archiveTicketMutation,
    boardError: controller.boardError,
    boardLoading: controller.boardLoading,
    boardSearch: controller.boardSearch,
    createPullRequestMutation: controller.createPullRequestMutation,
    deleteTicket: controller.deleteTicket,
    deleteTicketMutation: controller.deleteTicketMutation,
    doneColumnTickets: controller.doneColumnTickets,
    editReadyTicket: controller.editReadyTicket,
    editReadyTicketMutation: controller.editReadyTicketMutation,
    groupedTickets: controller.groupedTickets,
    handleSelectedRepositoryPreviewAction:
      controller.handleSelectedRepositoryPreviewAction,
    handleTicketPreviewAction: controller.handleTicketPreviewAction,
    hideInspector: controller.hideInspector,
    inspectorState: controller.inspectorState,
    isDraftRefinementActive: controller.isDraftRefinementActive,
    mergeTicketMutation: controller.mergeTicketMutation,
    navigateToTicketReference: controller.navigateToTicketReference,
    openArchiveModal: controller.openArchiveModal,
    openDraft: controller.openDraft,
    openNewDraft: controller.openNewDraft,
    openSelectedRepositoryWorkspaceTerminal:
      controller.openSelectedRepositoryWorkspaceTerminal,
    openTicketSession: controller.openTicketSession,
    openTicketWorkspaceModal: controller.openTicketWorkspaceModal,
    previewActionErrorByTicketId: controller.previewActionErrorByTicketId,
    repositories: controller.repositories,
    repositoryPreviewActionError: controller.repositoryPreviewActionError,
    repositoryPreviewActionPending: controller.repositoryPreviewActionPending,
    repositoryTerminalPending: controller.repositoryTerminalPending,
    repositoryWorkspacePreview: controller.repositoryWorkspacePreview,
    restartTicketFromScratch: controller.restartTicketFromScratch,
    restartTicketMutation: controller.restartTicketMutation,
    resumeTicketMutation: controller.resumeTicketMutation,
    selectedDraftId: controller.selectedDraftId,
    selectedProject: controller.selectedProject,
    selectedRepository: controller.selectedRepository,
    selectedSessionId: controller.selectedSessionId,
    session: controller.session,
    sessionById: controller.sessionById,
    sessionSummaryStateById: controller.sessionSummaryStateById,
    setBoardSearch: controller.setBoardSearch,
    startAgentReviewMutation: controller.startAgentReviewMutation,
    startTicketMutation: controller.startTicketMutation,
    startTicketWorkspacePreviewMutation:
      controller.startTicketWorkspacePreviewMutation,
    stopAgentReviewMutation: controller.stopAgentReviewMutation,
    stopTicketMutation: controller.stopTicketMutation,
    stopTicketWorkspacePreviewMutation:
      controller.stopTicketWorkspacePreviewMutation,
    ticketAiReviewActiveById: controller.ticketAiReviewActiveById,
    ticketDiffLineSummaryByTicketId: controller.ticketDiffLineSummaryByTicketId,
    ticketWorkspacePreviewByTicketId:
      controller.ticketWorkspacePreviewByTicketId,
    visibleDrafts: controller.visibleDrafts,
  };

  const inspectorPane: InspectorPaneController = {
    confirmDraftMutation: controller.confirmDraftMutation,
    createDraftMutation: controller.createDraftMutation,
    createPullRequestMutation: controller.createPullRequestMutation,
    deleteDraftMutation: controller.deleteDraftMutation,
    deleteTicket: controller.deleteTicket,
    deleteTicketMutation: controller.deleteTicketMutation,
    draftAnalysisActive: controller.draftAnalysisActive,
    draftEditorAcceptanceCriteria: controller.draftEditorAcceptanceCriteria,
    draftEditorAcceptanceCriteriaLines:
      controller.draftEditorAcceptanceCriteriaLines,
    draftEditorCanPersist: controller.draftEditorCanPersist,
    draftEditorDescription: controller.draftEditorDescription,
    draftEditorProject: controller.draftEditorProject,
    draftEditorRepository: controller.draftEditorRepository,
    draftEditorTicketType: controller.draftEditorTicketType,
    draftEditorTitle: controller.draftEditorTitle,
    draftEditorUploadError: controller.draftEditorUploadError,
    draftEvents: controller.draftEvents,
    draftEventsQuery: controller.draftEventsQuery,
    draftFormDirty: controller.draftFormDirty,
    globalTickets: controller.globalTickets,
    handleConfirmNewDraft: controller.handleConfirmNewDraft,
    handleQuestionNewDraft: controller.handleQuestionNewDraft,
    handleRefineNewDraft: controller.handleRefineNewDraft,
    handleSaveNewDraft: controller.handleSaveNewDraft,
    hideInspector: controller.hideInspector,
    inspectorState: controller.inspectorState,
    inspectorVisible: controller.inspectorVisible,
    isDraftRefinementActive: controller.isDraftRefinementActive,
    latestQuestionsResult: controller.latestQuestionsResult,
    latestRevertableRefineEvent: controller.latestRevertableRefineEvent,
    latestReviewRun: controller.latestReviewRun,
    latestReviewRunQuery: controller.latestReviewRunQuery,
    mergeTicketMutation: controller.mergeTicketMutation,
    navigateToTicketReference: controller.navigateToTicketReference,
    openAgentReviewHistoryModal: controller.openAgentReviewHistoryModal,
    openTicketWorkspaceModal: controller.openTicketWorkspaceModal,
    pendingNewDraftAction: controller.pendingNewDraftAction,
    planFeedbackBody: controller.planFeedbackBody,
    planFeedbackMutation: controller.planFeedbackMutation,
    questionDraftMutation: controller.questionDraftMutation,
    refineDraftMutation: controller.refineDraftMutation,
    repositories: controller.repositories,
    requestChangesMutation: controller.requestChangesMutation,
    requestedChangesBody: controller.requestedChangesBody,
    restartTicketFromScratch: controller.restartTicketFromScratch,
    restartTicketMutation: controller.restartTicketMutation,
    resumeReason: controller.resumeReason,
    resumeTicketMutation: controller.resumeTicketMutation,
    revertDraftRefineMutation: controller.revertDraftRefineMutation,
    reviewPackage: controller.reviewPackage,
    reviewPackageQuery: controller.reviewPackageQuery,
    saveDraftMutation: controller.saveDraftMutation,
    selectedDraft: controller.selectedDraft,
    selectedDraftRepository: controller.selectedDraftRepository,
    selectedProject: controller.selectedProject,
    selectedSessionId: controller.selectedSessionId,
    selectedSessionTicket: controller.selectedSessionTicket,
    selectedSessionTicketSession: controller.selectedSessionTicketSession,
    session: controller.session,
    sessionInputMutation: controller.sessionInputMutation,
    sessionLogs: controller.sessionLogs,
    sessionLogsQuery: controller.sessionLogsQuery,
    sessionQuery: controller.sessionQuery,
    setDraftEditorAcceptanceCriteria:
      controller.setDraftEditorAcceptanceCriteria,
    setDraftEditorDescription: controller.setDraftEditorDescription,
    setDraftEditorTicketType: controller.setDraftEditorTicketType,
    setDraftEditorTitle: controller.setDraftEditorTitle,
    setPendingDraftEditorSync: controller.setPendingDraftEditorSync,
    setPlanFeedbackBody: controller.setPlanFeedbackBody,
    setRequestedChangesBody: controller.setRequestedChangesBody,
    setResumeReason: controller.setResumeReason,
    startAgentReviewMutation: controller.startAgentReviewMutation,
    stopAgentReviewMutation: controller.stopAgentReviewMutation,
    stopTicketMutation: controller.stopTicketMutation,
    uploadDraftEditorImage: controller.uploadDraftEditorImage,
    uploadDraftArtifactMutation: controller.uploadDraftArtifactMutation,
  };

  const modals: WalleyBoardModalsController = {
    agentReviewHistoryModalOpen: controller.agentReviewHistoryModalOpen,
    archiveActionFeedback: controller.archiveActionFeedback,
    archiveModalOpen: controller.archiveModalOpen,
    archivedTicketsQuery: controller.archivedTicketsQuery,
    cancelDiscardDraft: controller.cancelDiscardDraft,
    canDeleteProject: controller.canDeleteProject,
    closeAgentReviewHistoryModal: controller.closeAgentReviewHistoryModal,
    confirmDiscardDraft: controller.confirmDiscardDraft,
    closeArchiveModal: controller.closeArchiveModal,
    closeProjectModal: controller.closeProjectModal,
    closeProjectOptionsModal: controller.closeProjectOptionsModal,
    closeWorkspaceModal: controller.closeWorkspaceModal,
    codexMcpServers: controller.codexMcpServers,
    createProjectMutation: controller.createProjectMutation,
    defaultBranch: controller.defaultBranch,
    deleteProjectMutation: controller.deleteProjectMutation,
    discardDraftConfirmOpen: controller.discardDraftConfirmOpen,
    dockerHealth: controller.dockerHealth,
    healthQuery: controller.healthQuery,
    openArchivedTicketDiff: controller.openArchivedTicketDiff,
    projectColor: controller.projectColor,
    projectDeleteConfirmText: controller.projectDeleteConfirmText,
    projectModalOpen: controller.projectModalOpen,
    projectName: controller.projectName,
    projectOptionsDraftAgentAdapter: controller.projectOptionsDraftAgentAdapter,
    projectOptionsTicketAgentAdapter:
      controller.projectOptionsTicketAgentAdapter,
    projectOptionsAutomaticAgentReview:
      controller.projectOptionsAutomaticAgentReview,
    projectOptionsAutomaticAgentReviewRunLimit:
      controller.projectOptionsAutomaticAgentReviewRunLimit,
    projectOptionsBranchesByRepositoryId:
      controller.projectOptionsBranchesByRepositoryId,
    projectOptionsBranchesQuery: controller.projectOptionsBranchesQuery,
    projectOptionsColor: controller.projectOptionsColor,
    projectOptionsDefaultReviewAction:
      controller.projectOptionsDefaultReviewAction,
    projectOptionsDirty: controller.projectOptionsDirty,
    projectOptionsDisabledMcpServers:
      controller.projectOptionsDisabledMcpServers,
    projectOptionsDraftModelCustom: controller.projectOptionsDraftModelCustom,
    projectOptionsDraftModelPreset: controller.projectOptionsDraftModelPreset,
    projectOptionsDraftReasoningEffort:
      controller.projectOptionsDraftReasoningEffort,
    projectOptionsFormError: controller.projectOptionsFormError,
    projectOptionsWorktreeTeardownCommand:
      controller.projectOptionsWorktreeTeardownCommand,
    projectOptionsWorktreeInitCommand:
      controller.projectOptionsWorktreeInitCommand,
    projectOptionsWorktreeInitRunSequential:
      controller.projectOptionsWorktreeInitRunSequential,
    projectOptionsPreviewStartCommand:
      controller.projectOptionsPreviewStartCommand,
    projectOptionsProject: controller.projectOptionsProject,
    projectOptionsRepositories: controller.projectOptionsRepositories,
    projectOptionsRepositoriesQuery: controller.projectOptionsRepositoriesQuery,
    projectOptionsRepositoryTargetBranches:
      controller.projectOptionsRepositoryTargetBranches,
    projectOptionsRepositoryValidationCommands:
      controller.projectOptionsRepositoryValidationCommands,
    projectOptionsTicketModelCustom: controller.projectOptionsTicketModelCustom,
    projectOptionsTicketModelPreset: controller.projectOptionsTicketModelPreset,
    projectOptionsTicketReasoningEffort:
      controller.projectOptionsTicketReasoningEffort,
    refreshProjectOptionsBranches: controller.refreshProjectOptionsBranches,
    restoreTicketMutation: controller.restoreTicketMutation,
    reviewRuns: controller.reviewRuns,
    reviewRunsQuery: controller.reviewRunsQuery,
    repositoryPath: controller.repositoryPath,
    saveProjectOptions: controller.saveProjectOptions,
    selectedSessionTicket: controller.selectedSessionTicket,
    selectedSessionTicketSession: controller.selectedSessionTicketSession,
    session: controller.session,
    sessionAttempts: controller.sessionAttempts,
    sessionAttemptsQuery: controller.sessionAttemptsQuery,
    sessionLogs: controller.sessionLogs,
    sessionLogsQuery: controller.sessionLogsQuery,
    sessionQuery: controller.sessionQuery,
    setDefaultBranch: controller.setDefaultBranch,
    setProjectColor: controller.setProjectColor,
    setProjectDeleteConfirmText: controller.setProjectDeleteConfirmText,
    setProjectName: controller.setProjectName,
    setProjectOptionsDraftAgentAdapter:
      controller.setProjectOptionsDraftAgentAdapter,
    setProjectOptionsTicketAgentAdapter:
      controller.setProjectOptionsTicketAgentAdapter,
    setProjectOptionsAutomaticAgentReview:
      controller.setProjectOptionsAutomaticAgentReview,
    setProjectOptionsAutomaticAgentReviewRunLimit:
      controller.setProjectOptionsAutomaticAgentReviewRunLimit,
    setProjectOptionsColor: controller.setProjectOptionsColor,
    setProjectOptionsDefaultReviewAction:
      controller.setProjectOptionsDefaultReviewAction,
    setProjectOptionsDisabledMcpServers:
      controller.setProjectOptionsDisabledMcpServers,
    setProjectOptionsDraftModelCustom:
      controller.setProjectOptionsDraftModelCustom,
    setProjectOptionsDraftModelPreset:
      controller.setProjectOptionsDraftModelPreset,
    setProjectOptionsDraftReasoningEffort:
      controller.setProjectOptionsDraftReasoningEffort,
    setProjectOptionsFormError: controller.setProjectOptionsFormError,
    setProjectOptionsWorktreeTeardownCommand:
      controller.setProjectOptionsWorktreeTeardownCommand,
    setProjectOptionsWorktreeInitCommand:
      controller.setProjectOptionsWorktreeInitCommand,
    setProjectOptionsWorktreeInitRunSequential:
      controller.setProjectOptionsWorktreeInitRunSequential,
    setProjectOptionsPreviewStartCommand:
      controller.setProjectOptionsPreviewStartCommand,
    setProjectOptionsRepositoryTargetBranches:
      controller.setProjectOptionsRepositoryTargetBranches,
    setProjectOptionsRepositoryValidationCommands:
      controller.setProjectOptionsRepositoryValidationCommands,
    setProjectOptionsTicketModelCustom:
      controller.setProjectOptionsTicketModelCustom,
    setProjectOptionsTicketModelPreset:
      controller.setProjectOptionsTicketModelPreset,
    setProjectOptionsTicketReasoningEffort:
      controller.setProjectOptionsTicketReasoningEffort,
    setRepositoryPath: controller.setRepositoryPath,
    setTicketWorkspaceDiffLayout: controller.setTicketWorkspaceDiffLayout,
    setValidationCommandsText: controller.setValidationCommandsText,
    ticketEvents: controller.ticketEvents,
    ticketEventsQuery: controller.ticketEventsQuery,
    ticketWorkspaceDiff: controller.ticketWorkspaceDiff,
    ticketWorkspaceDiffLayout: controller.ticketWorkspaceDiffLayout,
    ticketWorkspaceDiffQuery: controller.ticketWorkspaceDiffQuery,
    updateProjectMutation: controller.updateProjectMutation,
    validationCommandsText: controller.validationCommandsText,
    workspaceModal: controller.workspaceModal,
    workspaceTerminalContext: controller.workspaceTerminalContext,
  };

  return {
    boardView,
    inspectorPane,
    modals,
    projectRail,
    shell,
  };
}
