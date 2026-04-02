import type { z } from "zod";

import type {
  Project,
  RepositoryConfig,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";
import {
  appendContextSections,
  appendCriteriaSections,
  appendMarkdownSection,
  hasMeaningfulContent,
  normalizeOptionalModel,
  truncate,
} from "../execution-runtime/helpers.js";
import type { PromptContextSection } from "../execution-runtime/types.js";
import {
  buildDraftQuestionsPrompt,
  buildDraftRefinementPrompt,
} from "./shared-draft-prompts.js";
import type {
  AgentCliAdapter,
  DraftRunInput,
  ExecutionRunInput,
  InterpretedAdapterLine,
  MergeConflictRunInput,
  PreparedAgentRun,
} from "./types.js";

// Claude Code read-only tools allowlist for plan mode.
const planModeAllowedTools =
  "Read,Glob,Grep,Bash(git diff:git log:git status:git branch:ls:cat:head:tail:find:wc),Agent";

/**
 * Escape a string for safe embedding inside single quotes in a POSIX shell
 * command. Every single-quote in the value is replaced with the sequence
 * '\'' (end current quote, insert escaped literal single-quote, resume
 * quoting).
 */
function shellEscape(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

/**
 * Build a shell command that invokes `claude` and redirects stdout to
 * `outputPath`. Used only for draft analysis runs, which are spawned via
 * regular `spawn()` (not PTY) and produce a single JSON blob on stdout
 * via `--output-format json`.
 *
 * Draft analysis does not need streaming stdout - the runtime just reads
 * the output file after exit and passes it to `parseDraftResult`. Using
 * `>` redirect (instead of `tee`) avoids the problems that `tee` causes
 * with PTY (ANSI escape codes) and stream-json (capturing the entire
 * transcript instead of just the result).
 *
 * Uses `bash` (not `sh`) to guarantee `pipefail` support on Linux hosts
 * where `/bin/sh` may be `dash`.
 */
function buildDraftShellCommand(
  claudeArgs: string[],
  outputPath: string,
): { command: string; args: string[] } {
  const parts = ["claude"];
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
): void {
  if (model) {
    args.push("--model", model);
  }
}

function buildClaudeCodeImplementationPrompt(
  ticket: TicketFrontmatter,
  repository: RepositoryConfig,
  extraInstructions: PromptContextSection[],
  planSummary: string | null,
): string {
  const sections: string[] = [
    `Implement ticket #${ticket.id} in the repository ${repository.name}.`,
    "",
  ];

  appendMarkdownSection(sections, "Title", ticket.title);
  sections.push("");
  appendMarkdownSection(sections, "Description", ticket.description);
  sections.push("");
  appendCriteriaSections(
    sections,
    ticket.acceptance_criteria,
    "Preserve the intended user workflow and keep the change small and focused.",
  );
  sections.push(
    "",
    "Execution rules:",
    "- Make the smallest complete change that satisfies the ticket.",
    "- Stay inside this repository worktree.",
    "- Run lightweight validation when it is obvious and inexpensive.",
    "- Create a git commit before finishing if you made code changes.",
    "- End with a concise summary that includes changed files, validation run, and remaining risks.",
  );

  if (hasMeaningfulContent(planSummary)) {
    sections.push("");
    appendMarkdownSection(sections, "Approved plan", planSummary);
  }

  appendContextSections(sections, "Additional context", extraInstructions);
  return sections.join("\n");
}

function buildClaudeCodePlanPrompt(
  ticket: TicketFrontmatter,
  repository: RepositoryConfig,
  extraInstructions: PromptContextSection[],
): string {
  const sections: string[] = [
    `Plan ticket #${ticket.id} in the repository ${repository.name}.`,
    "",
  ];

  appendMarkdownSection(sections, "Title", ticket.title);
  appendMarkdownSection(sections, "Description", ticket.description);
  appendCriteriaSections(
    sections,
    ticket.acceptance_criteria,
    "Preserve the intended user workflow and keep the change small and focused.",
  );
  sections.push(
    "",
    "Execution rules:",
    "- Stay inside this repository worktree.",
    "- Read files and inspect the repository as needed.",
    "- Do not modify files, create commits, or run write operations.",
    "- Return a concise implementation plan only.",
    "- End with a short plan summary that the user can approve or revise.",
  );
  appendContextSections(sections, "Additional context", extraInstructions);
  return sections.join("\n");
}

function buildClaudeCodeMergeConflictPrompt(input: {
  ticket: TicketFrontmatter;
  repository: RepositoryConfig;
  targetBranch: string;
  stage: "rebase" | "merge";
  conflictedFiles: string[];
  failureMessage: string;
}): string {
  const sections: string[] = [
    `Resolve the active git ${input.stage} conflicts for ticket #${input.ticket.id} in repository ${input.repository.name}.`,
    "You are running inside the existing ticket worktree and must preserve the ticket's intended scope.",
    "",
  ];

  appendMarkdownSection(sections, "Title", input.ticket.title);
  sections.push("");
  appendMarkdownSection(sections, "Description", input.ticket.description);
  sections.push("");
  appendCriteriaSections(
    sections,
    input.ticket.acceptance_criteria,
    "Preserve the ticket intent while resolving the git conflicts.",
  );
  sections.push("");
  appendMarkdownSection(sections, "Target branch", input.targetBranch);
  sections.push("");
  appendMarkdownSection(sections, "Conflict stage", input.stage);
  sections.push("");
  appendMarkdownSection(
    sections,
    "Conflicted files",
    input.conflictedFiles.length > 0
      ? input.conflictedFiles.join("\n")
      : "Unknown",
  );
  sections.push("");
  appendMarkdownSection(sections, "Git failure", input.failureMessage);
  sections.push(
    "",
    "Requirements:",
    "- Stay inside this repository worktree.",
    "- Make the smallest safe conflict resolution that keeps the ticket intent and the latest target-branch behavior.",
    "- If a rebase is in progress, resolve conflicts, stage the files, and run `git rebase --continue` until the rebase finishes.",
    "- If a merge is in progress, resolve conflicts, stage the files, and finish the merge.",
    "- Do not abort the rebase or merge unless it is impossible to resolve safely.",
    "- Do not open a PR or change ticket metadata.",
    "- End with a concise summary stating whether the git operation finished cleanly.",
  );
  return sections.join("\n");
}

function parseClaudeCodeJsonResult<T>(
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
      candidates.push(wrapper.result.trim());
    }
  } catch {
    // Not a wrapper object - try other candidates.
  }

  // Strip markdown code fences if present.
  if (trimmed.startsWith("```")) {
    candidates.push(
      trimmed
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```$/i, "")
        .trim(),
    );
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
        candidates.push(parsed.result.trim());
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

function formatClaudeCodeExitReason(
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

function interpretClaudeCodeStreamJsonLine(
  line: string,
): InterpretedAdapterLine {
  const normalized = line.trim();
  if (normalized.length === 0) {
    return {
      logLine: "",
    };
  }

  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;

    const eventType =
      typeof parsed.type === "string" ? parsed.type : "event";

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
      return {
        logLine: `[claude-code result] ${truncate(resultText)}${costSuffix}`,
      };
    }

    // Handle assistant messages.
    if (eventType === "assistant") {
      const message = parsed.message;
      if (message && typeof message === "object") {
        const messageRecord = message as Record<string, unknown>;
        if (typeof messageRecord.content === "string") {
          return {
            logLine: `[claude-code assistant] ${truncate(messageRecord.content)}`,
          };
        }

        // Content can be an array of content blocks.
        if (Array.isArray(messageRecord.content)) {
          const textParts = (messageRecord.content as unknown[])
            .filter(
              (block): block is Record<string, unknown> =>
                typeof block === "object" &&
                block !== null &&
                (block as Record<string, unknown>).type === "text",
            )
            .map((block) => String(block.text ?? ""))
            .filter((text) => text.length > 0);
          if (textParts.length > 0) {
            return {
              logLine: `[claude-code assistant] ${truncate(textParts.join(" "))}`,
            };
          }
        }
      }

      if (typeof parsed.message === "string") {
        return {
          logLine: `[claude-code assistant] ${truncate(parsed.message)}`,
        };
      }

      return {
        logLine: `[claude-code assistant] ${truncate(JSON.stringify(parsed))}`,
      };
    }

    // Handle system messages.
    if (eventType === "system") {
      const text =
        typeof parsed.message === "string"
          ? parsed.message
          : JSON.stringify(parsed);
      return {
        logLine: `[claude-code system] ${truncate(text)}`,
      };
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
    return {
      logLine: `[claude-code ${eventType}] ${truncate(text)}`,
    };
  } catch {
    return {
      logLine: `[claude-code raw] ${truncate(line)}`,
    };
  }
}

export class ClaudeCodeAdapter implements AgentCliAdapter {
  readonly id = "claude-code" as const;
  readonly label = "Claude Code";

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
    const { model } = this.resolveModelSelection(input.project, "draft");
    const claudeArgs = [
      "-p",
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
          ),
      "--output-format",
      "json",
      "--dangerously-skip-permissions",
    ];

    appendClaudeCodeModelArgs(claudeArgs, model);

    // Claude Code CLI has no --output-file flag. For draft runs (which use
    // regular spawn, not PTY), wrap in a shell command that redirects stdout
    // to the output file. The runtime reads this file after exit and passes
    // its contents to parseDraftResult.
    const { command, args } = buildDraftShellCommand(
      claudeArgs,
      input.outputPath,
    );

    return {
      command,
      args,
      outputPath: input.outputPath,
      dockerSpec: null,
    };
  }

  buildExecutionRun(input: ExecutionRunInput): PreparedAgentRun {
    const { model } = this.resolveModelSelection(input.project, "ticket");
    const prompt =
      input.executionMode === "plan"
        ? buildClaudeCodePlanPrompt(
            input.ticket,
            input.repository,
            input.extraInstructions,
          )
        : buildClaudeCodeImplementationPrompt(
            input.ticket,
            input.repository,
            input.extraInstructions,
            input.planSummary,
          );

    const args = ["-p", prompt, "--output-format", "stream-json"];

    // Both plan and implementation modes need --dangerously-skip-permissions
    // for non-interactive (PTY) execution. Plan mode additionally restricts
    // available tools via --allowedTools.
    args.push("--dangerously-skip-permissions");
    if (input.executionMode === "plan") {
      args.push("--allowedTools", planModeAllowedTools);
    }

    appendClaudeCodeModelArgs(args, model);

    // Execution runs are spawned via PTY (spawnPty). Claude Code has no
    // --output-file or --output-last-message flag, and wrapping in a shell
    // with tee/redirect corrupts the output with ANSI escape codes from the
    // PTY and captures the entire stream-json transcript rather than just
    // the final result.
    //
    // Instead, spawn `claude` directly. The outputPath file will not be
    // populated by the CLI, but the runtime handles this gracefully -
    // it falls back to a default message when the file is missing or empty.
    // Session log lines are still captured via PTY onData.
    return {
      command: "claude",
      args,
      outputPath: input.outputPath,
      // Claude Code does not support Docker runtime.
      dockerSpec: null,
    };
  }

  buildMergeConflictRun(input: MergeConflictRunInput): PreparedAgentRun {
    const { model } = this.resolveModelSelection(input.project, "ticket");
    const prompt = buildClaudeCodeMergeConflictPrompt({
      ticket: input.ticket,
      repository: input.repository,
      targetBranch: input.targetBranch,
      stage: input.stage,
      conflictedFiles: input.conflictedFiles,
      failureMessage: input.failureMessage,
    });

    const args = [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--dangerously-skip-permissions",
    ];

    appendClaudeCodeModelArgs(args, model);

    // Merge conflict runs use regular spawn (not PTY), but still use
    // --output-format stream-json which emits many lines. Shell wrapping
    // with tee would capture the entire NDJSON transcript into the output
    // file, but the runtime expects only a summary. Spawning `claude`
    // directly means the output file stays empty (pre-created by the
    // runtime). The runtime reads it and gets "", which is handled
    // gracefully. Stdout still flows to child.stdout for streamLines.
    return {
      command: "claude",
      args,
      outputPath: input.outputPath,
      // Claude Code does not support Docker runtime.
      dockerSpec: null,
    };
  }

  // Claude Code does not support session resumption, so sessionRef is
  // intentionally never set on returned InterpretedAdapterLine values.
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
