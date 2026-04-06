import {
  describeCommandExecution,
  describeFileChangeActivity,
  describeTodoListActivity,
  normalizeLoggedPath,
} from "./SessionActivityFeed.codex.js";

type ActivityTone =
  | "gray"
  | "blue"
  | "teal"
  | "yellow"
  | "orange"
  | "red"
  | "green";

export type ClaudeActivityDescription = {
  tone: ActivityTone;
  label: string;
  detail: string;
};

type ParsedClaudeEvent = {
  eventType: string;
  payload: Record<string, unknown> | null;
  rawPayload: string;
};

function truncateValue(value: string, maxLength = 240): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function parseClaudeEvent(line: string): ParsedClaudeEvent | null {
  const prefixedMatch = line.match(/^\[claude-code ([^\]]+)\] ([\s\S]+)$/);
  if (prefixedMatch) {
    const [, eventType, rawPayload] = prefixedMatch;
    if (!eventType || !rawPayload) {
      return null;
    }

    return {
      eventType,
      payload: parseJsonRecord(rawPayload),
      rawPayload,
    };
  }

  const normalized = line.trim();
  if (!normalized.startsWith("{")) {
    return null;
  }

  const payload = parseJsonRecord(normalized);
  if (!payload) {
    return null;
  }

  const eventType = typeof payload.type === "string" ? payload.type : null;
  if (!eventType) {
    return null;
  }

  return {
    eventType,
    payload,
    rawPayload: normalized,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function flattenTextContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => flattenTextContent(item))
      .filter((item) => item.trim().length > 0)
      .join("\n\n");
  }

  const record = asRecord(value);
  if (!record) {
    return "";
  }

  if (typeof record.text === "string") {
    return record.text;
  }

  if (typeof record.content === "string") {
    return record.content;
  }

  return "";
}

function summarizeTextUpdate(
  text: string,
  tone: ActivityTone = "blue",
): ClaudeActivityDescription | null {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return null;
  }

  return {
    tone,
    label: "Claude Code update",
    detail: normalized,
  };
}

function summarizeToolOutput(
  output: string,
  isError: boolean,
): ClaudeActivityDescription | null {
  const normalized = output.trim();
  if (normalized.length === 0) {
    return null;
  }

  const createdFileMatch = normalized.match(
    /^File created successfully at:\s*(.+)$/im,
  );
  if (createdFileMatch?.[1]) {
    return {
      tone: "green",
      label: "Created file",
      detail: `Claude Code created \`${normalizeLoggedPath(createdFileMatch[1].trim())}\`.`,
    };
  }

  const updatedFileMatch = normalized.match(
    /^File (?:updated|written) successfully at:\s*(.+)$/im,
  );
  if (updatedFileMatch?.[1]) {
    return {
      tone: "gray",
      label: "Updated file",
      detail: `Claude Code updated \`${normalizeLoggedPath(updatedFileMatch[1].trim())}\`.`,
    };
  }

  const commitMatch = normalized.match(
    /^\[([^\s\]]+)\s+([0-9a-f]{7,})\]\s+(.+)$/m,
  );
  if (commitMatch?.[2] && commitMatch[3]) {
    return {
      tone: "green",
      label: "Created commit",
      detail: `Claude Code created commit \`${commitMatch[2]}\`: ${commitMatch[3].trim()}.`,
    };
  }

  const firstMeaningfulLine =
    normalized
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? normalized;

  return {
    tone: isError ? "red" : "gray",
    label: isError ? "Tool failed" : "Tool result",
    detail: truncateValue(firstMeaningfulLine),
  };
}

function summarizeToolUse(
  toolUseBlock: Record<string, unknown>,
): ClaudeActivityDescription | null {
  const toolName =
    typeof toolUseBlock.name === "string" ? toolUseBlock.name : null;
  const input = asRecord(toolUseBlock.input);

  if (!toolName) {
    return null;
  }

  if (toolName === "Bash") {
    const command = typeof input?.command === "string" ? input.command : null;
    if (!command) {
      return null;
    }

    return {
      tone: "gray",
      ...describeCommandExecution(command, "Claude Code", truncateValue),
    };
  }

  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") {
    const filePath =
      typeof input?.file_path === "string" ? input.file_path : null;
    if (!filePath) {
      return null;
    }

    const description = describeFileChangeActivity(
      [filePath],
      "Claude Code",
      true,
    );
    return description ? { tone: "gray", ...description } : null;
  }

  if (toolName === "Read") {
    const filePath =
      typeof input?.file_path === "string" ? input.file_path : null;
    if (!filePath) {
      return null;
    }

    const offset = typeof input?.offset === "number" ? input.offset : null;
    const limit = typeof input?.limit === "number" ? input.limit : null;
    const lineWindow =
      offset !== null && limit !== null && limit > 0
        ? ` around lines ${offset + 1}-${offset + limit}`
        : "";

    return {
      tone: "gray",
      label: "Read file",
      detail: `Claude Code opened \`${normalizeLoggedPath(filePath)}\`${lineWindow}.`,
    };
  }

  if (toolName === "Grep") {
    const pattern = typeof input?.pattern === "string" ? input.pattern : null;
    const path = typeof input?.path === "string" ? input.path : null;
    if (!pattern) {
      return null;
    }

    return {
      tone: "gray",
      label: "Searched code",
      detail: path
        ? `Claude Code searched for \`${pattern}\` in \`${normalizeLoggedPath(path)}\`.`
        : `Claude Code searched the repository for \`${pattern}\`.`,
    };
  }

  if (toolName === "Glob") {
    const pattern = typeof input?.pattern === "string" ? input.pattern : null;
    if (!pattern) {
      return null;
    }

    return {
      tone: "gray",
      label: "Listed matching files",
      detail: `Claude Code looked for files matching \`${pattern}\`.`,
    };
  }

  if (toolName === "LS") {
    const path = typeof input?.path === "string" ? input.path : null;
    if (!path) {
      return null;
    }

    return {
      tone: "gray",
      label: "Listed directory",
      detail: `Claude Code inspected \`${normalizeLoggedPath(path)}\`.`,
    };
  }

  if (toolName === "TodoWrite") {
    const todos = asRecordArray(input?.todos).map((todo) => ({
      text: typeof todo.content === "string" ? todo.content : "",
      completed: todo.status === "completed",
    }));
    const description = describeTodoListActivity(todos, "Claude Code", true);
    return description ? { tone: "yellow", ...description } : null;
  }

  if (toolName === "ExitPlanMode") {
    const plan = typeof input?.plan === "string" ? input.plan.trim() : "";
    if (plan.length === 0) {
      return null;
    }

    return {
      tone: "yellow",
      label: "Plan ready",
      detail: plan,
    };
  }

  return {
    tone: "gray",
    label: "Tool requested",
    detail: `Claude Code called \`${toolName}\`.`,
  };
}

function summarizeToolResultRecord(
  toolResult: Record<string, unknown>,
): ClaudeActivityDescription | null {
  const resultType =
    typeof toolResult.type === "string" ? toolResult.type : null;
  const filePath =
    typeof toolResult.filePath === "string"
      ? toolResult.filePath
      : typeof toolResult.file_path === "string"
        ? toolResult.file_path
        : null;

  if (resultType === "create" && filePath) {
    return {
      tone: "green",
      label: "Created file",
      detail: `Claude Code created \`${normalizeLoggedPath(filePath)}\`.`,
    };
  }

  if (
    (resultType === "update" ||
      resultType === "write" ||
      resultType === "edit") &&
    filePath
  ) {
    return {
      tone: "gray",
      label: "Updated file",
      detail: `Claude Code updated \`${normalizeLoggedPath(filePath)}\`.`,
    };
  }

  const stderr = typeof toolResult.stderr === "string" ? toolResult.stderr : "";
  if (stderr.trim().length > 0) {
    return summarizeToolOutput(stderr, true);
  }

  const stdout = typeof toolResult.stdout === "string" ? toolResult.stdout : "";
  if (stdout.trim().length > 0) {
    return summarizeToolOutput(stdout, false);
  }

  const content = flattenTextContent(toolResult.content);
  return summarizeToolOutput(content, false);
}

function summarizeAssistantEvent(
  payload: Record<string, unknown> | null,
  rawPayload: string,
): ClaudeActivityDescription | null {
  if (!payload) {
    return summarizeTextUpdate(rawPayload);
  }

  const message = asRecord(payload.message);
  if (!message) {
    if (typeof payload.message === "string") {
      return summarizeTextUpdate(payload.message);
    }

    return summarizeTextUpdate(rawPayload);
  }

  if (typeof message.content === "string") {
    return summarizeTextUpdate(message.content);
  }

  const contentBlocks = asRecordArray(message.content);
  const planToolUse = contentBlocks.find(
    (block) => block.type === "tool_use" && block.name === "ExitPlanMode",
  );
  if (planToolUse) {
    const description = summarizeToolUse(planToolUse);
    if (description) {
      return description;
    }
  }

  const firstToolUse = contentBlocks.find((block) => block.type === "tool_use");
  if (firstToolUse) {
    const description = summarizeToolUse(firstToolUse);
    if (description) {
      return description;
    }
  }

  const textContent = contentBlocks
    .filter((block) => block.type === "text")
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .filter((text) => text.trim().length > 0)
    .join("\n\n");
  if (textContent.length > 0) {
    return summarizeTextUpdate(textContent);
  }

  return summarizeTextUpdate(rawPayload);
}

function summarizeUserEvent(
  payload: Record<string, unknown> | null,
  rawPayload: string,
): ClaudeActivityDescription | null {
  if (!payload) {
    return summarizeTextUpdate(rawPayload);
  }

  const toolUseResult = asRecord(payload.tool_use_result);
  if (toolUseResult) {
    const description = summarizeToolResultRecord(toolUseResult);
    if (description) {
      return description;
    }
  }

  const message = asRecord(payload.message);
  if (!message) {
    return summarizeTextUpdate(rawPayload);
  }

  if (typeof message.content === "string") {
    return summarizeTextUpdate(message.content);
  }

  const contentBlocks = asRecordArray(message.content);
  const firstToolResult = contentBlocks.find(
    (block) => block.type === "tool_result",
  );
  if (firstToolResult) {
    const content = flattenTextContent(firstToolResult.content);
    const description = summarizeToolOutput(
      content,
      firstToolResult.is_error === true,
    );
    if (description) {
      return description;
    }
  }

  const textContent = flattenTextContent(message.content);
  return summarizeTextUpdate(textContent);
}

export function interpretClaudeActivityLine(
  line: string,
): ClaudeActivityDescription | null {
  const event = parseClaudeEvent(line);
  if (!event) {
    return null;
  }

  const normalizedEventType =
    typeof event.payload?.type === "string"
      ? event.payload.type
      : event.eventType;

  if (normalizedEventType === "assistant") {
    return summarizeAssistantEvent(event.payload, event.rawPayload);
  }

  if (normalizedEventType === "user") {
    return summarizeUserEvent(event.payload, event.rawPayload);
  }

  if (normalizedEventType === "result") {
    const resultText =
      typeof event.payload?.result === "string"
        ? event.payload.result
        : event.rawPayload;
    const normalized = resultText.trim();
    if (normalized.length === 0) {
      return null;
    }

    return {
      tone: "green",
      label: "Result",
      detail: normalized,
    };
  }

  if (normalizedEventType === "system") {
    const text =
      typeof event.payload?.message === "string"
        ? event.payload.message
        : event.rawPayload;
    const normalized = text.trim();
    if (normalized.length === 0) {
      return null;
    }

    return {
      tone: "gray",
      label: "System update",
      detail: normalized,
    };
  }

  return summarizeTextUpdate(event.rawPayload);
}
