import { Badge, Group, Stack, Text } from "@mantine/core";
import type { ExecutionSession } from "@orchestrator/contracts";

type SessionActivityFeedProps = {
  logs: string[];
  session: ExecutionSession;
};

type ActivityTone = "gray" | "blue" | "teal" | "yellow" | "orange" | "red" | "green";

type SessionActivity = {
  key: string;
  tone: ActivityTone;
  label: string;
  detail: string;
};

function createActivity(
  key: string,
  tone: ActivityTone,
  label: string,
  detail: string
): SessionActivity {
  return {
    key,
    tone,
    label,
    detail
  };
}

function extractDetail(line: string, prefix: string): string | null {
  if (!line.startsWith(prefix)) {
    return null;
  }

  return line.slice(prefix.length).trim();
}

function interpretSessionLog(line: string, index: number): SessionActivity | null {
  const created = extractDetail(line, "Session created for ticket ");
  if (created) {
    return createActivity(`created-${index}`, "blue", "Execution prepared", created);
  }

  const branchReserved = extractDetail(line, "Working branch reserved: ");
  if (branchReserved) {
    return createActivity(`branch-${index}`, "gray", "Working branch", branchReserved);
  }

  const worktreePrepared = extractDetail(line, "Worktree prepared at: ");
  if (worktreePrepared) {
    return createActivity(`worktree-${index}`, "gray", "Worktree prepared", worktreePrepared);
  }

  const planningMode = extractDetail(line, "Planning mode: ");
  if (planningMode) {
    return createActivity(`planning-${index}`, "gray", "Planning mode", planningMode);
  }

  const launchPath = extractDetail(line, "Launching Codex in ");
  if (launchPath) {
    return createActivity(`launch-${index}`, "blue", "Codex started", launchPath);
  }

  const codexMessage = extractDetail(line, "[codex agent_message] ");
  if (codexMessage) {
    return createActivity(`codex-message-${index}`, "blue", "Codex update", codexMessage);
  }

  const codexStderr = extractDetail(line, "[codex stderr] ");
  if (codexStderr) {
    return createActivity(`codex-stderr-${index}`, "yellow", "Tool warning", codexStderr);
  }

  const codexRaw = extractDetail(line, "[codex raw] ");
  if (codexRaw) {
    return createActivity(`codex-raw-${index}`, "blue", "Codex update", codexRaw);
  }

  if (line.startsWith("[codex ")) {
    return createActivity(`codex-${index}`, "blue", "Codex update", line);
  }

  const validation = extractDetail(line, "Running validation: ");
  if (validation) {
    return createActivity(`validation-${index}`, "teal", "Validation running", validation);
  }

  const reviewReady = extractDetail(line, "Review package ready: ");
  if (reviewReady) {
    return createActivity(`review-${index}`, "green", "Ready for review", reviewReady);
  }

  if (line === "Codex finished successfully.") {
    return createActivity(
      `finished-${index}`,
      "green",
      "Implementation finished",
      "Codex completed the implementation phase."
    );
  }

  const runtimeFailure = extractDetail(line, "[runtime failure] ");
  if (runtimeFailure) {
    return createActivity(`failure-${index}`, "red", "Execution failed", runtimeFailure);
  }

  const requestedChanges = extractDetail(line, "Requested changes recorded: ");
  if (requestedChanges) {
    return createActivity(
      `requested-changes-${index}`,
      "orange",
      "Changes requested",
      requestedChanges
    );
  }

  const resumeInstruction = extractDetail(line, "Resume instruction recorded: ");
  if (resumeInstruction) {
    return createActivity(
      `resume-instruction-${index}`,
      "yellow",
      "Resume guidance saved",
      resumeInstruction
    );
  }

  if (line === "Resume requested without additional instruction.") {
    return createActivity(
      `resume-${index}`,
      "yellow",
      "Resume requested",
      "The next attempt will continue from the existing worktree without extra guidance."
    );
  }

  const resumeGuidance = extractDetail(line, "Resume guidance: ");
  if (resumeGuidance) {
    return createActivity(
      `resume-guidance-${index}`,
      "yellow",
      "Resume guidance",
      resumeGuidance
    );
  }

  const inputRecorded = extractDetail(line, "User input recorded: ");
  if (inputRecorded) {
    return createActivity(`input-${index}`, "yellow", "Note recorded", inputRecorded);
  }

  const stopped = extractDetail(line, "Execution stopped by user: ");
  if (stopped) {
    return createActivity(`stopped-${index}`, "orange", "Execution stopped", stopped);
  }

  if (line === "Execution stopped by user.") {
    return createActivity(
      `stopped-${index}`,
      "orange",
      "Execution stopped",
      "The current attempt was stopped intentionally and can be resumed later."
    );
  }

  const preservedWorktree = extractDetail(line, "Worktree preserved at: ");
  if (preservedWorktree) {
    return createActivity(
      `preserved-worktree-${index}`,
      "orange",
      "Worktree preserved",
      preservedWorktree
    );
  }

  const preservedBranch = extractDetail(line, "Working branch preserved: ");
  if (preservedBranch) {
    return createActivity(
      `preserved-branch-${index}`,
      "orange",
      "Working branch preserved",
      preservedBranch
    );
  }

  const reuseWorktree = extractDetail(line, "Reusing worktree at: ");
  if (reuseWorktree) {
    return createActivity(`reuse-worktree-${index}`, "blue", "Reusing worktree", reuseWorktree);
  }

  const reuseBranch = extractDetail(line, "Reusing working branch: ");
  if (reuseBranch) {
    return createActivity(`reuse-branch-${index}`, "blue", "Reusing branch", reuseBranch);
  }

  const newAttempt = extractDetail(line, "Starting execution attempt ");
  if (newAttempt) {
    return createActivity(`attempt-${index}`, "blue", "New attempt", newAttempt);
  }

  if (line === "Session was marked interrupted after backend startup recovery.") {
    return createActivity(
      `recovery-${index}`,
      "orange",
      "Restart recovery",
      "The backend restarted while the session was active, so the session was preserved for manual resume."
    );
  }

  if (
    line.startsWith("Command: codex ") ||
    line.startsWith("[validation ") ||
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

export function SessionActivityFeed({ logs, session }: SessionActivityFeedProps) {
  const interpretedActivities = logs
    .map((line, index) => interpretSessionLog(line, index))
    .filter((activity): activity is SessionActivity => activity !== null);
  const visibleActivities = interpretedActivities.slice(-12).reverse();

  return (
    <Stack gap="md">
      <Stack gap={4}>
        <Text fw={600}>Execution Summary</Text>
        <Text size="sm" c="dimmed">
          {session.last_summary ?? fallbackSummary(session.status)}
        </Text>
      </Stack>

      <Stack gap={4}>
        <Text fw={600}>Recent Activity</Text>
        <Text size="sm" c="dimmed">
          This view highlights notable Codex and system updates instead of showing the
          raw terminal transcript.
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
                <Text size="sm" style={{ flex: 1 }}>
                  {activity.detail}
                </Text>
              </Group>
            ))}
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}
