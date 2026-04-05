import {
  type ChildProcessWithoutNullStreams,
  execFileSync,
} from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";
import type { IPty } from "node-pty";
import type { z } from "zod";

import type {
  Project,
  ReasoningEffort,
  RepositoryConfig,
  ValidationCommand,
} from "../../../../../packages/contracts/src/index.js";
import { runObservedOperation } from "../backend-observability.js";
import { resolveWalleyBoardPath } from "../walleyboard-paths.js";
import type { DraftFeasibilityResult, DraftRefinementResult } from "./types.js";

export function truncate(value: string, maxLength = 600): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}

export function hasMeaningfulContent(
  value: string | null | undefined,
): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Resolve the effective target branch for a ticket. The repository config
 * is the live source of truth; the ticket's target_branch is a snapshot
 * from creation time that may be stale if the repo config changed since.
 */
export function resolveTargetBranch(
  repository: RepositoryConfig,
  ticketTargetBranch: string,
): string {
  return repository.target_branch ?? ticketTargetBranch;
}

export function formatMarkdownLog(label: string, body: string): string {
  return `${label}:\n${body}`;
}

export function extractMarkdownLogBody(
  summary: string | null | undefined,
  label: string,
): string | null {
  if (!hasMeaningfulContent(summary)) {
    return null;
  }

  const prefix = `${label}:\n`;
  if (!summary.startsWith(prefix)) {
    return null;
  }

  const body = summary.slice(prefix.length).trim();
  return body.length > 0 ? body : null;
}

export function extractPersistedAttemptGuidance(
  summary: string | null | undefined,
): string | null {
  return (
    extractMarkdownLogBody(summary, "Execution resume requested") ??
    extractMarkdownLogBody(summary, "Execution restart requested")
  );
}

export function appendMarkdownSection(
  sections: string[],
  label: string,
  content: string | null | undefined,
): void {
  sections.push(`${label}:`, hasMeaningfulContent(content) ? content : "None.");
}

export function appendCriteriaSections(
  sections: string[],
  criteria: string[],
  emptyFallback: string,
): void {
  sections.push("Acceptance criteria:");

  if (criteria.length === 0) {
    sections.push(emptyFallback);
    return;
  }

  for (const [index, criterion] of criteria.entries()) {
    sections.push(`Criterion ${index + 1}:`, criterion);
    if (index < criteria.length - 1) {
      sections.push("");
    }
  }
}

export function appendContextSections(
  sections: string[],
  label: string,
  items: Array<{ label: string; content: string }>,
): void {
  if (items.length === 0) {
    return;
  }

  sections.push("", `${label}:`);
  for (const [index, item] of items.entries()) {
    sections.push(`${item.label}:`, item.content);
    if (index < items.length - 1) {
      sections.push("");
    }
  }
}

export function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function normalizeOptionalModel(model: string | null): string | null {
  if (model === null) {
    return null;
  }

  const trimmed = model.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeOptionalReasoningEffort(
  effort: ReasoningEffort | null,
): ReasoningEffort | null {
  return effort ?? null;
}

export function buildProcessEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => {
      return typeof entry[1] === "string";
    }),
  );
}

export function runGit(repoPath: string, args: string[]): string {
  return runObservedOperation(
    "execution-runtime.git",
    {
      command: args.join(" "),
      repoPath,
    },
    () =>
      execFileSync("git", ["-C", repoPath, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim(),
  );
}

// Non-TTY Codex treats an open stdin pipe as additional prompt input and waits
// for EOF before starting. Unattended runs should close stdin immediately.
export function closeProcessStdin(child: ChildProcessWithoutNullStreams): void {
  try {
    child.stdin.end();
  } catch {
    // Ignore already-closed stdin streams.
  }
}

export function shouldSuppressDockerAdapterLine(
  adapterId: string,
  line: string,
): boolean {
  return adapterId === "codex" && line.startsWith("[codex raw]");
}

export function extractSuppressedDockerFailureDetail(
  line: string,
): string | null {
  const detail = line.replace(/^\[codex raw\]\s*/, "").trim();
  return detail.length > 0 ? detail : null;
}

export function writeReviewDiff(
  project: Project,
  ticketId: number,
  diff: string,
): string {
  const reviewDir = resolveWalleyBoardPath("review-packages", project.slug);
  ensureDirectory(reviewDir);
  const diffPath = join(reviewDir, `ticket-${ticketId}.patch`);
  writeFileSync(diffPath, diff, "utf8");
  return diffPath;
}

export function buildValidationLogPath(
  project: Project,
  ticketId: number,
  commandId: string,
): string {
  const validationDir = resolveWalleyBoardPath(
    "validation-logs",
    project.slug,
    `ticket-${ticketId}`,
  );
  ensureDirectory(validationDir);
  return join(validationDir, `${commandId}.log`);
}

export function buildOutputSummaryPath(
  project: Project,
  ticketId: number,
  sessionId: string,
): string {
  const summaryDir = resolveWalleyBoardPath("agent-summaries", project.slug);
  ensureDirectory(summaryDir);
  return join(summaryDir, `ticket-${ticketId}-${sessionId}.txt`);
}

export function buildPullRequestBodyOutputPath(
  project: Project,
  ticketId: number,
  sessionId: string,
): string {
  const summaryDir = resolveWalleyBoardPath(
    "pull-request-bodies",
    project.slug,
  );
  ensureDirectory(summaryDir);
  return join(summaryDir, `ticket-${ticketId}-${sessionId}.json`);
}

export function buildMergeConflictSummaryPath(
  project: Project,
  ticketId: number,
  sessionId: string,
): string {
  const summaryDir = resolveWalleyBoardPath("agent-summaries", project.slug);
  ensureDirectory(summaryDir);
  return join(summaryDir, `ticket-${ticketId}-${sessionId}-merge-conflict.txt`);
}

export function buildDraftAnalysisOutputPath(
  project: Project,
  draftId: string,
  runId: string,
  mode: "refine" | "questions",
): string {
  const analysisDir = resolveWalleyBoardPath("draft-analyses", project.slug);
  ensureDirectory(analysisDir);
  return join(analysisDir, `${draftId}-${mode}-${runId}.json`);
}

export function buildReviewRunOutputPath(
  project: Project,
  ticketId: number,
  reviewRunId: string,
): string {
  const reviewDir = resolveWalleyBoardPath("agent-reviews", project.slug);
  ensureDirectory(reviewDir);
  return join(reviewDir, `ticket-${ticketId}-${reviewRunId}.json`);
}

export function parseCodexJsonResult<T>(
  rawOutput: string,
  schema: z.ZodType<T>,
): T {
  const trimmed = rawOutput.trim();
  if (trimmed.length === 0) {
    throw new Error("Codex returned no JSON output.");
  }

  const candidates = [trimmed];
  if (trimmed.startsWith("```")) {
    candidates.push(
      trimmed
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```$/i, "")
        .trim(),
    );
  }

  for (const candidate of candidates) {
    try {
      return schema.parse(JSON.parse(candidate));
    } catch {
      // Try the next candidate shape.
    }
  }

  throw new Error("Codex did not return valid JSON output.");
}

export function summarizeDraftRefinement(
  result: DraftRefinementResult,
): string {
  if (
    result.split_proposal_summary &&
    result.split_proposal_summary.trim().length > 0
  ) {
    return truncate(result.split_proposal_summary.trim(), 240);
  }

  return `Updated draft proposal with ${result.proposed_acceptance_criteria.length} acceptance criteria.`;
}

export function summarizeDraftQuestions(
  result: DraftFeasibilityResult,
): string {
  return truncate(result.summary, 240);
}

export function formatDraftAnalysisExitReason(
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  rawOutput: string,
): string {
  const summary =
    rawOutput.trim().length > 0
      ? ` Final output: ${truncate(rawOutput.trim(), 240)}`
      : "";
  return `Codex exited with ${exitCode === null ? "unknown code" : `code ${exitCode}`}${
    signal ? ` and signal ${signal}` : ""
  }.${summary}`;
}

export function formatCodexExitReason(
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  rawOutput: string,
): string {
  const summary =
    rawOutput.trim().length > 0
      ? ` Final output: ${truncate(rawOutput.trim(), 240)}`
      : "";
  return `Codex exited with ${exitCode === null ? "unknown code" : `code ${exitCode}`}${
    signal ? ` and signal ${signal}` : ""
  }.${summary}`;
}

export function summarizeCodexJsonLine(line: string): string {
  const normalized = line.trim();
  if (normalized.length === 0) {
    return "";
  }

  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    const payload =
      parsed.payload && typeof parsed.payload === "object"
        ? (parsed.payload as Record<string, unknown>)
        : null;

    if (
      parsed.type === "session_meta" &&
      payload &&
      typeof payload.id === "string"
    ) {
      return `[codex session] ${payload.id}`;
    }

    const eventType =
      typeof parsed.type === "string"
        ? parsed.type
        : typeof parsed.event === "string"
          ? parsed.event
          : "event";

    if (typeof parsed.message === "string") {
      return `[codex ${eventType}] ${truncate(parsed.message)}`;
    }

    if (typeof parsed.text === "string") {
      return `[codex ${eventType}] ${truncate(parsed.text)}`;
    }

    if (typeof parsed.output === "string") {
      return `[codex ${eventType}] ${truncate(parsed.output)}`;
    }

    return `[codex ${eventType}] ${truncate(JSON.stringify(parsed))}`;
  } catch {
    return `[codex raw] ${truncate(line)}`;
  }
}

export function extractCodexSessionIdFromJsonLine(line: string): string | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const payload =
      parsed.payload && typeof parsed.payload === "object"
        ? (parsed.payload as Record<string, unknown>)
        : null;

    if (
      parsed.type === "session_meta" &&
      payload &&
      typeof payload.id === "string"
    ) {
      return payload.id;
    }

    if (typeof parsed.session_id === "string") {
      return parsed.session_id;
    }

    if (payload && typeof payload.session_id === "string") {
      return payload.session_id;
    }

    const thread =
      payload?.thread && typeof payload.thread === "object"
        ? (payload.thread as Record<string, unknown>)
        : null;
    if (thread && typeof thread.id === "string") {
      return thread.id;
    }
  } catch {
    return null;
  }

  return null;
}

export function streamLines(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
): void {
  const lineReader = readline.createInterface({
    input: stream,
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  lineReader.on("line", onLine);
}

export function streamPtyLines(
  pty: IPty,
  handlers: {
    onExit: (event: { exitCode: number; signal?: number }) => void;
    onLine: (line: string) => void;
  },
): void {
  let pendingBuffer = "";

  pty.onData((chunk: string) => {
    pendingBuffer += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    while (pendingBuffer.includes("\n")) {
      const newlineIndex = pendingBuffer.indexOf("\n");
      const line = pendingBuffer.slice(0, newlineIndex);
      pendingBuffer = pendingBuffer.slice(newlineIndex + 1);
      handlers.onLine(line);
    }
  });

  pty.onExit((event: { exitCode: number; signal?: number }) => {
    if (pendingBuffer.trim().length > 0) {
      handlers.onLine(pendingBuffer);
      pendingBuffer = "";
    }
    handlers.onExit(event);
  });
}

export function streamChildProcessLines(
  child: ChildProcessWithoutNullStreams,
  handlers: {
    onError?: (error: Error) => void;
    onExit: (event: {
      exitCode: number | null;
      signal: NodeJS.Signals | null;
    }) => void;
    onLine: (line: string) => void;
  },
): void {
  const pendingBuffers = {
    stderr: "",
    stdout: "",
  };
  let settled = false;

  const flushBuffer = (streamKey: keyof typeof pendingBuffers) => {
    const pendingBuffer = pendingBuffers[streamKey];
    if (pendingBuffer.trim().length === 0) {
      pendingBuffers[streamKey] = "";
      return;
    }

    handlers.onLine(pendingBuffer);
    pendingBuffers[streamKey] = "";
  };

  const attachStream = (
    stream: NodeJS.ReadableStream,
    streamKey: keyof typeof pendingBuffers,
  ) => {
    stream.on("data", (chunk: Buffer | string) => {
      pendingBuffers[streamKey] += String(chunk)
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");

      while (pendingBuffers[streamKey].includes("\n")) {
        const newlineIndex = pendingBuffers[streamKey].indexOf("\n");
        const line = pendingBuffers[streamKey].slice(0, newlineIndex);
        pendingBuffers[streamKey] = pendingBuffers[streamKey].slice(
          newlineIndex + 1,
        );
        handlers.onLine(line);
      }
    });
  };

  attachStream(child.stdout, "stdout");
  attachStream(child.stderr, "stderr");

  child.once("error", (error) => {
    if (settled) {
      return;
    }
    settled = true;
    flushBuffer("stdout");
    flushBuffer("stderr");
    handlers.onError?.(error);
  });

  child.once("exit", (exitCode, signal) => {
    if (settled) {
      return;
    }
    settled = true;
    flushBuffer("stdout");
    flushBuffer("stderr");
    handlers.onExit({ exitCode, signal });
  });
}

export function resolveValidationWorkingDirectory(
  command: ValidationCommand,
  repository: RepositoryConfig,
  worktreePath: string,
): string {
  if (command.working_directory === repository.path) {
    return worktreePath;
  }

  if (command.working_directory.startsWith(`${repository.path}/`)) {
    return command.working_directory.replace(repository.path, worktreePath);
  }

  return worktreePath;
}
