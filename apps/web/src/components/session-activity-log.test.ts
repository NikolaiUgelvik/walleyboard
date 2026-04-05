import assert from "node:assert/strict";
import test from "node:test";

import { parseExecutionSummary } from "./session-activity-log.js";

test("parseExecutionSummary ignores changed files in the overview and supports commit-last summaries", () => {
  const parsed = parseExecutionSummary(`
Implemented the runtime prompt cleanup.

Changed files:
- \`apps/backend/src/lib/agent-adapters/shared-execution-prompts.ts\`
- \`apps/backend/src/lib/agent-adapters/shared-draft-prompts.ts\`

Validation run:
- \`npm test -- --run apps/backend/src/lib/agent-adapters/shared-execution-prompts.test.ts\` - passed
- \`npm test -- --run apps/web/src/components/session-activity-log.test.ts\` - passed

Remaining risks:
- Prompt quality still depends on the downstream model following the required response format.

The change is committed as \`abc123\` with message \`Restructure runtime prompts\`.
`);

  assert.equal(parsed.overview, "Implemented the runtime prompt cleanup.");
  assert.deepEqual(parsed.commit, {
    hash: "abc123",
    message: "Restructure runtime prompts",
  });
  assert.deepEqual(parsed.validation?.commands, [
    "npm test -- --run apps/backend/src/lib/agent-adapters/shared-execution-prompts.test.ts",
    "npm test -- --run apps/web/src/components/session-activity-log.test.ts",
  ]);
  assert.equal(parsed.risks.length, 1);
  assert.match(
    parsed.risks[0] ?? "",
    /downstream model following the required response format/,
  );
});

test("parseExecutionSummary treats explicit no-risk summaries as empty", () => {
  const parsed = parseExecutionSummary(`
Prompt implementation finished successfully.

Validation run:
\`npm test\`.

Remaining risks: None.

The change is committed as \`def456\`.
`);

  assert.deepEqual(parsed.risks, []);
  assert.deepEqual(parsed.commit, {
    hash: "def456",
    message: null,
  });
});
