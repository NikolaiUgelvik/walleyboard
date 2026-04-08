import { Code, Stack, Text, useComputedColorScheme } from "@mantine/core";
import { FitAddon, init, Terminal } from "ghostty-web";
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

let ghosttyWebInitialization: Promise<void> | null = null;

function initializeGhosttyWeb() {
  if (!ghosttyWebInitialization) {
    ghosttyWebInitialization = init().catch((error) => {
      ghosttyWebInitialization = null;
      throw error;
    });
  }

  return ghosttyWebInitialization;
}

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

    let cancelled = false;
    let terminal: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let focusFrame: number | null = null;
    let socket: ReturnType<typeof connectWalleyboardSocket> | null = null;
    let disposable: { dispose(): void } | null = null;

    setError(null);
    setResolvedWorktreePath(worktreePath);
    container.replaceChildren();
    void initializeGhosttyWeb()
      .then(() => {
        if (cancelled) {
          return;
        }

        terminal = new Terminal(
          buildTicketWorkspaceTerminalOptions(terminalThemeRef.current),
        );
        fitAddon = new FitAddon();
        socket = connectWalleyboardSocket("/terminals", {
          auth: {
            socketPath,
          },
        });
        const startedTerminal = terminal;
        const startedFitAddon = fitAddon;
        const startedSocket = socket;
        terminalRef.current = startedTerminal;
        fitAddonRef.current = startedFitAddon;
        container.replaceChildren();
        resizeObserver = new ResizeObserver(() => {
          startedFitAddon.fit();
          if (!startedSocket.connected) {
            return;
          }

          startedSocket.emit(
            "terminal.message",
            JSON.stringify({
              type: "terminal.resize",
              cols: startedTerminal.cols,
              rows: startedTerminal.rows,
            }),
          );
        });

        startedTerminal.loadAddon(startedFitAddon);
        startedTerminal.open(container);
        startedTerminal.clear();
        startedFitAddon.fit();
        focusFrame = requestAnimationFrame(() => {
          if (terminalRef.current === startedTerminal) {
            startedTerminal.focus();
          }
        });
        resizeObserver.observe(container);

        const sendResize = () => {
          startedSocket.emit(
            "terminal.message",
            JSON.stringify({
              type: "terminal.resize",
              cols: startedTerminal.cols,
              rows: startedTerminal.rows,
            }),
          );
        };

        startedSocket.on("connect", () => {
          setError(null);
          sendResize();
        });
        startedSocket.on("terminal.message", (rawMessage: string) => {
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
              startedTerminal.write(message.data);
              return;
            }

            if (message.type === "terminal.error") {
              const detail = message.message ?? "Workspace terminal failed";
              setError(detail);
              startedTerminal.writeln(`\r\n${detail}`);
              return;
            }

            if (message.type === "terminal.exit") {
              startedTerminal.writeln(
                `\r\n[terminal exited: ${message.signal ?? message.exit_code ?? "unknown"}]`,
              );
            }
          } catch {
            setError("Unable to read terminal output");
          }
        });
        startedSocket.on("connect_error", () => {
          setError("The workspace terminal could not connect.");
        });

        disposable = startedTerminal.onData((data: string) => {
          if (!startedSocket.connected) {
            return;
          }

          startedSocket.emit(
            "terminal.message",
            JSON.stringify({
              type: "terminal.input",
              data,
            }),
          );
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        const detail =
          error instanceof Error && error.message
            ? `The workspace terminal could not start: ${error.message}`
            : "The workspace terminal could not start.";
        setError(detail);
      });

    return () => {
      cancelled = true;
      if (focusFrame !== null) {
        cancelAnimationFrame(focusFrame);
      }

      resizeObserver?.disconnect();
      disposable?.dispose();
      socket?.disconnect();
      fitAddonRef.current = null;
      terminalRef.current = null;
      terminal?.dispose();
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
