import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import React, { type RefObject } from "react";

type TerminalTheme = NonNullable<
  NonNullable<ConstructorParameters<typeof Terminal>[0]>["theme"]
>;

type TerminalLike = {
  options: {
    theme?: TerminalTheme;
  };
};

type FitAddonLike = Pick<FitAddon, "fit">;

export const TERMINAL_COLOR_SCHEME_HOOK_OPTIONS = Object.freeze({
  getInitialValueInEffect: false,
});

export function resolveTerminalTheme(
  colorScheme: "light" | "dark",
): TerminalTheme {
  return colorScheme === "dark"
    ? {
        background: "#10151b",
        foreground: "#eef2f7",
        cursor: "#f59e0b",
        selectionBackground: "rgba(245, 158, 11, 0.28)",
      }
    : {
        background: "#f8f7f4",
        foreground: "#182230",
        cursor: "#c2410c",
        selectionBackground: "rgba(194, 65, 12, 0.18)",
      };
}

export function buildTicketWorkspaceTerminalOptions(theme: TerminalTheme) {
  return {
    allowProposedApi: false,
    convertEol: true,
    cursorBlink: true,
    fontFamily: "'IBM Plex Mono', 'SFMono-Regular', monospace",
    fontSize: 13,
    theme,
  } satisfies NonNullable<ConstructorParameters<typeof Terminal>[0]>;
}

export function updateTicketWorkspaceTerminalTheme(
  terminal: TerminalLike | null,
  fitAddon: FitAddonLike | null,
  colorScheme: "light" | "dark",
): TerminalTheme {
  const theme = resolveTerminalTheme(colorScheme);
  if (!terminal) {
    return theme;
  }

  terminal.options.theme = theme;
  fitAddon?.fit();
  return theme;
}

export function TicketWorkspaceTerminalViewport({
  containerRef,
  colorScheme,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  colorScheme: "light" | "dark";
}) {
  const terminalTheme = resolveTerminalTheme(colorScheme);
  return React.createElement(
    "div",
    {
      className: "ticket-workspace-terminal-shell",
      style: { background: terminalTheme.background },
    },
    React.createElement("div", {
      ref: containerRef,
      className: "ticket-workspace-terminal-screen",
    }),
  );
}
