import { Badge, Code, Group, List, Stack, Text } from "@mantine/core";
import type { ExecutionSession } from "../../../../packages/contracts/src/index.js";
import { MarkdownContent } from "./MarkdownContent.js";

type SessionActivityFeedProps = {
  logs: string[];
  session: ExecutionSession;
};

type ActivityTone =
  | "gray"
  | "blue"
  | "teal"
  | "yellow"
  | "orange"
  | "red"
  | "green";

type SessionActivity = {
  key: string;
  tone: ActivityTone;
  label: string;
  detail: string;
};

type ParsedCodexEvent = {
  eventType: string;
  payload: Record<string, unknown>;
};

type ParsedExecutionSummary = {
  overview: string;
  commit: {
    hash: string;
    message: string | null;
  } | null;
  validation: {
    commands: string[];
    note: string | null;
  } | null;
  risks: string[];
};

function createActivity(
  key: string,
  tone: ActivityTone,
  label: string,
  detail: string,
): SessionActivity {
  return {
    key,
    tone,
    label,
    detail,
  };
}

function extractDetail(line: string, prefix: string): string | null {
  if (!line.startsWith(prefix)) {
    if (prefix.endsWith(" ")) {
      const multilinePrefix = `${prefix.trimEnd()}\n`;
      if (!line.startsWith(multilinePrefix)) {
        return null;
      }

      return line.slice(multilinePrefix.length);
    }

    return null;
  }

  return line.slice(prefix.length);
}

function truncate(value: string, maxLength = 240): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}

function parseCodexEvent(line: string): ParsedCodexEvent | null {
  const match = line.match(/^\[codex ([^\]]+)\] (.+)$/);
  if (!match) {
    return null;
  }

  const [, eventType, rawPayload] = match;
  if (!eventType || !rawPayload) {
    return null;
  }

  try {
    const payload = JSON.parse(rawPayload) as Record<string, unknown>;
    return {
      eventType,
      payload,
    };
  } catch {
    return null;
  }
}

function describeCommandExecution(command: string): {
  label: string;
  detail: string;
} {
  if (command.includes(".github/workflows")) {
    return {
      label: "Inspected CI workflow",
      detail: "Codex reviewed the CI workflow configuration.",
    };
  }

  if (command.includes(".gitignore")) {
    return {
      label: "Checked ignore rules",
      detail: "Codex inspected `.gitignore`.",
    };
  }

  if (command.includes("npm run typecheck") || command.includes("tsc -p")) {
    return {
      label: "Checked types",
      detail: "Codex ran the project's type checks.",
    };
  }

  if (command.includes("npm run build") || command.includes("vite build")) {
    return {
      label: "Built project",
      detail: "Codex ran the build to verify the current changes.",
    };
  }

  if (
    command.includes("npm run test") ||
    command.includes("npm test") ||
    command.includes("pytest")
  ) {
    return {
      label: "Ran tests",
      detail: "Codex ran a test command for the current change.",
    };
  }

  if (command.includes("git status")) {
    return {
      label: "Checked git status",
      detail: "Codex verified the repository status.",
    };
  }

  if (command.includes("git diff")) {
    return {
      label: "Reviewed changes",
      detail: "Codex inspected the current diff.",
    };
  }

  if (
    command.includes("rg ") ||
    command.includes("grep ") ||
    command.includes("sed -n") ||
    command.includes("cat ") ||
    command.includes("ls ") ||
    command.includes("find ")
  ) {
    return {
      label: "Inspected project files",
      detail: "Codex looked through repository files to gather context.",
    };
  }

  return {
    label: "Ran command",
    detail: truncate(command, 160),
  };
}

function interpretCodexEvent(
  line: string,
  index: number,
): SessionActivity | null {
  const event = parseCodexEvent(line);
  if (!event) {
    return null;
  }

  const item = event.payload.item;
  if (!item || typeof item !== "object") {
    return null;
  }

  const itemRecord = item as Record<string, unknown>;
  const itemType = typeof itemRecord.type === "string" ? itemRecord.type : null;

  if (event.eventType === "item.started") {
    return null;
  }

  if (itemType === "agent_message") {
    const text =
      typeof itemRecord.text === "string"
        ? itemRecord.text
        : typeof itemRecord.message === "string"
          ? itemRecord.message
          : null;

    if (!text) {
      return null;
    }

    return createActivity(
      `codex-message-${index}`,
      "blue",
      "Codex update",
      text,
    );
  }

  if (itemType === "command_execution") {
    const command =
      typeof itemRecord.command === "string" ? itemRecord.command : null;
    if (!command) {
      return null;
    }

    const exitCode =
      typeof itemRecord.exit_code === "number" ? itemRecord.exit_code : null;
    const aggregatedOutput =
      typeof itemRecord.aggregated_output === "string"
        ? itemRecord.aggregated_output.trim()
        : "";
    const description = describeCommandExecution(command);

    if (exitCode !== null && exitCode !== 0) {
      const failureDetail =
        aggregatedOutput.length > 0
          ? truncate(
              aggregatedOutput.split("\n").find(Boolean) ?? aggregatedOutput,
            )
          : description.detail;
      return createActivity(
        `codex-command-failed-${index}`,
        "red",
        "Command failed",
        failureDetail,
      );
    }

    return createActivity(
      `codex-command-${index}`,
      "gray",
      description.label,
      description.detail,
    );
  }

  return null;
}

function interpretSessionLog(
  line: string,
  index: number,
): SessionActivity | null {
  const codexEvent = interpretCodexEvent(line, index);
  if (codexEvent) {
    return codexEvent;
  }

  const created = extractDetail(line, "Session created for ticket ");
  if (created) {
    return createActivity(
      `created-${index}`,
      "blue",
      "Execution prepared",
      created,
    );
  }

  const branchReserved = extractDetail(line, "Working branch reserved: ");
  if (branchReserved) {
    return createActivity(
      `branch-${index}`,
      "gray",
      "Working branch",
      branchReserved,
    );
  }

  const worktreePrepared = extractDetail(line, "Worktree prepared at: ");
  if (worktreePrepared) {
    return createActivity(
      `worktree-${index}`,
      "gray",
      "Worktree prepared",
      worktreePrepared,
    );
  }

  const planningMode = extractDetail(line, "Planning mode: ");
  if (planningMode) {
    return createActivity(
      `planning-${index}`,
      "gray",
      "Planning mode",
      planningMode,
    );
  }

  const launchPath = extractDetail(line, "Launching Codex in ");
  if (launchPath) {
    return createActivity(
      `launch-${index}`,
      "blue",
      "Codex started",
      launchPath,
    );
  }

  const codexMessage = extractDetail(line, "[codex agent_message] ");
  if (codexMessage) {
    return createActivity(
      `codex-message-${index}`,
      "blue",
      "Codex update",
      codexMessage,
    );
  }

  const codexStderr = extractDetail(line, "[codex stderr] ");
  if (codexStderr) {
    return createActivity(
      `codex-stderr-${index}`,
      "yellow",
      "Tool warning",
      codexStderr,
    );
  }

  const codexRaw = extractDetail(line, "[codex raw] ");
  if (codexRaw) {
    return createActivity(
      `codex-raw-${index}`,
      "blue",
      "Codex update",
      codexRaw,
    );
  }

  if (line.startsWith("[codex ") || line.startsWith("[validation ")) {
    return null;
  }

  const validation = extractDetail(line, "Running validation: ");
  if (validation) {
    return createActivity(
      `validation-${index}`,
      "teal",
      "Validation running",
      validation,
    );
  }

  const reviewReady = extractDetail(line, "Review package ready: ");
  if (reviewReady) {
    return createActivity(
      `review-${index}`,
      "green",
      "Ready for review",
      reviewReady,
    );
  }

  const planSummary = extractDetail(line, "Plan summary: ");
  if (planSummary) {
    return createActivity(
      `plan-summary-${index}`,
      "yellow",
      "Plan ready",
      planSummary,
    );
  }

  const planFeedbackRequested = extractDetail(
    line,
    "Plan feedback requested: ",
  );
  if (planFeedbackRequested) {
    return createActivity(
      `plan-feedback-${index}`,
      "yellow",
      "Feedback requested",
      planFeedbackRequested,
    );
  }

  if (line === "Codex finished successfully.") {
    return createActivity(
      `finished-${index}`,
      "green",
      "Implementation finished",
      "Codex completed the implementation phase.",
    );
  }

  const runtimeFailure = extractDetail(line, "[runtime failure] ");
  if (runtimeFailure) {
    return createActivity(
      `failure-${index}`,
      "red",
      "Execution failed",
      runtimeFailure,
    );
  }

  const requestedChanges = extractDetail(line, "Requested changes recorded: ");
  if (requestedChanges) {
    return createActivity(
      `requested-changes-${index}`,
      "orange",
      "Changes requested",
      requestedChanges,
    );
  }

  const approvedPlan = extractDetail(line, "Plan approved by user: ");
  if (approvedPlan) {
    return createActivity(
      `plan-approved-${index}`,
      "green",
      "Plan approved",
      approvedPlan,
    );
  }

  const revisedPlan = extractDetail(line, "Plan changes requested: ");
  if (revisedPlan) {
    return createActivity(
      `plan-revised-${index}`,
      "orange",
      "Plan revision requested",
      revisedPlan,
    );
  }

  const resumeInstruction = extractDetail(
    line,
    "Resume instruction recorded: ",
  );
  if (resumeInstruction) {
    return createActivity(
      `resume-instruction-${index}`,
      "yellow",
      "Resume guidance saved",
      resumeInstruction,
    );
  }

  if (line === "Resume requested without additional instruction.") {
    return createActivity(
      `resume-${index}`,
      "yellow",
      "Resume requested",
      "The next attempt will continue from the existing worktree without extra guidance.",
    );
  }

  const resumeGuidance = extractDetail(line, "Resume guidance: ");
  if (resumeGuidance) {
    return createActivity(
      `resume-guidance-${index}`,
      "yellow",
      "Resume guidance",
      resumeGuidance,
    );
  }

  const inputRecorded = extractDetail(line, "User input recorded: ");
  if (inputRecorded) {
    return createActivity(
      `input-${index}`,
      "yellow",
      "Note recorded",
      inputRecorded,
    );
  }

  const terminalOpened = extractDetail(line, "Manual terminal opened in ");
  if (terminalOpened) {
    return createActivity(
      `terminal-opened-${index}`,
      "yellow",
      "Manual terminal attached",
      terminalOpened,
    );
  }

  if (line === "Manual terminal closed.") {
    return createActivity(
      `terminal-closed-${index}`,
      "gray",
      "Manual terminal closed",
      "Agent control can now be restored on the existing worktree.",
    );
  }

  const terminalInput = extractDetail(line, "[terminal input] ");
  if (terminalInput) {
    return createActivity(
      `terminal-input-${index}`,
      "yellow",
      "Manual command",
      truncate(terminalInput, 160),
    );
  }

  const agentInput = extractDetail(line, "[agent input] ");
  if (agentInput) {
    return createActivity(
      `agent-input-${index}`,
      "yellow",
      "Live input sent",
      truncate(agentInput, 160),
    );
  }

  if (line.startsWith("[terminal] ")) {
    return null;
  }

  const stopped = extractDetail(line, "Execution stopped by user: ");
  if (stopped) {
    return createActivity(
      `stopped-${index}`,
      "orange",
      "Execution stopped",
      stopped,
    );
  }

  if (line === "Execution stopped by user.") {
    return createActivity(
      `stopped-${index}`,
      "orange",
      "Execution stopped",
      "The current attempt was stopped intentionally and can be resumed later.",
    );
  }

  const preservedWorktree = extractDetail(line, "Worktree preserved at: ");
  if (preservedWorktree) {
    return createActivity(
      `preserved-worktree-${index}`,
      "orange",
      "Worktree preserved",
      preservedWorktree,
    );
  }

  const preservedBranch = extractDetail(line, "Working branch preserved: ");
  if (preservedBranch) {
    return createActivity(
      `preserved-branch-${index}`,
      "orange",
      "Working branch preserved",
      preservedBranch,
    );
  }

  const reuseWorktree = extractDetail(line, "Reusing worktree at: ");
  if (reuseWorktree) {
    return createActivity(
      `reuse-worktree-${index}`,
      "blue",
      "Reusing worktree",
      reuseWorktree,
    );
  }

  const reuseBranch = extractDetail(line, "Reusing working branch: ");
  if (reuseBranch) {
    return createActivity(
      `reuse-branch-${index}`,
      "blue",
      "Reusing branch",
      reuseBranch,
    );
  }

  const newAttempt = extractDetail(line, "Starting execution attempt ");
  if (newAttempt) {
    return createActivity(
      `attempt-${index}`,
      "blue",
      "New attempt",
      newAttempt,
    );
  }

  if (
    line === "Session was marked interrupted after backend startup recovery."
  ) {
    return createActivity(
      `recovery-${index}`,
      "orange",
      "Restart recovery",
      "The backend restarted while the session was active, so the session was preserved for manual resume.",
    );
  }

  if (
    line.startsWith("Command: codex ") ||
    line.startsWith("Verified git repository: ") ||
    line.startsWith("Checked out target branch: ") ||
    line === "Codex launch has been handed off to the execution runtime."
  ) {
    return null;
  }

  return createActivity(`system-${index}`, "gray", "System update", line);
}

function fallbackSummary(status: ExecutionSession["status"]): string {
  switch (status) {
    case "queued":
      return "Execution is queued and waiting to start.";
    case "running":
      return "Codex is currently working on the ticket.";
    case "paused_checkpoint":
      return "Codex is waiting for approval before it can continue.";
    case "paused_user_control":
      return "The session is paused for manual control.";
    case "awaiting_input":
      return "Codex needs more input before the next attempt can continue.";
    case "interrupted":
      return "The previous attempt stopped before completion and can be resumed.";
    case "failed":
      return "The last attempt failed and may need guidance before retrying.";
    case "completed":
      return "The implementation phase completed and handed off to review.";
  }
}

function parseExecutionSummary(summary: string): ParsedExecutionSummary {
  const normalized = summary.trim();
  const commitMarker = "The change is committed as ";
  const validationMarker = "Validation run:";
  const risksMarker = "Remaining risks:";
  const commitIndex = normalized.indexOf(commitMarker);
  const validationIndex = normalized.indexOf(validationMarker);
  const risksIndex = normalized.indexOf(risksMarker);
  const sectionStarts = [commitIndex, validationIndex, risksIndex].filter(
    (value) => value >= 0,
  );
  const firstSectionStart =
    sectionStarts.length > 0 ? Math.min(...sectionStarts) : normalized.length;

  const overview = normalized.slice(0, firstSectionStart).trim();

  const commitEndCandidates = [validationIndex, risksIndex].filter(
    (value) => value > commitIndex,
  );
  const commitText =
    commitIndex >= 0
      ? normalized
          .slice(
            commitIndex,
            commitEndCandidates.length > 0
              ? Math.min(...commitEndCandidates)
              : normalized.length,
          )
          .trim()
      : "";
  const commitMatch = commitText.match(
    /The change is committed as `([^`]+)`(?: with message `([^`]+)`)?\.?/i,
  );
  const commitHash = commitMatch?.[1];
  const commit = commitHash
    ? {
        hash: commitHash,
        message: commitMatch[2] ?? null,
      }
    : null;

  const validationEnd = risksIndex >= 0 ? risksIndex : normalized.length;
  const validationText =
    validationIndex >= 0
      ? normalized
          .slice(validationIndex + validationMarker.length, validationEnd)
          .trim()
      : "";
  const validationSentences = validationText
    .split(/(?<=\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const firstValidationSentence = validationSentences[0];
  const validationCommands = firstValidationSentence
    ? Array.from(
        firstValidationSentence.matchAll(/`([^`]+)`/g),
        (match) => match[1],
      ).filter((command): command is string => command !== undefined)
    : [];
  const validationNote =
    validationSentences.length > 1
      ? validationSentences.slice(1).join(" ").trim()
      : validationCommands.length === 0 && validationText.length > 0
        ? validationText
        : null;
  const validation =
    validationCommands.length > 0 || validationNote
      ? {
          commands: validationCommands,
          note: validationNote,
        }
      : null;

  const risksText =
    risksIndex >= 0
      ? normalized
          .slice(risksIndex + risksMarker.length)
          .trim()
          .replace(/\.$/, "")
      : "";
  const risks = risksText
    ? risksText
        .split(
          /,\s+(?=(?:the|`|backend|integration|Codex|MCP|extra_env_allowlist)\b)/,
        )
        .map((risk) => risk.trim())
        .filter(Boolean)
    : [];

  return {
    overview,
    commit,
    validation,
    risks,
  };
}

export function SessionActivityFeed({
  logs,
  session,
}: SessionActivityFeedProps) {
  const interpretedActivities = logs
    .map((line, index) => interpretSessionLog(line, index))
    .filter((activity): activity is SessionActivity => activity !== null);
  const visibleActivities = interpretedActivities.slice(-12).reverse();
  const parsedSummary = parseExecutionSummary(
    session.last_summary ?? fallbackSummary(session.status),
  );

  return (
    <Stack gap="md">
      <Stack gap={4}>
        <Text fw={600}>Execution Summary</Text>
        {parsedSummary.overview ? (
          <Stack gap={2}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Outcome
            </Text>
            <MarkdownContent
              className="markdown-muted markdown-small"
              content={parsedSummary.overview}
            />
          </Stack>
        ) : null}
        {parsedSummary.commit ? (
          <Stack gap={2}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Commit
            </Text>
            <Group gap="xs" wrap="wrap">
              <Code>{parsedSummary.commit.hash}</Code>
              {parsedSummary.commit.message ? (
                <Text size="sm" c="dimmed">
                  {parsedSummary.commit.message}
                </Text>
              ) : null}
            </Group>
          </Stack>
        ) : null}
        {parsedSummary.validation ? (
          <Stack gap={2}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Validation
            </Text>
            {parsedSummary.validation.commands.length > 0 ? (
              <List size="sm" spacing={4}>
                {parsedSummary.validation.commands.map((command) => (
                  <List.Item key={command}>
                    <Code>{command}</Code>
                  </List.Item>
                ))}
              </List>
            ) : null}
            {parsedSummary.validation.note ? (
              <MarkdownContent
                className="markdown-muted markdown-small"
                content={parsedSummary.validation.note}
              />
            ) : null}
          </Stack>
        ) : null}
        {parsedSummary.risks.length > 0 ? (
          <Stack gap={2}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Remaining Risks
            </Text>
            {parsedSummary.risks.length === 1 ? (
              <MarkdownContent
                className="markdown-muted markdown-small"
                content={parsedSummary.risks[0] ?? ""}
              />
            ) : (
              <List size="sm" spacing={4}>
                {parsedSummary.risks.map((risk) => (
                  <List.Item key={risk}>
                    <MarkdownContent content={risk} />
                  </List.Item>
                ))}
              </List>
            )}
          </Stack>
        ) : null}
      </Stack>

      <Stack gap={4}>
        <Text fw={600}>Recent Activity</Text>
        <Text size="sm" c="dimmed">
          This view highlights notable Codex and system updates instead of
          showing the raw terminal transcript.
        </Text>
        {visibleActivities.length === 0 ? (
          <Text size="sm" c="dimmed">
            No interpreted activity is available for this session yet.
          </Text>
        ) : (
          <Stack gap="xs">
            {visibleActivities.map((activity) => (
              <Group key={activity.key} align="flex-start" wrap="nowrap">
                <Badge color={activity.tone} variant="light" mt={2}>
                  {activity.label}
                </Badge>
                <div style={{ flex: 1 }}>
                  <MarkdownContent
                    className="markdown-small"
                    content={activity.detail}
                  />
                </div>
              </Group>
            ))}
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}
