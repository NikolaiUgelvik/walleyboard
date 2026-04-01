import assert from "node:assert/strict";
import test from "node:test";

import type { DraftTicketState } from "../../../../packages/contracts/src/index.js";

import {
  type DraftEditorFields,
  type PendingDraftEditorSync,
  resolveDraftEditorSync,
} from "./draft-editor-sync.js";

function createDraft(
  overrides: Partial<DraftTicketState> = {},
): DraftTicketState {
  return {
    id: "draft-1",
    project_id: "project-1",
    artifact_scope_id: "artifact-scope-1",
    title_draft: "Initial title",
    description_draft: "Initial description",
    proposed_repo_id: "repo-1",
    confirmed_repo_id: null,
    proposed_ticket_type: "feature",
    proposed_acceptance_criteria: ["First criterion"],
    wizard_status: "editing",
    split_proposal_summary: null,
    created_at: "2026-04-01T10:00:00.000Z",
    updated_at: "2026-04-01T10:00:00.000Z",
    ...overrides,
  };
}

test("unsaved draft refine sync updates the editor after completion", () => {
  const editor: DraftEditorFields = {
    sourceId: "draft-1",
    title: "Initial title",
    description: "Initial description",
    ticketType: "feature",
    acceptanceCriteria: "First criterion",
  };
  const pendingSync: PendingDraftEditorSync = {
    draftId: "draft-1",
    sourceUpdatedAt: null,
    title: editor.title,
    description: editor.description,
    ticketType: editor.ticketType,
    acceptanceCriteria: editor.acceptanceCriteria,
  };

  const initialResult = resolveDraftEditorSync({
    draftFormDirty: false,
    editor,
    pendingSync,
    selectedDraft: createDraft(),
  });

  assert.equal(initialResult.nextEditor, undefined);
  assert.deepEqual(initialResult.nextPendingSync, {
    ...pendingSync,
    sourceUpdatedAt: "2026-04-01T10:00:00.000Z",
  });

  const completedResult = resolveDraftEditorSync({
    draftFormDirty: true,
    editor,
    pendingSync: initialResult.nextPendingSync ?? null,
    selectedDraft: createDraft({
      title_draft: "Refined title",
      description_draft: "Refined description",
      proposed_acceptance_criteria: ["Refined criterion"],
      wizard_status: "awaiting_confirmation",
      updated_at: "2026-04-01T10:00:05.000Z",
    }),
  });

  assert.deepEqual(completedResult.nextEditor, {
    sourceId: "draft-1",
    title: "Refined title",
    description: "Refined description",
    ticketType: "feature",
    acceptanceCriteria: "Refined criterion",
  });
  assert.equal(completedResult.nextPendingSync, null);
});
