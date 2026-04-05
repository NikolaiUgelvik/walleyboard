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

function appendCodeBlock(
  sections: string[],
  language: string,
  content: string,
): void {
  sections.push(`\`\`\`${language}`, content, "```");
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

export function buildDraftRefinementPrompt(
  draft: DraftTicketState,
  repository: RepositoryConfig,
  enabledMcpServers: readonly string[],
  instruction?: string,
): string {
  const sections: string[] = [];

  appendHeading(sections, "Objective");
  sections.push(
    `Refine the draft ticket for repository \`${repository.name}\`.`,
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
    "Inspect repository context as needed, but do not modify any files.",
    "Scan relevant Markdown (`.md`) files when they help infer the user's intent.",
    "Correct grammar, wording, clarity, and readability.",
    "Preserve the original intent and overall scope unless the wording is clearly contradictory or confusing.",
    "Keep any existing draft artifact Markdown image references as Markdown images in the description; do not remove them or convert them to plain links.",
    "Use repository context, especially Markdown documentation, to infer domain terms, existing workflows, and user intent.",
    "Keep the existing ticket type unless the draft text makes it obviously incorrect.",
    "Make acceptance criteria concrete, testable, and concise without expanding scope.",
    'Set `"split_proposal_summary"` to `null` unless the draft already clearly describes multiple separate tickets.',
  ]);

  appendHeading(sections, "Output JSON");
  sections.push("Return JSON only with no markdown fences or commentary.");
  appendCodeBlock(
    sections,
    "json",
    '{"title_draft":"string","description_draft":"string","proposed_ticket_type":"feature|bugfix|chore|research","proposed_acceptance_criteria":["string"],"split_proposal_summary":"string|null"}',
  );
  return sections.join("\n");
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

  appendHeading(sections, "Output JSON");
  sections.push("Return JSON only with no markdown fences or commentary.");
  appendCodeBlock(
    sections,
    "json",
    '{"verdict":"string","summary":"string","assumptions":["string"],"open_questions":["string"],"risks":["string"],"suggested_draft_edits":["string"]}',
  );
  return sections.join("\n");
}
