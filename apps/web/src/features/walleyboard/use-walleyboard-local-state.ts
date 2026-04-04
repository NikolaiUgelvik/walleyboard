import { useState } from "react";
import type {
  AgentAdapter,
  DraftTicketState,
  ExecutionBackend,
  ReviewAction,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import type { PendingDraftEditorSync } from "../../lib/draft-editor-sync.js";
import { readDiffLayoutPreference } from "./shared-api.js";
import type {
  InspectorState,
  NewDraftAction,
  ProjectModelPreset,
  ProjectReasoningEffortSelection,
  WorkspaceModalKind,
  WorkspaceTerminalContext,
} from "./shared-types.js";

export function useProjectOptionsState() {
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectOptionsColor, setProjectOptionsColor] = useState("");
  const [projectOptionsProjectId, setProjectOptionsProjectId] = useState<
    string | null
  >(null);
  const [projectOptionsAgentAdapter, setProjectOptionsAgentAdapter] =
    useState<AgentAdapter>("codex");
  const [projectOptionsExecutionBackend, setProjectOptionsExecutionBackend] =
    useState<ExecutionBackend>("host");
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
    projectOptionsColor,
    projectOptionsAgentAdapter,
    projectOptionsAutomaticAgentReview,
    projectOptionsAutomaticAgentReviewRunLimit,
    projectOptionsDefaultReviewAction,
    projectOptionsDisabledMcpServers,
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
    setProjectOptionsColor,
    setProjectOptionsAgentAdapter,
    setProjectOptionsAutomaticAgentReview,
    setProjectOptionsAutomaticAgentReviewRunLimit,
    setProjectOptionsDefaultReviewAction,
    setProjectOptionsDisabledMcpServers,
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
  };
}

export function useDraftWorkspaceState() {
  const [inspectorState, setInspectorState] = useState<InspectorState>({
    kind: "hidden",
  });
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
  const [workspaceModal, setWorkspaceModal] =
    useState<WorkspaceModalKind | null>(null);
  const [workspaceTicket, setWorkspaceTicket] =
    useState<TicketFrontmatter | null>(null);
  const [workspaceTerminalContext, setWorkspaceTerminalContext] =
    useState<WorkspaceTerminalContext | null>(null);
  const [ticketWorkspaceDiffLayout, setTicketWorkspaceDiffLayout] = useState<
    "split" | "stacked"
  >(() => readDiffLayoutPreference());
  const [boardSearch, setBoardSearch] = useState("");

  return {
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
  };
}
