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
    args.push(
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
    );

    return {
      command: "codex",
      args,
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

    args.push(
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
          ),
    );

    return {
      command: "codex",
      args,
      outputPath,
      dockerSpec: input.useDockerRuntime ? codexDockerSpec : null,
    };
  }

  buildMergeConflictRun(input: MergeConflictRunInput): PreparedAgentRun {
    const { model, reasoningEffort } = this.resolveModelSelection(
      input.project,
      "ticket",
    );
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
    args.push(
      buildMergeConflictPrompt({
        ticket: input.ticket,
        repository: input.repository,
        recoveryKind: input.recoveryKind,
        targetBranch: input.targetBranch,
        stage: input.stage,
        conflictedFiles: input.conflictedFiles,
        failureMessage: input.failureMessage,
      }),
    );

    return {
      command: "codex",
      args,
      outputPath,
      dockerSpec: input.useDockerRuntime ? codexDockerSpec : null,
    };
  }

  buildReviewRun(input: ReviewRunInput): PreparedAgentRun {
    const { model, reasoningEffort } = this.resolveModelSelection(
      input.project,
      "ticket",
    );
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
    args.push(
      buildReviewPrompt({
        repository: input.repository,
        reviewPackage: input.reviewPackage,
        ticket: input.ticket,
      }),
    );

    return {
      command: "codex",
      args,
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
