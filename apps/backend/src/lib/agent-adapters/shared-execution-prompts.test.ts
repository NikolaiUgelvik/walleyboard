import assert from "node:assert/strict";
import test from "node:test";

import type {
  RepositoryConfig,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import {
  buildImplementationPrompt,
  buildPlanPrompt,
} from "./shared-execution-prompts.js";

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

function createTicket(): TicketFrontmatter {
  return {
    id: 5,
    project: "project-1",
    repo: "repo-1",
    artifact_scope_id: "artifact-scope-1",
    status: "ready",
    title: "Use referenced ticket patches during follow-up work",
    description: "A follow-up ticket should see the old ticket patch path.",
    ticket_type: "feature",
    acceptance_criteria: ["Mention the referenced ticket patch in context."],
    working_branch: "codex/ticket-5",
    target_branch: "main",
    linked_pr: null,
    session_id: "session-1",
    ticket_references: [
      {
        ticket_id: 3,
        title: "Previous dependency",
        status: "done",
      },
    ],
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
  };
}

test("buildPlanPrompt includes referenced ticket patch context", () => {
  const prompt = buildPlanPrompt(createTicket(), createRepository(), [
    {
      label: "Referenced ticket #3",
      content: [
        "Ticket: #3",
        "Title: Previous dependency",
        "Status: done",
        "Repository: spacegame",
        "Patch file: /walleyboard-home/review-packages/project-1/ticket-3.patch",
      ].join("\n"),
    },
  ]);

  assert.match(prompt, /Additional context:/);
  assert.match(prompt, /Referenced ticket #3:/);
  assert.match(
    prompt,
    /Patch file: \/walleyboard-home\/review-packages\/project-1\/ticket-3\.patch/,
  );
});

test("buildImplementationPrompt includes referenced ticket patch context", () => {
  const prompt = buildImplementationPrompt(
    createTicket(),
    createRepository(),
    [
      {
        label: "Referenced ticket #3",
        content: [
          "Ticket: #3",
          "Title: Previous dependency",
          "Status: done",
          "Repository: spacegame",
          "Patch file: /walleyboard-home/review-packages/project-1/ticket-3.patch",
        ].join("\n"),
      },
    ],
    "Use the prior ticket as the baseline.",
  );

  assert.match(prompt, /Approved plan:/);
  assert.match(prompt, /Use the prior ticket as the baseline\./);
  assert.match(prompt, /Referenced ticket #3:/);
  assert.match(
    prompt,
    /Patch file: \/walleyboard-home\/review-packages\/project-1\/ticket-3\.patch/,
  );
});
