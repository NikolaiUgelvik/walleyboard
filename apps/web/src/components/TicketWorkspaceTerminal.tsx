import "@xterm/xterm/css/xterm.css";

import { Code, Stack, Text, useComputedColorScheme } from "@mantine/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";

import { connectWalleyboardSocket } from "../lib/socket-io.js";
import {
  buildTicketWorkspaceTerminalOptions,
  resolveTerminalTheme,
  resolveWorkspaceTerminalHeading,
  resolveWorkspaceTerminalPathLabel,
  TERMINAL_COLOR_SCHEME_HOOK_OPTIONS,
  TicketWorkspaceTerminalViewport,
  updateTicketWorkspaceTerminalTheme,
} from "./TicketWorkspaceTerminal.shared.js";

type TicketWorkspaceTerminalProps = {
  socketPath: string;
  surfaceLabel: "ticket" | "repository";
  worktreePath: string | null;
};

export function TicketWorkspaceTerminal({
  socketPath,
  surfaceLabel,
  worktreePath,
}: TicketWorkspaceTerminalProps) {
  const terminalColorScheme = useComputedColorScheme(
    "light",
    TERMINAL_COLOR_SCHEME_HOOK_OPTIONS,
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const terminalThemeRef = useRef(resolveTerminalTheme(terminalColorScheme));
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolvedWorktreePath, setResolvedWorktreePath] =
    useState(worktreePath);
  terminalThemeRef.current = resolveTerminalTheme(terminalColorScheme);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    setError(null);
    setResolvedWorktreePath(worktreePath);
    const terminal = new Terminal(
      buildTicketWorkspaceTerminalOptions(terminalThemeRef.current),
    );
    const fitAddon = new FitAddon();
    const socket = connectWalleyboardSocket("/terminals", {
      auth: {
        socketPath,
      },
    });
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (!socket.connected) {
        return;
      }

      socket.emit(
        "terminal.message",
        JSON.stringify({
          type: "terminal.resize",
          cols: terminal.cols,
          rows: terminal.rows,
        }),
      );
    });

    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();
    resizeObserver.observe(container);

    const sendResize = () => {
      socket.emit(
        "terminal.message",
        JSON.stringify({
          type: "terminal.resize",
          cols: terminal.cols,
          rows: terminal.rows,
        }),
      );
    };

    socket.on("connect", () => {
      setError(null);
      sendResize();
    });
    socket.on("terminal.message", (rawMessage: string) => {
      try {
        const message = JSON.parse(String(rawMessage)) as
          | {
              type?: "terminal.started";
              worktree_path?: string | null;
            }
          | {
              type?: "terminal.output";
              data?: string;
            }
          | {
              type?: "terminal.error";
              message?: string;
            }
          | {
              type?: "terminal.exit";
              exit_code?: number;
              signal?: number;
            };

        if (message.type === "terminal.started") {
          setResolvedWorktreePath(message.worktree_path ?? null);
          return;
        }

        if (message.type === "terminal.output" && message.data) {
          terminal.write(message.data);
          return;
        }

        if (message.type === "terminal.error") {
          const detail = message.message ?? "Workspace terminal failed";
          setError(detail);
          terminal.writeln(`\r\n${detail}`);
          return;
        }

        if (message.type === "terminal.exit") {
          terminal.writeln(
            `\r\n[terminal exited: ${message.signal ?? message.exit_code ?? "unknown"}]`,
          );
        }
      } catch {
        setError("Unable to read terminal output");
      }
    });
    socket.on("connect_error", () => {
      setError("The workspace terminal could not connect.");
    });

    const disposable = terminal.onData((data: string) => {
      if (!socket.connected) {
        return;
      }

      socket.emit(
        "terminal.message",
        JSON.stringify({
          type: "terminal.input",
          data,
        }),
      );
    });

    return () => {
      resizeObserver.disconnect();
      disposable.dispose();
      socket.disconnect();
      fitAddonRef.current = null;
      terminalRef.current = null;
      terminal.dispose();
      container.replaceChildren();
    };
  }, [socketPath, worktreePath]);

  useEffect(() => {
    updateTicketWorkspaceTerminalTheme(
      terminalRef.current,
      fitAddonRef.current,
      terminalColorScheme,
    );
  }, [terminalColorScheme]);

  return (
    <Stack gap="sm" style={{ height: "100%" }}>
      <Stack gap={4}>
        <Text fw={600}>{resolveWorkspaceTerminalHeading(surfaceLabel)}</Text>
        <Text size="sm" c="dimmed">
          Plain shell access at the {surfaceLabel} worktree root.
        </Text>
        <Text size="sm" c="dimmed">
          Working directory:{" "}
          <Code>{resolveWorkspaceTerminalPathLabel(resolvedWorktreePath)}</Code>
        </Text>
      </Stack>

      {error ? (
        <Text size="sm" c="red">
          {error}
        </Text>
      ) : null}

      <TicketWorkspaceTerminalViewport
        containerRef={containerRef}
        colorScheme={terminalColorScheme}
      />
    </Stack>
  );
}
