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

test("alerts when an item disappears and later reappears", () => {
  const keysAfterRemoval = ["session-1"];

  assert.equal(
    hasNewInboxItems(["session-1", "review-2"], keysAfterRemoval),
    false,
  );
  assert.equal(
    hasNewInboxItems(keysAfterRemoval, ["session-1", "review-2"]),
    true,
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
