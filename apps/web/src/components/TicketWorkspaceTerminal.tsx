import "@xterm/xterm/css/xterm.css";

import { Box, Code, Stack, Text, useMantineColorScheme } from "@mantine/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";

import { apiBaseUrl } from "../lib/api-base-url.js";

type TicketWorkspaceTerminalProps = {
  ticketId: number;
  worktreePath: string | null;
};

function resolveTerminalSocketUrl(ticketId: number): string {
  const base = apiBaseUrl.replace(/^http/, "ws");
  return `${base}/tickets/${ticketId}/workspace/terminal`;
}

function resolveTerminalTheme(colorScheme: "light" | "dark") {
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

export function TicketWorkspaceTerminal({
  ticketId,
  worktreePath,
}: TicketWorkspaceTerminalProps) {
  const { colorScheme } = useMantineColorScheme();
  const terminalColorScheme = colorScheme === "dark" ? "dark" : "light";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const terminalThemeRef = useRef(resolveTerminalTheme(terminalColorScheme));
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [error, setError] = useState<string | null>(null);
  terminalThemeRef.current = resolveTerminalTheme(terminalColorScheme);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    setError(null);
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: true,
      fontFamily: "'IBM Plex Mono', 'SFMono-Regular', monospace",
      fontSize: 13,
      theme: terminalThemeRef.current,
    });
    const fitAddon = new FitAddon();
    const socket = new WebSocket(resolveTerminalSocketUrl(ticketId));
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }

      socket.send(
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
      socket.send(
        JSON.stringify({
          type: "terminal.resize",
          cols: terminal.cols,
          rows: terminal.rows,
        }),
      );
    };

    socket.addEventListener("open", () => {
      setError(null);
      sendResize();
    });
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data)) as
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
    socket.addEventListener("error", () => {
      setError("The workspace terminal could not connect.");
    });

    const disposable = terminal.onData((data: string) => {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }

      socket.send(
        JSON.stringify({
          type: "terminal.input",
          data,
        }),
      );
    });

    return () => {
      resizeObserver.disconnect();
      disposable.dispose();
      socket.close();
      fitAddonRef.current = null;
      terminalRef.current = null;
      terminal.dispose();
      container.replaceChildren();
    };
  }, [ticketId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.options.theme = resolveTerminalTheme(terminalColorScheme);
    fitAddonRef.current?.fit();
  }, [terminalColorScheme]);

  return (
    <Stack gap="sm" style={{ height: "100%" }}>
      <Stack gap={4}>
        <Text fw={600}>Worktree terminal</Text>
        <Text size="sm" c="dimmed">
          Plain shell access at the ticket worktree root.
        </Text>
        <Text size="sm" c="dimmed">
          Working directory: <Code>{worktreePath ?? "pending"}</Code>
        </Text>
      </Stack>

      {error ? (
        <Text size="sm" c="red">
          {error}
        </Text>
      ) : null}

      <Box className="ticket-workspace-terminal-shell">
        <div ref={containerRef} className="ticket-workspace-terminal-screen" />
      </Box>
    </Stack>
  );
}
