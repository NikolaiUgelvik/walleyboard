import { join, relative } from "node:path";
import type { z } from "zod";

import type {
  Project,
  ReasoningEffort,
} from "../../../../../packages/contracts/src/index.js";
import { dockerWorkspacePath } from "../docker-runtime.js";
import {
  hasMeaningfulContent,
  normalizeOptionalModel,
  normalizeOptionalReasoningEffort,
  truncate,
} from "../execution-runtime/helpers.js";
import {
  buildDraftQuestionsPrompt,
  buildDraftRefinementPrompt,
} from "./shared-draft-prompts.js";
import {
  buildImplementationPrompt,
  buildMergeConflictPrompt,
  buildPlanPrompt,
  buildReviewPrompt,
} from "./shared-execution-prompts.js";
import type {
  AgentCliAdapter,
  DraftRunInput,
  ExecutionRunInput,
  InterpretedAdapterLine,
  MergeConflictRunInput,
  PreparedAgentRun,
  ReviewRunInput,
} from "./types.js";

const codexDockerSpec = {
  imageTag: "walleyboard/codex-runtime:ubuntu-24.04-node-24",
  dockerfilePath: "apps/backend/docker/codex-runtime.Dockerfile",
  homePath: "/home/codex",
  configMountPath: "/home/codex/.codex",
} as const;

function appendCodexModelArgs(
  args: string[],
  input: { model: string | null; reasoningEffort: ReasoningEffort | null },
): void {
  const model = input.model?.trim() || null;
  const reasoningEffort = input.reasoningEffort ?? null;

  if (model) {
    args.push("--model", model);
  }

  if (reasoningEffort) {
    args.push("--config", `model_reasoning_effort="${reasoningEffort}"`);
  }
}

function appendCodexExecutionModeArgs(
  args: string[],
  executionMode: ExecutionRunInput["executionMode"],
): void {
  const sandboxMode =
    executionMode === "plan" ? "read-only" : "workspace-write";

  args.push("--config", 'approval_policy="on-request"');
  args.push("--config", `sandbox_mode="${sandboxMode}"`);
}

function appendDangerousDockerArgs(args: string[]): void {
  args.push("--dangerously-bypass-approvals-and-sandbox");
}

function resolveDockerOutputPath(
  outputPath: string,
  worktreePath: string,
): string {
  const relativeOutputPath = relative(worktreePath, outputPath);
  if (
    relativeOutputPath.length === 0 ||
    relativeOutputPath.startsWith("..") ||
    relativeOutputPath === "." ||
    relativeOutputPath.includes("../")
  ) {
    throw new Error(
      "Docker-backed Codex runs must write output inside the mounted worktree.",
    );
  }

  return join(dockerWorkspacePath, relativeOutputPath);
}

function resolveAgentOutputPath(input: {
  outputPath: string;
  useDockerRuntime: boolean;
  worktreePath: string | null;
}): string {
  if (!input.useDockerRuntime) {
    return input.outputPath;
  }

  if (!input.worktreePath) {
    throw new Error(
      "Docker-backed Codex runs require a prepared worktree path.",
    );
  }

  return resolveDockerOutputPath(input.outputPath, input.worktreePath);
}

function parseCodexJsonResult<T>(rawOutput: string, schema: z.ZodType<T>): T {
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

function summarizeCodexCommandEvent(
  eventType: string,
  item: Record<string, unknown>,
): string | null {
  const command = typeof item.command === "string" ? item.command.trim() : null;
  if (!command) {
    return null;
  }

  if (eventType === "item.started") {
    return `[codex command.started] ${truncate(command, 180)}`;
  }

  const exitCode =
    typeof item.exit_code === "number" ? item.exit_code : undefined;
  if (eventType === "item.completed" && exitCode !== 0) {
    return `[codex command.failed] ${truncate(command, 180)}`;
  }

  return `[codex command.completed] ${truncate(command, 180)}`;
}

function summarizeCodexFileChangeEvent(
  eventType: string,
  item: Record<string, unknown>,
): string | null {
  const changes = Array.isArray(item.changes)
    ? item.changes.filter(
        (change): change is Record<string, unknown> =>
          !!change && typeof change === "object",
      )
    : [];
  const paths = changes
    .map((change) => (typeof change.path === "string" ? change.path : null))
    .filter((path): path is string => path !== null);
  if (paths.length === 0) {
    return null;
  }

  const preview = paths.slice(0, 2).join(", ");
  const suffix = paths.length > 2 ? ` (+${paths.length - 2} more)` : "";
  const summary = `${preview}${suffix}`;

  if (eventType === "item.started") {
    return `[codex file_change.started] ${truncate(summary, 180)}`;
  }

  return `[codex file_change.completed] ${truncate(summary, 180)}`;
}

function summarizeCodexWebSearchEvent(
  eventType: string,
  item: Record<string, unknown>,
): string | null {
  const query = typeof item.query === "string" ? item.query.trim() : "";
  const action =
    item.action && typeof item.action === "object"
      ? (item.action as Record<string, unknown>)
      : null;
  const actionType = typeof action?.type === "string" ? action.type : null;
  const isUrl = /^https?:\/\//.test(query);

  if (eventType === "item.started") {
    return query.length > 0
      ? `[codex web_search.started] ${truncate(query, 180)}`
      : "[codex web_search.started]";
  }

  if (actionType === "search" || (!isUrl && query.length > 0)) {
    return `[codex web_search.search] ${truncate(query, 180)}`;
  }

  if (isUrl) {
    return `[codex web_search.open] ${truncate(query, 180)}`;
  }

  return query.length > 0
    ? `[codex web_search.completed] ${truncate(query, 180)}`
    : "[codex web_search.completed]";
}

function summarizeCodexTodoListEvent(
  eventType: string,
  item: Record<string, unknown>,
): string | null {
  const todoItems = Array.isArray(item.items)
    ? item.items.filter(
        (todo): todo is Record<string, unknown> =>
          !!todo && typeof todo === "object",
      )
    : [];
  const texts = todoItems
    .map((todo) => (typeof todo.text === "string" ? todo.text.trim() : null))
    .filter((text): text is string => !!text);
  if (texts.length === 0) {
    return null;
  }

  const completedCount = todoItems.filter(
    (todo) => todo.completed === true,
  ).length;
  const preview = texts.slice(0, 2).join(" | ");
  const suffix = texts.length > 2 ? ` (+${texts.length - 2} more)` : "";
  const summary = `${preview}${suffix} [${completedCount}/${texts.length}]`;

  if (eventType === "item.started") {
    return `[codex todo_list.started] ${truncate(summary, 180)}`;
  }

  return `[codex todo_list.completed] ${truncate(summary, 180)}`;
}

function summarizeCodexItemEvent(
  eventType: string,
  item: Record<string, unknown>,
): string | null {
  const itemType = typeof item.type === "string" ? item.type : null;
  if (!itemType) {
    return null;
  }

  if (itemType === "agent_message") {
    const text =
      typeof item.text === "string"
        ? item.text
        : typeof item.message === "string"
          ? item.message
          : null;
    return text ? `[codex agent_message] ${truncate(text)}` : null;
  }

  if (itemType === "command_execution") {
    return summarizeCodexCommandEvent(eventType, item);
  }

  if (itemType === "file_change") {
    return summarizeCodexFileChangeEvent(eventType, item);
  }

  if (itemType === "web_search") {
    return summarizeCodexWebSearchEvent(eventType, item);
  }

  if (itemType === "todo_list") {
    return summarizeCodexTodoListEvent(eventType, item);
  }

  return null;
}

function formatCodexExitReason(
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

function interpretCodexJsonLine(line: string): InterpretedAdapterLine {
  const normalized = line.trim();
  if (normalized.length === 0) {
    return {
      logLine: "",
    };
  }

  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    const payload =
      parsed.payload && typeof parsed.payload === "object"
        ? (parsed.payload as Record<string, unknown>)
        : null;

    let sessionRef: string | undefined;
    if (
      parsed.type === "session_meta" &&
      payload &&
      typeof payload.id === "string"
    ) {
      sessionRef = payload.id;
      return {
        logLine: `[codex session] ${payload.id}`,
        sessionRef,
      };
    }

    if (typeof parsed.session_id === "string") {
      sessionRef = parsed.session_id;
    } else if (payload && typeof payload.session_id === "string") {
      sessionRef = payload.session_id;
    } else {
      const thread =
        payload?.thread && typeof payload.thread === "object"
          ? (payload.thread as Record<string, unknown>)
          : null;
      if (thread && typeof thread.id === "string") {
        sessionRef = thread.id;
      }
    }

    const eventType =
      typeof parsed.type === "string"
        ? parsed.type
        : typeof parsed.event === "string"
          ? parsed.event
          : "event";

    const item =
      parsed.item && typeof parsed.item === "object"
        ? (parsed.item as Record<string, unknown>)
        : null;
    if (item) {
      const summarizedItem = summarizeCodexItemEvent(eventType, item);
      if (summarizedItem) {
        return sessionRef
          ? {
              logLine: summarizedItem,
              sessionRef,
            }
          : {
              logLine: summarizedItem,
            };
      }
    }

    if (typeof parsed.message === "string") {
      return sessionRef
        ? {
            logLine: `[codex ${eventType}] ${truncate(parsed.message)}`,
            sessionRef,
          }
        : {
            logLine: `[codex ${eventType}] ${truncate(parsed.message)}`,
          };
    }

    if (typeof parsed.text === "string") {
      return sessionRef
        ? {
            logLine: `[codex ${eventType}] ${truncate(parsed.text)}`,
            sessionRef,
          }
        : {
            logLine: `[codex ${eventType}] ${truncate(parsed.text)}`,
          };
    }

    if (typeof parsed.output === "string") {
      return sessionRef
        ? {
            logLine: `[codex ${eventType}] ${truncate(parsed.output)}`,
            sessionRef,
          }
        : {
            logLine: `[codex ${eventType}] ${truncate(parsed.output)}`,
          };
    }

    return sessionRef
      ? {
          logLine: `[codex ${eventType}] ${truncate(JSON.stringify(parsed))}`,
          sessionRef,
        }
      : {
          logLine: `[codex ${eventType}] ${truncate(JSON.stringify(parsed))}`,
        };
  } catch {
    return {
      logLine: `[codex raw] ${truncate(line)}`,
    };
  }
}

export class CodexCliAdapter implements AgentCliAdapter {
  readonly id = "codex" as const;
  readonly label = "Codex";

  resolveModelSelection(project: Project, scope: "draft" | "ticket") {
    return {
      model: normalizeOptionalModel(
        scope === "draft"
          ? project.draft_analysis_model
          : project.ticket_work_model,
      ),
      reasoningEffort: normalizeOptionalReasoningEffort(
        scope === "draft"
          ? project.draft_analysis_reasoning_effort
          : project.ticket_work_reasoning_effort,
      ),
    };
  }

  buildDraftRun(input: DraftRunInput): PreparedAgentRun {
    const { model, reasoningEffort } = this.resolveModelSelection(
      input.project,
      "draft",
    );
    const prompt =
      input.mode === "refine"
        ? buildDraftRefinementPrompt(
            input.draft,
            input.repository,
            input.instruction,
          )
        : buildDraftQuestionsPrompt(
            input.draft,
            input.repository,
            input.instruction,
          );
    const args = [
      "exec",
      "--json",
      "--full-auto",
      "--output-last-message",
      input.outputPath,
    ];

    appendCodexModelArgs(args, {
      model,
      reasoningEffort,
    });
    args.push(prompt);

    return {
      command: "codex",
      args,
      prompt,
      outputPath: input.outputPath,
      dockerSpec: null,
    };
  }

  buildExecutionRun(input: ExecutionRunInput): PreparedAgentRun {
    const resumeSessionRef = hasMeaningfulContent(
      input.session.adapter_session_ref,
    )
      ? input.session.adapter_session_ref
      : null;
    const { model, reasoningEffort } = this.resolveModelSelection(
      input.project,
      "ticket",
    );
    const outputPath = resolveAgentOutputPath({
      outputPath: input.outputPath,
      useDockerRuntime: input.useDockerRuntime,
      worktreePath: input.session.worktree_path,
    });
    const prompt =
      input.executionMode === "plan"
        ? buildPlanPrompt(
            input.ticket,
            input.repository,
            input.extraInstructions,
          )
        : buildImplementationPrompt(
            input.ticket,
            input.repository,
            input.extraInstructions,
            input.planSummary,
          );
    const args = resumeSessionRef
      ? ["exec", "resume", "--json"]
      : ["exec", "--json"];

    if (input.useDockerRuntime) {
      appendDangerousDockerArgs(args);
    } else {
      appendCodexExecutionModeArgs(args, input.executionMode);
    }

    args.push("--output-last-message", outputPath);
    appendCodexModelArgs(args, {
      model,
      reasoningEffort,
    });

    if (resumeSessionRef) {
      args.push(resumeSessionRef);
    }

    args.push(prompt);

    return {
      command: "codex",
      args,
      prompt,
      outputPath,
      dockerSpec: input.useDockerRuntime ? codexDockerSpec : null,
    };
  }

  buildMergeConflictRun(input: MergeConflictRunInput): PreparedAgentRun {
    const { model, reasoningEffort } = this.resolveModelSelection(
      input.project,
      "ticket",
    );
    const prompt = buildMergeConflictPrompt({
      ticket: input.ticket,
      repository: input.repository,
      recoveryKind: input.recoveryKind,
      targetBranch: input.targetBranch,
      stage: input.stage,
      conflictedFiles: input.conflictedFiles,
      failureMessage: input.failureMessage,
    });
    const outputPath = resolveAgentOutputPath({
      outputPath: input.outputPath,
      useDockerRuntime: input.useDockerRuntime,
      worktreePath: input.session.worktree_path,
    });
    const resumeSessionRef = hasMeaningfulContent(
      input.session.adapter_session_ref,
    )
      ? input.session.adapter_session_ref
      : null;
    const args = resumeSessionRef
      ? ["exec", "resume", "--json"]
      : ["exec", "--json"];

    if (input.useDockerRuntime) {
      appendDangerousDockerArgs(args);
    } else {
      args.push("--full-auto");
    }

    appendCodexModelArgs(args, {
      model,
      reasoningEffort,
    });
    args.push("--output-last-message", outputPath);
    if (resumeSessionRef) {
      args.push(resumeSessionRef);
    }
    args.push(prompt);

    return {
      command: "codex",
      args,
      prompt,
      outputPath,
      dockerSpec: input.useDockerRuntime ? codexDockerSpec : null,
    };
  }

  buildReviewRun(input: ReviewRunInput): PreparedAgentRun {
    const { model, reasoningEffort } = this.resolveModelSelection(
      input.project,
      "ticket",
    );
    const prompt = buildReviewPrompt({
      repository: input.repository,
      reviewPackage: input.reviewPackage,
      ticket: input.ticket,
    });
    const outputPath = resolveAgentOutputPath({
      outputPath: input.outputPath,
      useDockerRuntime: input.useDockerRuntime,
      worktreePath: input.session.worktree_path,
    });
    const args = ["exec", "--json", "--output-last-message", outputPath];

    if (input.useDockerRuntime) {
      appendDangerousDockerArgs(args);
    } else {
      args.push("--full-auto");
      appendCodexExecutionModeArgs(args, "plan");
    }
    appendCodexModelArgs(args, {
      model,
      reasoningEffort,
    });
    args.push(prompt);

    return {
      command: "codex",
      args,
      prompt,
      outputPath,
      dockerSpec: input.useDockerRuntime ? codexDockerSpec : null,
    };
  }

  interpretOutputLine(line: string): InterpretedAdapterLine {
    return interpretCodexJsonLine(line);
  }

  parseDraftResult<T>(rawOutput: string, schema: z.ZodType<T>): T {
    return parseCodexJsonResult(rawOutput, schema);
  }

  formatExitReason(
    exitCode: number | null,
    signal: NodeJS.Signals | null,
    rawOutput: string,
  ): string {
    return formatCodexExitReason(exitCode, signal, rawOutput);
  }
}
