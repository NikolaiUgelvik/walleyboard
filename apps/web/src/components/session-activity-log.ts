import type { ExecutionSession } from "../../../../packages/contracts/src/index.js";
import { agentLabel as agentLabelForAdapter } from "../features/walleyboard/shared.js";
import {
  describeCommandExecution,
  describeFileChangeActivity,
  describeTodoListActivity,
  describeWebSearchActivity,
  extractCodexRawItemActionType,
  extractCodexRawItemStringField,
  extractCodexRawNumberField,
  extractCodexRawPaths,
  extractCodexRawTodoItems,
  parseCodexEvent,
  unwrapShellCommand,
} from "./SessionActivityFeed.codex.js";

export type ActivityTone =
  | "gray"
  | "blue"
  | "teal"
  | "yellow"
  | "orange"
  | "red"
  | "green";

export type SessionActivity = {
  key: string;
  tone: ActivityTone;
  label: string;
  detail: string;
};

export type ParsedExecutionSummary = {
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

function sessionAgentLabel(session: ExecutionSession): string {
  return agentLabelForAdapter(session.agent_adapter);
}

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

export function extractDetail(line: string, prefix: string): string | null {
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

export function truncate(value: string, maxLength = 240): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}

function interpretCodexEvent(
  line: string,
  index: number,
): SessionActivity | null {
  const event = parseCodexEvent(line);
  if (!event) {
    return null;
  }

  if (
    event.eventType === "turn.started" ||
    event.eventType === "thread.started" ||
    event.eventType === "turn.completed" ||
    event.eventType === "thread.completed"
  ) {
    return null;
  }

  if (
    event.eventType === "agent_message" &&
    event.payload === null &&
    event.rawPayload.trim().length > 0
  ) {
    return createActivity(
      `codex-message-${index}`,
      "blue",
      "Codex update",
      event.rawPayload,
    );
  }

  if (event.payload === null && event.eventType.startsWith("item.")) {
    const rawItemType = extractCodexRawItemStringField(
      event.rawPayload,
      "type",
    );
    if (rawItemType === "agent_message") {
      const text =
        extractCodexRawItemStringField(event.rawPayload, "text") ??
        extractCodexRawItemStringField(event.rawPayload, "message");
      if (text) {
        return createActivity(
          `codex-message-raw-${index}`,
          "blue",
          "Codex update",
          text.trim(),
        );
      }
    }

    if (rawItemType === "command_execution") {
      if (event.eventType === "item.started") {
        return null;
      }

      const command = extractCodexRawItemStringField(
        event.rawPayload,
        "command",
      );
      if (!command) {
        return null;
      }

      const description = describeCommandExecution(command, "Codex", truncate);
      const exitCode = extractCodexRawNumberField(
        event.rawPayload,
        "exit_code",
      );
      return createActivity(
        `codex-command-raw-${index}`,
        exitCode !== null && exitCode !== 0 ? "red" : "gray",
        exitCode !== null && exitCode !== 0
          ? "Command failed"
          : description.label,
        exitCode !== null && exitCode !== 0
          ? `\`${truncate(unwrapShellCommand(command), 160)}\``
          : description.detail,
      );
    }

    if (rawItemType === "file_change") {
      const description = describeFileChangeActivity(
        extractCodexRawPaths(event.rawPayload),
        "Codex",
        event.eventType === "item.started",
      );
      if (!description) {
        return null;
      }

      return createActivity(
        `codex-file-change-raw-${index}`,
        "gray",
        description.label,
        description.detail,
      );
    }

    if (rawItemType === "web_search") {
      const description = describeWebSearchActivity(
        extractCodexRawItemStringField(event.rawPayload, "query") ?? "",
        extractCodexRawItemActionType(event.rawPayload),
        "Codex",
        event.eventType === "item.started",
      );
      if (!description) {
        return null;
      }

      return createActivity(
        `codex-web-search-raw-${index}`,
        "gray",
        description.label,
        description.detail,
      );
    }

    if (rawItemType === "todo_list") {
      const description = describeTodoListActivity(
        extractCodexRawTodoItems(event.rawPayload),
        "Codex",
        event.eventType === "item.started",
      );
      if (!description) {
        return null;
      }

      return createActivity(
        `codex-todo-list-raw-${index}`,
        "yellow",
        description.label,
        description.detail,
      );
    }
  }

  if (
    event.eventType === "command.completed" ||
    event.eventType === "command.failed"
  ) {
    const description = describeCommandExecution(
      event.rawPayload,
      "Codex",
      truncate,
    );
    return createActivity(
      `codex-command-text-${index}`,
      event.eventType === "command.failed" ? "red" : "gray",
      event.eventType === "command.failed"
        ? "Command failed"
        : description.label,
      event.eventType === "command.failed"
        ? `\`${truncate(unwrapShellCommand(event.rawPayload), 160)}\``
        : description.detail,
    );
  }

  if (
    event.eventType === "file_change.started" ||
    event.eventType === "file_change.completed"
  ) {
    const description = describeFileChangeActivity(
      event.rawPayload
        .split(/\s*,\s*/)
        .map((part) => part.trim())
        .filter(Boolean),
      "Codex",
      event.eventType === "file_change.started",
    );
    if (!description) {
      return null;
    }

    return createActivity(
      `codex-file-change-${index}`,
      "gray",
      description.label,
      description.detail,
    );
  }

  if (
    event.eventType === "web_search.started" ||
    event.eventType === "web_search.search" ||
    event.eventType === "web_search.open" ||
    event.eventType === "web_search.completed"
  ) {
    const description = describeWebSearchActivity(
      event.rawPayload,
      event.eventType === "web_search.search"
        ? "search"
        : event.eventType === "web_search.open"
          ? "open"
          : null,
      "Codex",
      event.eventType === "web_search.started",
    );
    if (!description) {
      return null;
    }

    return createActivity(
      `codex-web-search-${index}`,
      "gray",
      description.label,
      description.detail,
    );
  }

  if (
    event.eventType === "todo_list.started" ||
    event.eventType === "todo_list.completed"
  ) {
    const summaryMatch = event.rawPayload.match(/^(.*)\s+\[(\d+)\/(\d+)\]$/);
    const summaryText = summaryMatch?.[1]?.trim() ?? event.rawPayload.trim();
    const completedCount = summaryMatch?.[2] ?? null;
    const totalCount = summaryMatch?.[3] ?? null;
    const lines = summaryText
      .split(/\s+\|\s+/)
      .map((item) => `- ${item}`)
      .join("\n");
    return createActivity(
      `codex-todo-list-${index}`,
      "yellow",
      event.eventType === "todo_list.started"
        ? "Plan updated"
        : "Plan checkpoint",
      `Codex refreshed the task list:\n${lines}${completedCount && totalCount ? `\n${completedCount}/${totalCount} completed` : ""}`,
    );
  }

  if (
    !event.payload ||
    !("item" in event.payload) ||
    !event.payload.item ||
    typeof event.payload.item !== "object"
  ) {
    return null;
  }

  const itemRecord = event.payload.item as Record<string, unknown>;
  const itemType = typeof itemRecord.type === "string" ? itemRecord.type : null;

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
      text.trim(),
    );
  }

  if (itemType === "command_execution") {
    if (event.eventType === "item.started") {
      return null;
    }

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
    const description = describeCommandExecution(command, "Codex", truncate);

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

  if (itemType === "file_change") {
    const changes = Array.isArray(itemRecord.changes)
      ? itemRecord.changes.filter(
          (change): change is Record<string, unknown> =>
            !!change && typeof change === "object",
        )
      : [];
    const paths = changes
      .map((change) => (typeof change.path === "string" ? change.path : null))
      .filter((path): path is string => path !== null);
    const description = describeFileChangeActivity(
      paths,
      "Codex",
      event.eventType === "item.started",
    );
    if (!description) {
      return null;
    }

    return createActivity(
      `codex-file-change-item-${index}`,
      "gray",
      description.label,
      description.detail,
    );
  }

  if (itemType === "web_search") {
    const action =
      itemRecord.action && typeof itemRecord.action === "object"
        ? (itemRecord.action as Record<string, unknown>)
        : null;
    const description = describeWebSearchActivity(
      typeof itemRecord.query === "string" ? itemRecord.query : "",
      typeof action?.type === "string" ? action.type : null,
      "Codex",
      event.eventType === "item.started",
    );
    if (!description) {
      return null;
    }

    return createActivity(
      `codex-web-search-item-${index}`,
      "gray",
      description.label,
      description.detail,
    );
  }

  if (itemType === "todo_list") {
    const todoItems = Array.isArray(itemRecord.items)
      ? itemRecord.items.filter(
          (todo): todo is Record<string, unknown> =>
            !!todo && typeof todo === "object",
        )
      : [];
    const description = describeTodoListActivity(
      todoItems.map((todo) => ({
        text: typeof todo.text === "string" ? todo.text : "",
        completed: todo.completed === true,
      })),
      "Codex",
      event.eventType === "item.started",
    );
    if (!description) {
      return null;
    }

    return createActivity(
      `codex-todo-list-item-${index}`,
      "yellow",
      description.label,
      description.detail,
    );
  }

  return null;
}

function isSuppressedCodexEnvelopeEvent(line: string): boolean {
  const event = parseCodexEvent(line);
  if (!event) {
    return false;
  }

  return (
    event.eventType === "turn.started" ||
    event.eventType === "thread.started" ||
    event.eventType === "turn.completed" ||
    event.eventType === "thread.completed"
  );
}

function interpretGenericAdapterLine(
  line: string,
  index: number,
  session: ExecutionSession,
): SessionActivity | null {
  const agentLabel = sessionAgentLabel(session);
  const adapterPrefix = `[${session.agent_adapter} `;

  const adapterStderr = extractDetail(
    line,
    `[${session.agent_adapter} stderr] `,
  );
  if (adapterStderr) {
    return createActivity(
      `${session.agent_adapter}-stderr-${index}`,
      "yellow",
      "Tool warning",
      adapterStderr,
    );
  }

  const adapterRaw = extractDetail(line, `[${session.agent_adapter} raw] `);
  if (adapterRaw) {
    return createActivity(
      `${session.agent_adapter}-raw-${index}`,
      "blue",
      `${agentLabel} update`,
      adapterRaw,
    );
  }

  if (line.startsWith(adapterPrefix)) {
    const match = line.match(/^\[[^\]]+\]\s+(.+)$/);
    return createActivity(
      `${session.agent_adapter}-event-${index}`,
      "blue",
      `${agentLabel} update`,
      match?.[1] ?? line,
    );
  }

  return null;
}

function extractLaunchPath(line: string, agentLabel: string): string | null {
  return (
    extractDetail(line, `Launching ${agentLabel} in Docker for `) ??
    extractDetail(line, `Launching ${agentLabel} in `) ??
    extractDetail(line, "Launching Agent in Docker for ") ??
    extractDetail(line, "Launching Agent in ")
  );
}

export function interpretSessionLog(
  line: string,
  index: number,
  session: ExecutionSession,
): SessionActivity | null {
  const agentLabel = sessionAgentLabel(session);

  if (session.agent_adapter === "codex") {
    const codexEvent = interpretCodexEvent(line, index);
    if (codexEvent) {
      return codexEvent;
    }
    if (isSuppressedCodexEnvelopeEvent(line)) {
      return null;
    }
  } else {
    const genericAdapterLine = interpretGenericAdapterLine(
      line,
      index,
      session,
    );
    if (genericAdapterLine) {
      return genericAdapterLine;
    }
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

  const launchPath = extractLaunchPath(line, agentLabel);
  if (launchPath) {
    return createActivity(
      `launch-${index}`,
      "blue",
      `${agentLabel} started`,
      launchPath,
    );
  }

  const genericAdapterLine = interpretGenericAdapterLine(line, index, session);
  if (genericAdapterLine) {
    return genericAdapterLine;
  }

  if (
    line.startsWith("[codex ") ||
    line.startsWith(`[${session.agent_adapter} `) ||
    line.startsWith("[validation ")
  ) {
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

  if (line === `${agentLabel} finished successfully.`) {
    return createActivity(
      `finished-${index}`,
      "green",
      "Implementation finished",
      `${agentLabel} completed the implementation phase.`,
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

  const restartInstruction = extractDetail(
    line,
    "Fresh restart guidance recorded: ",
  );
  if (restartInstruction) {
    return createActivity(
      `restart-guidance-${index}`,
      "orange",
      "Fresh restart guidance",
      restartInstruction,
    );
  }

  if (line === "Fresh restart requested without additional guidance.") {
    return createActivity(
      `restart-requested-${index}`,
      "orange",
      "Fresh restart requested",
      "The next attempt will recreate the worktree and start from scratch without extra guidance.",
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
      terminalInput,
    );
  }

  const agentInput = extractDetail(line, "[agent input] ");
  if (agentInput) {
    return createActivity(
      `agent-input-${index}`,
      "yellow",
      "Live input sent",
      agentInput,
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

  if (parseAttemptNumberFromLogLine(line) !== null) {
    return createActivity(
      `attempt-${index}`,
      "blue",
      "New attempt",
      line.replace(/\.$/, ""),
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
    line.startsWith("Command: ") ||
    line.startsWith("Verified git repository: ") ||
    line.startsWith("Checked out target branch: ") ||
    line === "Codex launch has been handed off to the execution runtime." ||
    line === "Agent launch has been handed off to the execution runtime." ||
    line === "Claude Code launch has been handed off to the execution runtime."
  ) {
    return null;
  }

  return createActivity(`system-${index}`, "gray", "System update", line);
}

function parseAttemptNumberFromLogLine(line: string): number | null {
  const match = line.match(
    /(?:Starting|Queued)(?: fresh)? execution attempt (\d+)/i,
  );
  if (!match?.[1]) {
    return null;
  }

  const attemptNumber = Number.parseInt(match[1], 10);
  return Number.isNaN(attemptNumber) ? null : attemptNumber;
}

export function fallbackSessionSummary(session: ExecutionSession): string {
  const agentLabel = sessionAgentLabel(session);
  switch (session.status) {
    case "queued":
      return "Execution is queued and waiting to start.";
    case "running":
      return `${agentLabel} is currently working on the ticket.`;
    case "paused_checkpoint":
      return `${agentLabel} is waiting for approval before it can continue.`;
    case "paused_user_control":
      return "The session is paused for manual control.";
    case "awaiting_input":
      return `${agentLabel} needs more input before the next attempt can continue.`;
    case "interrupted":
      return "The previous attempt stopped before completion and can be resumed.";
    case "failed":
      return "The last attempt failed and may need guidance before retrying.";
    case "completed":
      return "The implementation phase completed and handed off to review.";
  }
}

function nextSectionStart(
  sectionStarts: number[],
  currentIndex: number,
  fallback: number,
): number {
  const laterStarts = sectionStarts.filter((value) => value > currentIndex);
  return laterStarts.length > 0 ? Math.min(...laterStarts) : fallback;
}

function parseRisksSection(risksText: string): string[] {
  const trimmed = risksText.trim().replace(/\.$/, "");
  if (trimmed.length === 0 || /^none$/i.test(trimmed)) {
    return [];
  }

  const bulletMatches = Array.from(
    trimmed.matchAll(/(?:^|\n)-\s+([\s\S]*?)(?=\n-\s+|$)/g),
    (match) => match[1]?.trim() ?? "",
  ).filter(Boolean);
  if (bulletMatches.length > 0) {
    return bulletMatches;
  }

  return trimmed
    .split(
      /,\s+(?=(?:the|`|backend|integration|Codex|MCP|extra_env_allowlist)\b)/,
    )
    .map((risk) => risk.trim())
    .filter(Boolean);
}

export function parseExecutionSummary(summary: string): ParsedExecutionSummary {
  const normalized = summary.trim();
  const changedFilesMarker = "Changed files:";
  const commitMarker = "The change is committed as ";
  const validationMarker = "Validation run:";
  const risksMarker = "Remaining risks:";
  const changedFilesIndex = normalized.indexOf(changedFilesMarker);
  const commitIndex = normalized.indexOf(commitMarker);
  const validationIndex = normalized.indexOf(validationMarker);
  const risksIndex = normalized.indexOf(risksMarker);
  const sectionStarts = [
    changedFilesIndex,
    commitIndex,
    validationIndex,
    risksIndex,
  ].filter((value) => value >= 0);
  const firstSectionStart =
    sectionStarts.length > 0 ? Math.min(...sectionStarts) : normalized.length;

  const overview = normalized.slice(0, firstSectionStart).trim();

  const commitText =
    commitIndex >= 0
      ? normalized
          .slice(
            commitIndex,
            nextSectionStart(sectionStarts, commitIndex, normalized.length),
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

  const validationText =
    validationIndex >= 0
      ? normalized
          .slice(
            validationIndex + validationMarker.length,
            nextSectionStart(sectionStarts, validationIndex, normalized.length),
          )
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
          .slice(
            risksIndex + risksMarker.length,
            nextSectionStart(sectionStarts, risksIndex, normalized.length),
          )
          .trim()
      : "";
  const risks = parseRisksSection(risksText);

  return {
    overview,
    commit,
    validation,
    risks,
  };
}

export function getSessionActivities(
  logs: string[],
  session: ExecutionSession,
): SessionActivity[] {
  return logs
    .map((line, index) => interpretSessionLog(line, index, session))
    .filter((activity): activity is SessionActivity => activity !== null);
}

export function getRecentSessionActivities(
  logs: string[],
  session: ExecutionSession,
  limit = 12,
): SessionActivity[] {
  return getSessionActivities(logs, session).slice(-limit).reverse();
}

export function summarizeSessionActivity(
  session: ExecutionSession,
  logs: string[],
): string {
  const parsedSummary = parseExecutionSummary(
    session.last_summary ?? fallbackSessionSummary(session),
  );
  if (parsedSummary.overview.length > 0) {
    return parsedSummary.overview;
  }

  const latestActivity = [...logs]
    .reverse()
    .map((line, index) => interpretSessionLog(line, index, session))
    .find((activity): activity is SessionActivity => activity !== null);

  return latestActivity?.detail ?? fallbackSessionSummary(session);
}
