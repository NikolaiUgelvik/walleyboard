import assert from "node:assert/strict";
import test from "node:test";

import {
  createProjectInputSchema,
  updateProjectInputSchema,
} from "../../../../packages/contracts/src/index.js";

test("project create and update inputs reject colors outside the fixed palette", () => {
  assert.equal(
    createProjectInputSchema.safeParse({
      name: "WalleyBoard",
      color: "#123456",
      repository: {
        name: "walleyboard",
        path: "/workspace",
      },
    }).success,
    false,
  );

  assert.equal(
    updateProjectInputSchema.safeParse({
      color: "#123456",
    }).success,
    false,
  );
});
