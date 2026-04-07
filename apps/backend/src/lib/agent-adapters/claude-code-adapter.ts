import { randomUUID } from "node:crypto";
import type { z } from "zod";

import type {
  Project,
  ReasoningEffort,
} from "../../../../../packages/contracts/src/index.js";
import { dockerHostAddress } from "../docker-runtime.js";
import {
  hasMeaningfulContent,
  normalizeOptionalModel,
  normalizeOptionalReasoningEffort,
  truncate,
} from "../execution-runtime/helpers.js";
import { claudeCodeDockerSpec } from "./claude-code-runtime.js";
import { listEnabledProjectClaudeMcpServers } from "./claude-config.js";
import { resolveDockerManagedOutputPath } from "./docker-paths.js";
import { augmentPromptForAgent } from "./prompt-augmentation.js";
import {
  buildDraftQuestionsPrompt,
  buildDraftRefinementPrompt,
  buildDraftRefinementRetryInstruction,
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
  HostSidecar,
  InterpretedAdapterLine,
  MergeConflictRunInput,
  PreparedAgentRun,
  PullRequestBodyRunInput,
  ReviewRunInput,
} from "./types.js";
import {
  buildClaudeWalleyboardHttpMcpConfig,
  buildWalleyboardAllowedTools,
  buildWalleyboardHttpServerConfig,
  buildWalleyboardToolDefinition,
  buildWalleyboardToolRef,
} from "./walleyboard-mcp.js";

// Claude Code permission modes. Every run builder must use one of these to
// set permission args. This is the single place where permission policy is
// decided, so a new run type cannot accidentally omit it.
type ClaudePermissionMode = "inspect-only" | "plan" | "full-access";

const fullAccessAllowedTools =
  "Read,Write,Edit,Glob,Grep,Bash,Agent,NotebookEdit";

function appendClaudePermissionArgs(
  args: string[],
  mode: ClaudePermissionMode,
  options?: {
    allowedTools?: string;
    tools?: string;
  },
): void {
  switch (mode) {
    case "inspect-only":
      args.push("--permission-mode", "dontAsk");
      if (options?.tools) {
        args.push("--tools", options.tools);
      }
      if (options?.allowedTools) {
        args.push("--allowedTools", options.allowedTools);
      }
      break;
    case "plan":
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
 * `outputPath`.
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

function appendClaudeCodeModelArgs(
  args: string[],
  model: string | null,
  reasoningEffort: ReasoningEffort | null,
): void {
  if (model) {
    args.push("--model", model);
  }
  if (reasoningEffort) {
    args.push("--effort", reasoningEffort);
  }
}

export function buildClaudeStructuredOutputRun(input: {
  allowedTools: string;
  claudeArgs: string[];
  claudeCommand: string;
  /** Host-side path where the sidecar writes the structured output. */
  hostOutputPath: string;
  /** Port for the MCP HTTP sidecar to listen on. */
  port: number;
  tool: ReturnType<typeof buildWalleyboardToolDefinition>;
}): { command: string; args: string[]; hostSidecar: HostSidecar } {
  const token = randomUUID();
  const sidecar = buildWalleyboardHttpServerConfig({
    outputPath: input.hostOutputPath,
    port: input.port,
    token,
    tool: input.tool,
  });
  const args = [
    ...input.claudeArgs,
    "--mcp-config",
    buildClaudeWalleyboardHttpMcpConfig({
      host: dockerHostAddress,
      port: input.port,
      token,
    }),
    "--strict-mcp-config",
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    input.allowedTools,
  ];

  return {
    command: input.claudeCommand,
    args,
    hostSidecar: {
      command: sidecar.command,
      args: sidecar.args,
      env: { WALLEYBOARD_MCP_BIND_HOST: dockerHostAddress },
      healthCheckHost: dockerHostAddress,
      healthCheckPort: input.port,
    },
  };
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

export function parseClaudeCodeJsonResult<T>(
  rawOutput: string,
  schema: z.ZodType<T>,
): T {
  const trimmed = rawOutput.trim();
  if (trimmed.length === 0) {
    throw new Error("Claude Code returned no JSON output.");
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;

      if ("structured_output" in record) {
        return schema.parse(record.structured_output);
      }

      if ("result" in record) {
        const result = record.result;
        if (typeof result === "string") {
          return schema.parse(JSON.parse(result));
        }

        return schema.parse(result);
      }
    }

    return schema.parse(parsed);
  } catch {
    // Invalid JSON - handled below.
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
      reasoningEffort: normalizeOptionalReasoningEffort(
        scope === "draft"
          ? project.draft_analysis_reasoning_effort
          : project.ticket_work_reasoning_effort,
      ),
    };
  }

  buildDraftRun(input: DraftRunInput): PreparedAgentRun {
    assertDockerRuntimeEnabled(input.useDockerRuntime);
    const { model, reasoningEffort } = this.resolveModelSelection(
      input.project,
      "draft",
    );
    const enabledMcpServers = listEnabledProjectClaudeMcpServers(input.project);
    const retryAttempt =
      input.mode === "refine" &&
      typeof input.retryAttempt === "number" &&
      input.retryAttempt > 0
        ? input.retryAttempt
        : 0;
    const effectiveInstruction =
      retryAttempt > 0
        ? buildDraftRefinementRetryInstruction(retryAttempt)
        : input.instruction;
    const basePrompt =
      input.mode === "refine"
        ? buildDraftRefinementPrompt(
            input.draft,
            input.repository,
            enabledMcpServers,
            effectiveInstruction,
          )
        : buildDraftQuestionsPrompt(
            input.draft,
            input.repository,
            enabledMcpServers,
            input.instruction,
          );
    const promptKind =
      input.mode === "refine" ? "draft_refine" : "draft_questions";
    const structuredOutputTool = buildWalleyboardToolDefinition({
      promptKind,
      schema: input.resultSchema,
    });
    const prompt = augmentPromptForAgent({
      adapterId: this.id,
      promptKind,
      basePrompt,
      structuredOutputToolRef: buildWalleyboardToolRef(
        structuredOutputTool.name,
      ),
    });

    const resumeRef = hasMeaningfulContent(input.adapterSessionRef)
      ? input.adapterSessionRef
      : null;

    const claudeArgs: string[] = [];
    if (resumeRef) {
      claudeArgs.push("--resume", resumeRef);
    }
    claudeArgs.push("-p", prompt);
    appendClaudeCodeModelArgs(claudeArgs, model, reasoningEffort);
    if (!input.mcpPort) {
      throw new Error("mcpPort is required for Claude Code draft runs.");
    }
    const shellCommand = buildClaudeStructuredOutputRun({
      allowedTools: buildWalleyboardAllowedTools(
        enabledMcpServers,
        structuredOutputTool.name,
      ),
      claudeArgs,
      claudeCommand: this.#resolveCommand(),
      hostOutputPath: input.outputPath,
      port: input.mcpPort,
      tool: structuredOutputTool,
    });

    return {
      ...shellCommand,
      prompt,
      outputPath: input.outputPath,
      dockerSpec: claudeCodeDockerSpec,
    };
  }

  buildExecutionRun(input: ExecutionRunInput): PreparedAgentRun {
    assertDockerRuntimeEnabled(input.useDockerRuntime);
    const { model, reasoningEffort } = this.resolveModelSelection(
      input.project,
      "ticket",
    );
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
      input.executionMode === "plan" ? "plan" : "full-access",
    );

    appendClaudeCodeModelArgs(args, model, reasoningEffort);

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
    const { model, reasoningEffort } = this.resolveModelSelection(
      input.project,
      "ticket",
    );
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

    appendClaudeCodeModelArgs(args, model, reasoningEffort);

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
    const { model, reasoningEffort } = this.resolveModelSelection(
      input.project,
      "ticket",
    );
    const enabledMcpServers = listEnabledProjectClaudeMcpServers(input.project);
    const worktreePath = input.session.worktree_path;
    if (!worktreePath) {
      throw new Error(
        "Docker-backed Claude Code runs require a prepared worktree path.",
      );
    }
    const basePrompt = buildReviewPrompt({
      repository: input.repository,
      reviewPackage: input.reviewPackage,
      ticket: input.ticket,
      useDockerRuntime: input.useDockerRuntime,
      worktreePath,
    });
    const structuredOutputTool = buildWalleyboardToolDefinition({
      promptKind: "review",
      schema: input.resultSchema,
    });
    const prompt = augmentPromptForAgent({
      adapterId: this.id,
      promptKind: "review",
      basePrompt,
      structuredOutputToolRef: buildWalleyboardToolRef(
        structuredOutputTool.name,
      ),
    });
    if (!input.mcpPort) {
      throw new Error("mcpPort is required for Claude Code review runs.");
    }
    const claudeArgs = ["-p", prompt];
    appendClaudeCodeModelArgs(claudeArgs, model, reasoningEffort);
    const shellCommand = buildClaudeStructuredOutputRun({
      allowedTools: buildWalleyboardAllowedTools(
        enabledMcpServers,
        structuredOutputTool.name,
      ),
      claudeArgs,
      claudeCommand: this.#resolveCommand(),
      hostOutputPath: input.outputPath,
      port: input.mcpPort,
      tool: structuredOutputTool,
    });

    return {
      ...shellCommand,
      prompt,
      outputPath: input.outputPath,
      dockerSpec: claudeCodeDockerSpec,
    };
  }

  buildPullRequestBodyRun(input: PullRequestBodyRunInput): PreparedAgentRun {
    assertDockerRuntimeEnabled(input.useDockerRuntime);
    const { model, reasoningEffort } = this.resolveModelSelection(
      input.project,
      "draft",
    );
    const enabledMcpServers = listEnabledProjectClaudeMcpServers(input.project);
    const worktreePath = input.session.worktree_path;
    if (!worktreePath) {
      throw new Error(
        "Docker-backed Claude Code runs require a prepared worktree path.",
      );
    }
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
    const structuredOutputTool = buildWalleyboardToolDefinition({
      promptKind: "pull_request_body",
      schema: input.resultSchema,
    });
    const prompt = augmentPromptForAgent({
      adapterId: this.id,
      promptKind: "pull_request_body",
      basePrompt,
      structuredOutputToolRef: buildWalleyboardToolRef(
        structuredOutputTool.name,
      ),
    });
    if (!input.mcpPort) {
      throw new Error(
        "mcpPort is required for Claude Code pull request body runs.",
      );
    }
    const claudeArgs = ["-p", prompt];
    appendClaudeCodeModelArgs(claudeArgs, model, reasoningEffort);
    const shellCommand = buildClaudeStructuredOutputRun({
      allowedTools: buildWalleyboardAllowedTools(
        enabledMcpServers,
        structuredOutputTool.name,
      ),
      claudeArgs,
      claudeCommand: this.#resolveCommand(),
      hostOutputPath: input.outputPath,
      port: input.mcpPort,
      tool: structuredOutputTool,
    });

    return {
      ...shellCommand,
      prompt,
      outputPath: input.outputPath,
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
