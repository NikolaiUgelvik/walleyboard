import type {
  RepositoryConfig,
  ReviewPackage,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";
import {
  appendContextSections,
  appendCriteriaSections,
  appendMarkdownSection,
  hasMeaningfulContent,
} from "../execution-runtime/helpers.js";
import type { PromptContextSection } from "../execution-runtime/types.js";

export function buildImplementationPrompt(
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

export function buildPlanPrompt(
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

export function buildMergeConflictPrompt(input: {
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

export function buildReviewPrompt(input: {
  repository: RepositoryConfig;
  reviewPackage: ReviewPackage;
  ticket: TicketFrontmatter;
}): string {
  const sections: string[] = [
    `Review ticket #${input.ticket.id} in the repository ${input.repository.name}.`,
    "You are a separate reviewer running after implementation finished.",
    "Inspect the current worktree, compare it against the target branch, and do not modify files or create commits.",
    "Return JSON only with no markdown fences or commentary.",
    "",
  ];

  appendMarkdownSection(sections, "Title", input.ticket.title);
  sections.push("");
  appendMarkdownSection(sections, "Description", input.ticket.description);
  sections.push("");
  appendCriteriaSections(
    sections,
    input.ticket.acceptance_criteria,
    "Review the ticket intent and the implementation against this scope.",
  );
  sections.push("");
  appendMarkdownSection(sections, "Target branch", input.ticket.target_branch);
  sections.push("");
  appendMarkdownSection(
    sections,
    "Implementation summary",
    input.reviewPackage.change_summary,
  );
  sections.push("");
  appendMarkdownSection(
    sections,
    "Implementation commits",
    input.reviewPackage.commit_refs.join("\n"),
  );
  sections.push("");
  appendMarkdownSection(
    sections,
    "Validation results",
    input.reviewPackage.validation_results.length > 0
      ? input.reviewPackage.validation_results
          .map((result) => `${result.label}: ${result.status}`)
          .join("\n")
      : "No validation commands were recorded.",
  );
  sections.push("");
  appendMarkdownSection(
    sections,
    "Previously noted risks",
    input.reviewPackage.remaining_risks.length > 0
      ? input.reviewPackage.remaining_risks.join("\n")
      : "No remaining risks were recorded.",
  );
  sections.push(
    "",
    "Return strict JSON with this shape:",
    '{"summary":"string","strengths":["string"],"actionable_findings":[{"severity":"high|medium|low","category":"first_principles|code_smell|separation_of_concerns|correctness|testing|maintainability","title":"string","details":"string","suggested_fix":"string"}]}',
    "",
    "Requirements:",
    "- Be critical and skeptical. Do not rubber-stamp the work just to finish it.",
    "- Flag first-principles problems, code smells, poor separation of concerns, correctness risks, missing tests, and maintainability issues.",
    "- Only report findings that are actionable and should be fixed before merge.",
    "- If there are no actionable findings, return an empty actionable_findings array.",
    "- Use the repository context, ticket intent, validation output, and git diff to justify your conclusions.",
  );

  return sections.join("\n");
}
