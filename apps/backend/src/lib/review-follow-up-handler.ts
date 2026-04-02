import type { AgentReviewService } from "./agent-review-service.js";
import type { GitHubPullRequestService } from "./github-pull-request-service.js";

type ReviewFollowUpInput = Parameters<
  GitHubPullRequestService["handleReviewReady"]
>[0];

type ReviewFollowUpDependencies = {
  agentReviewService: Pick<
    AgentReviewService,
    "hasActiveReviewLoop" | "startReviewLoop"
  >;
  githubPullRequestService: Pick<GitHubPullRequestService, "handleReviewReady">;
};

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function runReviewFollowUp(
  input: ReviewFollowUpInput,
  { agentReviewService, githubPullRequestService }: ReviewFollowUpDependencies,
): Promise<void> {
  const failures: string[] = [];

  if (input.project.automatic_agent_review) {
    try {
      if (!agentReviewService.hasActiveReviewLoop(input.ticket.id)) {
        agentReviewService.startReviewLoop(input.ticket.id);
      }
    } catch (error) {
      failures.push(
        `Automatic agent review could not start: ${toErrorMessage(
          error,
          "Unknown error",
        )}`,
      );
    }
  }

  try {
    await githubPullRequestService.handleReviewReady(input);
  } catch (error) {
    failures.push(
      `GitHub review follow-up failed: ${toErrorMessage(
        error,
        "Unknown error",
      )}`,
    );
  }

  if (failures.length > 0) {
    throw new Error(failures.join(" | "));
  }
}
