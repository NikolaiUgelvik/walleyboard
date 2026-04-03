import assert from "node:assert/strict";
import test from "node:test";

import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";

import { getTicketsWithAiReviewSessions } from "./use-ticket-ai-review-status.js";

function createTicket(
  overrides: Partial<TicketFrontmatter> = {},
): TicketFrontmatter {
  return {
    acceptance_criteria: [],
    artifact_scope_id: "artifact-scope-15",
    created_at: "2026-04-03T00:00:00.000Z",
    description: "Track agent review progress on the board.",
    id: 15,
    linked_pr: null,
    project: "project-1",
    repo: "repo-1",
    session_id: "session-15",
    status: "review",
    target_branch: "main",
    ticket_type: "feature",
    title: "Display AI review in progress on ticket cards",
    updated_at: "2026-04-03T00:00:00.000Z",
    working_branch: "ticket-15",
    ...overrides,
  };
}

test("includes any ticket with an implementation session when checking AI review activity", () => {
  const tickets = [
    createTicket({ id: 1, status: "review", session_id: "session-review" }),
    createTicket({ id: 2, status: "done", session_id: "session-done" }),
    createTicket({ id: 3, status: "in_progress", session_id: "session-work" }),
    createTicket({ id: 4, status: "ready", session_id: null }),
  ];

  assert.deepEqual(
    getTicketsWithAiReviewSessions(tickets).map((ticket) => ticket.id),
    [1, 2, 3],
  );
});
