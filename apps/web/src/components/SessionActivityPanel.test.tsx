import assert from "node:assert/strict";
import test from "node:test";

import { MantineProvider } from "@mantine/core";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type {
  ExecutionAttempt,
  ExecutionSession,
  StructuredEvent,
} from "../../../../packages/contracts/src/index.js";
import { SessionActivityPanel } from "./SessionActivityPanel.js";

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

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
    window,
    cleanup() {
      mountNode.remove();
      for (const restore of restoreGlobals.reverse()) {
        restore();
      }
      dom.window.close();
    },
  };
}

function createSession(): ExecutionSession {
  return {
    id: "session-42",
    ticket_id: 42,
    project_id: "project-1",
    repo_id: "repo-1",
    agent_adapter: "codex",
    worktree_path: "/tmp/worktree-42",
    adapter_session_ref: "sess_42",
    status: "completed",
    planning_enabled: false,
    plan_status: "not_requested",
    plan_summary: null,
    current_attempt_id: "attempt-2",
    latest_requested_change_note_id: null,
    latest_review_package_id: null,
    queue_entered_at: null,
    started_at: "2026-04-04T10:00:00.000Z",
    completed_at: "2026-04-04T10:30:00.000Z",
    last_heartbeat_at: "2026-04-04T10:30:00.000Z",
    last_summary: "The ticket completed successfully.",
  };
}

test("session activity panel defaults to overview and switches to the timeline tab", async () => {
  const harness = installDom();
  const root = createRoot(harness.mountNode);
  const session = createSession();
  const attempts: ExecutionAttempt[] = [
    {
      id: "attempt-1",
      session_id: session.id,
      attempt_number: 1,
      status: "completed",
      prompt_kind: "implementation",
      prompt: "Implement the ticket.",
      pty_pid: null,
      started_at: "2026-04-04T10:00:00.000Z",
      ended_at: "2026-04-04T10:10:00.000Z",
      end_reason: "completed",
    },
  ];
  const events: StructuredEvent[] = [
    {
      id: "event-created",
      occurred_at: "2026-04-04T09:59:00.000Z",
      entity_type: "ticket",
      entity_id: "42",
      event_type: "ticket.created",
      payload: {
        title: "Wire up the activity timeline",
      },
    },
  ];

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <SessionActivityPanel
            attempts={attempts}
            logs={[
              "Session created for ticket #42: Wire up the activity timeline",
            ]}
            reviewRuns={[]}
            session={session}
            ticketEvents={events}
            timelineError={null}
            timelinePending={false}
          />
        </MantineProvider>,
      );
    });

    assert.match(
      harness.window.document.body.textContent ?? "",
      /Execution Summary/,
    );
    assert.doesNotMatch(
      harness.window.document.body.textContent ?? "",
      /Ticket created/,
    );

    const timelineTab = Array.from(
      harness.window.document.querySelectorAll<HTMLElement>('[role="tab"]'),
    ).find((tab) => tab.textContent?.trim() === "Timeline");
    assert.ok(timelineTab);

    await act(async () => {
      timelineTab.dispatchEvent(
        new harness.window.MouseEvent("click", {
          bubbles: true,
        }),
      );
    });

    assert.match(
      harness.window.document.body.textContent ?? "",
      /Ticket created/,
    );
    assert.match(
      harness.window.document.body.textContent ?? "",
      /Implementation prompt prepared for attempt 1/,
    );
    const bodyText = harness.window.document.body.textContent ?? "";
    const implementationPromptIndex = bodyText.indexOf(
      "Implementation prompt prepared for attempt 1",
    );
    const ticketCreatedIndex = bodyText.indexOf("Ticket created");
    assert.ok(implementationPromptIndex >= 0);
    assert.ok(ticketCreatedIndex >= 0);
    assert.ok(implementationPromptIndex < ticketCreatedIndex);
  } finally {
    await act(async () => {
      root.unmount();
    });
    harness.cleanup();
  }
});
