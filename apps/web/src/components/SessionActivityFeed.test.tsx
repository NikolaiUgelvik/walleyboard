import assert from "node:assert/strict";
import test from "node:test";

import { MantineProvider } from "@mantine/core";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ExecutionSession } from "../../../../packages/contracts/src/index.js";
import { SessionActivityFeed } from "./SessionActivityFeed.js";

function createSession(
  agentAdapter: ExecutionSession["agent_adapter"] = "codex",
): ExecutionSession {
  return {
    id: "session-1",
    ticket_id: 12,
    project_id: "project-1",
    repo_id: "repo-1",
    agent_adapter: agentAdapter,
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
    last_summary:
      agentAdapter === "claude-code"
        ? "Claude Code is currently working on the ticket."
        : "Codex is currently working on the ticket.",
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

test("renders raw file change JSON as readable file update activity", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      MantineProvider,
      null,
      React.createElement(SessionActivityFeed, {
        logs: [
          JSON.stringify({
            type: "item.started",
            item: {
              id: "item_83",
              type: "file_change",
              changes: [
                {
                  path: "/workspace/apps/web/src/components/AgentReviewHistoryModal.test.tsx",
                  kind: "update",
                },
              ],
              status: "in_progress",
            },
          }),
          JSON.stringify({
            type: "item.completed",
            item: {
              id: "item_83",
              type: "file_change",
              changes: [
                {
                  path: "/workspace/apps/web/src/components/AgentReviewHistoryModal.test.tsx",
                  kind: "update",
                },
              ],
              status: "completed",
            },
          }),
        ],
        session: createSession(),
      }),
    ),
  );

  assert.match(html, /Updated file/);
  assert.match(html, /Editing file/);
  assert.match(
    html,
    /apps\/web\/src\/components\/AgentReviewHistoryModal\.test\.tsx/,
  );
  assert.doesNotMatch(html, /&quot;type&quot;:&quot;item\.completed&quot;/);
});

test("renders summarized file change events without raw JSON", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      MantineProvider,
      null,
      React.createElement(SessionActivityFeed, {
        logs: [
          "[codex file_change.completed] /workspace/apps/backend/src/lib/sqlite-store.test.ts, /workspace/apps/web/src/components/AgentReviewHistoryModal.test.tsx",
        ],
        session: createSession(),
      }),
    ),
  );

  assert.match(html, /Updated files/);
  assert.match(html, /apps\/backend\/src\/lib\/sqlite-store\.test\.ts/);
  assert.match(
    html,
    /apps\/web\/src\/components\/AgentReviewHistoryModal\.test\.tsx/,
  );
});

test("renders raw web search JSON as readable web activity", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      MantineProvider,
      null,
      React.createElement(SessionActivityFeed, {
        logs: [
          JSON.stringify({
            type: "item.started",
            item: {
              id: "ws_0",
              type: "web_search",
              query: "",
              action: {
                type: "other",
              },
            },
          }),
          JSON.stringify({
            type: "item.completed",
            item: {
              id: "ws_1",
              type: "web_search",
              query: "Simple Icons license CC0 OpenAI icon Claude icon",
              action: {
                type: "search",
                query: "Simple Icons license CC0 OpenAI icon Claude icon",
              },
            },
          }),
          JSON.stringify({
            type: "item.completed",
            item: {
              id: "ws_2",
              type: "web_search",
              query:
                "https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md",
              action: {
                type: "other",
              },
            },
          }),
        ],
        session: createSession(),
      }),
    ),
  );

  assert.match(html, /Searched web/);
  assert.match(html, /Opened web page/);
  assert.match(html, /Simple Icons license CC0 OpenAI icon Claude icon/);
  assert.match(
    html,
    /https:\/\/github\.com\/simple-icons\/simple-icons\/blob\/develop\/DISCLAIMER\.md/,
  );
  assert.doesNotMatch(html, /&quot;type&quot;:&quot;item\.completed&quot;/);
  assert.doesNotMatch(html, /Searching web/);
});

test("renders summarized web search events without raw JSON", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      MantineProvider,
      null,
      React.createElement(SessionActivityFeed, {
        logs: [
          "[codex web_search.search] site:github.com/simple-icons/simple-icons OpenAI SVG simple-icons",
          "[codex web_search.open] https://github.com/simple-icons/simple-icons",
        ],
        session: createSession(),
      }),
    ),
  );

  assert.match(html, /Searched web/);
  assert.match(html, /Opened web page/);
  assert.doesNotMatch(html, /&quot;type&quot;:&quot;item\.completed&quot;/);
});

test("renders raw todo list JSON as readable plan activity", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      MantineProvider,
      null,
      React.createElement(SessionActivityFeed, {
        logs: [
          JSON.stringify({
            type: "item.started",
            item: {
              id: "item_51",
              type: "todo_list",
              items: [
                {
                  text: "Vendor SVG assets and document third-party license/source",
                  completed: false,
                },
                {
                  text: "Wire icons into Agent CLI selector rendering without behavior changes",
                  completed: false,
                },
                {
                  text: "Add focused regression test",
                  completed: false,
                },
              ],
            },
          }),
        ],
        session: createSession(),
      }),
    ),
  );

  assert.match(html, /Plan updated/);
  assert.match(
    html,
    /Vendor SVG assets and document third-party license\/source/,
  );
  assert.match(
    html,
    /Wire icons into Agent CLI selector rendering without behavior changes/,
  );
  assert.match(html, /1 more items/);
  assert.match(html, /0\/3 completed/);
  assert.doesNotMatch(html, /&quot;type&quot;:&quot;item\.started&quot;/);
});

test("renders Claude Bash tool-use JSON as a readable activity row", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      MantineProvider,
      null,
      React.createElement(SessionActivityFeed, {
        logs: [
          `[claude-code assistant] ${JSON.stringify({
            type: "assistant",
            message: {
              model: "claude-opus-4-6",
              content: [
                {
                  type: "tool_use",
                  id: "toolu_01SJJ4qygzCgg5oDuM7Q9N4k",
                  name: "Bash",
                  input: {
                    command:
                      'git add README.md && git commit -m "Add README.md with project documentation template"',
                  },
                },
              ],
            },
          })}`,
        ],
        session: createSession("claude-code"),
      }),
    ),
  );

  assert.match(html, /Ran command/);
  assert.match(html, /git add README\.md/);
  assert.doesNotMatch(html, /&quot;type&quot;:&quot;assistant&quot;/);
  assert.doesNotMatch(html, /tool_use/);
});

test("renders Claude Write tool-use JSON as a readable file activity row", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      MantineProvider,
      null,
      React.createElement(SessionActivityFeed, {
        logs: [
          `[claude-code assistant] ${JSON.stringify({
            type: "assistant",
            message: {
              model: "claude-opus-4-6",
              content: [
                {
                  type: "tool_use",
                  id: "toolu_012kupgTfEX6Wx6Yms4sgVDB",
                  name: "Write",
                  input: {
                    file_path: "/workspace/README.md",
                    content:
                      "# claude-test\n\nA brief description of the project.\n\n## Getting Started\n\nProject documentation template",
                  },
                },
              ],
            },
          })}`,
        ],
        session: createSession("claude-code"),
      }),
    ),
  );

  assert.match(html, /Editing file/);
  assert.match(html, /README\.md/);
  assert.doesNotMatch(html, /Project documentation template/);
  assert.doesNotMatch(html, /&quot;type&quot;:&quot;assistant&quot;/);
});

test("renders Claude file creation tool results as readable activity rows", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      MantineProvider,
      null,
      React.createElement(SessionActivityFeed, {
        logs: [
          `[claude-code user] ${JSON.stringify({
            type: "user",
            message: {
              role: "user",
              content: [
                {
                  tool_use_id: "toolu_012kupgTfEX6Wx6Yms4sgVDB",
                  type: "tool_result",
                  content: "File created successfully at: /workspace/README.md",
                  is_error: false,
                },
              ],
            },
            tool_use_result: {
              type: "create",
              filePath: "/workspace/README.md",
              content: "# claude-test",
            },
          })}`,
        ],
        session: createSession("claude-code"),
      }),
    ),
  );

  assert.match(html, /Created file/);
  assert.match(html, /README\.md/);
  assert.doesNotMatch(html, /File created successfully at:/);
  assert.doesNotMatch(html, /tool_use_result/);
});

test("renders Claude commit tool results as readable activity rows", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      MantineProvider,
      null,
      React.createElement(SessionActivityFeed, {
        logs: [
          `[claude-code user] ${JSON.stringify({
            type: "user",
            message: {
              role: "user",
              content: [
                {
                  tool_use_id: "toolu_01SJJ4qygzCgg5oDuM7Q9N4k",
                  type: "tool_result",
                  content:
                    "[claude/ticket-19-create-readme-md-with-pr e3dce4d] Add README.md with project documentation template\n 1 file changed, 37 insertions(+)\n create mode 100644 README.md",
                  is_error: false,
                },
              ],
            },
            tool_use_result: {
              stdout:
                "[claude/ticket-19-create-readme-md-with-pr e3dce4d] Add README.md with project documentation template\n 1 file changed, 37 insertions(+)\n create mode 100644 README.md",
            },
          })}`,
        ],
        session: createSession("claude-code"),
      }),
    ),
  );

  assert.match(html, /Created commit/);
  assert.match(html, /e3dce4d/);
  assert.match(html, /Add README\.md with project documentation template/);
  assert.doesNotMatch(html, /tool_use_result/);
  assert.doesNotMatch(html, /&quot;type&quot;:&quot;user&quot;/);
});

test("renders summarized todo list events without raw JSON", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      MantineProvider,
      null,
      React.createElement(SessionActivityFeed, {
        logs: [
          "[codex todo_list.started] Vendor SVG assets and document third-party license/source | Wire icons into Agent CLI selector rendering without behavior changes (+1 more) [0/3]",
        ],
        session: createSession(),
      }),
    ),
  );

  assert.match(html, /Plan updated/);
  assert.match(html, /0\/3 completed/);
  assert.doesNotMatch(html, /&quot;type&quot;:&quot;item\.started&quot;/);
});

test("suppresses top-level Codex turn and thread envelope events", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      MantineProvider,
      null,
      React.createElement(SessionActivityFeed, {
        logs: [
          JSON.stringify({
            type: "turn.started",
          }),
          JSON.stringify({
            type: "thread.started",
            thread_id: "019d53d4-84ec-7a30-9142-b564455d4ce1",
          }),
        ],
        session: createSession(),
      }),
    ),
  );

  assert.match(
    html,
    /No interpreted activity is available for this session yet/,
  );
  assert.doesNotMatch(html, /thread_id/);
  assert.doesNotMatch(html, /turn\.started/);
  assert.doesNotMatch(html, /thread\.started/);
});
