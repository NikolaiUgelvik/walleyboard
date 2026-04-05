import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("codemirror selection styling uses native highlight colors", async () => {
  const stylesheet = await readFile(
    new URL("./app-shell.css", import.meta.url),
    {
      encoding: "utf8",
    },
  );

  assert.doesNotMatch(
    stylesheet,
    /\.walleyboard-codemirror \.cm-selectionBackground\s*\{/s,
  );
  assert.doesNotMatch(
    stylesheet,
    /\.walleyboard-codemirror \.cm-content ::selection\s*\{/s,
  );
});
