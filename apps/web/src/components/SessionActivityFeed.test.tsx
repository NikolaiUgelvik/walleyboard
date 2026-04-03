import assert from "node:assert/strict";
import test from "node:test";

import { MantineProvider } from "@mantine/core";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ExecutionSession } from "../../../../packages/contracts/src/index.js";
import { SessionActivityFeed } from "./SessionActivityFeed.js";

function createSession(): ExecutionSession {
  return {
    id: "session-1",
    ticket_id: 12,
    project_id: "project-1",
    repo_id: "repo-1",
    agent_adapter: "codex",
    worktree_path: "/tmp/worktree",
    adapter_session_ref: "sess_123",
    status: "running",
    planning_enabled: false,
    plan_status: "not_requested",
    plan_summary: null,
    current_attempt_id: "attempt-1",
    latest_requested_change_note_id: null,
    latest_review_package_id: null,
    queue_entered_at: null,
    started_at: "2026-04-01T00:00:00.000Z",
    completed_at: null,
    last_heartbeat_at: "2026-04-01T00:00:00.000Z",
    last_summary: "Codex is currently working on the ticket.",
  };
}

test("renders prefixed Codex command JSON as a readable activity row", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      MantineProvider,
      null,
      React.createElement(SessionActivityFeed, {
        logs: [
          `[codex item.completed] ${JSON.stringify({
            type: "item.completed",
            item: {
              id: "item_54",
              type: "command_execution",
              command: `/bin/bash -lc "sed -n '240,360p' /workspace/apps/web/src/features/walleyboard/use-protocol-event-sync.ts"`,
              aggregated_output: "const logs = previous?.logs ?? [];",
              exit_code: 0,
              status: "completed",
            },
          })}`,
        ],
        session: createSession(),
      }),
    ),
  );

  assert.match(html, /Read file excerpt/);
  assert.match(
    html,
    /apps\/web\/src\/features\/walleyboard\/use-protocol-event-sync\.ts/,
  );
  assert.doesNotMatch(html, /aggregated_output/);
});

test("renders raw Codex command JSON and summarized command lines without dumping JSON", () => {
  const rawCommandEvent = JSON.stringify({
    type: "item.completed",
    item: {
      id: "item_52",
      type: "command_execution",
      command: `/bin/bash -lc "sed -n '1,320p' /workspace/apps/backend/src/lib/sqlite-store.ts"`,
      aggregated_output: 'import type { CreateDraftInput } from "contracts";',
      exit_code: 0,
      status: "completed",
    },
  });

  const html = renderToStaticMarkup(
    React.createElement(
      MantineProvider,
      null,
      React.createElement(SessionActivityFeed, {
        logs: [
          rawCommandEvent,
          `[codex command.completed] /bin/bash -lc "sed -n '320,520p' /workspace/apps/backend/src/lib/sqlite-store.ts"`,
        ],
        session: createSession(),
      }),
    ),
  );

  assert.match(html, /Read file excerpt/);
  assert.match(html, /apps\/backend\/src\/lib\/sqlite-store\.ts/);
  assert.doesNotMatch(html, /&quot;type&quot;:&quot;item\.completed&quot;/);
});

test("renders search commands with the searched pattern and target files", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      MantineProvider,
      null,
      React.createElement(SessionActivityFeed, {
        logs: [
          `[codex command.completed] /bin/bash -lc 'rg -n "/review-run|review package|review run" /workspace/apps/backend/src/routes/tickets.test.ts /workspace/apps/backend/src/routes/read-workspace-routes.test.ts -S'`,
        ],
        session: createSession(),
      }),
    ),
  );

  assert.match(html, /Searched code/);
  assert.match(html, /review-run\|review package\|review run/);
  assert.match(html, /apps\/backend\/src\/routes\/tickets\.test\.ts/);
  assert.match(
    html,
    /apps\/backend\/src\/routes\/read-workspace-routes\.test\.ts/,
  );
});
