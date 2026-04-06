import type { AgentAdapterId } from "./types.js";

export type AgentPromptKind =
  | "draft_refine"
  | "draft_questions"
  | "review"
  | "pull_request_body"
  | "plan"
  | "implementation"
  | "merge_conflict";

const claudeJsonOnlyPromptKinds = new Set<AgentPromptKind>([
  "draft_refine",
  "draft_questions",
  "review",
  "pull_request_body",
]);

const claudeJsonOnlyGuardrails = [
  "## Agent-Specific Guardrails",
  "You must output ONLY valid JSON.",
  "",
  "- Do not include any explanations",
  "- Do not include markdown fences (no ```json)",
  "- Do not include any text before or after the JSON",
  "- Output must be parseable with JSON.parse",
  "",
  'If you cannot comply, output: {"error": "invalid"}',
].join("\n");

export function augmentPromptForAgent(input: {
  adapterId: AgentAdapterId;
  promptKind: AgentPromptKind;
  basePrompt: string;
}): string {
  if (
    input.adapterId === "claude-code" &&
    claudeJsonOnlyPromptKinds.has(input.promptKind)
  ) {
    return `${input.basePrompt}\n\n${claudeJsonOnlyGuardrails}`;
  }

  return input.basePrompt;
}
