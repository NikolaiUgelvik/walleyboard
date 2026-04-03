import assert from "node:assert/strict";
import test from "node:test";

import { createKeyedSerialTaskRunner } from "./keyed-serial-task-runner.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

test("createKeyedSerialTaskRunner runs tasks sequentially for the same key", async () => {
  const runWithKey = createKeyedSerialTaskRunner();
  const events: string[] = [];

  await Promise.all([
    runWithKey("repo-1", async () => {
      events.push("first:start");
      await delay(20);
      events.push("first:end");
    }),
    runWithKey("repo-1", async () => {
      events.push("second:start");
      events.push("second:end");
    }),
  ]);

  assert.deepEqual(events, [
    "first:start",
    "first:end",
    "second:start",
    "second:end",
  ]);
});

test("createKeyedSerialTaskRunner allows different keys to run independently", async () => {
  const runWithKey = createKeyedSerialTaskRunner();
  const events: string[] = [];

  await Promise.all([
    runWithKey("repo-1", async () => {
      events.push("repo-1:start");
      await delay(20);
      events.push("repo-1:end");
    }),
    runWithKey("repo-2", async () => {
      events.push("repo-2:start");
      events.push("repo-2:end");
    }),
  ]);

  assert.ok(events.includes("repo-1:start"));
  assert.ok(events.includes("repo-1:end"));
  assert.ok(events.includes("repo-2:start"));
  assert.ok(events.includes("repo-2:end"));
  assert.ok(
    events.indexOf("repo-2:start") < events.indexOf("repo-1:end"),
    "Expected the second repository to proceed without waiting for repo-1",
  );
});
