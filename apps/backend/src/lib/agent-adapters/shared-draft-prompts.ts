import type {
  DraftTicketState,
  RepositoryConfig,
} from "../../../../../packages/contracts/src/index.js";
import { hasMeaningfulContent } from "../execution-runtime/helpers.js";

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
  emptyFallback = "None yet.",
): void {
  if (items.length === 0) {
    sections.push(emptyFallback);
    return;
  }

  for (const [index, item] of items.entries()) {
    sections.push(`${index + 1}. ${item}`);
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

function appendDraftSection(sections: string[], draft: DraftTicketState): void {
  appendHeading(sections, "Draft");
  appendSubsection(sections, "Title", draft.title_draft);
  appendSubsection(sections, "Description", draft.description_draft);
  appendSubsection(
    sections,
    "Proposed Ticket Type",
    draft.proposed_ticket_type ?? "feature",
  );
}

function appendAvailableMcpSection(
  sections: string[],
  enabledMcpServers: readonly string[],
): void {
  if (enabledMcpServers.length === 0) {
    return;
  }

  appendHeading(sections, "Available MCPs");

  appendBullets(
    sections,
    enabledMcpServers.map((server) => `\`${server}\` - enabled`),
  );
}

export function buildDraftRefinementPrompt(
  draft: DraftTicketState,
  repository: RepositoryConfig,
  enabledMcpServers: readonly string[],
  instruction?: string,
): string {
  const sections: string[] = [];

  appendHeading(sections, "Objective");
  sections.push(
    `Refine the draft ticket for repository \`${repository.name}\` and produce a structured implementation plan.`,
  );
  sections.push(
    "Inspect the repository to gather context. Submit the result only via the MCP tool — no commentary, no inline output.",
  );

  appendDraftSection(sections, draft);

  appendHeading(sections, "Proposed Acceptance Checklist");
  appendNumberedList(sections, draft.proposed_acceptance_criteria);

  appendHeading(sections, "Description Structure");
  sections.push(
    "Write the description as structured Markdown using these sections (omit any section where the repository provides no relevant evidence):",
  );
  appendBullets(sections, [
    "`## Goal` — explicit task definition; what the system should do after this change",
    "`## Current Behavior` — what happens today (use repository evidence, not assumption)",
    "`## Desired Behavior` — what should happen after the change",
    "`## Constraints` — what must not change (API contracts, DB schema, external interfaces)",
    "`## Relevant Files` — file paths gathered from the repository; include line numbers (e.g. `src/foo.ts:42-51`) only when the exact location matters",
    "`## Code Context` — short, targeted snippets only; include only when a snippet clarifies the exact change point; do not paste full files",
    '`## Implementation Steps` — numbered; concrete and ordered (e.g. "1. Add interface to X, 2. Implement in Y")',
    "`## Requirements` — language, framework, library, or pattern constraints that apply to this change",
  ]);

  appendAvailableMcpSection(sections, enabledMcpServers);

  if (hasMeaningfulContent(instruction)) {
    appendHeading(sections, "Context");
    appendSubsection(sections, "Additional Instruction", instruction);
  }

  appendHeading(sections, "Guardrails");
  appendBullets(sections, [
    "Inspect repository source files, documentation, and configuration as needed to resolve ambiguity; do not modify any files.",
    "Do not explain your reasoning; produce only the refined ticket via the MCP tool call.",
    "Do not invent implementation steps, constraints, or file references that cannot be verified in the repository.",
    "Preserve the original intent and overall scope unless the wording is clearly contradictory or confusing.",
    "Keep any existing draft artifact Markdown image references as Markdown images in the description; do not remove them or convert them to plain links.",
    "Use repository context to infer domain terms, existing patterns, and user intent.",
    "Keep the existing ticket type unless the draft text makes it obviously incorrect.",
    "Make acceptance criteria concrete, testable, and concise without expanding scope.",
    'Set `"split_proposal_summary"` to `null` unless the draft already clearly describes multiple separate tickets.',
  ]);
  return sections.join("\n");
}

export function buildDraftRefinementRetryInstruction(
  attemptNumber: number,
  originalInstruction?: string,
): string {
  const retryGuidance = [
    `This is retry attempt ${attemptNumber + 1} of 3.`,
    "Your previous attempt did not produce valid JSON output.",
    "You MUST return your result by calling the MCP tool `mcp__walleyboard__submit_refined_draft` with the structured fields.",
    "Do not return JSON inline — use only the MCP tool.",
  ].join(" ");
  if (originalInstruction) {
    return `${retryGuidance}\n\nOriginal instruction:\n${originalInstruction}`;
  }
  return retryGuidance;
}

export function buildDraftQuestionsPrompt(
  draft: DraftTicketState,
  repository: RepositoryConfig,
  enabledMcpServers: readonly string[],
  instruction?: string,
): string {
  const sections: string[] = [];

  appendHeading(sections, "Objective");
  sections.push(
    `Assess feasibility for the draft ticket inside repository \`${repository.name}\`.`,
  );

  appendDraftSection(sections, draft);

  appendHeading(sections, "Proposed Acceptance Checklist");
  appendNumberedList(sections, draft.proposed_acceptance_criteria);
  appendAvailableMcpSection(sections, enabledMcpServers);

  if (hasMeaningfulContent(instruction)) {
    appendHeading(sections, "Context");
    appendSubsection(sections, "Additional Instruction", instruction);
  }

  appendHeading(sections, "Guardrails");
  appendBullets(sections, [
    "Read repository context as needed, but do not modify any files.",
    "Focus on whether the draft is feasible and correctly scoped for this repository.",
    "Call out missing information, risky assumptions, and likely blockers.",
    "Keep suggested edits concrete and short.",
  ]);
  return sections.join("\n");
}
