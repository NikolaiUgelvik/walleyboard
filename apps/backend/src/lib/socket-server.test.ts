import assert from "node:assert/strict";
import test from "node:test";

import { parseTerminalSocketPath } from "./socket-server.js";

test("parses ticket terminal socket targets", () => {
  assert.deepEqual(parseTerminalSocketPath("/tickets/42/workspace/terminal"), {
    kind: "ticket",
    ticketId: "42",
  });
});

test("parses repository terminal socket targets", () => {
  assert.deepEqual(
    parseTerminalSocketPath(
      "/projects/project-1/repositories/repo-2/workspace/terminal",
    ),
    {
      kind: "repository",
      projectId: "project-1",
      repositoryId: "repo-2",
    },
  );
});

test("rejects unknown terminal socket targets", () => {
  assert.equal(parseTerminalSocketPath("/ws"), null);
});
