import assert from "node:assert/strict";
import test from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type {
  ProtocolEvent,
  ReviewRun,
} from "../../../../../packages/contracts/src/index.js";

import { useProtocolEventSync } from "./use-protocol-event-sync.js";

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

class FakeSocket {
  readonly #listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  disconnect(): void {}

  emitServer(event: string, payload: unknown): void {
    for (const listener of this.#listeners.get(event) ?? []) {
      listener(payload);
    }
  }

  on(event: string, listener: (...args: unknown[]) => void): this {
    const listeners = this.#listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(event, listeners);
    return this;
  }
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

function installDom(socketFactory: () => FakeSocket) {
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
    installGlobal("__WALLEYBOARD_SOCKET_IO_FACTORY__", socketFactory),
  ];

  return () => {
    for (const restore of restoreGlobals.reverse()) {
      restore();
    }
    dom.window.close();
  };
}

function SyncProbe({ queryClient }: { queryClient: QueryClient }) {
  useProtocolEventSync({
    queryClient,
    selectedDraftId: null,
    selectedProjectId: null,
    selectedSessionId: null,
    setInspectorState() {},
  });

  return null;
}

test("review_run.updated hydrates the latest review-run cache without polling", async () => {
  const sockets: FakeSocket[] = [];
  const restoreDom = installDom(() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  });
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });
  const container = document.createElement("div");
  const root = createRoot(container);

  try {
    queryClient.setQueryData(["tickets", 31, "review-runs"], {
      review_runs: [],
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SyncProbe queryClient={queryClient} />
        </QueryClientProvider>,
      );
    });

    const reviewRun: ReviewRun = {
      id: "review-run-31",
      ticket_id: 31,
      review_package_id: "review-package-31",
      implementation_session_id: "session-31",
      status: "running",
      adapter_session_ref: null,
      prompt: "Review ticket 31.",
      report: null,
      failure_message: null,
      created_at: "2026-04-04T00:00:00.000Z",
      updated_at: "2026-04-04T00:00:00.000Z",
      completed_at: null,
    };
    const protocolEvent: ProtocolEvent = {
      entity_id: reviewRun.id,
      entity_type: "review_run",
      event_id: "event-31",
      event_type: "review_run.updated",
      occurred_at: "2026-04-04T00:00:00.000Z",
      payload: {
        review_run: reviewRun,
      },
    };

    await act(async () => {
      sockets[0]?.emitServer("protocol.event", protocolEvent);
    });

    assert.deepEqual(queryClient.getQueryData(["tickets", 31, "review-run"]), {
      review_run: reviewRun,
    });
    assert.equal(
      queryClient.getQueryState(["tickets", 31, "review-runs"])?.isInvalidated,
      true,
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    restoreDom();
  }
});

test("timeline-backed queries invalidate on session, ticket, archive, and review-package events", async () => {
  const sockets: FakeSocket[] = [];
  const restoreDom = installDom(() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  });
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });
  const container = document.createElement("div");
  const root = createRoot(container);

  try {
    queryClient.setQueryData(["sessions", "session-44", "attempts"], {
      attempts: [],
    });
    queryClient.setQueryData(["tickets", 41, "events"], {
      events: [],
    });
    queryClient.setQueryData(["tickets", 42, "events"], {
      events: [],
    });
    queryClient.setQueryData(["tickets", 43, "review-runs"], {
      review_runs: [],
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SyncProbe queryClient={queryClient} />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      sockets[0]?.emitServer("protocol.event", {
        entity_id: "session-44",
        entity_type: "session",
        event_id: "event-session-44",
        event_type: "session.updated",
        occurred_at: "2026-04-04T01:00:00.000Z",
        payload: {
          session: {
            id: "session-44",
            ticket_id: 44,
            project_id: "project-1",
            repo_id: "repo-1",
            agent_adapter: "codex",
            worktree_path: "/tmp/worktree-44",
            adapter_session_ref: null,
            status: "running",
            planning_enabled: false,
            plan_status: "not_requested",
            plan_summary: null,
            current_attempt_id: "attempt-44",
            latest_requested_change_note_id: null,
            latest_review_package_id: null,
            queue_entered_at: null,
            started_at: "2026-04-04T00:55:00.000Z",
            completed_at: null,
            last_heartbeat_at: "2026-04-04T01:00:00.000Z",
            last_summary: "Running.",
          },
          agent_controls_worktree: true,
        },
      } satisfies ProtocolEvent);
      sockets[0]?.emitServer("protocol.event", {
        entity_id: "41",
        entity_type: "ticket",
        event_id: "event-ticket-41",
        event_type: "ticket.updated",
        occurred_at: "2026-04-04T01:01:00.000Z",
        payload: {
          ticket: {
            id: 41,
            project: "project-1",
            repo: "repo-1",
            artifact_scope_id: "artifact-41",
            status: "review",
            title: "Ticket 41",
            description: "Review the timeline",
            ticket_type: "feature",
            acceptance_criteria: [],
            working_branch: "ticket-41",
            target_branch: "main",
            linked_pr: null,
            session_id: "session-41",
            created_at: "2026-04-04T00:00:00.000Z",
            updated_at: "2026-04-04T01:01:00.000Z",
          },
        },
      } satisfies ProtocolEvent);
      sockets[0]?.emitServer("protocol.event", {
        entity_id: "42",
        entity_type: "ticket",
        event_id: "event-ticket-42",
        event_type: "ticket.archived",
        occurred_at: "2026-04-04T01:02:00.000Z",
        payload: {
          ticket_id: 42,
          project_id: "project-1",
          session_id: "session-42",
        },
      } satisfies ProtocolEvent);
      sockets[0]?.emitServer("protocol.event", {
        entity_id: "review-package-43",
        entity_type: "review_package",
        event_id: "event-review-package-43",
        event_type: "review_package.generated",
        occurred_at: "2026-04-04T01:03:00.000Z",
        payload: {
          review_package: {
            id: "review-package-43",
            ticket_id: 43,
            session_id: "session-43",
            diff_ref: "/tmp/review.diff",
            commit_refs: [],
            change_summary: "Ready for review",
            validation_results: [],
            remaining_risks: [],
            created_at: "2026-04-04T01:03:00.000Z",
          },
        },
      } satisfies ProtocolEvent);
    });

    assert.equal(
      queryClient.getQueryState(["sessions", "session-44", "attempts"])
        ?.isInvalidated,
      true,
    );
    assert.equal(
      queryClient.getQueryState(["tickets", 41, "events"])?.isInvalidated,
      true,
    );
    assert.equal(
      queryClient.getQueryState(["tickets", 42, "events"])?.isInvalidated,
      true,
    );
    assert.equal(
      queryClient.getQueryState(["tickets", 43, "review-runs"])?.isInvalidated,
      true,
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    restoreDom();
  }
});
