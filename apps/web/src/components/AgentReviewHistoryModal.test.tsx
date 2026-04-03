import assert from "node:assert/strict";
import test from "node:test";

import { MantineProvider } from "@mantine/core";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentReviewHistoryList } from "./AgentReviewHistoryModal.js";

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

test("renders completed summaries and in-progress review states", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      MantineProvider,
      {},
      React.createElement(AgentReviewHistoryList, {
        reviewRuns: [
          {
            id: "review-run-1",
            ticket_id: 7,
            review_package_id: "review-package-1",
            implementation_session_id: "session-7",
            status: "completed",
            adapter_session_ref: "adapter-session-1",
            report: {
              summary: "The first stored summary remains visible.",
              strengths: [],
              actionable_findings: [],
            },
            failure_message: null,
            created_at: "2026-04-03T00:00:00.000Z",
            updated_at: "2026-04-03T00:01:00.000Z",
            completed_at: "2026-04-03T00:01:00.000Z",
          },
          {
            id: "review-run-2",
            ticket_id: 7,
            review_package_id: "review-package-2",
            implementation_session_id: "session-7",
            status: "running",
            adapter_session_ref: null,
            report: null,
            failure_message: null,
            created_at: "2026-04-03T00:02:00.000Z",
            updated_at: "2026-04-03T00:02:00.000Z",
            completed_at: null,
          },
        ],
        reviewRunsPending: false,
        reviewRunsError: null,
      }),
    ),
  );

  assert.match(html, /1\. Run review-run-1/);
  assert.match(html, /2\. Run review-run-2/);
  assert.match(html, /The first stored summary remains visible\./);
  assert.match(html, /Review under processing\./);
});
