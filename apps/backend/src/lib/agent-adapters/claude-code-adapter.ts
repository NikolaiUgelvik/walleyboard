import type { z } from "zod";

import type { Project } from "../../../../../packages/contracts/src/index.js";
import {
  hasMeaningfulContent,
  normalizeOptionalModel,
  truncate,
} from "../execution-runtime/helpers.js";
import { claudeCodeDockerSpec } from "./claude-code-runtime.js";
import { listEnabledProjectClaudeMcpServers } from "./claude-config.js";
import { resolveDockerManagedOutputPath } from "./docker-paths.js";
import { augmentPromptForAgent } from "./prompt-augmentation.js";
import {
  buildDraftQuestionsPrompt,
  buildDraftRefinementPrompt,
} from "./shared-draft-prompts.js";
import {
  buildImplementationPrompt,
  buildMergeConflictPrompt,
  buildPlanPrompt,
  buildPullRequestBodyPrompt,
  buildReviewPrompt,
} from "./shared-execution-prompts.js";
import type {
  AgentCliAdapter,
  DraftRunInput,
  ExecutionRunInput,
  InterpretedAdapterLine,
  MergeConflictRunInput,
  PreparedAgentRun,
  PullRequestBodyRunInput,
  ReviewRunInput,
} from "./types.js";

// Claude Code permission modes. Every run builder must use one of these to
// set permission args. This is the single place where permission policy is
// decided, so a new run type cannot accidentally omit it.
type ClaudePermissionMode = "read-only" | "full-access";

const fullAccessAllowedTools =
  "Read,Write,Edit,Glob,Grep,Bash,Agent,NotebookEdit";

function appendClaudePermissionArgs(
  args: string[],
  mode: ClaudePermissionMode,
): void {
  switch (mode) {
    case "read-only":
      args.push("--permission-mode", "plan");
      break;
    case "full-access":
      args.push("--permission-mode", "dontAsk");
      args.push("--allowedTools", fullAccessAllowedTools);
      break;
  }
}

/**
 * Strip ANSI escape sequences from a string. PTY output often contains
 * color codes, cursor movement, and other terminal control sequences
 * that must be removed before attempting JSON.parse.
 */
export function stripAnsi(value: string): string {
  const ansiPattern =
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI stripping requires matching control characters.
    /\x1b\[[0-9;?]*[A-Za-z~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()#][A-Za-z0-9]|\x1b[A-Za-z0-9=><]|\x9b[0-9;?]*[A-Za-z~]/g;
  return value.replace(ansiPattern, "");
}

/**
 * Escape a string for safe embedding inside single quotes in a POSIX shell
 * command. Every single-quote in the value is replaced with the sequence
 * '\'' (end current quote, insert escaped literal single-quote, resume
 * quoting).
 *
 * NUL bytes are stripped as a defense-in-depth measure since they can cause
 * argument truncation in C-based programs (bash included).
 */
export function shellEscape(value: string): string {
  return `'${value.replace(/\0/g, "").replace(/'/g, "'\\''")}'`;
}

/**
 * Build a shell command that invokes `claude` and redirects stdout to
 * `outputPath`. Used for Claude JSON-result flows where the runtime reads
 * the output file after exit and passes its contents to `parseDraftResult`.
 *
 * Using `>` redirect (instead of `tee`) avoids PTY ANSI escape sequences
 * and prevents capturing the full transcript when we only want the final
 * JSON result.
 *
 * Uses `bash` for broad compatibility across Linux distributions.
 */
export function buildDraftShellCommand(
  command: string,
  claudeArgs: string[],
  outputPath: string,
): { command: string; args: string[] } {
  const parts = [shellEscape(command)];
  for (const arg of claudeArgs) {
    parts.push(shellEscape(arg));
  }
  parts.push(">", shellEscape(outputPath));
  return {
    command: "bash",
    args: ["-c", parts.join(" ")],
  };
}

function appendClaudeCodeModelArgs(args: string[], model: string | null): void {
  if (model) {
    args.push("--model", model);
  }
}

function assertDockerRuntimeEnabled(useDockerRuntime: boolean): void {
  if (!useDockerRuntime) {
    throw new Error(
      "Host execution is no longer supported for Claude Code. Use the Docker runtime.",
    );
  }
}

function resolveDockerOutputPath(
  outputPath: string,
  worktreePath: string,
): string {
  return resolveDockerManagedOutputPath({
    agentLabel: "Claude Code",
    outputPath,
    worktreePath,
  });
}

/**
 * Strip leading/trailing markdown code fences from a string, if present.
 * Returns the inner content trimmed.
 */
function stripMarkdownFences(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }
  return trimmed
    .replace(/^```[\w-]*\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

/**
 * Find the start of the last top-level JSON object in a string. Scans
 * backwards from the last `}` and counts balanced braces to locate
 * the matching `{`. Returns -1 if no balanced pair is found.
 *
 * This avoids the bug where `lastIndexOf("{")` would match a nested
 * sub-object instead of the intended top-level JSON.
 */
export function findLastTopLevelJsonStart(text: string): number {
  const lastClose = text.lastIndexOf("}");
  if (lastClose < 0) {
    return -1;
  }
  let depth = 0;
  for (let i = lastClose; i >= 0; i--) {
    if (text[i] === "}") {
      depth++;
    } else if (text[i] === "{") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

export function parseClaudeCodeJsonResult<T>(
  rawOutput: string,
  schema: z.ZodType<T>,
): T {
  const trimmed = rawOutput.trim();
  if (trimmed.length === 0) {
    throw new Error("Claude Code returned no JSON output.");
  }

  // Claude Code json output can be a JSON object with a "result" key,
  // or the stream-json output file may contain multiple JSON lines.
  const candidates: string[] = [trimmed];

  // Try extracting the "result" field from a wrapper object.
  try {
    const wrapper = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof wrapper.result === "string") {
      const resultText = wrapper.result.trim();
      candidates.push(resultText);
      // Also try stripping markdown fences from the result field.
      const unfenced = stripMarkdownFences(resultText);
      if (unfenced !== resultText) {
        candidates.push(unfenced);
      }
      // The model may emit reasoning text before the JSON object.
      // Use balanced-brace scanning to find the last complete top-level
      // JSON object, avoiding accidental extraction of nested sub-objects.
      const braceIndex = findLastTopLevelJsonStart(resultText);
      if (braceIndex > 0) {
        candidates.push(resultText.slice(braceIndex));
      }
    }
  } catch {
    // Not a wrapper object - try other candidates.
  }

  // Strip markdown code fences if present on the outer input.
  if (trimmed.startsWith("```")) {
    candidates.push(stripMarkdownFences(trimmed));
  }

  // For stream-json output, try extracting the last result line.
  // This is a defensive fallback in case output is captured from a
  // mixed source that includes stream-json NDJSON lines.
  const lines = trimmed.split("\n");
  for (const line of lines) {
    const lineTrimmed = line.trim();
    if (lineTrimmed.length === 0) {
      continue;
    }

    try {
      const parsed = JSON.parse(lineTrimmed) as Record<string, unknown>;
      if (parsed.type === "result" && typeof parsed.result === "string") {
        const resultText = parsed.result.trim();
        candidates.push(resultText);
        // Also try stripping markdown fences from the NDJSON result.
        const unfenced = stripMarkdownFences(resultText);
        if (unfenced !== resultText) {
          candidates.push(unfenced);
        }
        // Try extracting embedded JSON from reasoning text.
        const braceIndex = findLastTopLevelJsonStart(resultText);
        if (braceIndex > 0) {
          candidates.push(resultText.slice(braceIndex));
        }
      }
    } catch {
      // Not a JSON line - skip.
    }
  }

  for (const candidate of candidates) {
    try {
      return schema.parse(JSON.parse(candidate));
    } catch {
      // Try the next candidate shape.
    }
  }

  throw new Error("Claude Code did not return valid JSON output.");
}

export function formatClaudeCodeExitReason(
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  rawOutput: string,
): string {
  const summary =
    rawOutput.trim().length > 0
      ? ` Final output: ${truncate(rawOutput.trim(), 240)}`
      : "";
  return `Claude Code exited with ${exitCode === null ? "unknown code" : `code ${exitCode}`}${
    signal ? ` and signal ${signal}` : ""
  }.${summary}`;
}

export function interpretClaudeCodeStreamJsonLine(
  line: string,
): InterpretedAdapterLine {
  const normalized = stripAnsi(line.trim());
  if (normalized.length === 0) {
    return {
      logLine: "",
    };
  }

  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;

    // Extract session_id from any event that carries it.
    const sessionRef =
      typeof parsed.session_id === "string" ? parsed.session_id : undefined;

    // Helper to attach sessionRef only when present (exactOptionalPropertyTypes
    // forbids assigning undefined to an optional property).
    const withSession = (
      base: InterpretedAdapterLine,
    ): InterpretedAdapterLine => (sessionRef ? { ...base, sessionRef } : base);

    const eventType = typeof parsed.type === "string" ? parsed.type : "event";

    // Handle result events.
    if (eventType === "result") {
      const resultText =
        typeof parsed.result === "string"
          ? parsed.result
          : JSON.stringify(parsed);
      const costSuffix =
        typeof parsed.cost_usd === "number"
          ? ` (cost: $${parsed.cost_usd.toFixed(4)})`
          : "";
      const base: InterpretedAdapterLine = {
        logLine: `[claude-code result] ${truncate(resultText)}${costSuffix}`,
      };
      if (typeof parsed.result === "string") {
        base.outputContent = parsed.result;
      }
      return withSession(base);
    }

    // Handle assistant messages. We set outputContent so the execution
    // runtime can capture the last meaningful text as a fallback summary.
    // For plan mode specifically, we extract the `plan` field from
    // ExitPlanMode tool_use blocks, which contains the actual plan content.
    if (eventType === "assistant") {
      const message = parsed.message;
      if (message && typeof message === "object") {
        const messageRecord = message as Record<string, unknown>;
        if (typeof messageRecord.content === "string") {
          return withSession({
            logLine: `[claude-code assistant] ${truncate(messageRecord.content)}`,
            outputContent: messageRecord.content,
          });
        }

        // Content can be an array of content blocks.
        if (Array.isArray(messageRecord.content)) {
          const blocks = messageRecord.content as unknown[];

          // Check for ExitPlanMode tool_use with a plan field. This is
          // the authoritative plan content. We set planContent (not
          // outputContent) so the runtime can track it separately and
          // prevent later assistant text messages from overwriting it.
          for (const block of blocks) {
            if (
              typeof block === "object" &&
              block !== null &&
              (block as Record<string, unknown>).type === "tool_use" &&
              (block as Record<string, unknown>).name === "ExitPlanMode"
            ) {
              const input = (block as Record<string, unknown>).input;
              if (
                typeof input === "object" &&
                input !== null &&
                typeof (input as Record<string, unknown>).plan === "string"
              ) {
                const plan = (input as Record<string, unknown>).plan as string;
                if (plan.trim().length > 0) {
                  return withSession({
                    logLine: `[claude-code assistant] ${truncate(plan)}`,
                    planContent: plan,
                  });
                }
              }
            }
          }

          const textParts = blocks
            .filter(
              (block): block is Record<string, unknown> =>
                typeof block === "object" &&
                block !== null &&
                (block as Record<string, unknown>).type === "text",
            )
            .map((block) => String(block.text ?? ""))
            .filter((text) => text.length > 0);
          if (textParts.length > 0) {
            const fullText = textParts.join("\n\n");
            return withSession({
              logLine: `[claude-code assistant] ${truncate(fullText)}`,
              outputContent: fullText,
            });
          }
        }
      }

      if (typeof parsed.message === "string") {
        return withSession({
          logLine: `[claude-code assistant] ${truncate(parsed.message)}`,
          outputContent: parsed.message,
        });
      }

      return withSession({
        logLine: `[claude-code assistant] ${truncate(JSON.stringify(parsed))}`,
      });
    }

    // Handle system messages.
    if (eventType === "system") {
      const text =
        typeof parsed.message === "string"
          ? parsed.message
          : JSON.stringify(parsed);
      return withSession({
        logLine: `[claude-code system] ${truncate(text)}`,
      });
    }

    // Generic fallback for other event types.
    const text =
      typeof parsed.message === "string"
        ? parsed.message
        : typeof parsed.text === "string"
          ? parsed.text
          : typeof parsed.output === "string"
            ? parsed.output
            : JSON.stringify(parsed);
    return withSession({
      logLine: `[claude-code ${eventType}] ${truncate(text)}`,
    });
  } catch {
    return {
      logLine: `[claude-code raw] ${truncate(normalized)}`,
    };
  }
}

export class ClaudeCodeAdapter implements AgentCliAdapter {
  readonly id = "claude-code" as const;
  readonly label = "Claude Code";
  readonly #commandOverride: string | null;

  constructor(commandOverride?: string) {
    this.#commandOverride = commandOverride ?? null;
  }

  #resolveCommand(): string {
    return this.#commandOverride ?? "claude";
  }

  resolveModelSelection(project: Project, scope: "draft" | "ticket") {
    return {
      model: normalizeOptionalModel(
        scope === "draft"
          ? project.draft_analysis_model
          : project.ticket_work_model,
      ),
      // Claude Code does not support reasoning effort configuration.
      reasoningEffort: null,
    };
  }

  buildDraftRun(input: DraftRunInput): PreparedAgentRun {
    assertDockerRuntimeEnabled(input.useDockerRuntime);
    const { model } = this.resolveModelSelection(input.project, "draft");
    const enabledMcpServers = listEnabledProjectClaudeMcpServers(input.project);
    const outputPath = resolveDockerOutputPath(
      input.outputPath,
      input.repository.path,
    );
    const basePrompt =
      input.mode === "refine"
        ? buildDraftRefinementPrompt(
            input.draft,
            input.repository,
            enabledMcpServers,
            input.instruction,
          )
        : buildDraftQuestionsPrompt(
            input.draft,
            input.repository,
            enabledMcpServers,
            input.instruction,
          );
    const prompt = augmentPromptForAgent({
      adapterId: this.id,
      promptKind: input.mode === "refine" ? "draft_refine" : "draft_questions",
      basePrompt,
    });
    const claudeArgs = ["-p", prompt, "--output-format", "json"];
    appendClaudePermissionArgs(claudeArgs, "read-only");

    appendClaudeCodeModelArgs(claudeArgs, model);

    // Claude Code CLI has no --output-file flag, so wrap draft runs in a
    // shell command that redirects stdout to the output file. The runtime
    // reads this file after exit and passes its contents to parseDraftResult.
    const { command, args } = buildDraftShellCommand(
      this.#resolveCommand(),
      claudeArgs,
      outputPath,
    );

    return {
      command,
      args,
      prompt,
      outputPath,
      dockerSpec: claudeCodeDockerSpec,
    };
  }

  buildExecutionRun(input: ExecutionRunInput): PreparedAgentRun {
    assertDockerRuntimeEnabled(input.useDockerRuntime);
    const { model } = this.resolveModelSelection(input.project, "ticket");
    const enabledMcpServers = listEnabledProjectClaudeMcpServers(input.project);
    const worktreePath = input.session.worktree_path;
    if (!worktreePath) {
      throw new Error(
        "Docker-backed Claude Code runs require a prepared worktree path.",
      );
    }
    const outputPath = resolveDockerOutputPath(input.outputPath, worktreePath);
    const basePrompt =
      input.executionMode === "plan"
        ? buildPlanPrompt(
            input.ticket,
            input.repository,
            enabledMcpServers,
            input.extraInstructions,
          )
        : buildImplementationPrompt(
            input.ticket,
            input.repository,
            enabledMcpServers,
            input.extraInstructions,
            input.planSummary,
          );
    const prompt = augmentPromptForAgent({
      adapterId: this.id,
      promptKind: input.executionMode === "plan" ? "plan" : "implementation",
      basePrompt,
    });

    const resumeRef = hasMeaningfulContent(input.session.adapter_session_ref)
      ? input.session.adapter_session_ref
      : null;

    const args: string[] = [];
    if (resumeRef) {
      args.push("--resume", resumeRef);
    }
    args.push("-p", prompt, "--output-format", "stream-json", "--verbose");
    appendClaudePermissionArgs(
      args,
      input.executionMode === "plan" ? "read-only" : "full-access",
    );

    appendClaudeCodeModelArgs(args, model);

    // Execution runs are spawned via PTY (spawnPty). Claude Code has no
    // --output-file or --output-last-message flag, and wrapping in a shell
    // with tee/redirect corrupts the output with ANSI escape codes from the
    // PTY and captures the entire stream-json transcript rather than just
    // the final result.
    //
    // Instead, spawn claude directly. The outputPath file will not be
    // populated by the CLI, but the runtime handles this gracefully -
    // it falls back to a default message when the file is missing or empty.
    // Session log lines are still captured via PTY onData.
    return {
      command: this.#resolveCommand(),
      args,
      prompt,
      outputPath,
      dockerSpec: claudeCodeDockerSpec,
    };
  }

  buildMergeConflictRun(input: MergeConflictRunInput): PreparedAgentRun {
    assertDockerRuntimeEnabled(input.useDockerRuntime);
    const { model } = this.resolveModelSelection(input.project, "ticket");
    const enabledMcpServers = listEnabledProjectClaudeMcpServers(input.project);
    const worktreePath = input.session.worktree_path;
    if (!worktreePath) {
      throw new Error(
        "Docker-backed Claude Code runs require a prepared worktree path.",
      );
    }
    const outputPath = resolveDockerOutputPath(input.outputPath, worktreePath);
    const basePrompt = buildMergeConflictPrompt({
      ticket: input.ticket,
      repository: input.repository,
      enabledMcpServers,
      recoveryKind: input.recoveryKind,
      targetBranch: input.targetBranch,
      stage: input.stage,
      conflictedFiles: input.conflictedFiles,
      failureMessage: input.failureMessage,
    });
    const prompt = augmentPromptForAgent({
      adapterId: this.id,
      promptKind: "merge_conflict",
      basePrompt,
    });

    const resumeRef = hasMeaningfulContent(input.session.adapter_session_ref)
      ? input.session.adapter_session_ref
      : null;

    const args: string[] = [];
    if (resumeRef) {
      args.push("--resume", resumeRef);
    }
    args.push("-p", prompt, "--output-format", "stream-json", "--verbose");
    appendClaudePermissionArgs(args, "full-access");

    appendClaudeCodeModelArgs(args, model);

    // Merge conflict runs stream through PTY just like the main execution
    // path. We still spawn `claude` directly because wrapping stream-json
    // output in shell redirection would capture the entire NDJSON transcript
    // instead of a concise final result.
    return {
      command: this.#resolveCommand(),
      args,
      prompt,
      outputPath,
      dockerSpec: claudeCodeDockerSpec,
    };
  }

  buildReviewRun(input: ReviewRunInput): PreparedAgentRun {
    assertDockerRuntimeEnabled(input.useDockerRuntime);
    const { model } = this.resolveModelSelection(input.project, "ticket");
    const worktreePath = input.session.worktree_path;
    if (!worktreePath) {
      throw new Error(
        "Docker-backed Claude Code runs require a prepared worktree path.",
      );
    }
    const outputPath = resolveDockerOutputPath(input.outputPath, worktreePath);
    const basePrompt = buildReviewPrompt({
      repository: input.repository,
      reviewPackage: input.reviewPackage,
      ticket: input.ticket,
      useDockerRuntime: input.useDockerRuntime,
      worktreePath,
    });
    const prompt = augmentPromptForAgent({
      adapterId: this.id,
      promptKind: "review",
      basePrompt,
    });
    const claudeArgs = ["-p", prompt, "--output-format", "json"];
    appendClaudePermissionArgs(claudeArgs, "read-only");
    appendClaudeCodeModelArgs(claudeArgs, model);

    const { command, args } = buildDraftShellCommand(
      this.#resolveCommand(),
      claudeArgs,
      outputPath,
    );

    return {
      command,
      args,
      prompt,
      outputPath,
      dockerSpec: claudeCodeDockerSpec,
    };
  }

  buildPullRequestBodyRun(input: PullRequestBodyRunInput): PreparedAgentRun {
    assertDockerRuntimeEnabled(input.useDockerRuntime);
    const { model } = this.resolveModelSelection(input.project, "draft");
    const worktreePath = input.session.worktree_path;
    if (!worktreePath) {
      throw new Error(
        "Docker-backed Claude Code runs require a prepared worktree path.",
      );
    }
    const outputPath = resolveDockerOutputPath(input.outputPath, worktreePath);
    const basePrompt = buildPullRequestBodyPrompt({
      attempts: input.attempts,
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      patch: input.patch,
      repository: input.repository,
      reviewPackage: input.reviewPackage,
      reviewRuns: input.reviewRuns,
      session: {
        id: input.session.id,
        plan_summary: input.session.plan_summary,
        last_summary: input.session.last_summary,
      },
      sessionLogs: input.sessionLogs,
      ticket: input.ticket,
      ticketEvents: input.ticketEvents,
    });
    const prompt = augmentPromptForAgent({
      adapterId: this.id,
      promptKind: "pull_request_body",
      basePrompt,
    });
    const claudeArgs = ["-p", prompt, "--output-format", "json"];
    appendClaudePermissionArgs(claudeArgs, "read-only");
    appendClaudeCodeModelArgs(claudeArgs, model);

    const { command, args } = buildDraftShellCommand(
      this.#resolveCommand(),
      claudeArgs,
      outputPath,
    );

    return {
      command,
      args,
      prompt,
      outputPath,
      dockerSpec: claudeCodeDockerSpec,
    };
  }

  interpretOutputLine(line: string): InterpretedAdapterLine {
    return interpretClaudeCodeStreamJsonLine(line);
  }

  parseDraftResult<T>(rawOutput: string, schema: z.ZodType<T>): T {
    return parseClaudeCodeJsonResult(rawOutput, schema);
  }

  formatExitReason(
    exitCode: number | null,
    signal: NodeJS.Signals | null,
    rawOutput: string,
  ): string {
    return formatClaudeCodeExitReason(exitCode, signal, rawOutput);
  }
}
