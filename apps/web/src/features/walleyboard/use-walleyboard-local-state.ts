import { useLocalStorage } from "@mantine/hooks";
import { useState } from "react";
import type {
  AgentAdapter,
  DraftTicketState,
  ReviewAction,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import type { PendingDraftEditorSync } from "../../lib/draft-editor-sync.js";
import { diffLayoutStorageKey } from "./shared-api.js";
import type {
  ArchiveActionFeedback,
  DiffLayout,
  InspectorState,
  NewDraftAction,
  ProjectModelPreset,
  ProjectReasoningEffortSelection,
  WorkspaceModalKind,
  WorkspaceTerminalContext,
} from "./shared-types.js";

export function useProjectSelectionState(input: {
  readInboxItemState: Record<string, string>;
}) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [readInboxItemState, setReadInboxItemState] = useState<
    Record<string, string>
  >(input.readInboxItemState);
  const [projectSelectionHydrated, setProjectSelectionHydrated] =
    useState(false);
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [archiveActionFeedback, setArchiveActionFeedback] =
    useState<ArchiveActionFeedback | null>(null);

  return {
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
  };
}

export function useProjectCreationState(input: { projectColor: string }) {
  const [projectDeleteConfirmText, setProjectDeleteConfirmText] = useState("");
  const [projectColor, setProjectColor] = useState(input.projectColor);
  const [projectColorManuallySelected, setProjectColorManuallySelected] =
    useState(false);
  const [projectColorNeedsRefresh, setProjectColorNeedsRefresh] =
    useState(false);
  const [projectName, setProjectName] = useState("");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [validationCommandsText, setValidationCommandsText] = useState("");

  return {
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
  };
}

export function useProjectOptionsState() {
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectOptionsColor, setProjectOptionsColor] = useState("");
  const [
    projectOptionsColorManuallySelected,
    setProjectOptionsColorManuallySelected,
  ] = useState(false);
  const [projectOptionsProjectId, setProjectOptionsProjectId] = useState<
    string | null
  >(null);
  const [projectOptionsAgentAdapter, setProjectOptionsAgentAdapter] =
    useState<AgentAdapter>("codex");
  const [
    projectOptionsDisabledMcpServers,
    setProjectOptionsDisabledMcpServers,
  ] = useState<string[]>([]);
  const [
    projectOptionsAutomaticAgentReview,
    setProjectOptionsAutomaticAgentReview,
  ] = useState(false);
  const [
    projectOptionsAutomaticAgentReviewRunLimit,
    setProjectOptionsAutomaticAgentReviewRunLimit,
  ] = useState(1);
  const [
    projectOptionsDefaultReviewAction,
    setProjectOptionsDefaultReviewAction,
  ] = useState<ReviewAction>("direct_merge");
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
    projectOptionsPreviewStartCommand,
    setProjectOptionsPreviewStartCommand,
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

  return {
    projectModalOpen,
    projectOptionsAgentAdapter,
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
    setProjectOptionsColor,
    setProjectOptionsColorManuallySelected,
    setProjectOptionsDefaultReviewAction,
    setProjectOptionsDisabledMcpServers,
    setProjectOptionsDraftModelCustom,
    setProjectOptionsDraftModelPreset,
    setProjectOptionsDraftReasoningEffort,
    setProjectOptionsFormError,
    setProjectOptionsPostWorktreeCommand,
    setProjectOptionsPreWorktreeCommand,
    setProjectOptionsPreviewStartCommand,
    setProjectOptionsProjectId,
    setProjectOptionsRepositoryTargetBranches,
    setProjectOptionsTicketModelCustom,
    setProjectOptionsTicketModelPreset,
    setProjectOptionsTicketReasoningEffort,
  };
}

export function useDraftInspectorState() {
  const [inspectorState, setInspectorState] = useState<InspectorState>({
    kind: "hidden",
  });
  const [boardSearch, setBoardSearch] = useState("");

  return {
    boardSearch,
    inspectorState,
    setBoardSearch,
    setInspectorState,
  };
}

export function useDraftEditorState() {
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

  return {
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
  };
}

export function useSessionActionState() {
  const [requestedChangesBody, setRequestedChangesBody] = useState("");
  const [planFeedbackBody, setPlanFeedbackBody] = useState("");
  const [resumeReason, setResumeReason] = useState("");
  const [terminalCommand, setTerminalCommand] = useState("");

  return {
    planFeedbackBody,
    requestedChangesBody,
    resumeReason,
    setPlanFeedbackBody,
    setRequestedChangesBody,
    setResumeReason,
    setTerminalCommand,
    terminalCommand,
  };
}

export function useWorkspaceState() {
  const [workspaceModal, setWorkspaceModal] =
    useState<WorkspaceModalKind | null>(null);
  const [workspaceTicket, setWorkspaceTicket] =
    useState<TicketFrontmatter | null>(null);
  const [workspaceTerminalContext, setWorkspaceTerminalContext] =
    useState<WorkspaceTerminalContext | null>(null);
  const [ticketWorkspaceDiffLayout, setTicketWorkspaceDiffLayout] =
    useLocalStorage<DiffLayout>({
      key: diffLayoutStorageKey,
      defaultValue: "split",
      getInitialValueInEffect: false,
      serialize: (value) => value,
      deserialize: (value) => (value === "stacked" ? "stacked" : "split"),
    });

  return {
    setTicketWorkspaceDiffLayout,
    setWorkspaceModal,
    setWorkspaceTerminalContext,
    setWorkspaceTicket,
    ticketWorkspaceDiffLayout,
    workspaceModal,
    workspaceTerminalContext,
    workspaceTicket,
  };
}
