import type { QueryClient } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import type {
  AgentAdapter,
  CommandAck,
  Project,
  ReasoningEffort,
  RepositoryConfig,
  ReviewAction,
  TicketFrontmatter,
  ValidationCommand,
} from "../../../../../packages/contracts/src/index.js";

import type { PendingDraftEditorSync } from "../../lib/draft-editor-sync.js";
import {
  patchJson,
  postJson,
  saveProjectOptionsRequest,
  uploadDraftArtifactRequest,
} from "./shared-api.js";
import type {
  ArchiveActionFeedback,
  DraftsResponse,
  InspectorState,
  ProjectsResponse,
  ReviewRunResponse,
  ReviewRunsResponse,
  TicketsResponse,
  TicketWorkspacePreviewResponse,
} from "./shared-types.js";
import {
  defaultProjectColor,
  deriveRepositoryName,
  slugify,
  upsertById,
} from "./shared-utils.js";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

type UseWalleyBoardMutationsInput = {
  queryClient: QueryClient;
  pendingDraftEditorSync: PendingDraftEditorSync | null;
  selectedDraftId: string | null;
  selectedProjectId: string | null;
  selectedSessionId: string | null;
  selectProject: (projectId: string | null) => void;
  setArchiveActionFeedback: StateSetter<ArchiveActionFeedback | null>;
  setDefaultBranch: StateSetter<string>;
  setInspectorState: StateSetter<InspectorState>;
  setPendingDraftEditorSync: StateSetter<PendingDraftEditorSync | null>;
  setPlanFeedbackBody: StateSetter<string>;
  setProjectColor: StateSetter<string>;
  setProjectDeleteConfirmText: StateSetter<string>;
  setProjectModalOpen: StateSetter<boolean>;
  setProjectName: StateSetter<string>;
  setProjectOptionsFormError: StateSetter<string | null>;
  setProjectOptionsProjectId: StateSetter<string | null>;
  setProjectOptionsRepositoryTargetBranches: StateSetter<
    Record<string, string>
  >;
  setRepositoryPath: StateSetter<string>;
  setRequestedChangesBody: StateSetter<string>;
  setResumeReason: StateSetter<string>;
  setTerminalCommand: StateSetter<string>;
  setValidationCommandsText: StateSetter<string>;
  tickets: TicketFrontmatter[];
};

export async function saveDraftRequest(input: {
  draftId: string;
  titleDraft: string;
  descriptionDraft: string;
  proposedTicketType: string | null;
  proposedAcceptanceCriteria: string[];
}): Promise<CommandAck> {
  return await patchJson<CommandAck>(`/drafts/${input.draftId}`, {
    title_draft: input.titleDraft,
    description_draft: input.descriptionDraft,
    proposed_ticket_type: input.proposedTicketType,
    proposed_acceptance_criteria: input.proposedAcceptanceCriteria,
  });
}

export async function editReadyTicketRequest(
  ticketId: number,
): Promise<CommandAck> {
  return await postJson<CommandAck>(`/tickets/${ticketId}/edit`, {});
}

export function setOptimisticRunningReviewRun(input: {
  implementationSessionId: string | null;
  queryClient: QueryClient;
  ticketId: number;
}): void {
  const now = new Date().toISOString();

  input.queryClient.setQueryData<ReviewRunResponse | null>(
    ["tickets", input.ticketId, "review-run"],
    (current) => {
      const currentReviewRun = current?.review_run ?? null;

      return {
        review_run: {
          id: currentReviewRun?.id ?? `pending-review-run-${input.ticketId}`,
          ticket_id: input.ticketId,
          review_package_id:
            currentReviewRun?.review_package_id ??
            `pending-review-package-${input.ticketId}`,
          implementation_session_id:
            currentReviewRun?.implementation_session_id ??
            input.implementationSessionId ??
            `pending-implementation-session-${input.ticketId}`,
          status: "running",
          adapter_session_ref: currentReviewRun?.adapter_session_ref ?? null,
          prompt: currentReviewRun?.prompt ?? null,
          report: null,
          failure_message: null,
          created_at: currentReviewRun?.created_at ?? now,
          updated_at: now,
          completed_at: null,
        },
      };
    },
  );
}

export function setStoppedReviewRun(input: {
  failureMessage: string;
  queryClient: QueryClient;
  ticketId: number;
}): void {
  const now = new Date().toISOString();
  let updatedReviewRun: ReviewRunResponse["review_run"] = null;

  input.queryClient.setQueryData<ReviewRunResponse | null>(
    ["tickets", input.ticketId, "review-run"],
    (current) => {
      const currentReviewRun = current?.review_run ?? null;
      if (!currentReviewRun) {
        return current;
      }

      updatedReviewRun = {
        ...currentReviewRun,
        completed_at: now,
        failure_message: input.failureMessage,
        status: "failed",
        updated_at: now,
      };
      return {
        review_run: updatedReviewRun,
      };
    },
  );

  if (!updatedReviewRun) {
    return;
  }
  const stoppedReviewRun = updatedReviewRun;

  input.queryClient.setQueryData<ReviewRunsResponse>(
    ["tickets", input.ticketId, "review-runs"],
    (previous) =>
      previous
        ? {
            review_runs: upsertById(
              previous.review_runs,
              stoppedReviewRun,
            ).sort(
              (left, right) =>
                left.created_at.localeCompare(right.created_at) ||
                left.id.localeCompare(right.id),
            ),
          }
        : previous,
  );
}

export function useWalleyBoardMutations({
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
  setTerminalCommand,
  setValidationCommandsText,
  tickets,
}: UseWalleyBoardMutationsInput) {
  const createProjectMutation = useMutation({
    mutationFn: (input: {
      color: string;
      name: string;
      repositoryPath: string;
      defaultTargetBranch: string;
      validationCommands: string[];
    }) =>
      postJson<CommandAck>("/projects", {
        name: input.name,
        slug: slugify(input.name),
        color: input.color,
        default_target_branch: input.defaultTargetBranch,
        repository: {
          name: deriveRepositoryName(input.repositoryPath, input.name),
          path: input.repositoryPath,
          target_branch: input.defaultTargetBranch,
          validation_commands: input.validationCommands,
        },
      }),
    onSuccess: async (ack: CommandAck) => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      selectProject(ack.resource_refs.project_id ?? null);
      setProjectModalOpen(false);
      setProjectColor(defaultProjectColor);
      setProjectName("");
      setRepositoryPath("");
      setDefaultBranch("main");
      setValidationCommandsText("");
    },
  });

  const updateProjectMutation = useMutation({
    mutationFn: (input: {
      draftAgentAdapter: AgentAdapter;
      ticketAgentAdapter: AgentAdapter;
      projectId: string;
      color: string;
      disabledMcpServers: string[];
      automaticAgentReview: boolean;
      automaticAgentReviewRunLimit: number;
      defaultReviewAction: ReviewAction;
      previewStartCommand: string | null;
      worktreeInitCommand: string | null;
      worktreeTeardownCommand: string | null;
      worktreeInitRunSequential: boolean;
      draftAnalysisModel: string | null;
      draftAnalysisReasoningEffort: ReasoningEffort | null;
      ticketWorkModel: string | null;
      ticketWorkReasoningEffort: ReasoningEffort | null;
      repositoryTargetBranches: Array<{
        repositoryId: string;
        targetBranch: string;
      }>;
      repositoryValidationCommands: Array<{
        repositoryId: string;
        validationProfile: ValidationCommand[];
      }>;
    }) =>
      saveProjectOptionsRequest(input.projectId, {
        color: input.color,
        draft_analysis_agent_adapter: input.draftAgentAdapter,
        ticket_work_agent_adapter: input.ticketAgentAdapter,
        disabled_mcp_servers: input.disabledMcpServers,
        automatic_agent_review: input.automaticAgentReview,
        automatic_agent_review_run_limit: input.automaticAgentReviewRunLimit,
        default_review_action: input.defaultReviewAction,
        preview_start_command: input.previewStartCommand,
        worktree_init_command: input.worktreeInitCommand,
        worktree_teardown_command: input.worktreeTeardownCommand,
        worktree_init_run_sequential: input.worktreeInitRunSequential,
        draft_analysis_model: input.draftAnalysisModel,
        draft_analysis_reasoning_effort: input.draftAnalysisReasoningEffort,
        ticket_work_model: input.ticketWorkModel,
        ticket_work_reasoning_effort: input.ticketWorkReasoningEffort,
        repository_target_branches: input.repositoryTargetBranches.map(
          (repository) => ({
            repository_id: repository.repositoryId,
            target_branch: repository.targetBranch,
          }),
        ),
        repository_validation_commands: input.repositoryValidationCommands.map(
          (repository) => ({
            repository_id: repository.repositoryId,
            validation_profile: repository.validationProfile,
          }),
        ),
      }),
    onSuccess: async (_, input) => {
      setProjectOptionsFormError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({
          queryKey: ["projects", input.projectId, "repositories"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", input.projectId, "repository-branches"],
        }),
      ]);
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: (projectId: string) =>
      postJson<CommandAck>(`/projects/${projectId}/delete`, {}),
    onSuccess: async (_, projectId) => {
      const remainingProjects =
        queryClient
          .getQueryData<ProjectsResponse>(["projects"])
          ?.projects.filter((project) => project.id !== projectId) ?? [];

      queryClient.setQueryData<ProjectsResponse>(["projects"], {
        projects: remainingProjects,
      });
      queryClient.removeQueries({
        queryKey: ["projects", projectId, "repositories"],
      });
      queryClient.removeQueries({
        queryKey: ["projects", projectId, "drafts"],
      });
      queryClient.removeQueries({
        queryKey: ["projects", projectId, "tickets"],
      });
      queryClient.removeQueries({
        queryKey: ["projects", projectId, "repository-branches"],
      });

      setProjectOptionsProjectId(null);
      setProjectOptionsRepositoryTargetBranches({});
      setProjectOptionsFormError(null);
      setProjectDeleteConfirmText("");

      if (selectedProjectId === projectId) {
        selectProject(remainingProjects[0]?.id ?? null);
        setInspectorState({ kind: "hidden" });
      }

      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const createDraftMutation = useMutation({
    mutationFn: (input: {
      projectId: string;
      artifactScopeId: string | null;
      title: string;
      description: string;
      proposedTicketType: string | null;
      proposedAcceptanceCriteria: string[];
    }) =>
      postJson<CommandAck>("/drafts", {
        project_id: input.projectId,
        artifact_scope_id: input.artifactScopeId ?? undefined,
        title: input.title,
        description: input.description,
        proposed_ticket_type: input.proposedTicketType,
        proposed_acceptance_criteria: input.proposedAcceptanceCriteria,
      }),
    onSuccess: async (ack: CommandAck, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ["projects", variables.projectId, "drafts"],
      });

      const draftId = ack.resource_refs.draft_id;
      if (draftId) {
        setInspectorState({ kind: "draft", draftId });
      }
    },
  });

  const uploadDraftArtifactMutation = useMutation({
    mutationFn: uploadDraftArtifactRequest,
  });

  const saveDraftMutation = useMutation({
    mutationFn: saveDraftRequest,
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "drafts"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["drafts", variables.draftId, "events"],
        }),
      ]);
    },
  });

  const refineDraftMutation = useMutation({
    mutationFn: (draftId: string) =>
      postJson<CommandAck>(`/drafts/${draftId}/refine`, {}),
    onError: (_, draftId) => {
      if (pendingDraftEditorSync?.draftId === draftId) {
        setPendingDraftEditorSync(null);
      }
    },
    onSuccess: async (_, draftId) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "drafts"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["drafts", draftId, "events"],
        }),
      ]);
    },
  });

  const revertDraftRefineMutation = useMutation({
    mutationFn: (draftId: string) =>
      postJson<CommandAck>(`/drafts/${draftId}/refine/revert`, {}),
    onError: (_, draftId) => {
      if (pendingDraftEditorSync?.draftId === draftId) {
        setPendingDraftEditorSync(null);
      }
    },
    onSuccess: async (_, draftId) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "drafts"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["drafts", draftId, "events"],
        }),
      ]);
    },
  });

  const questionDraftMutation = useMutation({
    mutationFn: (draftId: string) =>
      postJson<CommandAck>(`/drafts/${draftId}/questions`, {}),
    onSuccess: async (_, draftId) => {
      await queryClient.invalidateQueries({
        queryKey: ["drafts", draftId, "events"],
      });
    },
  });

  const confirmDraftMutation = useMutation({
    mutationFn: (input: {
      draftId: string;
      title: string;
      description: string;
      ticketType: string | null;
      acceptanceCriteria: string[];
      repository: RepositoryConfig;
      project: Project;
    }) =>
      postJson<CommandAck>(`/drafts/${input.draftId}/confirm`, {
        title: input.title,
        description: input.description,
        repo_id: input.repository.id,
        ticket_type: input.ticketType ?? "feature",
        acceptance_criteria:
          input.acceptanceCriteria.length > 0
            ? input.acceptanceCriteria
            : [`Implement ${input.title}.`],
        target_branch:
          input.repository.target_branch ??
          input.project.default_target_branch ??
          "main",
      }),
    onSuccess: async () => {
      if (!selectedProjectId) {
        return;
      }

      setInspectorState({ kind: "hidden" });

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "drafts"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"],
        }),
      ]);
    },
  });

  const deleteDraftMutation = useMutation({
    mutationFn: (draftId: string) =>
      postJson<CommandAck>(`/drafts/${draftId}/delete`, {}),
    onSuccess: async (_, draftId) => {
      if (selectedDraftId === draftId) {
        setInspectorState({ kind: "hidden" });
      }

      if (selectedProjectId) {
        await queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "drafts"],
        });
      }
    },
  });

  const startTicketMutation = useMutation({
    mutationFn: (input: { ticketId: number; planningEnabled: boolean }) =>
      postJson<CommandAck>(`/tickets/${input.ticketId}/start`, {
        planning_enabled: input.planningEnabled,
      }),
    onSuccess: async (ack: CommandAck, _variables) => {
      if (!selectedProjectId) {
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "drafts"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", ack.resource_refs.session_id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", ack.resource_refs.session_id, "logs"],
        }),
      ]);
    },
  });

  const stopTicketMutation = useMutation({
    mutationFn: (input: { ticketId: number; reason?: string }) =>
      postJson<CommandAck>(`/tickets/${input.ticketId}/stop`, {
        reason:
          input.reason && input.reason.trim().length > 0
            ? input.reason
            : undefined,
      }),
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["tickets", variables.ticketId, "review-package"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId, "logs"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["tickets", variables.ticketId, "workspace", "diff"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["tickets", variables.ticketId, "workspace", "preview"],
        }),
      ]);
    },
  });

  const deleteTicketMutation = useMutation({
    mutationFn: (input: { ticketId: number; sessionId?: string | null }) =>
      postJson<CommandAck>(`/tickets/${input.ticketId}/delete`, {}),
    onSuccess: async (_, variables) => {
      if (variables.sessionId && selectedSessionId === variables.sessionId) {
        setInspectorState({ kind: "hidden" });
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "drafts"],
        }),
      ]);
    },
  });

  const editReadyTicketMutation = useMutation({
    mutationFn: (input: { ticket: TicketFrontmatter }) =>
      editReadyTicketRequest(input.ticket.id),
    onSuccess: async (ack, { ticket }) => {
      const draftId = ack.resource_refs.draft_id;
      const timestamp = ack.issued_at ?? new Date().toISOString();

      if (draftId) {
        queryClient.setQueryData<DraftsResponse>(
          ["projects", ticket.project, "drafts"],
          (previous) => ({
            drafts: upsertById(previous?.drafts ?? [], {
              id: draftId,
              project_id: ticket.project,
              artifact_scope_id: ticket.artifact_scope_id,
              title_draft: ticket.title,
              description_draft: ticket.description,
              proposed_repo_id: ticket.repo,
              confirmed_repo_id: ticket.repo,
              proposed_ticket_type: ticket.ticket_type,
              proposed_acceptance_criteria: ticket.acceptance_criteria,
              wizard_status: "editing",
              split_proposal_summary: null,
              source_ticket_id: ticket.id,
              target_branch: ticket.target_branch,
              created_at: timestamp,
              updated_at: timestamp,
            }),
          }),
        );
        setInspectorState({ kind: "draft", draftId });
      } else {
        setInspectorState({ kind: "hidden" });
      }

      queryClient.setQueryData<TicketsResponse>(
        ["projects", ticket.project, "tickets"],
        (previous) => ({
          tickets: (previous?.tickets ?? []).filter(
            (currentTicket) => currentTicket.id !== ticket.id,
          ),
        }),
      );

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", ticket.project, "drafts"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", ticket.project, "tickets"],
        }),
      ]);
    },
  });

  const archiveTicketMutation = useMutation({
    mutationFn: (input: {
      ticketId: number;
      sessionId?: string | null;
      projectId: string;
    }) => postJson<CommandAck>(`/tickets/${input.ticketId}/archive`, {}),
    onMutate: () => {
      setArchiveActionFeedback(null);
    },
    onSuccess: async (ack: CommandAck, variables) => {
      setArchiveActionFeedback({
        tone: "green",
        message: ack.message ?? `Ticket #${variables.ticketId} archived.`,
      });

      if (variables.sessionId && selectedSessionId === variables.sessionId) {
        setInspectorState({ kind: "hidden" });
      }

      queryClient.setQueryData<TicketsResponse>(
        ["projects", variables.projectId, "tickets"],
        (previous) => ({
          tickets: (previous?.tickets ?? []).filter(
            (ticket) => ticket.id !== variables.ticketId,
          ),
        }),
      );

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", variables.projectId, "tickets"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", variables.projectId, "tickets", "archived"],
        }),
      ]);
    },
    onError: (error) => {
      setArchiveActionFeedback({
        tone: "red",
        message: error.message,
      });
    },
  });

  const archiveDoneTicketsMutation = useMutation({
    mutationFn: async (input: {
      projectId: string;
      tickets: TicketFrontmatter[];
    }) => {
      await Promise.all(
        input.tickets.map((ticket) =>
          postJson<CommandAck>(`/tickets/${ticket.id}/archive`, {}),
        ),
      );

      return {
        archivedTicketIds: input.tickets.map((ticket) => ticket.id),
        archivedSessionIds: input.tickets.flatMap((ticket) =>
          ticket.session_id ? [ticket.session_id] : [],
        ),
      };
    },
    onMutate: () => {
      setArchiveActionFeedback(null);
    },
    onSuccess: async (result, variables) => {
      const archivedIdSet = new Set(result.archivedTicketIds);
      const archivedCount = result.archivedTicketIds.length;
      setArchiveActionFeedback({
        tone: "green",
        message:
          archivedCount === 1
            ? "1 ticket archived."
            : `${archivedCount} tickets archived.`,
      });

      if (
        selectedSessionId &&
        result.archivedSessionIds.includes(selectedSessionId)
      ) {
        setInspectorState({ kind: "hidden" });
      }

      queryClient.setQueryData<TicketsResponse>(
        ["projects", variables.projectId, "tickets"],
        (previous) => ({
          tickets: (previous?.tickets ?? []).filter(
            (ticket) => !archivedIdSet.has(ticket.id),
          ),
        }),
      );

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", variables.projectId, "tickets"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", variables.projectId, "tickets", "archived"],
        }),
      ]);
    },
    onError: (error) => {
      setArchiveActionFeedback({
        tone: "red",
        message: error.message,
      });
    },
  });

  const restoreTicketMutation = useMutation({
    mutationFn: (input: { ticketId: number; projectId: string }) =>
      postJson<CommandAck>(`/tickets/${input.ticketId}/restore`, {}),
    onMutate: () => {
      setArchiveActionFeedback(null);
    },
    onSuccess: async (ack: CommandAck, variables) => {
      setArchiveActionFeedback({
        tone: "green",
        message: ack.message ?? `Ticket #${variables.ticketId} restored.`,
      });

      queryClient.setQueryData<TicketsResponse>(
        ["projects", variables.projectId, "tickets", "archived"],
        (previous) => ({
          tickets: (previous?.tickets ?? []).filter(
            (ticket) => ticket.id !== variables.ticketId,
          ),
        }),
      );

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", variables.projectId, "tickets"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", variables.projectId, "tickets", "archived"],
        }),
      ]);
    },
    onError: (error) => {
      setArchiveActionFeedback({
        tone: "red",
        message: error.message,
      });
    },
  });

  const sessionInputMutation = useMutation({
    mutationFn: (input: { sessionId: string; body: string }) =>
      postJson<CommandAck>(`/sessions/${input.sessionId}/input`, {
        body: input.body,
      }),
    onSuccess: async (_, variables) => {
      setResumeReason("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["sessions", variables.sessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", variables.sessionId, "logs"],
        }),
      ]);
    },
  });

  const terminalInputMutation = useMutation({
    mutationFn: (input: { sessionId: string; body: string }) =>
      postJson<CommandAck>(`/sessions/${input.sessionId}/input`, {
        body: input.body,
      }),
    onSuccess: async (_, variables) => {
      setTerminalCommand("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["sessions", variables.sessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", variables.sessionId, "logs"],
        }),
      ]);
    },
  });

  const terminalTakeoverMutation = useMutation({
    mutationFn: (sessionId: string) =>
      postJson<CommandAck>(`/sessions/${sessionId}/terminal/takeover`, {}),
    onSuccess: async (_, sessionId) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["sessions", sessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", sessionId, "logs"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"],
        }),
      ]);
    },
  });

  const terminalRestoreMutation = useMutation({
    mutationFn: (sessionId: string) =>
      postJson<CommandAck>(`/sessions/${sessionId}/terminal/restore-agent`, {}),
    onSuccess: async (_, sessionId) => {
      setTerminalCommand("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["sessions", sessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", sessionId, "logs"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"],
        }),
      ]);
    },
  });

  const startTicketWorkspacePreviewMutation = useMutation({
    mutationFn: (ticketId: number) =>
      postJson<TicketWorkspacePreviewResponse>(
        `/tickets/${ticketId}/workspace/preview`,
        {},
      ),
    onSuccess: (response, ticketId) => {
      queryClient.setQueryData<TicketWorkspacePreviewResponse>(
        ["tickets", ticketId, "workspace", "preview"],
        response,
      );
    },
  });

  const stopTicketWorkspacePreviewMutation = useMutation({
    mutationFn: (ticketId: number) =>
      postJson<TicketWorkspacePreviewResponse>(
        `/tickets/${ticketId}/workspace/preview/stop`,
        {},
      ),
    onSuccess: (response, ticketId) => {
      queryClient.setQueryData<TicketWorkspacePreviewResponse>(
        ["tickets", ticketId, "workspace", "preview"],
        response,
      );
    },
  });

  const mergeTicketMutation = useMutation({
    mutationFn: (ticketId: number) =>
      postJson<CommandAck>(`/tickets/${ticketId}/merge`, {}),
    onSuccess: async (_, ticketId) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId, "logs"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["tickets", ticketId, "review-package"],
        }),
      ]);
    },
  });

  const createPullRequestMutation = useMutation({
    mutationFn: (ticketId: number) =>
      postJson<CommandAck>(`/tickets/${ticketId}/create-pr`, {}),
    onSuccess: async (_, ticketId) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId, "logs"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["tickets", ticketId, "review-package"],
        }),
      ]);
    },
  });

  const startAgentReviewMutation = useMutation({
    mutationFn: (ticketId: number) =>
      postJson<CommandAck>(`/tickets/${ticketId}/start-agent-review`, {}),
    onSuccess: async (_, ticketId) => {
      setOptimisticRunningReviewRun({
        queryClient,
        ticketId,
        implementationSessionId:
          tickets.find((ticket) => ticket.id === ticketId)?.session_id ?? null,
      });

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId, "logs"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["tickets", ticketId, "review-run"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["tickets", ticketId, "review-runs"],
        }),
      ]);
    },
  });

  const stopAgentReviewMutation = useMutation({
    mutationFn: (ticketId: number) =>
      postJson<CommandAck>(`/tickets/${ticketId}/stop-agent-review`, {}),
    onSuccess: async (_, ticketId) => {
      setStoppedReviewRun({
        failureMessage: "Agent review stopped by user.",
        queryClient,
        ticketId,
      });

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId, "logs"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["tickets", ticketId, "review-run"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["tickets", ticketId, "review-runs"],
        }),
      ]);
    },
  });

  const requestChangesMutation = useMutation({
    mutationFn: (input: { ticketId: number; body: string }) =>
      postJson<CommandAck>(`/tickets/${input.ticketId}/request-changes`, {
        body: input.body,
      }),
    onSuccess: async (_, variables) => {
      setRequestedChangesBody("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId, "logs"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["tickets", variables.ticketId, "review-package"],
        }),
      ]);
    },
  });

  const planFeedbackMutation = useMutation({
    mutationFn: (input: {
      sessionId: string;
      approved: boolean;
      body: string;
    }) =>
      postJson<CommandAck>(`/sessions/${input.sessionId}/checkpoint-response`, {
        approved: input.approved,
        body: input.body,
      }),
    onSuccess: async () => {
      setPlanFeedbackBody("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId, "logs"],
        }),
      ]);
    },
  });

  const resumeTicketMutation = useMutation({
    mutationFn: (input: { ticketId: number; reason?: string }) =>
      postJson<CommandAck>(`/tickets/${input.ticketId}/resume`, {
        reason:
          input.reason && input.reason.trim().length > 0
            ? input.reason
            : undefined,
      }),
    onSuccess: async (_, variables) => {
      const resumedSessionId =
        tickets.find((ticket) => ticket.id === variables.ticketId)
          ?.session_id ?? null;

      setResumeReason("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"],
        }),
        ...(resumedSessionId
          ? [
              queryClient.invalidateQueries({
                queryKey: ["sessions", resumedSessionId],
              }),
              queryClient.invalidateQueries({
                queryKey: ["sessions", resumedSessionId, "logs"],
              }),
            ]
          : []),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId, "logs"],
        }),
      ]);
    },
  });

  const restartTicketMutation = useMutation({
    mutationFn: (input: { ticketId: number; reason?: string }) =>
      postJson<CommandAck>(`/tickets/${input.ticketId}/restart`, {
        reason:
          input.reason && input.reason.trim().length > 0
            ? input.reason
            : undefined,
      }),
    onSuccess: async (_, variables) => {
      const restartedSessionId =
        tickets.find((ticket) => ticket.id === variables.ticketId)
          ?.session_id ?? null;

      setResumeReason("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"],
        }),
        ...(restartedSessionId
          ? [
              queryClient.invalidateQueries({
                queryKey: ["sessions", restartedSessionId],
              }),
              queryClient.invalidateQueries({
                queryKey: ["sessions", restartedSessionId, "logs"],
              }),
            ]
          : []),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId, "logs"],
        }),
      ]);
    },
  });

  return {
    archiveDoneTicketsMutation,
    archiveTicketMutation,
    confirmDraftMutation,
    createDraftMutation,
    createProjectMutation,
    createPullRequestMutation,
    editReadyTicketMutation,
    deleteDraftMutation,
    deleteProjectMutation,
    deleteTicketMutation,
    mergeTicketMutation,
    planFeedbackMutation,
    questionDraftMutation,
    refineDraftMutation,
    requestChangesMutation,
    restartTicketMutation,
    restoreTicketMutation,
    resumeTicketMutation,
    revertDraftRefineMutation,
    saveDraftMutation,
    sessionInputMutation,
    startAgentReviewMutation,
    startTicketMutation,
    startTicketWorkspacePreviewMutation,
    stopAgentReviewMutation,
    stopTicketWorkspacePreviewMutation,
    stopTicketMutation,
    terminalInputMutation,
    terminalRestoreMutation,
    terminalTakeoverMutation,
    updateProjectMutation,
    uploadDraftArtifactMutation,
  };
}

export type WalleyBoardMutations = ReturnType<typeof useWalleyBoardMutations>;
