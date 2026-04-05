import assert from "node:assert/strict";
import test from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";

import {
  getTicketsWithVisibleDiffSummary,
  useTicketDiffLineSummary,
} from "./use-ticket-diff-line-summary.js";

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

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

function installGlobal(name: string, value: unknown): () => void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true,
  });

  return () => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, name, originalDescriptor);
      return;
    }

    Reflect.deleteProperty(globalThis, name);
  };
}

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const { window } = dom;
  const restoreGlobals = [
    installGlobal("IS_REACT_ACT_ENVIRONMENT", true),
    installGlobal("window", window),
    installGlobal("document", window.document),
    installGlobal("Document", window.Document),
    installGlobal("navigator", window.navigator),
    installGlobal("Element", window.Element),
    installGlobal("HTMLElement", window.HTMLElement),
    installGlobal("MutationObserver", window.MutationObserver),
    installGlobal("Node", window.Node),
    installGlobal("ShadowRoot", window.ShadowRoot),
    installGlobal("SVGElement", window.SVGElement),
  ];
  const mountNode = window.document.createElement("div");
  window.document.body.appendChild(mountNode);

  return {
    mountNode,
    restore: () => {
      mountNode.remove();
      for (const restoreGlobal of restoreGlobals.reverse()) {
        restoreGlobal();
      }
      dom.window.close();
    },
  };
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });
}

async function waitFor(check: () => void): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      check();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  throw lastError;
}

function TicketDiffSummaryProbe({ tickets }: { tickets: TicketFrontmatter[] }) {
  const ticketDiffLineSummaryByTicketId = useTicketDiffLineSummary(tickets);

  return React.createElement(
    "pre",
    undefined,
    JSON.stringify([...ticketDiffLineSummaryByTicketId.entries()]),
  );
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

test("loads persisted line counts for done tickets from the workspace summary endpoint", async () => {
  const dom = installDom();
  const queryClient = createQueryClient();
  const root = createRoot(dom.mountNode);
  const originalFetch = globalThis.fetch;
  const fetchCalls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetchCalls.push(url);

    assert.equal(url, "http://127.0.0.1:4000/tickets/4/workspace/summary");

    return new Response(
      JSON.stringify({
        workspace_summary: {
          added_lines: 3,
          files_changed: 1,
          generated_at: "2026-04-04T00:00:00.000Z",
          has_changes: true,
          removed_lines: 2,
          source: "review_artifact",
          ticket_id: 4,
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
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(TicketDiffSummaryProbe, {
            tickets: [
              createTicket({ id: 1, status: "ready", session_id: null }),
              createTicket({
                id: 4,
                session_id: null,
                status: "done",
                working_branch: null,
              }),
            ],
          }),
        ),
      );
    });

    await waitFor(() => {
      assert.equal(
        dom.mountNode.textContent,
        JSON.stringify([[4, { additions: 3, deletions: 2, files: 1 }]]),
      );
      assert.deepEqual(fetchCalls, [
        "http://127.0.0.1:4000/tickets/4/workspace/summary",
      ]);
    });
  } finally {
    globalThis.fetch = originalFetch;
    await act(async () => {
      root.unmount();
    });
    dom.restore();
  }
});

test("omits done ticket line counts when the persisted summary endpoint reports no summary", async () => {
  const dom = installDom();
  const queryClient = createQueryClient();
  const root = createRoot(dom.mountNode);
  const originalFetch = globalThis.fetch;
  const fetchCalls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetchCalls.push(url);

    assert.equal(url, "http://127.0.0.1:4000/tickets/5/workspace/summary");

    return new Response(
      JSON.stringify({ error: "Ticket has no diff available yet" }),
      {
        status: 409,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  }) as typeof fetch;

  try {
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(TicketDiffSummaryProbe, {
            tickets: [
              createTicket({
                id: 5,
                session_id: null,
                status: "done",
                working_branch: null,
              }),
            ],
          }),
        ),
      );
    });

    await waitFor(() => {
      assert.equal(dom.mountNode.textContent, "[]");
      assert.equal(queryClient.isFetching(), 0);
      assert.deepEqual(fetchCalls, [
        "http://127.0.0.1:4000/tickets/5/workspace/summary",
      ]);
    });
  } finally {
    globalThis.fetch = originalFetch;
    await act(async () => {
      root.unmount();
    });
    dom.restore();
  }
});
