import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeDraftAcceptanceCriteria } from "./draft-acceptance-criteria.js";

test("sanitizeDraftAcceptanceCriteria drops blank placeholders", () => {
  assert.deepEqual(
    sanitizeDraftAcceptanceCriteria(
      [
        "Ship the migration",
        "",
        "   ",
        "\t",
        "Keep the API contract stable",
      ].join("\n"),
    ),
    ["Ship the migration", "Keep the API contract stable"],
  );
});

test("sanitizeDraftAcceptanceCriteria preserves non-empty criterion text", () => {
  assert.deepEqual(
    sanitizeDraftAcceptanceCriteria(
      ["  Preserve intentional spacing  ", "Follow-up"].join("\n"),
    ),
    ["  Preserve intentional spacing  ", "Follow-up"],
  );
});
