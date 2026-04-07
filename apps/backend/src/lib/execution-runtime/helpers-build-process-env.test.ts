import assert from "node:assert/strict";
import test from "node:test";

import { buildProcessEnv } from "./helpers.js";

test("buildProcessEnv returns process.env entries when called without overrides", () => {
  const result = buildProcessEnv();
  assert.equal(typeof result, "object");
  assert.equal(result.PATH, process.env.PATH);
});

test("buildProcessEnv merges agent env overrides on top of process.env", () => {
  const uniqueKey = `WALLEYBOARD_TEST_KEY_${Date.now()}`;
  const result = buildProcessEnv({ [uniqueKey]: "override_value" });
  assert.equal(result[uniqueKey], "override_value");
  assert.equal(result.PATH, process.env.PATH);
});

test("buildProcessEnv overrides let agent config take precedence over process.env", () => {
  const original = process.env.HOME;
  const result = buildProcessEnv({ HOME: "/custom/home" });
  assert.equal(result.HOME, "/custom/home");
  assert.equal(process.env.HOME, original);
});

test("buildProcessEnv with empty overrides matches no-argument behavior", () => {
  const withoutOverrides = buildProcessEnv();
  const withEmptyOverrides = buildProcessEnv({});
  assert.deepEqual(withoutOverrides, withEmptyOverrides);
});
