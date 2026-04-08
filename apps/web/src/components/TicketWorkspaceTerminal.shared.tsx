import type { CanvasRenderer, FitAddon, Terminal } from "ghostty-web";
import React, { type RefObject } from "react";

type TerminalTheme = NonNullable<
  NonNullable<ConstructorParameters<typeof Terminal>[0]>["theme"]
>;

type TerminalLike = {
  options: {
    theme?: TerminalTheme;
  };
  renderer?: Pick<CanvasRenderer, "setTheme">;
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
    cursorBlink: true,
    fontFamily:
      "'Cascadia Mono', 'Cascadia Code', 'Consolas', 'Menlo', 'Monaco', 'SFMono-Regular', monospace",
    fontSize: 14,
    smoothScrollDuration: 0,
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

  if (terminal.options.theme) {
    Object.assign(terminal.options.theme, theme);
  } else {
    terminal.options.theme = theme;
  }

  terminal.renderer?.setTheme(theme);
  fitAddon?.fit();
  return theme;
}

export function resolveWorkspaceTerminalHeading(
  surfaceLabel: "ticket" | "repository",
): string {
  return surfaceLabel === "repository"
    ? "Repository terminal"
    : "Ticket terminal";
}

export function resolveWorkspaceTerminalPathLabel(
  worktreePath: string | null,
): string {
  return worktreePath ?? "starting...";
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
