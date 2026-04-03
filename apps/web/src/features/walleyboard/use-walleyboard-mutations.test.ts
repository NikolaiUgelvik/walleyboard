import assert from "node:assert/strict";
import test from "node:test";

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
