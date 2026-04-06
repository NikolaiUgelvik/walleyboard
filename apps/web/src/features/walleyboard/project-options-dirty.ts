import type {
  AgentAdapter,
  Project,
  ReviewAction,
} from "../../../../../packages/contracts/src/index.js";

import { normalizeProjectColor } from "./shared-utils.js";

type ProjectOptionsDirtyInput = {
  color: string;
  draftModelValue: string | null;
  draftReasoningEffortValue: string | null;
  disabledMcpServers: string[];
  postWorktreeCommandValue: string | null;
  preWorktreeCommandValue: string | null;
  previewStartCommandValue: string | null;
  project: Project | null;
  projectOptionsAutomaticAgentReview: boolean;
  projectOptionsAutomaticAgentReviewRunLimit: number;
  projectOptionsDefaultReviewAction: ReviewAction;
  repositoryBranchesDirty: boolean;
  selectedDraftAgentAdapter: AgentAdapter;
  selectedTicketAgentAdapter: AgentAdapter;
  ticketModelValue: string | null;
  ticketReasoningEffortValue: string | null;
};

export function hasProjectOptionsDirty(
  input: ProjectOptionsDirtyInput,
): boolean {
  const project = input.project;
  if (project === null) {
    return false;
  }

  return (
    input.color !== normalizeProjectColor(project.color) ||
    input.selectedDraftAgentAdapter !== project.draft_analysis_agent_adapter ||
    input.selectedTicketAgentAdapter !== project.ticket_work_agent_adapter ||
    !(
      input.disabledMcpServers.length === project.disabled_mcp_servers.length &&
      input.disabledMcpServers.every(
        (server, index) => server === project.disabled_mcp_servers[index],
      )
    ) ||
    input.projectOptionsAutomaticAgentReview !==
      project.automatic_agent_review ||
    input.projectOptionsAutomaticAgentReviewRunLimit !==
      project.automatic_agent_review_run_limit ||
    input.projectOptionsDefaultReviewAction !== project.default_review_action ||
    input.previewStartCommandValue !== project.preview_start_command ||
    input.preWorktreeCommandValue !== project.pre_worktree_command ||
    input.postWorktreeCommandValue !== project.post_worktree_command ||
    input.draftModelValue !== project.draft_analysis_model ||
    input.draftReasoningEffortValue !==
      project.draft_analysis_reasoning_effort ||
    input.ticketModelValue !== project.ticket_work_model ||
    input.ticketReasoningEffortValue !== project.ticket_work_reasoning_effort ||
    input.repositoryBranchesDirty
  );
}
