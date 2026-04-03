import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildTicketWorkspaceTerminalOptions,
  resolveTerminalTheme,
  TERMINAL_COLOR_SCHEME_HOOK_OPTIONS,
  TicketWorkspaceTerminalViewport,
  updateTicketWorkspaceTerminalTheme,
} from "./TicketWorkspaceTerminal.shared.js";

test("builds the dark terminal theme synchronously for initial render", () => {
  assert.deepEqual(TERMINAL_COLOR_SCHEME_HOOK_OPTIONS, {
    getInitialValueInEffect: false,
  });

  const darkTheme = resolveTerminalTheme("dark");
  const options = buildTicketWorkspaceTerminalOptions(darkTheme);

  assert.deepEqual(options.theme, darkTheme);
  assert.equal(options.theme?.background, "#10151b");
  assert.equal(options.theme?.foreground, "#eef2f7");
});

test("viewport background follows the resolved light and dark color schemes", () => {
  const darkMarkup = renderToStaticMarkup(
    React.createElement(TicketWorkspaceTerminalViewport, {
      colorScheme: "dark",
      containerRef: React.createRef<HTMLDivElement>(),
    }),
  );
  const lightMarkup = renderToStaticMarkup(
    React.createElement(TicketWorkspaceTerminalViewport, {
      colorScheme: "light",
      containerRef: React.createRef<HTMLDivElement>(),
    }),
  );

  assert.match(darkMarkup, /background:\s*#10151b/i);
  assert.match(lightMarkup, /background:\s*#f8f7f4/i);
});

test("switches the existing terminal instance between dark and light themes", () => {
  const terminal = {
    options: {
      theme: resolveTerminalTheme("light"),
    },
  };
  let fitCalls = 0;
  const fitAddon = {
    fit() {
      fitCalls += 1;
    },
  };

  const darkTheme = updateTicketWorkspaceTerminalTheme(
    terminal,
    fitAddon,
    "dark",
  );

  assert.strictEqual(terminal.options.theme, darkTheme);
  assert.equal(terminal.options.theme?.background, "#10151b");
  assert.equal(fitCalls, 1);

  const lightTheme = updateTicketWorkspaceTerminalTheme(
    terminal,
    fitAddon,
    "light",
  );

  assert.strictEqual(terminal.options.theme, lightTheme);
  assert.equal(terminal.options.theme?.background, "#f8f7f4");
  assert.equal(fitCalls, 2);
});
