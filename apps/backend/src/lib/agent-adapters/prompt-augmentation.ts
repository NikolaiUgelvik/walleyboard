import type { AgentAdapterId } from "./types.js";

export type AgentPromptKind =
  | "draft_refine"
  | "draft_questions"
  | "review"
  | "pull_request_body"
  | "plan"
  | "implementation"
  | "merge_conflict";

const structuredOutputPromptKinds = new Set<AgentPromptKind>([
  "draft_refine",
  "draft_questions",
  "review",
  "pull_request_body",
]);

export function buildStructuredOutputToolInstruction(toolRef: string): string {
  return `Use the MCP tool \`${toolRef}\` exactly once to submit the final result by filling its named input fields directly. Do not return the structured result in chat, Markdown, JSON, plan text, code fences, file paths, or commentary. Do not create plan files or any other output files.`;
}

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

function buildStructuredOutputSection(toolRef: string): string {
  const sections: string[] = [];
  appendHeading(sections, "Response Format");
  sections.push(buildStructuredOutputToolInstruction(toolRef));
  return sections.join("\n");
}

export function augmentPromptForAgent(input: {
  adapterId: AgentAdapterId;
  promptKind: AgentPromptKind;
  basePrompt: string;
  structuredOutputToolRef?: string;
}): string {
  if (
    (input.adapterId === "codex" || input.adapterId === "claude-code") &&
    structuredOutputPromptKinds.has(input.promptKind)
  ) {
    if (!input.structuredOutputToolRef) {
      throw new Error(
        `Prompt kind ${input.promptKind} requires a structured output tool reference.`,
      );
    }

    return `${input.basePrompt}\n\n${buildStructuredOutputSection(input.structuredOutputToolRef)}`;
  }

  return input.basePrompt;
}
