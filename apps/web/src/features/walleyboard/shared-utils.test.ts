import assert from "node:assert/strict";
import test from "node:test";

import {
  getProjectColorSwatchForegroundColor,
  pickProjectColor,
  projectColorPalette,
} from "./shared-utils.js";

function colorChannelToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: string): number {
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);

  return (
    colorChannelToLinear(red) * 0.2126 +
    colorChannelToLinear(green) * 0.7152 +
    colorChannelToLinear(blue) * 0.0722
  );
}

function contrastRatio(left: string, right: string): number {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  const lighter = Math.max(leftLuminance, rightLuminance);
  const darker = Math.min(leftLuminance, rightLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

test("pickProjectColor selects an unused swatch when one is available", () => {
  const color = pickProjectColor(
    [
      { color: projectColorPalette[0] },
      { color: projectColorPalette[2] },
      { color: projectColorPalette[4] },
    ],
    () => 0,
  );

  assert.equal(color, projectColorPalette[1]);
});

test("pickProjectColor reuses a swatch when every swatch is already in use", () => {
  const color = pickProjectColor(
    projectColorPalette.map((swatch) => ({ color: swatch })),
    () => 0,
  );

  assert.equal(color, projectColorPalette[0]);
});

test("getProjectColorSwatchForegroundColor keeps every palette swatch legible", () => {
  for (const swatch of projectColorPalette) {
    const foreground = getProjectColorSwatchForegroundColor(swatch);
    assert.ok(
      contrastRatio(swatch, foreground) >= 3,
      `Expected ${swatch} to keep at least 3:1 contrast with ${foreground}`,
    );
  }
});
