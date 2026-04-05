import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildMarkdownImageInsertion } from "./MarkdownCodeEditor.js";

test("MarkdownCodeEditor uses native browser selection rendering", async () => {
  const source = await readFile(
    new URL("./MarkdownCodeEditor.tsx", import.meta.url),
    {
      encoding: "utf8",
    },
  );

  assert.doesNotMatch(source, /\bbasicSetup\b/);
  assert.doesNotMatch(source, /\bdrawSelection\s*\(/);
});

test("buildMarkdownImageInsertion moves the cursor below a pasted image at the end of the document", () => {
  const insertion = buildMarkdownImageInsertion(
    "",
    "![clip]( /projects/project-1/draft-artifacts/scope-1/clip.png )",
    0,
    0,
  );

  assert.equal(
    insertion.nextValue,
    "![clip]( /projects/project-1/draft-artifacts/scope-1/clip.png )\n\n",
  );
  assert.equal(insertion.cursorOffset, insertion.nextValue.length);
});

test("buildMarkdownImageInsertion skips over an existing newline after a pasted image", () => {
  const insertion = buildMarkdownImageInsertion(
    "Existing line",
    "![clip]( /projects/project-1/draft-artifacts/scope-1/clip.png )",
    0,
    0,
  );

  assert.equal(
    insertion.nextValue,
    "![clip]( /projects/project-1/draft-artifacts/scope-1/clip.png )\n\nExisting line",
  );
  assert.equal(
    insertion.cursorOffset,
    "![clip]( /projects/project-1/draft-artifacts/scope-1/clip.png )\n\n"
      .length,
  );
});
