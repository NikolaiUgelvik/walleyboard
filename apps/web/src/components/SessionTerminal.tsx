import { Box } from "@mantine/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";

type SessionTerminalProps = {
  logs: string[];
  sessionId: string;
};

export function SessionTerminal({ logs, sessionId }: SessionTerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: false,
      disableStdin: true,
      fontFamily:
        "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace",
      fontSize: 12,
      rows: 18,
      theme: {
        background: "#111318",
        foreground: "#e5e7eb",
        cursor: "#f59f00",
        selectionBackground: "#2b303b"
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) {
      return;
    }

    terminal.reset();
    const contents = logs.length > 0 ? logs.join("\r\n") : "Waiting for session output...";
    terminal.write(contents);
    fitAddon.fit();
  }, [logs, sessionId]);

  return (
    <Box
      ref={containerRef}
      style={{
        border: "1px solid var(--mantine-color-gray-3)",
        borderRadius: "12px",
        height: "320px",
        overflow: "hidden",
        width: "100%"
      }}
    />
  );
}
