import type { z } from "zod";

import type {
  DraftTicketState,
  Project,
  ReasoningEffort,
  RepositoryConfig,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";
import {
  appendContextSections,
  appendCriteriaSections,
  appendMarkdownSection,
  hasMeaningfulContent,
  normalizeOptionalModel,
  normalizeOptionalReasoningEffort,
  truncate,
} from "../execution-runtime/helpers.js";
import type { PromptContextSection } from "../execution-runtime/types.js";
import type {
  AgentCliAdapter,
  DraftRunInput,
  ExecutionRunInput,
  InterpretedAdapterLine,
  MergeConflictRunInput,
  PreparedAgentRun,
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

function buildCodexImplementationPrompt(
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

function buildCodexPlanPrompt(
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

function buildMergeConflictResolutionPrompt(input: {
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

function buildDraftRefinementPrompt(
  draft: DraftTicketState,
  repository: RepositoryConfig,
  instruction?: string,
): string {
  const sections: string[] = [
    `Refine the draft ticket for repository ${repository.name}.`,
    "Inspect repository context as needed, but do not modify any files.",
    "Scan the repository for relevant Markdown (.md) files and read their text when it helps infer the user's intent.",
    "Return JSON only with no markdown fences or commentary.",
    "",
    "Current draft:",
  ];

  appendMarkdownSection(sections, "title_draft", draft.title_draft);
  sections.push("");
  appendMarkdownSection(sections, "description_draft", draft.description_draft);
  appendMarkdownSection(
    sections,
    "proposed_ticket_type",
    draft.proposed_ticket_type ?? "feature",
  );
  sections.push("", "proposed_acceptance_criteria:");
  if (draft.proposed_acceptance_criteria.length > 0) {
    for (const [
      index,
      criterion,
    ] of draft.proposed_acceptance_criteria.entries()) {
      sections.push(`criterion_${index + 1}:`, criterion);
      if (index < draft.proposed_acceptance_criteria.length - 1) {
        sections.push("");
      }
    }
  } else {
    sections.push("None yet.");
  }
  sections.push(
    "",
    "Return strict JSON with this shape:",
    '{"title_draft":"string","description_draft":"string","proposed_ticket_type":"feature|bugfix|chore|research","proposed_acceptance_criteria":["string"],"split_proposal_summary":"string|null"}',
    "",
    "Requirements:",
    "- Correct grammar, wording, clarity, and readability.",
    "- Preserve the original intent and overall scope unless the wording is clearly contradictory or confusing.",
    "- Keep any existing draft artifact Markdown image references as Markdown images in the description; do not remove them or convert them to plain links.",
    "- Use relevant repository context, especially Markdown documentation, to infer domain terms, existing workflows, and user intent.",
    "- Keep the existing ticket type unless the draft text makes it obviously incorrect.",
    "- Make acceptance criteria concrete, testable, and concise without expanding scope.",
    '- Set "split_proposal_summary" to null unless the draft already clearly describes multiple separate tickets.',
  );

  if (hasMeaningfulContent(instruction)) {
    sections.push("");
    appendMarkdownSection(sections, "Additional instruction", instruction);
  }
  return sections.join("\n");
}

function buildDraftQuestionsPrompt(
  draft: DraftTicketState,
  repository: RepositoryConfig,
  instruction?: string,
): string {
  const sections: string[] = [
    `Assess feasibility for the draft ticket inside repository ${repository.name}.`,
    "Read repository context as needed, but do not modify any files.",
    "Return JSON only with no markdown fences or commentary.",
    "",
    "Draft under review:",
  ];

  appendMarkdownSection(sections, "title_draft", draft.title_draft);
  sections.push("");
  appendMarkdownSection(sections, "description_draft", draft.description_draft);
  appendMarkdownSection(
    sections,
    "proposed_ticket_type",
    draft.proposed_ticket_type ?? "feature",
  );
  sections.push("", "proposed_acceptance_criteria:");
  if (draft.proposed_acceptance_criteria.length > 0) {
    for (const [
      index,
      criterion,
    ] of draft.proposed_acceptance_criteria.entries()) {
      sections.push(`criterion_${index + 1}:`, criterion);
      if (index < draft.proposed_acceptance_criteria.length - 1) {
        sections.push("");
      }
    }
  } else {
    sections.push("None yet.");
  }
  sections.push(
    "",
    "Return strict JSON with this shape:",
    '{"verdict":"string","summary":"string","assumptions":["string"],"open_questions":["string"],"risks":["string"],"suggested_draft_edits":["string"]}',
    "",
    "Requirements:",
    "- Focus on whether the draft is feasible and correctly scoped for this repository.",
    "- Call out missing information, risky assumptions, and likely blockers.",
    "- Keep suggested edits concrete and short.",
  );

  if (hasMeaningfulContent(instruction)) {
    sections.push("");
    appendMarkdownSection(sections, "Additional instruction", instruction);
  }
  return sections.join("\n");
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
    const args = resumeSessionRef
      ? ["exec", "resume", "--json"]
      : ["exec", "--json"];

    if (input.useDockerRuntime) {
      appendDangerousDockerArgs(args);
    } else {
      appendCodexExecutionModeArgs(args, input.executionMode);
    }

    args.push("--output-last-message", input.outputPath);
    appendCodexModelArgs(args, {
      model,
      reasoningEffort,
    });

    if (resumeSessionRef) {
      args.push(resumeSessionRef);
    }

    args.push(
      input.executionMode === "plan"
        ? buildCodexPlanPrompt(
            input.ticket,
            input.repository,
            input.extraInstructions,
          )
        : buildCodexImplementationPrompt(
            input.ticket,
            input.repository,
            input.extraInstructions,
            input.planSummary,
          ),
    );

    return {
      command: "codex",
      args,
      outputPath: input.outputPath,
      dockerSpec: input.useDockerRuntime ? codexDockerSpec : null,
    };
  }

  buildMergeConflictRun(input: MergeConflictRunInput): PreparedAgentRun {
    const { model, reasoningEffort } = this.resolveModelSelection(
      input.project,
      "ticket",
    );
    const args = ["exec", "--json", "--output-last-message", input.outputPath];

    if (input.useDockerRuntime) {
      appendDangerousDockerArgs(args);
    } else {
      args.push("--full-auto");
    }

    appendCodexModelArgs(args, {
      model,
      reasoningEffort,
    });
    args.push(
      buildMergeConflictResolutionPrompt({
        ticket: input.ticket,
        repository: input.repository,
        targetBranch: input.targetBranch,
        stage: input.stage,
        conflictedFiles: input.conflictedFiles,
        failureMessage: input.failureMessage,
      }),
    );

    return {
      command: "codex",
      args,
      outputPath: input.outputPath,
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
