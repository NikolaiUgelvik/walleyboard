import assert from "node:assert/strict";
import test from "node:test";

import { saveProjectOptionsRequest } from "./shared-api.js";
import {
  editReadyTicketRequest,
  saveDraftRequest,
} from "./use-walleyboard-mutations.js";

test("saveDraftRequest patches the draft update endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{
    input: RequestInfo | URL;
    init?: RequestInit;
  }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init ? { input, init } : { input });

    return new Response(
      JSON.stringify({
        ok: true,
        message: "Draft updated",
        resource_refs: {
          draft_id: "draft-1",
          project_id: "project-1",
        },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  }) as typeof fetch;

  try {
    const response = await saveDraftRequest({
      draftId: "draft-1",
      titleDraft: "Refined but not ready",
      descriptionDraft: "Keep this draft editable.",
      proposedTicketType: "feature",
      proposedAcceptanceCriteria: ["Persist edits while still in draft."],
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.input, "http://127.0.0.1:4000/drafts/draft-1");
    assert.equal(calls[0]?.init?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
      title_draft: "Refined but not ready",
      description_draft: "Keep this draft editable.",
      proposed_ticket_type: "feature",
      proposed_acceptance_criteria: ["Persist edits while still in draft."],
    });
    assert.deepEqual(response, {
      ok: true,
      message: "Draft updated",
      resource_refs: {
        draft_id: "draft-1",
        project_id: "project-1",
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("editReadyTicketRequest posts to the ready ticket edit endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{
    input: RequestInfo | URL;
    init?: RequestInit;
  }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init ? { input, init } : { input });

    return new Response(
      JSON.stringify({
        accepted: true,
        issued_at: "2026-04-03T00:00:00.000Z",
        message: "Ticket moved back to draft",
        resource_refs: {
          draft_id: "draft-24",
          project_id: "project-1",
          ticket_id: 24,
        },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  }) as typeof fetch;

  try {
    const response = await editReadyTicketRequest(24);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.input, "http://127.0.0.1:4000/tickets/24/edit");
    assert.equal(calls[0]?.init?.method, "POST");
    assert.equal(calls[0]?.init?.body, "{}");
    assert.deepEqual(response, {
      accepted: true,
      issued_at: "2026-04-03T00:00:00.000Z",
      message: "Ticket moved back to draft",
      resource_refs: {
        draft_id: "draft-24",
        project_id: "project-1",
        ticket_id: 24,
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("saveProjectOptionsRequest sends disabled MCP server selections", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{
    input: RequestInfo | URL;
    init?: RequestInit;
  }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init ? { input, init } : { input });

    return new Response(
      JSON.stringify({
        accepted: true,
        issued_at: "2026-04-04T00:00:00.000Z",
        message: "Project options saved",
        resource_refs: {
          project_id: "project-1",
        },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  }) as typeof fetch;

  try {
    const response = await saveProjectOptionsRequest("project-1", {
      agent_adapter: "codex",
      execution_backend: "docker",
      disabled_mcp_servers: ["sentry"],
      automatic_agent_review: false,
      automatic_agent_review_run_limit: 1,
      default_review_action: "direct_merge",
      preview_start_command: null,
      pre_worktree_command: null,
      post_worktree_command: null,
      draft_analysis_model: null,
      draft_analysis_reasoning_effort: null,
      ticket_work_model: null,
      ticket_work_reasoning_effort: null,
      repository_target_branches: [],
    });

    assert.equal(calls.length, 1);
    assert.equal(
      calls[0]?.input,
      "http://127.0.0.1:4000/projects/project-1/update",
    );
    assert.equal(calls[0]?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
      agent_adapter: "codex",
      execution_backend: "docker",
      disabled_mcp_servers: ["sentry"],
      automatic_agent_review: false,
      automatic_agent_review_run_limit: 1,
      default_review_action: "direct_merge",
      preview_start_command: null,
      pre_worktree_command: null,
      post_worktree_command: null,
      draft_analysis_model: null,
      draft_analysis_reasoning_effort: null,
      ticket_work_model: null,
      ticket_work_reasoning_effort: null,
      repository_target_branches: [],
    });
    assert.deepEqual(response, {
      accepted: true,
      issued_at: "2026-04-04T00:00:00.000Z",
      message: "Project options saved",
      resource_refs: {
        project_id: "project-1",
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
