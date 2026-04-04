import assert from "node:assert/strict";
import test from "node:test";

import { walleyboardTheme } from "./theme.js";

test("badge theme allows compact labels to render without clipping ascenders", () => {
  const badgeLabelStyles = walleyboardTheme.components?.Badge?.styles?.label;
  const badgeRootStyles = walleyboardTheme.components?.Badge?.styles?.root;

  assert.ok(badgeLabelStyles, "Expected shared badge label styles");
  assert.ok(badgeRootStyles, "Expected shared badge root styles");
  assert.equal(badgeLabelStyles.lineHeight, 1.15);
  assert.equal(badgeLabelStyles.textBoxEdge, "unset");
  assert.equal(badgeLabelStyles.textBoxTrim, "unset");
  assert.equal(badgeRootStyles.height, "auto");
  assert.equal(badgeRootStyles.minHeight, "var(--badge-height)");
  assert.equal(badgeRootStyles.lineHeight, 1.15);
  assert.equal(badgeRootStyles.overflow, "visible");
  assert.equal(
    badgeRootStyles.paddingBlock,
    "calc(0.0625rem * var(--mantine-scale))",
  );
});
