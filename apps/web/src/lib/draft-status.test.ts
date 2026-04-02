import assert from "node:assert/strict";
import test from "node:test";

import { formatDraftStatusLabel } from "./draft-status.js";

test("shows an explicit in-progress label while draft refinement is active", () => {
  assert.equal(
    formatDraftStatusLabel({
      isRefining: true,
      wizardStatus: "editing",
    }),
    "Refining...",
  );
});

test("falls back to the stored draft wizard status label when refinement is idle", () => {
  assert.equal(
    formatDraftStatusLabel({
      isRefining: false,
      wizardStatus: "awaiting_confirmation",
    }),
    "Awaiting confirmation",
  );
});
