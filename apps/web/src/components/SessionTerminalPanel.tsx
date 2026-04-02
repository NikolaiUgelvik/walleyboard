import {
  Button,
  Code,
  Group,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import type { ExecutionSession } from "../../../../packages/contracts/src/index.js";

type SessionTerminalPanelProps = {
  canTakeOver: boolean;
  session: ExecutionSession;
  logs: string[];
  command: string;
  onCommandChange: (value: string) => void;
  onSendCommand: () => void;
  onTakeOver: () => void;
  onRestoreAgent: () => void;
  sendLoading: boolean;
  takeOverLoading: boolean;
  restoreLoading: boolean;
  error?: string | null;
};

function extractTerminalTranscript(logs: string[]): string {
  return logs
    .flatMap((line) => {
      if (line.startsWith("[terminal input] ")) {
        return [`$ ${line.slice("[terminal input] ".length).trim()}`];
      }

      if (line.startsWith("[terminal] ")) {
        return [line.slice("[terminal] ".length)];
      }

      if (line.startsWith("Manual terminal opened in ")) {
        return [`# ${line}`];
      }

      if (line === "Manual terminal closed.") {
        return ["# Manual terminal closed."];
      }

      return [];
    })
    .slice(-120)
    .join("\n");
}

export function SessionTerminalPanel({
  canTakeOver,
  session,
  logs,
  command,
  onCommandChange,
  onSendCommand,
  onTakeOver,
  onRestoreAgent,
  sendLoading,
  takeOverLoading,
  restoreLoading,
  error,
}: SessionTerminalPanelProps) {
  const active = session.status === "paused_user_control";
  const transcript = extractTerminalTranscript(logs);

  return (
    <Stack gap="sm">
      <Stack gap={4}>
        <Text fw={600}>Project Terminal</Text>
        <Text size="sm" c="dimmed">
          This is the raw terminal view for direct commands in the ticket
          worktree. When attached, commands run with the worktree root as the
          current working directory.
        </Text>
        <Text size="sm" c="dimmed">
          Working directory: <Code>{session.worktree_path ?? "pending"}</Code>
        </Text>
      </Stack>

      <Textarea
        label="Terminal transcript"
        readOnly
        rows={14}
        value={
          transcript.length > 0 ? transcript : "No terminal transcript yet."
        }
        styles={{
          input: {
            fontFamily:
              "Monaco, Menlo, Consolas, Liberation Mono, Courier New, monospace",
          },
        }}
      />

      {error ? (
        <Text size="sm" c="red">
          {error}
        </Text>
      ) : null}

      {active ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (command.trim().length === 0) {
              return;
            }

            onSendCommand();
          }}
        >
          <Group align="end" wrap="nowrap">
            <TextInput
              id="terminal-command"
              label="Command"
              name="terminal-command"
              placeholder="git status"
              value={command}
              onChange={(event) => onCommandChange(event.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button
              type="submit"
              loading={sendLoading}
              disabled={command.trim().length === 0}
            >
              Run Command
            </Button>
            <Button
              variant="light"
              type="button"
              loading={restoreLoading}
              onClick={onRestoreAgent}
            >
              Restore Agent
            </Button>
          </Group>
        </form>
      ) : (
        <Group justify="space-between" align="center">
          <Text size="sm" c="dimmed">
            {canTakeOver
              ? "Attach the project shell to run direct commands from this worktree root."
              : "Manual terminal takeover is only available while the ticket is in progress."}
          </Text>
          <Button
            variant="light"
            loading={takeOverLoading}
            disabled={!canTakeOver}
            onClick={onTakeOver}
          >
            Take Over Terminal
          </Button>
        </Group>
      )}
    </Stack>
  );
}
