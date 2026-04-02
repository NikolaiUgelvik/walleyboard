import type {
  DraftTicketState,
  ReasoningEffort,
  RepositoryConfig,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import {
  appendContextSections,
  appendCriteriaSections,
  appendMarkdownSection,
  hasMeaningfulContent,
} from "./helpers.js";
import type { ExecutionMode, PromptContextSection } from "./types.js";

export function appendCodexModelArgs(
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

export function appendCodexExecutionModeArgs(
  args: string[],
  executionMode: ExecutionMode,
): void {
  const sandboxMode =
    executionMode === "plan" ? "read-only" : "workspace-write";

  args.push("--config", 'approval_policy="on-request"');
  args.push("--config", `sandbox_mode="${sandboxMode}"`);
}

export function appendDangerousDockerArgs(args: string[]): void {
  args.push("--dangerously-bypass-approvals-and-sandbox");
}

export function buildCodexImplementationPrompt(
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

export function buildCodexPlanPrompt(
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

export function buildMergeConflictResolutionPrompt(input: {
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

export function buildDraftRefinementPrompt(
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

export function buildDraftQuestionsPrompt(
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
