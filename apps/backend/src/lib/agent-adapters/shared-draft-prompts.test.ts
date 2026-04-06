import assert from "node:assert/strict";
import test from "node:test";

import type {
  DraftTicketState,
  RepositoryConfig,
} from "../../../../../packages/contracts/src/index.js";

import {
  buildDraftQuestionsPrompt,
  buildDraftRefinementPrompt,
} from "./shared-draft-prompts.js";

function createRepository(): RepositoryConfig {
  return {
    id: "repo-1",
    project_id: "project-1",
    name: "spacegame",
    path: "/tmp/spacegame",
    target_branch: "main",
    setup_hook: null,
    cleanup_hook: null,
    validation_profile: [],
    extra_env_allowlist: [],
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
  };
}

function createDraft(): DraftTicketState {
  return {
    id: "draft-1",
    project_id: "project-1",
    artifact_scope_id: "artifact-scope-1",
    title_draft: "Handle menu navigation",
    description_draft: "Escape should return to the main menu during gameplay.",
    proposed_repo_id: "repo-1",
    confirmed_repo_id: "repo-1",
    proposed_ticket_type: "feature",
    proposed_acceptance_criteria: [
      "Escape returns the player to the main menu.",
      "Gamepad cancel uses the same behavior.",
    ],
    wizard_status: "editing",
    split_proposal_summary: null,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
  };
}

test("buildDraftRefinementPrompt uses human-readable Markdown sections", () => {
  const prompt = buildDraftRefinementPrompt(
    createDraft(),
    createRepository(),
    ["context7", "sentry"],
    "Prefer the terminology already used in the repo.",
  );

  assert.match(prompt, /## Objective/);
  assert.match(prompt, /## Draft/);
  assert.match(prompt, /### Title/);
  assert.match(prompt, /### Description/);
  assert.match(prompt, /### Proposed Ticket Type/);
  assert.match(prompt, /## Proposed Acceptance Checklist/);
  assert.match(prompt, /## Available MCPs/);
  assert.match(prompt, /- `context7` - enabled/);
  assert.match(prompt, /- `sentry` - enabled/);
  assert.doesNotMatch(prompt, /chat response/);
  assert.doesNotMatch(prompt, /output files/);
  assert.match(prompt, /## Context/);
  assert.match(prompt, /### Additional Instruction/);
  assert.match(prompt, /## Guardrails/);
  assert.doesNotMatch(prompt, /## Output JSON/);
  assert.doesNotMatch(prompt, /```json/);
  assert.doesNotMatch(prompt, /title_draft:/);
  assert.doesNotMatch(prompt, /criterion_1:/);
});

test("buildDraftQuestionsPrompt keeps the shared prompt focused on task context", () => {
  const prompt = buildDraftQuestionsPrompt(
    createDraft(),
    createRepository(),
    [],
  );

  assert.match(prompt, /## Objective/);
  assert.match(prompt, /## Draft/);
  assert.match(prompt, /## Proposed Acceptance Checklist/);
  assert.doesNotMatch(prompt, /## Available MCPs/);
  assert.doesNotMatch(prompt, /chat response/);
  assert.doesNotMatch(prompt, /output files/);
  assert.match(prompt, /1\. Escape returns the player to the main menu\./);
  assert.match(prompt, /## Guardrails/);
  assert.doesNotMatch(prompt, /## Output JSON/);
  assert.doesNotMatch(prompt, /"open_questions":\["string"\]/);
  assert.doesNotMatch(prompt, /Return JSON only/);
});
