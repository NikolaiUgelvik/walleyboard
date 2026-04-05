import assert from "node:assert/strict";
import test from "node:test";

import { MantineProvider } from "@mantine/core";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type {
  ExecutionAttempt,
  ExecutionSession,
  ReviewRun,
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

test("timeline copies raw markdown for implementation prompt entries", async () => {
  const harness = installDom();
  const root = createRoot(harness.mountNode);
  const session = createSession();
  const copiedMarkdown: string[] = [];
  const implementationPrompt = [
    "## Implementation prompt",
    "- Add a copy action button",
    "- Keep the rendered markdown unchanged",
    "",
    "```ts",
    "navigator.clipboard.writeText(rawMarkdown);",
    "```",
  ].join("\n");

  Object.defineProperty(harness.window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText(value: string) {
        copiedMarkdown.push(value);
        return Promise.resolve();
      },
    },
  });

  const attempts: ExecutionAttempt[] = [
    {
      id: "attempt-1",
      session_id: session.id,
      attempt_number: 1,
      status: "completed",
      prompt_kind: "plan",
      prompt: "Draft the execution plan first.",
      pty_pid: null,
      started_at: "2026-04-04T10:00:00.000Z",
      ended_at: "2026-04-04T10:05:00.000Z",
      end_reason: "plan_completed",
    },
    {
      id: "attempt-2",
      session_id: session.id,
      attempt_number: 2,
      status: "completed",
      prompt_kind: "implementation",
      prompt: implementationPrompt,
      pty_pid: null,
      started_at: "2026-04-04T10:06:00.000Z",
      ended_at: "2026-04-04T10:30:00.000Z",
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
            logs={[]}
            reviewRuns={[]}
            session={session}
            ticketEvents={events}
            timelineError={null}
            timelinePending={false}
          />
        </MantineProvider>,
      );
    });

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

    const bodyText = harness.window.document.body.textContent ?? "";
    assert.match(bodyText, /Plan prompt prepared for attempt 1/);
    assert.match(bodyText, /Implementation prompt prepared for attempt 2/);
    assert.match(bodyText, /Ticket created/);

    const copyButtons = Array.from(
      harness.window.document.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="Copy raw prompt markdown"]',
      ),
    );
    assert.equal(copyButtons.length, 1);

    await act(async () => {
      copyButtons[0]?.dispatchEvent(
        new harness.window.MouseEvent("click", {
          bubbles: true,
        }),
      );
    });

    assert.deepEqual(copiedMarkdown, [implementationPrompt]);
  } finally {
    await act(async () => {
      root.unmount();
    });
    harness.cleanup();
  }
});

test("timeline copies raw markdown for AI review prompt entries", async () => {
  const harness = installDom();
  const root = createRoot(harness.mountNode);
  const session = createSession();
  const copiedMarkdown: string[] = [];
  const reviewPrompt = [
    "# Review checklist",
    "- Confirm the copy action only appears on prompt rows",
    "- Verify the clipboard receives the raw markdown",
  ].join("\n");

  Object.defineProperty(harness.window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText(value: string) {
        copiedMarkdown.push(value);
        return Promise.resolve();
      },
    },
  });

  const attempts: ExecutionAttempt[] = [
    {
      id: "attempt-1",
      session_id: session.id,
      attempt_number: 1,
      status: "completed",
      prompt_kind: "plan",
      prompt: "Draft the execution plan first.",
      pty_pid: null,
      started_at: "2026-04-04T10:00:00.000Z",
      ended_at: "2026-04-04T10:05:00.000Z",
      end_reason: "plan_completed",
    },
  ];
  const reviewRuns: ReviewRun[] = [
    {
      id: "review-run-1",
      ticket_id: session.ticket_id,
      review_package_id: "review-package-1",
      implementation_session_id: session.id,
      status: "completed",
      adapter_session_ref: null,
      prompt: reviewPrompt,
      report: {
        summary: "Review completed successfully.",
        strengths: [],
        actionable_findings: [],
      },
      failure_message: null,
      created_at: "2026-04-04T10:10:00.000Z",
      updated_at: "2026-04-04T10:12:00.000Z",
      completed_at: "2026-04-04T10:12:00.000Z",
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
            logs={[]}
            reviewRuns={reviewRuns}
            session={session}
            ticketEvents={events}
            timelineError={null}
            timelinePending={false}
          />
        </MantineProvider>,
      );
    });

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

    const bodyText = harness.window.document.body.textContent ?? "";
    assert.match(bodyText, /AI review prompt prepared/);
    assert.match(bodyText, /Plan prompt prepared for attempt 1/);
    assert.match(bodyText, /Ticket created/);

    const copyButtons = Array.from(
      harness.window.document.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="Copy raw prompt markdown"]',
      ),
    );
    assert.equal(copyButtons.length, 1);

    await act(async () => {
      copyButtons[0]?.dispatchEvent(
        new harness.window.MouseEvent("click", {
          bubbles: true,
        }),
      );
    });

    assert.deepEqual(copiedMarkdown, [reviewPrompt]);
  } finally {
    await act(async () => {
      root.unmount();
    });
    harness.cleanup();
  }
});

test("timeline copies raw markdown for restart prompt entries", async () => {
  const harness = installDom();
  const root = createRoot(harness.mountNode);
  const session = createSession();
  const copiedMarkdown: string[] = [];
  const restartPrompt = [
    "## Fresh restart guidance",
    "- Reset the worktree",
    "- Re-run the validation checks",
  ].join("\n");

  Object.defineProperty(harness.window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText(value: string) {
        copiedMarkdown.push(value);
        return Promise.resolve();
      },
    },
  });

  const attempts: ExecutionAttempt[] = [
    {
      id: "attempt-4",
      session_id: session.id,
      attempt_number: 4,
      status: "queued",
      prompt_kind: "implementation",
      prompt: "Continue implementation.",
      pty_pid: null,
      started_at: "2026-04-04T10:20:00.000Z",
      ended_at: null,
      end_reason: null,
    },
  ];

  try {
    await act(async () => {
      root.render(
        <MantineProvider>
          <SessionActivityPanel
            attempts={attempts}
            logs={[
              `Fresh restart guidance recorded:\n${restartPrompt}`,
              "Starting fresh execution attempt 4.",
            ]}
            reviewRuns={[]}
            session={session}
            ticketEvents={[]}
            timelineError={null}
            timelinePending={false}
          />
        </MantineProvider>,
      );
    });

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

    const bodyText = harness.window.document.body.textContent ?? "";
    assert.match(bodyText, /Fresh restart guidance/);
    assert.match(bodyText, /Implementation prompt prepared for attempt 4/);

    const copyButtons = Array.from(
      harness.window.document.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="Copy raw prompt markdown"]',
      ),
    );
    assert.equal(copyButtons.length, 2);

    const restartCopyButton = copyButtons.find((button) =>
      button
        .closest(".session-timeline-card")
        ?.textContent?.includes("Fresh restart guidance"),
    );
    assert.ok(restartCopyButton);

    await act(async () => {
      restartCopyButton.dispatchEvent(
        new harness.window.MouseEvent("click", {
          bubbles: true,
        }),
      );
    });

    assert.deepEqual(copiedMarkdown, [restartPrompt]);
  } finally {
    await act(async () => {
      root.unmount();
    });
    harness.cleanup();
  }
});
