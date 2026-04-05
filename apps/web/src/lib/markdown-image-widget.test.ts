import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveMarkdownImageFilename,
  parseStandaloneMarkdownImageLine,
  splitMarkdownImageFilename,
} from "./markdown-image-widget.js";

test("parseStandaloneMarkdownImageLine resolves hosted project artifact URLs", () => {
  const match = parseStandaloneMarkdownImageLine(
    "![Clipboard image]( /projects/project-1/draft-artifacts/scope-1/example.png )",
  );

  assert.deepEqual(match, {
    alt: "Clipboard image",
    rawMarkdown:
      "![Clipboard image]( /projects/project-1/draft-artifacts/scope-1/example.png )",
    src: "http://127.0.0.1:4000/projects/project-1/draft-artifacts/scope-1/example.png",
  });
});
test("parseStandaloneMarkdownImageLine ignores non-image markdown lines", () => {
  assert.equal(
    parseStandaloneMarkdownImageLine(
      "Description with inline ![Clipboard image](/projects/project-1/draft-artifacts/scope-1/example.png) text",
    ),
    null,
  );
});

test("parseStandaloneMarkdownImageLine rejects unsafe image URLs", () => {
  assert.equal(
    parseStandaloneMarkdownImageLine("![Clipboard image](javascript:alert(1))"),
    null,
  );
});

test("deriveMarkdownImageFilename returns the last path segment", () => {
  assert.equal(
    deriveMarkdownImageFilename(
      "http://127.0.0.1:4000/projects/project-1/draft-artifacts/scope-1/hello-world.png",
    ),
    "hello-world.png",
  );
});

test("splitMarkdownImageFilename preserves the extension separately", () => {
  assert.deepEqual(splitMarkdownImageFilename("hello-world.png"), {
    basename: "hello-world",
    extension: ".png",
  });
});
