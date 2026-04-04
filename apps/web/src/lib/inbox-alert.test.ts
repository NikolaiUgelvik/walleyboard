import assert from "node:assert/strict";
import test from "node:test";

import { hasNewInboxItems } from "./inbox-alert.js";

test("does not alert on the first snapshot", () => {
  assert.equal(hasNewInboxItems(null, ["session-1"]), false);
});

test("alerts when one new inbox item appears", () => {
  assert.equal(
    hasNewInboxItems(["session-1"], ["session-1", "review-2"]),
    true,
  );
});

test("alerts once for a batch with multiple new inbox items", () => {
  assert.equal(
    hasNewInboxItems(["session-1"], ["session-1", "review-2", "review-3"]),
    true,
  );
});

test("does not alert when the inbox keys are unchanged", () => {
  assert.equal(
    hasNewInboxItems(["session-1", "review-2"], ["session-1", "review-2"]),
    false,
  );
});

test("does not alert when inbox items are only removed", () => {
  assert.equal(
    hasNewInboxItems(["session-1", "review-2"], ["session-1"]),
    false,
  );
});

test("does not alert when the same notification instance disappears and reappears", () => {
  const keysAfterRemoval = ["session-1:attempt-1"];

  assert.equal(
    hasNewInboxItems(
      ["session-1:attempt-1", "review-2:attempt-4"],
      keysAfterRemoval,
    ),
    false,
  );
  assert.equal(
    hasNewInboxItems(
      keysAfterRemoval,
      ["session-1:attempt-1", "review-2:attempt-4"],
      new Set(),
      new Set(["session-1:attempt-1", "review-2:attempt-4"]),
    ),
    false,
  );
});

test("does not alert for newly added items that are explicitly ignored", () => {
  assert.equal(
    hasNewInboxItems(
      ["session-1"],
      ["session-1", "review-2"],
      new Set(["review-2"]),
    ),
    false,
  );
});

test("alerts when the same ticket returns with a new notification instance", () => {
  assert.equal(
    hasNewInboxItems(["review-2:attempt-4"], ["review-2:attempt-5"]),
    true,
  );
});
