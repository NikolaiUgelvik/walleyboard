import type {
  ExecutionAttempt,
  RepositoryConfig,
  ReviewPackage,
  ReviewRun,
  StructuredEvent,
  TicketFrontmatter,
  ValidationResult,
} from "../../../../../packages/contracts/src/index.js";
import { hasMeaningfulContent } from "../execution-runtime/helpers.js";
import type { PromptContextSection } from "../execution-runtime/types.js";

function appendHeading(
  sections: string[],
  title: string,
  level: 2 | 3 = 2,
): void {
  if (sections.length > 0 && sections[sections.length - 1] !== "") {
    sections.push("");
  }

  sections.push(`${"#".repeat(level)} ${title}`);
}

function appendTextBlock(
  sections: string[],
  content: string | null | undefined,
  fallback = "None.",
): void {
  sections.push(hasMeaningfulContent(content) ? content : fallback);
}

function appendBullets(
  sections: string[],
  items: string[],
  emptyFallback = "None.",
): void {
  if (items.length === 0) {
    sections.push(emptyFallback);
    return;
  }

  for (const item of items) {
    sections.push(`- ${item}`);
  }
}

function appendNumberedList(
  sections: string[],
  items: string[],
  emptyFallback: string,
): void {
  if (items.length === 0) {
    sections.push(emptyFallback);
    return;
  }

  for (const [index, item] of items.entries()) {
    sections.push(`${index + 1}. ${item}`);
  }
}

function appendCodeBlock(
  sections: string[],
  language: string,
  content: string,
): void {
  sections.push(`\`\`\`${language}`, content, "```");
}

function appendMetadataBullets(
  sections: string[],
  metadata: Array<[label: string, value: string | null | undefined]>,
): void {
  for (const [label, value] of metadata) {
    sections.push(
      `- ${label}: ${hasMeaningfulContent(value) ? value : "None."}`,
    );
  }
}

function appendSubsection(
  sections: string[],
  title: string,
  content: string | null | undefined,
  fallback = "None.",
): void {
  appendHeading(sections, title, 3);
  appendTextBlock(sections, content, fallback);
}

function appendBulletSubsection(
  sections: string[],
  title: string,
  items: string[],
  emptyFallback = "None.",
): void {
  appendHeading(sections, title, 3);
  appendBullets(sections, items, emptyFallback);
}

function appendTicketSection(
  sections: string[],
  ticket: TicketFrontmatter,
): void {
  appendHeading(sections, "Ticket");
  appendSubsection(sections, "Title", ticket.title);
  appendSubsection(sections, "Description", ticket.description);
}

function appendAcceptanceChecklist(
  sections: string[],
  criteria: string[],
  emptyFallback: string,
): void {
  appendHeading(sections, "Acceptance Checklist");
  appendNumberedList(sections, criteria, emptyFallback);
}

function appendAvailableMcpSection(
  sections: string[],
  enabledMcpServers: readonly string[],
): void {
  appendHeading(sections, "Available MCPs");

  if (enabledMcpServers.length === 0) {
    sections.push("No MCP servers are enabled for this project.");
    return;
  }

  appendBullets(
    sections,
    enabledMcpServers.map((server) => `\`${server}\` - enabled`),
  );
}

function appendContext(
  sections: string[],
  planSummary: string | null,
  extraInstructions: PromptContextSection[],
): void {
  if (!hasMeaningfulContent(planSummary) && extraInstructions.length === 0) {
    return;
  }

  appendHeading(sections, "Context");

  if (hasMeaningfulContent(planSummary)) {
    appendSubsection(sections, "Approved Plan", planSummary);
  }

  for (const item of extraInstructions) {
    appendSubsection(sections, item.label, item.content);
  }
}

function formatValidationResults(reviewPackage: ReviewPackage): string[] {
  return reviewPackage.validation_results.map(
    (result) => `\`${result.label}\` - ${result.status}`,
  );
}

function formatRemainingRisks(reviewPackage: ReviewPackage): string[] {
  return reviewPackage.remaining_risks;
}

function formatValidationResult(result: ValidationResult): string {
  return [
    `Label: ${result.label}`,
    `Status: ${result.status}`,
    `Started at: ${result.started_at}`,
    `Ended at: ${result.ended_at}`,
    `Exit code: ${result.exit_code === null ? "None" : String(result.exit_code)}`,
    `Failure overridden: ${result.failure_overridden ? "yes" : "no"}`,
    `Summary: ${hasMeaningfulContent(result.summary) ? result.summary : "None."}`,
    `Log ref: ${hasMeaningfulContent(result.log_ref) ? result.log_ref : "None."}`,
  ].join("\n");
}

function appendExecutionAttemptsSection(
  sections: string[],
  attempts: ExecutionAttempt[],
): void {
  appendHeading(sections, "Execution Attempts");
  if (attempts.length === 0) {
    sections.push("None.");
    return;
  }

  for (const attempt of attempts) {
    appendHeading(sections, `Attempt ${attempt.attempt_number}`, 3);
    appendMetadataBullets(sections, [
      ["Status", attempt.status],
      ["Prompt kind", attempt.prompt_kind],
      ["Started at", attempt.started_at],
      ["Ended at", attempt.ended_at],
      ["End reason", attempt.end_reason],
    ]);
    appendSubsection(sections, "Prompt", attempt.prompt);
  }
}

function appendReviewRunsSection(
  sections: string[],
  reviewRuns: ReviewRun[],
): void {
  appendHeading(sections, "Review Runs");
  if (reviewRuns.length === 0) {
    sections.push("None.");
    return;
  }

  for (const [index, reviewRun] of reviewRuns.entries()) {
    appendHeading(sections, `Review Run ${index + 1}`, 3);
    appendMetadataBullets(sections, [
      ["Review run id", reviewRun.id],
      ["Status", reviewRun.status],
      ["Created at", reviewRun.created_at],
      ["Updated at", reviewRun.updated_at],
      ["Completed at", reviewRun.completed_at],
      ["Adapter session ref", reviewRun.adapter_session_ref],
    ]);
    appendSubsection(sections, "Prompt", reviewRun.prompt);
    appendSubsection(
      sections,
      "Report summary",
      reviewRun.report?.summary ?? null,
    );
    appendBulletSubsection(
      sections,
      "Report strengths",
      reviewRun.report?.strengths ?? [],
    );
    appendBulletSubsection(
      sections,
      "Actionable findings",
      (reviewRun.report?.actionable_findings ?? []).map((finding) =>
        [
          `Severity: ${finding.severity}`,
          `Category: ${finding.category}`,
          `Title: ${finding.title}`,
          `Details: ${finding.details}`,
          `Suggested fix: ${finding.suggested_fix}`,
        ].join(" | "),
      ),
    );
    appendSubsection(sections, "Failure message", reviewRun.failure_message);
  }
}

function appendTicketEventsSection(
  sections: string[],
  ticketEvents: StructuredEvent[],
): void {
  appendHeading(sections, "Ticket Events");
  if (ticketEvents.length === 0) {
    sections.push("None.");
    return;
  }

  for (const [index, event] of ticketEvents.entries()) {
    appendHeading(sections, `Event ${index + 1}`, 3);
    appendMetadataBullets(sections, [
      ["Occurred at", event.occurred_at],
      ["Entity type", event.entity_type],
      ["Entity id", event.entity_id],
      ["Event type", event.event_type],
    ]);
    appendCodeBlock(sections, "json", JSON.stringify(event.payload, null, 2));
  }
}

function appendSessionLogsSection(
  sections: string[],
  sessionLogs: string[],
): void {
  appendHeading(sections, "Session Logs");
  if (sessionLogs.length === 0) {
    sections.push("None.");
    return;
  }

  appendCodeBlock(sections, "text", sessionLogs.join("\n"));
}

export function buildImplementationPrompt(
  ticket: TicketFrontmatter,
  repository: RepositoryConfig,
  enabledMcpServers: readonly string[],
  extraInstructions: PromptContextSection[],
  planSummary: string | null,
): string {
  const sections: string[] = [];

  appendHeading(sections, "Objective");
  sections.push(
    `You are the implementation agent for ticket #${ticket.id} in repository \`${repository.name}\`.`,
    "Make the smallest complete change that satisfies the ticket.",
  );

  appendTicketSection(sections, ticket);
  appendAcceptanceChecklist(
    sections,
    ticket.acceptance_criteria,
    "Preserve the intended user workflow and keep the change small and focused.",
  );
  appendAvailableMcpSection(sections, enabledMcpServers);
  appendContext(sections, planSummary, extraInstructions);

  appendHeading(sections, "Guardrails");
  appendBullets(sections, [
    "Stay inside this repository worktree.",
    "Preserve the intended user workflow and keep the change small and focused.",
    "Run lightweight validation when it is obvious and inexpensive.",
    "Create a git commit before finishing if you made code changes.",
  ]);

  appendHeading(sections, "Required Final Response");
  sections.push("Return Markdown using this structure:");
  appendCodeBlock(
    sections,
    "md",
    [
      "Short summary paragraph.",
      "",
      "Changed files:",
      "- `path/to/file`",
      "",
      "Validation run:",
      "- `npm test` - passed",
      "",
      "Remaining risks:",
      "- Describe any remaining risk, or write `Remaining risks: None.` when there are none.",
      "",
      "The change is committed as `abc123` with message `Concise commit message`.",
    ].join("\n"),
  );
  return sections.join("\n");
}

export function buildPlanPrompt(
  ticket: TicketFrontmatter,
  repository: RepositoryConfig,
  enabledMcpServers: readonly string[],
  extraInstructions: PromptContextSection[],
): string {
  const sections: string[] = [];

  appendHeading(sections, "Objective");
  sections.push(
    `Plan ticket #${ticket.id} in repository \`${repository.name}\`.`,
    "Return a concise implementation plan only.",
  );

  appendTicketSection(sections, ticket);
  appendAcceptanceChecklist(
    sections,
    ticket.acceptance_criteria,
    "Preserve the intended user workflow and keep the change small and focused.",
  );
  appendAvailableMcpSection(sections, enabledMcpServers);
  appendContext(sections, null, extraInstructions);

  appendHeading(sections, "Guardrails");
  appendBullets(sections, [
    "Stay inside this repository worktree.",
    "Read files and inspect the repository as needed.",
    "Do not modify files, create commits, or run write operations.",
    "Keep the plan small, concrete, and directly tied to the ticket scope.",
  ]);

  appendHeading(sections, "Required Output");
  appendBullets(sections, [
    "Return Markdown only.",
    "Use exactly these sections: `## Approach`, `## Likely Files or Systems`, `## Validation`, and `## Open Questions or Assumptions`.",
    "End with a short plan summary the user can approve or revise.",
  ]);
  return sections.join("\n");
}

export function buildMergeConflictPrompt(input: {
  ticket: TicketFrontmatter;
  repository: RepositoryConfig;
  enabledMcpServers: readonly string[];
  recoveryKind: "conflicts" | "target_branch_advanced";
  targetBranch: string;
  stage: "rebase" | "merge";
  conflictedFiles: string[];
  failureMessage: string;
}): string {
  const sections: string[] = [];

  appendHeading(sections, "Objective");
  sections.push(
    input.recoveryKind === "target_branch_advanced"
      ? `Update the ticket branch for ticket #${input.ticket.id} in repository \`${input.repository.name}\` so it includes the latest \`${input.targetBranch}\` changes and the final merge can continue.`
      : `Resolve the active git ${input.stage} conflicts for ticket #${input.ticket.id} in repository \`${input.repository.name}\`.`,
    "You are running inside the existing ticket worktree and must preserve the ticket's intended scope.",
  );

  appendTicketSection(sections, input.ticket);
  appendAcceptanceChecklist(
    sections,
    input.ticket.acceptance_criteria,
    "Preserve the ticket intent while resolving the git conflicts.",
  );
  appendAvailableMcpSection(sections, input.enabledMcpServers);

  appendHeading(sections, "Conflict Facts");
  appendBullets(sections, [
    `Target branch: \`${input.targetBranch}\``,
    `Conflict stage: \`${input.stage}\``,
    `Recovery mode: \`${input.recoveryKind}\``,
  ]);
  appendBulletSubsection(
    sections,
    "Conflicted Files",
    input.conflictedFiles.map((file) => `\`${file}\``),
    "Unknown",
  );
  appendSubsection(sections, "Git Failure", input.failureMessage);

  appendHeading(sections, "Guardrails");
  if (input.recoveryKind === "target_branch_advanced") {
    appendBullets(sections, [
      "Stay inside this repository worktree.",
      "Update the current ticket branch so it includes the latest target-branch changes before the final merge is retried.",
      "Merge the target branch into the current ticket branch in this worktree, resolve conflicts safely if they appear, and complete the merge commit when needed.",
      "Keep the resulting branch ready for the final merge back onto the target branch.",
      "Do not open a PR or change ticket metadata.",
    ]);
  } else {
    appendBullets(sections, [
      "Stay inside this repository worktree.",
      "Make the smallest safe conflict resolution that keeps the ticket intent and the latest target-branch behavior.",
      "If a rebase is in progress, resolve conflicts, stage the files, and run `git rebase --continue` until the rebase finishes.",
      "If a merge is in progress, resolve conflicts, stage the files, and finish the merge.",
      "Do not abort the rebase or merge unless it is impossible to resolve safely.",
      "Do not open a PR or change ticket metadata.",
    ]);
  }

  appendHeading(sections, "Completion Checklist");
  appendBullets(sections, [
    "Leave the worktree clean with no in-progress git operation.",
    input.recoveryKind === "target_branch_advanced"
      ? "The ticket branch now contains the latest target-branch changes cleanly."
      : "The git operation finished cleanly, or the blocker is clearly stated.",
    "End with a concise summary of the outcome.",
  ]);
  return sections.join("\n");
}

export function buildReviewPrompt(input: {
  repository: RepositoryConfig;
  reviewPackage: ReviewPackage;
  ticket: TicketFrontmatter;
}): string {
  const sections: string[] = [];

  appendHeading(sections, "Review Goal");
  sections.push(
    `Review ticket #${input.ticket.id} in repository \`${input.repository.name}\` as a separate reviewer after implementation finished.`,
  );
  appendBullets(sections, [
    "Inspect the current worktree and compare it against the target branch.",
    "Do not modify files or create commits.",
    "Return JSON only with no markdown fences or commentary.",
  ]);

  appendHeading(sections, "Ticket Intent");
  appendSubsection(sections, "Title", input.ticket.title);
  appendSubsection(sections, "Description", input.ticket.description);

  appendAcceptanceChecklist(
    sections,
    input.ticket.acceptance_criteria,
    "Review the ticket intent and the implementation against this scope.",
  );

  appendHeading(sections, "Evidence");
  appendBullets(sections, [
    `Target branch: \`${input.ticket.target_branch}\``,
    `Diff patch: \`${input.reviewPackage.diff_ref}\``,
  ]);
  appendSubsection(
    sections,
    "Implementation Summary",
    input.reviewPackage.change_summary,
  );
  if (input.reviewPackage.commit_refs.length > 0) {
    appendBulletSubsection(
      sections,
      "Commits",
      input.reviewPackage.commit_refs.map((commitRef) => `\`${commitRef}\``),
    );
  }
  const validationResults = formatValidationResults(input.reviewPackage);
  if (validationResults.length > 0) {
    appendBulletSubsection(sections, "Validation Results", validationResults);
  }
  const knownRisks = formatRemainingRisks(input.reviewPackage);
  if (knownRisks.length > 0) {
    appendBulletSubsection(sections, "Known Risks", knownRisks);
  }

  appendHeading(sections, "Review Standard");
  appendBullets(sections, [
    "Be critical and skeptical. Do not rubber-stamp the work just to finish it.",
    "Flag first-principles problems, code smells, poor separation of concerns, correctness risks, missing tests, and maintainability issues.",
    "Only report findings that are actionable and should be fixed before merge.",
    "If the implementation summary conflicts with the repository state or git diff, trust the repository state and git diff.",
    "If there are no actionable findings, return an empty actionable_findings array.",
  ]);

  appendHeading(sections, "Output JSON");
  sections.push("Return strict JSON with this shape:");
  appendCodeBlock(
    sections,
    "json",
    '{"summary":"string","strengths":["string"],"actionable_findings":[{"severity":"high|medium|low","category":"first_principles|code_smell|separation_of_concerns|correctness|testing|maintainability","title":"string","details":"string","suggested_fix":"string"}]}',
  );
  appendBullets(sections, [
    "Use the repository context, ticket intent, validation output, and git diff to justify your conclusions.",
  ]);

  return sections.join("\n");
}

export function buildPullRequestBodyPrompt(input: {
  attempts: ExecutionAttempt[];
  baseBranch: string;
  headBranch: string;
  patch: string;
  repository: RepositoryConfig;
  reviewPackage: ReviewPackage;
  reviewRuns: ReviewRun[];
  session: {
    id: string;
    plan_summary: string | null;
    last_summary: string | null;
  };
  sessionLogs: string[];
  ticket: TicketFrontmatter;
  ticketEvents: StructuredEvent[];
}): string {
  const sections: string[] = [];

  appendHeading(sections, "Pull Request Goal");
  sections.push(
    `Write the GitHub pull request body for ticket #${input.ticket.id} in repository \`${input.repository.name}\`.`,
    "Do not write a title. Return only the PR body content in the required JSON shape.",
  );

  appendHeading(sections, "Ticket");
  appendMetadataBullets(sections, [
    ["Ticket id", String(input.ticket.id)],
    ["Title", input.ticket.title],
    ["Type", input.ticket.ticket_type],
    ["Status", input.ticket.status],
    ["Repository", input.repository.name],
    ["Base branch", input.baseBranch],
    ["Head branch", input.headBranch],
    ["Session id", input.session.id],
  ]);
  appendSubsection(sections, "Description", input.ticket.description);
  appendBulletSubsection(
    sections,
    "Acceptance Criteria",
    input.ticket.acceptance_criteria,
  );

  appendHeading(sections, "Review Package");
  appendMetadataBullets(sections, [
    ["Review package id", input.reviewPackage.id],
    ["Diff artifact", input.reviewPackage.diff_ref],
    ["Created at", input.reviewPackage.created_at],
  ]);
  appendSubsection(
    sections,
    "Change summary",
    input.reviewPackage.change_summary,
  );
  appendBulletSubsection(
    sections,
    "Commit Refs",
    input.reviewPackage.commit_refs.map((commitRef) => `\`${commitRef}\``),
  );

  appendHeading(sections, "Validation Results", 3);
  if (input.reviewPackage.validation_results.length === 0) {
    sections.push("None.");
  } else {
    for (const result of input.reviewPackage.validation_results) {
      appendCodeBlock(sections, "text", formatValidationResult(result));
    }
  }

  appendBulletSubsection(
    sections,
    "Remaining Risks",
    input.reviewPackage.remaining_risks,
  );

  appendHeading(sections, "Session Summary");
  appendSubsection(sections, "Plan summary", input.session.plan_summary);
  appendSubsection(sections, "Last summary", input.session.last_summary);

  appendExecutionAttemptsSection(sections, input.attempts);
  appendReviewRunsSection(sections, input.reviewRuns);
  appendTicketEventsSection(sections, input.ticketEvents);
  appendSessionLogsSection(sections, input.sessionLogs);

  appendHeading(sections, "Diff Patch");
  appendCodeBlock(sections, "diff", input.patch);

  appendHeading(sections, "Output JSON");
  sections.push(
    "Return strict JSON with exactly one key: `body`.",
    "The `body` should be polished GitHub Markdown that summarizes the change, includes acceptance criteria, validation, and any remaining risks when present.",
  );
  appendCodeBlock(
    sections,
    "json",
    JSON.stringify(
      {
        body: "## Summary\n- ...",
      },
      null,
      2,
    ),
  );

  return sections.join("\n");
}
