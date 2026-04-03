import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MarkdownContent } from "./MarkdownContent.js";

test("renders block markdown while leaving raw HTML escaped", () => {
  const html = renderToStaticMarkup(
    React.createElement(MarkdownContent, {
      content: [
        "# Heading",
        "",
        "- **Bold** item",
        "- [External link](https://example.com)",
        "",
        "Plain <script>alert(1)</script> with `code`.",
      ].join("\n"),
    }),
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
    React.createElement(MarkdownContent, {
      inline: true,
      content: "**Bold** and _emphasis_ with [link](#x)",
    }),
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
    React.createElement(MarkdownContent, {
      content: [
        "Pasted screenshot:",
        "",
        "![Clipboard image](/projects/project-1/draft-artifacts/scope-1/example.png)",
      ].join("\n"),
    }),
  );

  assert.match(
    html,
    /<img alt="Clipboard image" loading="lazy" src="http:\/\/127\.0\.0\.1:4000\/projects\/project-1\/draft-artifacts\/scope-1\/example\.png"\/>/,
  );
});

test("resolves project artifact links against the backend origin", () => {
  const html = renderToStaticMarkup(
    React.createElement(MarkdownContent, {
      inline: true,
      content:
        "[Artifact](/projects/project-1/draft-artifacts/scope-1/example.png)",
    }),
  );

  assert.match(
    html,
    /<a href="http:\/\/127\.0\.0\.1:4000\/projects\/project-1\/draft-artifacts\/scope-1\/example\.png" rel="noreferrer" target="_blank">Artifact<\/a>/,
  );
});

test("renders resolved ticket references as linked summaries", () => {
  const html = renderToStaticMarkup(
    React.createElement(MarkdownContent, {
      inline: true,
      content: "Depends on #33 before merge.",
      ticketReferences: [
        {
          ticket_id: 33,
          title: "Finish the API contract",
          status: "in_progress",
        },
      ],
    }),
  );

  assert.match(
    html,
    /Depends on <a class="markdown-ticket-reference" href="#ticket-33">#33<\/a><span class="markdown-ticket-reference-meta"> \(Finish the API contract • In progress\)<\/span> before merge\./,
  );
});

test("ignores ticket references inside markdown links, code spans, and escapes", () => {
  const html = renderToStaticMarkup(
    React.createElement(MarkdownContent, {
      inline: true,
      content:
        "Use `#33`, \\#33, [#33](https://example.com), and #33 in plain text.",
      ticketReferences: [
        {
          ticket_id: 33,
          title: "Finish the API contract",
          status: "in_progress",
        },
      ],
    }),
  );

  assert.match(html, /<code>#33<\/code>/);
  assert.match(
    html,
    /<a href="https:\/\/example\.com" rel="noreferrer" target="_blank">#33<\/a>/,
  );
  assert.doesNotMatch(
    html,
    /<a href="https:\/\/example\.com"[^>]*><a class="markdown-ticket-reference"/,
  );
  assert.equal(
    [...html.matchAll(/class="markdown-ticket-reference"/g)].length,
    1,
  );
});
