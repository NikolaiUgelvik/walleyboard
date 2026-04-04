import assert from "node:assert/strict";
import test from "node:test";

import type {
  DraftTicketState,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import {
  resolveNextInspectorState,
  shouldResetProjectOptionsSelection,
} from "./controller-guards.js";
import type { InspectorState } from "./shared-types.js";

function createDraft(id: string): DraftTicketState {
  return {
    id,
    project_id: "project-1",
    artifact_scope_id: `${id}-artifacts`,
    title_draft: `Draft ${id}`,
    description_draft: "Draft description",
    proposed_acceptance_criteria: ["criterion"],
    wizard_status: "editing",
    split_proposal_summary: null,
    source_ticket_id: null,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
    proposed_ticket_type: "feature",
    proposed_repo_id: null,
    confirmed_repo_id: null,
  };
}

function createTicket(sessionId: string | null): TicketFrontmatter {
  return {
    id: 1,
    project: "project-1",
    repo: "repo-1",
    artifact_scope_id: "artifacts",
    status: "in_progress",
    title: "Ticket",
    description: "Ticket description",
    ticket_type: "feature",
    acceptance_criteria: ["criterion"],
    working_branch: "codex/ticket-1",
    target_branch: "main",
    linked_pr: null,
    session_id: sessionId,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
  };
}

test("shouldResetProjectOptionsSelection waits for project data before clearing selection", () => {
  assert.equal(
    shouldResetProjectOptionsSelection({
      projectOptionsProjectId: "project-1",
      projects: [],
      projectsLoaded: false,
    }),
    false,
  );
});

test("shouldResetProjectOptionsSelection clears missing project selections after load", () => {
  assert.equal(
    shouldResetProjectOptionsSelection({
      projectOptionsProjectId: "project-2",
      projects: [{ id: "project-1" }],
      projectsLoaded: true,
    }),
    true,
  );
});

test("resolveNextInspectorState keeps a draft inspector open while drafts are still loading", () => {
  const inspectorState: InspectorState = { kind: "draft", draftId: "draft-1" };

  assert.equal(
    resolveNextInspectorState({
      drafts: [],
      draftsLoaded: false,
      inspectorState,
      selectedProjectId: "project-1",
      tickets: [],
      ticketsLoaded: true,
    }),
    null,
  );
});

test("resolveNextInspectorState hides a draft inspector once the draft is confirmed missing", () => {
  assert.deepEqual(
    resolveNextInspectorState({
      drafts: [createDraft("draft-2")],
      draftsLoaded: true,
      inspectorState: { kind: "draft", draftId: "draft-1" },
      selectedProjectId: "project-1",
      tickets: [],
      ticketsLoaded: true,
    }),
    { kind: "hidden" },
  );
});

test("resolveNextInspectorState keeps a session inspector open while tickets are still loading", () => {
  const inspectorState: InspectorState = {
    kind: "session",
    sessionId: "session-1",
  };

  assert.equal(
    resolveNextInspectorState({
      drafts: [],
      draftsLoaded: true,
      inspectorState,
      selectedProjectId: "project-1",
      tickets: [],
      ticketsLoaded: false,
    }),
    null,
  );
});

test("resolveNextInspectorState hides a session inspector after the session disappears", () => {
  assert.deepEqual(
    resolveNextInspectorState({
      drafts: [],
      draftsLoaded: true,
      inspectorState: { kind: "session", sessionId: "session-1" },
      selectedProjectId: "project-1",
      tickets: [createTicket("session-2")],
      ticketsLoaded: true,
    }),
    { kind: "hidden" },
  );
});

test("resolveNextInspectorState hides the new draft inspector when no project remains selected", () => {
  assert.deepEqual(
    resolveNextInspectorState({
      drafts: [createDraft("draft-1")],
      draftsLoaded: true,
      inspectorState: { kind: "new_draft" },
      selectedProjectId: null,
      tickets: [createTicket("session-1")],
      ticketsLoaded: true,
    }),
    { kind: "hidden" },
  );
});
