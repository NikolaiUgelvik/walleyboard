import assert from "node:assert/strict";
import test from "node:test";

import type { Project } from "../../../../packages/contracts/src/index.js";

import { runReviewFollowUp } from "./review-follow-up-handler.js";

type ReviewFollowUpInput = Parameters<typeof runReviewFollowUp>[0];

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    slug: "project-1",
    name: "Project",
    agent_adapter: "codex",
    execution_backend: "host",
    automatic_agent_review: false,
    default_review_action: "direct_merge",
    default_target_branch: "main",
    pre_worktree_command: null,
    post_worktree_command: null,
    draft_analysis_model: null,
    draft_analysis_reasoning_effort: null,
    ticket_work_model: null,
    ticket_work_reasoning_effort: null,
    max_concurrent_sessions: 4,
    created_at: "2026-04-02T00:00:00.000Z",
    updated_at: "2026-04-02T00:00:00.000Z",
    ...overrides,
  };
}

function createReviewInput(automaticAgentReview: boolean): ReviewFollowUpInput {
  return {
    project: createProject({
      automatic_agent_review: automaticAgentReview,
    }),
    repository: {
      id: "repo-1",
      project_id: "project-1",
      name: "repo",
      path: "/tmp/repo",
      target_branch: "main",
      setup_hook: null,
      cleanup_hook: null,
      validation_profile: [],
      extra_env_allowlist: [],
      created_at: "2026-04-02T00:00:00.000Z",
      updated_at: "2026-04-02T00:00:00.000Z",
    },
    reviewPackage: {
      id: "review-package-1",
      ticket_id: 12,
      session_id: "session-1",
      diff_ref: "/tmp/review.patch",
      commit_refs: ["abc123"],
      change_summary: "Ready for review.",
      validation_results: [],
      remaining_risks: [],
      created_at: "2026-04-02T00:00:00.000Z",
    },
    session: {
      id: "session-1",
      ticket_id: 12,
      project_id: "project-1",
      repo_id: "repo-1",
      agent_adapter: "codex",
      worktree_path: "/tmp/repo-worktree",
      adapter_session_ref: null,
      status: "completed" as const,
      planning_enabled: false,
      plan_status: "not_requested" as const,
      plan_summary: null,
      current_attempt_id: "attempt-1",
      latest_requested_change_note_id: null,
      latest_review_package_id: "review-package-1",
      queue_entered_at: null,
      started_at: "2026-04-02T00:00:00.000Z",
      completed_at: "2026-04-02T00:05:00.000Z",
      last_heartbeat_at: "2026-04-02T00:05:00.000Z",
      last_summary: "Implementation finished.",
    },
    ticket: {
      id: 12,
      project: "project-1",
      repo: "repo-1",
      artifact_scope_id: "artifact-scope-1",
      status: "review" as const,
      title: "Review ticket",
      description: "Exercise review follow-up behavior.",
      ticket_type: "feature" as const,
      acceptance_criteria: ["Keep the review flow intact."],
      working_branch: "codex/ticket-12",
      target_branch: "main",
      linked_pr: null,
      session_id: "session-1",
      created_at: "2026-04-02T00:00:00.000Z",
      updated_at: "2026-04-02T00:05:00.000Z",
    },
  };
}

test("runReviewFollowUp starts automatic agent review when the project enables it", async () => {
  const reviewStarts: number[] = [];
  const githubFollowUps: number[] = [];

  await runReviewFollowUp(createReviewInput(true), {
    agentReviewService: {
      hasActiveReviewLoop() {
        return false;
      },
      startReviewLoop(ticketId: number) {
        reviewStarts.push(ticketId);
        return undefined as never;
      },
    },
    githubPullRequestService: {
      async handleReviewReady(input) {
        githubFollowUps.push(input.ticket.id);
      },
    },
  });

  assert.deepEqual(reviewStarts, [12]);
  assert.deepEqual(githubFollowUps, [12]);
});

test("runReviewFollowUp leaves manual agent review in place when the project disables it", async () => {
  const reviewStarts: number[] = [];
  const githubFollowUps: number[] = [];

  await runReviewFollowUp(createReviewInput(false), {
    agentReviewService: {
      hasActiveReviewLoop() {
        return false;
      },
      startReviewLoop(ticketId: number) {
        reviewStarts.push(ticketId);
        return undefined as never;
      },
    },
    githubPullRequestService: {
      async handleReviewReady(input) {
        githubFollowUps.push(input.ticket.id);
      },
    },
  });

  assert.deepEqual(reviewStarts, []);
  assert.deepEqual(githubFollowUps, [12]);
});

test("runReviewFollowUp keeps an active automatic review loop running without restarting it", async () => {
  const reviewStarts: number[] = [];
  const githubFollowUps: number[] = [];

  await runReviewFollowUp(createReviewInput(true), {
    agentReviewService: {
      hasActiveReviewLoop(ticketId: number) {
        return ticketId === 12;
      },
      startReviewLoop(ticketId: number) {
        reviewStarts.push(ticketId);
        return undefined as never;
      },
    },
    githubPullRequestService: {
      async handleReviewReady(input) {
        githubFollowUps.push(input.ticket.id);
      },
    },
  });

  assert.deepEqual(reviewStarts, []);
  assert.deepEqual(githubFollowUps, [12]);
});
