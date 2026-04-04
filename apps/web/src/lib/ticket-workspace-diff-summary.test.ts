import assert from "node:assert/strict";
import test from "node:test";

import type { TicketWorkspaceDiff } from "../../../../packages/contracts/src/index.js";

import { summarizeTicketWorkspaceDiff } from "./ticket-workspace-diff-summary.js";

function createDiff(patch: string): TicketWorkspaceDiff {
  return {
    artifact_path: null,
    generated_at: "2026-04-04T00:00:00.000Z",
    patch,
    source: "live_worktree",
    target_branch: "main",
    ticket_id: 29,
    working_branch: "ticket-29",
    worktree_path: "/workspace/.worktrees/ticket-29",
  };
}

test("summarizeTicketWorkspaceDiff counts changed files and line totals from the patch", () => {
  const summary = summarizeTicketWorkspaceDiff(
    createDiff(`diff --git a/src/alpha.ts b/src/alpha.ts
index 1111111..2222222 100644
--- a/src/alpha.ts
+++ b/src/alpha.ts
@@ -1,2 +1,3 @@
 export const alpha = 1;
+export const beta = 2;
-export const gamma = 3;
+export const gamma = 4;
diff --git a/src/bravo.ts b/src/bravo.ts
index 3333333..4444444 100644
--- a/src/bravo.ts
+++ b/src/bravo.ts
@@ -5,0 +6 @@
+export const bravo = true;
`),
  );

  assert.deepEqual(summary, {
    additions: 3,
    deletions: 1,
    files: 2,
  });
});

test("summarizeTicketWorkspaceDiff returns null when the patch cannot be parsed", () => {
  assert.equal(summarizeTicketWorkspaceDiff(createDiff("not a diff")), null);
});
