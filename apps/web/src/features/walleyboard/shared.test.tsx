import assert from "node:assert/strict";
import test from "node:test";

import { MantineProvider } from "@mantine/core";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AgentAdapterIcon,
  AgentAdapterOptionLabel,
  agentAdapterOptions,
  getAgentAdapterIconPath,
  getProjectAgentAdapterOptions,
} from "./shared.js";

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

test("AgentAdapter icon helpers point to the vendored SVG assets", () => {
  assert.equal(getAgentAdapterIconPath("codex"), "/agent-icons/openai.svg");
  assert.equal(
    getAgentAdapterIconPath("claude-code"),
    "/agent-icons/claude.svg",
  );

  const iconMarkup = renderToStaticMarkup(
    <MantineProvider>
      <AgentAdapterIcon adapter="codex" />
      <AgentAdapterIcon adapter="claude-code" />
    </MantineProvider>,
  );

  assert.match(iconMarkup, /\/agent-icons\/openai\.svg/);
  assert.match(iconMarkup, /\/agent-icons\/claude\.svg/);
});

test("AgentAdapter option label renders the matching icon without changing text", () => {
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <AgentAdapterOptionLabel adapter="codex" label="Codex" />
      <AgentAdapterOptionLabel adapter="claude-code" label="Claude Code" />
    </MantineProvider>,
  );

  assert.match(markup, /Codex/);
  assert.match(markup, /Claude Code/);
  assert.match(markup, /\/agent-icons\/openai\.svg/);
  assert.match(markup, /\/agent-icons\/claude\.svg/);
});

test("Project Agent CLI options keep the existing disabled Claude label behavior", () => {
  assert.deepEqual(getProjectAgentAdapterOptions(true), agentAdapterOptions);
  assert.deepEqual(getProjectAgentAdapterOptions(false), [
    { label: "Codex", value: "codex" },
    {
      label: "Claude Code (not installed)",
      value: "claude-code",
      disabled: true,
    },
  ]);
});
