import assert from "node:assert/strict";
import test from "node:test";

import type {
  Project,
  TicketFrontmatter,
} from "../../../../packages/contracts/src/index.js";

import {
  describePullRequestStatus,
  resolveReviewCardActions,
} from "../features/walleyboard/shared-utils.js";

function createProject(overrides: Partial<Project> = {}): Project {
  const project: Project = {
    id: "project-1",
    slug: "project-1",
    name: "Project One",
    agent_adapter: "codex",
    execution_backend: "host",
    disabled_mcp_servers: [],
    automatic_agent_review: false,
    automatic_agent_review_run_limit: 1,
    default_review_action: "direct_merge",
    default_target_branch: "main",
    preview_start_command: null,
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
  return project;
}

function createTicket(
  overrides: Partial<TicketFrontmatter> = {},
): TicketFrontmatter {
  return {
    id: 3,
    project: "project-1",
    repo: "repo-1",
    artifact_scope_id: "artifact-scope-1",
    status: "review",
    title: "Review me",
    description: "Review path coverage.",
    ticket_type: "feature",
    acceptance_criteria: ["Keep review actions coherent."],
    working_branch: "codex/ticket-3",
    target_branch: "main",
    linked_pr: null,
    session_id: "session-3",
    created_at: "2026-04-02T00:00:00.000Z",
    updated_at: "2026-04-02T00:00:00.000Z",
    ...overrides,
  };
}

test("resolveReviewCardActions uses the project default when no PR is linked", () => {
  assert.deepEqual(resolveReviewCardActions(createProject(), createTicket()), {
    primary: {
      kind: "merge",
      label: "Merge",
    },
    secondary: {
      kind: "create_pr",
      label: "Create pull request",
    },
  });
  assert.deepEqual(
    resolveReviewCardActions(
      createProject({
        default_review_action: "pull_request",
      }),
      createTicket(),
    ),
    {
      primary: {
        kind: "create_pr",
        label: "Create pull request",
      },
      secondary: {
        kind: "merge",
        label: "Merge",
      },
    },
  );
});

test("linked pull requests switch review cards into tracking mode", () => {
  const ticket = createTicket({
    linked_pr: {
      provider: "github",
      repo_owner: "acme",
      repo_name: "repo",
      number: 44,
      url: "https://github.com/acme/repo/pull/44",
      head_branch: "codex/ticket-3",
      base_branch: "main",
      state: "open",
      review_status: "changes_requested",
      head_sha: "abc123",
      changes_requested_by: "reviewer1",
      last_changes_requested_head_sha: "abc123",
      last_reconciled_at: "2026-04-02T00:10:00.000Z",
    },
  });

  assert.deepEqual(
    resolveReviewCardActions(
      createProject({
        default_review_action: "pull_request",
      }),
      ticket,
    ),
    {
      primary: {
        kind: "open_pr",
        label: "Open PR #44",
      },
      secondary: null,
    },
  );
  if (!ticket.linked_pr) {
    throw new Error("linked_pr should be present");
  }
  assert.equal(
    describePullRequestStatus(ticket.linked_pr),
    "Changes requested",
  );
});
