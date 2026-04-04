import assert from "node:assert/strict";
import test from "node:test";

import { pickProjectColor, projectColorPalette } from "./shared-utils.js";

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
