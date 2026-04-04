import type { Dispatch, SetStateAction } from "react";
import type {
  AgentAdapter,
  Project,
  RepositoryConfig,
  ReviewAction,
} from "../../../../../packages/contracts/src/index.js";
import type {
  ProjectModelPreset,
  ProjectReasoningEffortSelection,
} from "./shared-types.js";
import {
  defaultProjectColor,
  mapRepositoryTargetBranches,
  pickProjectColor,
  resolveProjectCustomModelValue,
  resolveProjectModelPreset,
  resolveProjectReasoningEffortSelection,
} from "./shared-utils.js";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export function openProjectCreationModal(input: {
  projectRecords: Pick<Project, "color">[];
  projectsFetching: boolean;
  projectsLoaded: boolean;
  resetCreateProjectMutation: () => void;
  setProjectColor: StateSetter<string>;
  setProjectColorManuallySelected: StateSetter<boolean>;
  setProjectColorNeedsRefresh: StateSetter<boolean>;
  setProjectModalOpen: StateSetter<boolean>;
}): void {
  input.setProjectColorManuallySelected(false);
  input.setProjectColorNeedsRefresh(
    !input.projectsLoaded || input.projectsFetching,
  );
  input.setProjectColor(pickProjectColor(input.projectRecords));
  input.setProjectModalOpen(true);
  input.resetCreateProjectMutation();
}

export function closeProjectCreationModal(input: {
  resetCreateProjectMutation: () => void;
  setProjectColorManuallySelected: StateSetter<boolean>;
  setProjectColorNeedsRefresh: StateSetter<boolean>;
  setProjectModalOpen: StateSetter<boolean>;
}): void {
  input.setProjectModalOpen(false);
  input.setProjectColorManuallySelected(false);
  input.setProjectColorNeedsRefresh(false);
  input.resetCreateProjectMutation();
}

export function resetProjectOptionsModal(input: {
  resetDeleteProjectMutation: () => void;
  resetUpdateProjectMutation: () => void;
  setProjectDeleteConfirmText: StateSetter<string>;
  setProjectOptionsAgentAdapter: StateSetter<AgentAdapter>;
  setProjectOptionsAutomaticAgentReview: StateSetter<boolean>;
  setProjectOptionsAutomaticAgentReviewRunLimit: StateSetter<number>;
  setProjectOptionsColor: StateSetter<string>;
  setProjectOptionsColorManuallySelected: StateSetter<boolean>;
  setProjectOptionsDefaultReviewAction: StateSetter<ReviewAction>;
  setProjectOptionsDisabledMcpServers: StateSetter<string[]>;
  setProjectOptionsFormError: StateSetter<string | null>;
  setProjectOptionsPreviewStartCommand: StateSetter<string>;
  setProjectOptionsProjectId: StateSetter<string | null>;
  setProjectOptionsRepositoryTargetBranches: StateSetter<
    Record<string, string>
  >;
}): void {
  input.setProjectOptionsProjectId(null);
  input.setProjectOptionsColor(defaultProjectColor);
  input.setProjectOptionsColorManuallySelected(false);
  input.setProjectOptionsAgentAdapter("codex");
  input.setProjectOptionsDisabledMcpServers([]);
  input.setProjectOptionsAutomaticAgentReview(false);
  input.setProjectOptionsAutomaticAgentReviewRunLimit(1);
  input.setProjectOptionsDefaultReviewAction("direct_merge");
  input.setProjectOptionsPreviewStartCommand("");
  input.setProjectOptionsRepositoryTargetBranches({});
  input.setProjectOptionsFormError(null);
  input.setProjectDeleteConfirmText("");
  input.resetUpdateProjectMutation();
  input.resetDeleteProjectMutation();
}

export function populateProjectOptionsModal(input: {
  cachedRepositories: RepositoryConfig[];
  project: Project;
  resetDeleteProjectMutation: () => void;
  resetUpdateProjectMutation: () => void;
  setProjectDeleteConfirmText: StateSetter<string>;
  setProjectOptionsAgentAdapter: StateSetter<AgentAdapter>;
  setProjectOptionsAutomaticAgentReview: StateSetter<boolean>;
  setProjectOptionsAutomaticAgentReviewRunLimit: StateSetter<number>;
  setProjectOptionsColor: StateSetter<string>;
  setProjectOptionsColorManuallySelected: StateSetter<boolean>;
  setProjectOptionsDefaultReviewAction: StateSetter<ReviewAction>;
  setProjectOptionsDisabledMcpServers: StateSetter<string[]>;
  setProjectOptionsDraftModelCustom: StateSetter<string>;
  setProjectOptionsDraftModelPreset: StateSetter<ProjectModelPreset>;
  setProjectOptionsDraftReasoningEffort: StateSetter<ProjectReasoningEffortSelection>;
  setProjectOptionsFormError: StateSetter<string | null>;
  setProjectOptionsPostWorktreeCommand: StateSetter<string>;
  setProjectOptionsPreWorktreeCommand: StateSetter<string>;
  setProjectOptionsPreviewStartCommand: StateSetter<string>;
  setProjectOptionsProjectId: StateSetter<string | null>;
  setProjectOptionsRepositoryTargetBranches: StateSetter<
    Record<string, string>
  >;
  setProjectOptionsTicketModelCustom: StateSetter<string>;
  setProjectOptionsTicketModelPreset: StateSetter<ProjectModelPreset>;
  setProjectOptionsTicketReasoningEffort: StateSetter<ProjectReasoningEffortSelection>;
}): void {
  input.setProjectOptionsProjectId(input.project.id);
  input.setProjectOptionsColor(input.project.color);
  input.setProjectOptionsColorManuallySelected(false);
  input.setProjectOptionsAgentAdapter(input.project.agent_adapter);
  input.setProjectOptionsDisabledMcpServers(
    [...input.project.disabled_mcp_servers].sort((left, right) =>
      left.localeCompare(right),
    ),
  );
  input.setProjectOptionsAutomaticAgentReview(
    input.project.automatic_agent_review,
  );
  input.setProjectOptionsAutomaticAgentReviewRunLimit(
    input.project.automatic_agent_review_run_limit,
  );
  input.setProjectOptionsDefaultReviewAction(
    input.project.default_review_action,
  );
  input.setProjectOptionsDraftModelPreset(
    resolveProjectModelPreset(input.project.draft_analysis_model),
  );
  input.setProjectOptionsDraftModelCustom(
    resolveProjectCustomModelValue(input.project.draft_analysis_model),
  );
  input.setProjectOptionsDraftReasoningEffort(
    resolveProjectReasoningEffortSelection(
      input.project.draft_analysis_reasoning_effort,
    ),
  );
  input.setProjectOptionsTicketModelPreset(
    resolveProjectModelPreset(input.project.ticket_work_model),
  );
  input.setProjectOptionsTicketModelCustom(
    resolveProjectCustomModelValue(input.project.ticket_work_model),
  );
  input.setProjectOptionsTicketReasoningEffort(
    resolveProjectReasoningEffortSelection(
      input.project.ticket_work_reasoning_effort,
    ),
  );
  input.setProjectOptionsPreviewStartCommand(
    input.project.preview_start_command ?? "",
  );
  input.setProjectOptionsPreWorktreeCommand(
    input.project.pre_worktree_command ?? "",
  );
  input.setProjectOptionsPostWorktreeCommand(
    input.project.post_worktree_command ?? "",
  );
  input.setProjectOptionsRepositoryTargetBranches(
    mapRepositoryTargetBranches(
      input.cachedRepositories,
      input.project.default_target_branch,
    ),
  );
  input.setProjectOptionsFormError(null);
  input.setProjectDeleteConfirmText("");
  input.resetUpdateProjectMutation();
  input.resetDeleteProjectMutation();
}
