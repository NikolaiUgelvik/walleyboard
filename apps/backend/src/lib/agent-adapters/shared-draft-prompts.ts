import type {
  DraftTicketState,
  RepositoryConfig,
} from "../../../../../packages/contracts/src/index.js";
import {
  appendMarkdownSection,
  hasMeaningfulContent,
} from "../execution-runtime/helpers.js";

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
