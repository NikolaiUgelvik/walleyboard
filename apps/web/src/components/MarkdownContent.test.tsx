import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MarkdownContent } from "./MarkdownContent.js";

test("renders block markdown while leaving raw HTML escaped", () => {
  const html = renderToStaticMarkup(
    <MarkdownContent
      content={[
        "# Heading",
        "",
        "- **Bold** item",
        "- [External link](https://example.com)",
        "",
        "Plain <script>alert(1)</script> with `code`.",
      ].join("\n")}
    />,
  );

  assert.match(html, /<h1>Heading<\/h1>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(
    html,
    /<a href="https:\/\/example\.com"[^>]*>External link<\/a>/,
  );
  assert.match(html, /Plain &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<code>code<\/code>/);
});

test("renders inline markdown without wrapping block elements", () => {
  const html = renderToStaticMarkup(
    <MarkdownContent
      inline
      content={"**Bold** and _emphasis_ with [link](#x)"}
    />,
  );

  assert.match(
    html,
    /^<span class="markdown-content markdown-content--inline">/,
  );
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /<em>emphasis<\/em>/);
  assert.match(html, /<a href="#x">link<\/a>/);
  assert.doesNotMatch(html, /<p>/);
});

test("renders markdown images with safe src values", () => {
  const html = renderToStaticMarkup(
    <MarkdownContent
      content={[
        "Pasted screenshot:",
        "",
        "![Clipboard image](/projects/project-1/draft-artifacts/scope-1/example.png)",
      ].join("\n")}
    />,
  );

  assert.match(
    html,
    /<img alt="Clipboard image" loading="lazy" src="http:\/\/127\.0\.0\.1:4000\/projects\/project-1\/draft-artifacts\/scope-1\/example\.png"\/>/,
  );
});

test("resolves project artifact links against the backend origin", () => {
  const html = renderToStaticMarkup(
    <MarkdownContent
      inline
      content={
        "[Artifact](/projects/project-1/draft-artifacts/scope-1/example.png)"
      }
    />,
  );

  assert.match(
    html,
    /<a href="http:\/\/127\.0\.0\.1:4000\/projects\/project-1\/draft-artifacts\/scope-1\/example\.png" rel="noreferrer" target="_blank">Artifact<\/a>/,
  );
});
