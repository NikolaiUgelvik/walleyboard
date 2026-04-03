type ActivityDescription = {
  label: string;
  detail: string;
};

export type ParsedCodexEvent = {
  eventType: string;
  payload: Record<string, unknown> | null;
  rawPayload: string;
};

export function parseCodexEvent(line: string): ParsedCodexEvent | null {
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

export function unwrapShellCommand(command: string): string {
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

export function normalizeLoggedPath(value: string): string {
  return value.replace(/^\/workspace\//, "");
}

function normalizeCommandPathList(paths: string): string {
  return paths
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => normalizeLoggedPath(stripOuterQuotes(part)))
    .join(", ");
}

function formatCommandTargetSummary(targets: string): string {
  const normalizedTargets = normalizeCommandPathList(targets);
  if (normalizedTargets.length === 0) {
    return "the repository";
  }

  return normalizedTargets;
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

export function extractCodexRawItemStringField(
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

export function extractCodexRawNumberField(
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

export function extractCodexRawPaths(rawPayload: string): string[] {
  return Array.from(
    rawPayload.matchAll(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/g),
    (match) => unescapeShellString(match[1] ?? ""),
  ).filter(Boolean);
}

export function extractCodexRawItemActionType(
  rawPayload: string,
): string | null {
  const match = rawPayload.match(
    /"action"\s*:\s*\{[\s\S]*?"type"\s*:\s*"([^"]+)"/,
  );
  return match?.[1] ?? null;
}

export function extractCodexRawTodoItems(
  rawPayload: string,
): Array<{ text: string; completed: boolean }> {
  return Array.from(
    rawPayload.matchAll(
      /"text"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"completed"\s*:\s*(true|false)/g,
    ),
    (match) => ({
      text: unescapeShellString(match[1] ?? ""),
      completed: match[2] === "true",
    }),
  );
}

export function describeFileChangeActivity(
  paths: string[],
  label: string,
  inProgress: boolean,
): ActivityDescription | null {
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

export function describeWebSearchActivity(
  query: string,
  actionType: string | null,
  label: string,
  inProgress: boolean,
): ActivityDescription | null {
  const normalizedQuery = query.trim();
  const isUrl = /^https?:\/\//.test(normalizedQuery);

  if (inProgress) {
    if (normalizedQuery.length === 0) {
      return null;
    }

    return {
      label: "Searching web",
      detail: isUrl
        ? `${label} started opening \`${normalizedQuery}\`.`
        : `${label} started a web lookup for \`${normalizedQuery}\`.`,
    };
  }

  if (actionType === "search" || (!isUrl && normalizedQuery.length > 0)) {
    return normalizedQuery.length > 0
      ? {
          label: "Searched web",
          detail: `${label} searched the web for \`${normalizedQuery}\`.`,
        }
      : null;
  }

  if (isUrl) {
    return {
      label: "Opened web page",
      detail: `${label} opened \`${normalizedQuery}\`.`,
    };
  }

  return normalizedQuery.length > 0
    ? {
        label: "Web lookup",
        detail: `${label} checked \`${normalizedQuery}\`.`,
      }
    : null;
}

export function describeTodoListActivity(
  items: Array<{ text: string; completed: boolean }>,
  label: string,
  inProgress: boolean,
): ActivityDescription | null {
  const normalizedItems = items.filter((item) => item.text.trim().length > 0);
  if (normalizedItems.length === 0) {
    return null;
  }

  const completedCount = normalizedItems.filter(
    (item) => item.completed,
  ).length;
  const preview = normalizedItems
    .slice(0, 2)
    .map((item) => `- ${item.text.trim()}`)
    .join("\n");
  const suffix =
    normalizedItems.length > 2
      ? `\n- ${normalizedItems.length - 2} more items`
      : "";
  const summary = `${preview}${suffix}\n${completedCount}/${normalizedItems.length} completed`;

  return {
    label: inProgress ? "Plan updated" : "Plan checkpoint",
    detail: `${label} refreshed the task list:\n${summary}`,
  };
}

export function describeCommandExecution(
  command: string,
  label: string,
  truncate: (value: string, maxLength?: number) => string,
): ActivityDescription {
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
