import assert from "node:assert/strict";
import test from "node:test";

import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";

import {
  deriveTicketAiReviewStatus,
  getTicketsWithAiReviewSessions,
} from "./use-ticket-ai-review-status.js";

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

test("keeps pending review-run lookups unresolved until they finish", () => {
  const reviewTickets = getTicketsWithAiReviewSessions([
    createTicket({ id: 21, session_id: "session-21" }),
    createTicket({ id: 22, session_id: "session-22" }),
  ]);

  const status = deriveTicketAiReviewStatus({
    reviewRunQueries: [
      {
        data: undefined,
        status: "pending",
      },
      {
        data: {
          review_run: {
            id: "review-run-22",
            ticket_id: 22,
            review_package_id: "review-package-22",
            implementation_session_id: "session-22",
            status: "completed",
            adapter_session_ref: null,
            prompt: "Review ticket #22.",
            report: null,
            failure_message: null,
            created_at: "2026-04-03T00:00:00.000Z",
            updated_at: "2026-04-03T00:00:00.000Z",
            completed_at: "2026-04-03T00:01:00.000Z",
          },
        },
        status: "success",
      },
    ],
    reviewTickets,
  });

  assert.equal(status.ticketAiReviewActiveById.get(21), false);
  assert.equal(status.ticketAiReviewResolvedById.get(21), false);
  assert.equal(status.ticketAiReviewActiveById.get(22), false);
  assert.equal(status.ticketAiReviewResolvedById.get(22), true);
  assert.equal(status.reviewRunQueriesSettled, false);
});

test("keeps errored review-run lookups unresolved when no review state is known", () => {
  const reviewTickets = getTicketsWithAiReviewSessions([
    createTicket({ id: 31, session_id: "session-31" }),
  ]);

  const status = deriveTicketAiReviewStatus({
    reviewRunQueries: [
      {
        data: undefined,
        status: "error",
      },
    ],
    reviewTickets,
  });

  assert.equal(status.ticketAiReviewActiveById.get(31), false);
  assert.equal(status.ticketAiReviewResolvedById.get(31), false);
  assert.equal(status.reviewRunQueriesSettled, false);
});

test("treats errored review-run lookups with last known data as settled", () => {
  const reviewTickets = getTicketsWithAiReviewSessions([
    createTicket({ id: 32, session_id: "session-32" }),
  ]);

  const status = deriveTicketAiReviewStatus({
    reviewRunQueries: [
      {
        data: {
          review_run: {
            id: "review-run-32",
            ticket_id: 32,
            review_package_id: "review-package-32",
            implementation_session_id: "session-32",
            status: "completed",
            adapter_session_ref: null,
            prompt: "Review ticket #32.",
            report: null,
            failure_message: null,
            created_at: "2026-04-03T00:00:00.000Z",
            updated_at: "2026-04-03T00:00:00.000Z",
            completed_at: "2026-04-03T00:01:00.000Z",
          },
        },
        status: "error",
      },
    ],
    reviewTickets,
  });

  assert.equal(status.ticketAiReviewActiveById.get(32), false);
  assert.equal(status.ticketAiReviewResolvedById.get(32), true);
  assert.equal(status.reviewRunQueriesSettled, true);
});

test("keeps automatic AI-review tickets unresolved until a review run record exists", () => {
  const reviewTickets = getTicketsWithAiReviewSessions([
    createTicket({ id: 41, session_id: "session-41", project: "project-auto" }),
    createTicket({
      id: 42,
      session_id: "session-42",
      project: "project-manual",
    }),
  ]);

  const status = deriveTicketAiReviewStatus({
    automaticAgentReviewByProjectId: new Map([
      ["project-auto", true],
      ["project-manual", false],
    ]),
    reviewRunQueries: [
      {
        data: null,
        status: "success",
      },
      {
        data: null,
        status: "success",
      },
    ],
    reviewTickets,
  });

  assert.equal(status.ticketAiReviewResolvedById.get(41), false);
  assert.equal(status.ticketAiReviewResolvedById.get(42), true);
  assert.equal(status.reviewRunQueriesSettled, false);
});
