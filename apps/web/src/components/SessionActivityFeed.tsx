import { Badge, Code, Group, List, Stack, Text } from "@mantine/core";
import React from "react";
import type { ExecutionSession } from "../../../../packages/contracts/src/index.js";
import { agentLabel as agentLabelForAdapter } from "../features/walleyboard/shared.js";
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
  payload: Record<string, unknown> | null;
  rawPayload: string;
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
  if (match) {
    const [, eventType, rawPayload] = match;
    if (!eventType || !rawPayload) {
      return null;
    }

    try {
      const payload = JSON.parse(rawPayload) as Record<string, unknown>;
      return {
        eventType,
        payload,
        rawPayload,
      };
    } catch {
      return {
        eventType,
        payload: null,
        rawPayload,
      };
    }
  }

  const normalized = line.trim();
  if (!normalized.startsWith("{")) {
    return null;
  }

  try {
    const payload = JSON.parse(normalized) as Record<string, unknown>;
    const eventType =
      typeof payload.type === "string"
        ? payload.type
        : typeof payload.event === "string"
          ? payload.event
          : null;
    if (!eventType) {
      return null;
    }
    return {
      payload,
      eventType,
      rawPayload: normalized,
    };
  } catch {
    return null;
  }
}

function stripOuterQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function unescapeShellString(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, "\\");
}

function unwrapShellCommand(command: string): string {
  const trimmed = command.trim();
  const wrappedMatch = trimmed.match(/^(?:\/bin\/)?(?:bash|sh)\s+-lc\s+(.+)$/s);
  if (!wrappedMatch) {
    return trimmed;
  }

  const wrappedCommand = wrappedMatch[1];
  if (!wrappedCommand) {
    return trimmed;
  }

  return unescapeShellString(stripOuterQuotes(wrappedCommand)).trim();
}

function normalizeLoggedPath(value: string): string {
  return value.replace(/^\/workspace\//, "");
}

function normalizeCommandPathList(paths: string): string {
  return paths
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => normalizeLoggedPath(stripOuterQuotes(part)))
    .join(", ");
}

function summarizePathList(paths: string[]): string {
  if (paths.length === 0) {
    return "";
  }

  if (paths.length === 1) {
    return `\`${normalizeLoggedPath(paths[0] ?? "")}\``;
  }

  if (paths.length === 2) {
    return `\`${normalizeLoggedPath(paths[0] ?? "")}\` and \`${normalizeLoggedPath(paths[1] ?? "")}\``;
  }

  return `\`${normalizeLoggedPath(paths[0] ?? "")}\`, \`${normalizeLoggedPath(paths[1] ?? "")}\`, and ${paths.length - 2} more`;
}

function formatCommandTargetSummary(targets: string): string {
  const normalizedTargets = normalizeCommandPathList(targets);
  if (normalizedTargets.length === 0) {
    return "the repository";
  }

  return normalizedTargets;
}

function extractCodexRawItemStringField(
  rawPayload: string,
  fieldName: string,
): string | null {
  const match = rawPayload.match(
    new RegExp(
      `"item"\\s*:\\s*\\{[\\s\\S]*?"${fieldName}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`,
      "s",
    ),
  );
  if (!match?.[1]) {
    return null;
  }

  return unescapeShellString(match[1]);
}

function extractCodexRawNumberField(
  rawPayload: string,
  fieldName: string,
): number | null {
  const match = rawPayload.match(new RegExp(`"${fieldName}"\\s*:\\s*(-?\\d+)`));
  if (!match?.[1]) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function extractCodexRawPaths(rawPayload: string): string[] {
  return Array.from(
    rawPayload.matchAll(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/g),
    (match) => unescapeShellString(match[1] ?? ""),
  ).filter(Boolean);
}

function describeFileChangeActivity(
  paths: string[],
  label: string,
  inProgress: boolean,
): {
  label: string;
  detail: string;
} | null {
  if (paths.length === 0) {
    return null;
  }

  const pathSummary = summarizePathList(paths);
  if (inProgress) {
    return {
      label: paths.length === 1 ? "Editing file" : "Editing files",
      detail: `${label} started updating ${pathSummary}.`,
    };
  }

  return {
    label: paths.length === 1 ? "Updated file" : "Updated files",
    detail: `${label} updated ${pathSummary}.`,
  };
}

function describeCommandExecution(
  command: string,
  label: string,
): {
  label: string;
  detail: string;
} {
  const resolvedCommand = unwrapShellCommand(command);
  const quotedSearchCommand = stripOuterQuotes(resolvedCommand);

  const rgMatch = quotedSearchCommand.match(
    /^rg(?:\s+--files)?\s+-n\s+["']([^"']+)["']\s+(.+)$/,
  );
  if (rgMatch) {
    const [, pattern, targets] = rgMatch;
    return {
      label: "Searched code",
      detail: `${label} searched for \`${pattern}\` in ${formatCommandTargetSummary(targets ?? "")}.`,
    };
  }

  const rgFilesMatch = quotedSearchCommand.match(/^rg\s+--files\s+(.+)$/);
  if (rgFilesMatch) {
    return {
      label: "Listed matching files",
      detail: `${label} listed files under ${formatCommandTargetSummary(rgFilesMatch[1] ?? "")}.`,
    };
  }

  const grepMatch = quotedSearchCommand.match(
    /^grep(?:\s+-\S+)*\s+["']([^"']+)["']\s+(.+)$/,
  );
  if (grepMatch) {
    const [, pattern, targets] = grepMatch;
    return {
      label: "Searched code",
      detail: `${label} searched for \`${pattern}\` in ${formatCommandTargetSummary(targets ?? "")}.`,
    };
  }

  const findMatch = quotedSearchCommand.match(/^find\s+(.+)$/);
  if (findMatch) {
    return {
      label: "Scanned files",
      detail: `${label} scanned ${formatCommandTargetSummary(findMatch[1] ?? "")} for relevant files.`,
    };
  }

  const sedMatch = resolvedCommand.match(
    /^sed -n ['"]?(\d+),(\d+)p['"]?\s+(.+)$/,
  );
  if (sedMatch) {
    const [, startLine, endLine, path] = sedMatch;
    return {
      label: "Read file excerpt",
      detail: `${label} reviewed \`${normalizeLoggedPath(path ?? "")}\` lines ${startLine}-${endLine}.`,
    };
  }

  const catMatch = resolvedCommand.match(/^cat\s+(.+)$/);
  if (catMatch) {
    return {
      label: "Read file",
      detail: `${label} opened \`${normalizeLoggedPath(catMatch[1] ?? "")}\`.`,
    };
  }

  const listMatch = resolvedCommand.match(/^ls(?:\s+-\S+)*\s+(.+)$/);
  if (listMatch) {
    return {
      label: "Listed directory",
      detail: `${label} inspected \`${normalizeLoggedPath(listMatch[1] ?? "")}\`.`,
    };
  }

  if (resolvedCommand.includes(".github/workflows")) {
    return {
      label: "Inspected CI workflow",
      detail: `${label} reviewed the CI workflow configuration.`,
    };
  }

  if (resolvedCommand.includes(".gitignore")) {
    return {
      label: "Checked ignore rules",
      detail: `${label} inspected \`.gitignore\`.`,
    };
  }

  if (
    resolvedCommand.includes("npm run typecheck") ||
    resolvedCommand.includes("tsc -p")
  ) {
    return {
      label: "Checked types",
      detail: `${label} ran the project's type checks.`,
    };
  }

  if (
    resolvedCommand.includes("npm run build") ||
    resolvedCommand.includes("vite build")
  ) {
    return {
      label: "Built project",
      detail: `${label} ran the build to verify the current changes.`,
    };
  }

  if (
    resolvedCommand.includes("npm run test") ||
    resolvedCommand.includes("npm test") ||
    resolvedCommand.includes("pytest")
  ) {
    return {
      label: "Ran tests",
      detail: `${label} ran a test command for the current change.`,
    };
  }

  if (resolvedCommand.includes("git status")) {
    return {
      label: "Checked git status",
      detail: `${label} verified the repository status.`,
    };
  }

  if (resolvedCommand.includes("git diff")) {
    return {
      label: "Reviewed changes",
      detail: `${label} inspected the current diff.`,
    };
  }

  if (
    resolvedCommand.includes("rg ") ||
    resolvedCommand.includes("grep ") ||
    resolvedCommand.includes("sed -n") ||
    resolvedCommand.includes("cat ") ||
    resolvedCommand.includes("ls ") ||
    resolvedCommand.includes("find ")
  ) {
    return {
      label: "Inspected project files",
      detail: `${label} looked through repository files to gather context.`,
    };
  }

  return {
    label: "Ran command",
    detail: `Ran \`${truncate(resolvedCommand, 160)}\`.`,
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

      const description = describeCommandExecution(command, "Codex");
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
  }

  if (
    event.eventType === "command.completed" ||
    event.eventType === "command.failed"
  ) {
    const description = describeCommandExecution(event.rawPayload, "Codex");
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
    const description = describeCommandExecution(command, "Codex");

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

  return null;
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

function interpretSessionLog(
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

function fallbackSummary(session: ExecutionSession): string {
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

export function summarizeSessionActivity(
  session: ExecutionSession,
  logs: string[],
): string {
  const parsedSummary = parseExecutionSummary(
    session.last_summary ?? fallbackSummary(session),
  );
  if (parsedSummary.overview.length > 0) {
    return parsedSummary.overview;
  }

  const latestActivity = [...logs]
    .reverse()
    .map((line, index) => interpretSessionLog(line, index, session))
    .find((activity): activity is SessionActivity => activity !== null);

  return latestActivity?.detail ?? fallbackSummary(session);
}

export function SessionActivityFeed({
  logs,
  session,
}: SessionActivityFeedProps) {
  const agentLabel = sessionAgentLabel(session);
  const interpretedActivities = logs
    .map((line, index) => interpretSessionLog(line, index, session))
    .filter((activity): activity is SessionActivity => activity !== null);
  const visibleActivities = interpretedActivities.slice(-12).reverse();
  const parsedSummary = parseExecutionSummary(
    session.last_summary ?? fallbackSummary(session),
  );
  const activityRows = React.Children.toArray(
    visibleActivities.map((activity) => (
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
    )),
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
          This view highlights notable {agentLabel} and system updates instead
          of showing the raw terminal transcript.
        </Text>
        {visibleActivities.length === 0 ? (
          <Text size="sm" c="dimmed">
            No interpreted activity is available for this session yet.
          </Text>
        ) : (
          <Stack gap="xs">{activityRows}</Stack>
        )}
      </Stack>
    </Stack>
  );
}
