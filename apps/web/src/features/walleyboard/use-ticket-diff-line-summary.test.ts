import assert from "node:assert/strict";
import test from "node:test";

import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";

import { getTicketsWithVisibleDiffSummary } from "./use-ticket-diff-line-summary.js";

function createTicket(
  overrides: Partial<TicketFrontmatter> = {},
): TicketFrontmatter {
  return {
    acceptance_criteria: [],
    artifact_scope_id: "artifact-scope-49",
    created_at: "2026-04-04T00:00:00.000Z",
    description: "Show persisted diff totals on done tickets.",
    id: 49,
    linked_pr: null,
    project: "project-1",
    repo: "repo-1",
    session_id: "session-49",
    status: "review",
    target_branch: "main",
    ticket_type: "feature",
    title: "Show added and removed line counts on Done tickets",
    updated_at: "2026-04-04T00:00:00.000Z",
    working_branch: "ticket-49",
    ...overrides,
  };
}

test("includes done tickets when selecting cards that should load diff summaries", () => {
  const tickets = [
    createTicket({ id: 1, status: "ready", session_id: null }),
    createTicket({ id: 2, status: "in_progress", session_id: "session-2" }),
    createTicket({ id: 3, status: "review", session_id: "session-3" }),
    createTicket({
      id: 4,
      status: "done",
      session_id: null,
      working_branch: null,
    }),
  ];

  assert.deepEqual(
    getTicketsWithVisibleDiffSummary(tickets).map((ticket) => ticket.id),
    [2, 3, 4],
  );
});
