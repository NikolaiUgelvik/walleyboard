import { z } from "zod";

import type {
  DraftTicketState,
  ExecutionSession,
  Project,
  ReasoningEffort,
  RepositoryConfig,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";
import { ticketTypeSchema } from "../../../../../packages/contracts/src/index.js";

import type { AgentAdapterRegistry } from "../agent-adapters/registry.js";
import type { DockerRuntime } from "../docker-runtime.js";
import type { EventHub } from "../event-hub.js";
import type { ExecutionRuntimePersistence } from "../store.js";

export type ExecutionRuntimeOptions = {
  adapterRegistry: AgentAdapterRegistry;
  dockerRuntime: DockerRuntime;
  eventHub: EventHub;
  store: ExecutionRuntimePersistence;
};

export type StartExecutionInput = {
  project: Project;
  repository: RepositoryConfig;
  ticket: TicketFrontmatter;
  session: ExecutionSession;
  additionalInstruction?: string;
};

export type DraftAnalysisInput = {
  draft: DraftTicketState;
  project: Project;
  repository: RepositoryConfig;
  instruction?: string | undefined;
};

export type DraftAnalysisMode = "refine" | "questions";

export type ManualTerminalStartInput = {
  sessionId: string;
  worktreePath: string;
  attemptId: string | null;
};

export type ForwardedInputTarget = "agent" | "terminal";
export type ExecutionMode = "plan" | "implementation";
export type PromptContextSection = {
  label: string;
  content: string;
};

export const draftRefinementAgentResultSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  ticket_type: ticketTypeSchema,
  acceptance_criteria: z.array(z.string().min(1)),
  split_proposal_summary: z.string().nullable().optional(),
});

export const draftRefinementResultSchema = z.object({
  title_draft: z.string().min(1),
  description_draft: z.string().min(1),
  proposed_ticket_type: ticketTypeSchema,
  proposed_acceptance_criteria: z.array(z.string().min(1)),
  split_proposal_summary: z.string().nullable().optional(),
});

export const draftFeasibilityResultSchema = z.object({
  verdict: z.string().min(1),
  summary: z.string().min(1),
  assumptions: z.array(z.string().min(1)).default([]),
  open_questions: z.array(z.string().min(1)).default([]),
  risks: z.array(z.string().min(1)).default([]),
  suggested_draft_edits: z.array(z.string().min(1)).default([]),
});

export type DraftRefinementAgentResult = z.infer<
  typeof draftRefinementAgentResultSchema
>;
export type DraftRefinementResult = z.infer<typeof draftRefinementResultSchema>;
export type DraftFeasibilityResult = z.infer<
  typeof draftFeasibilityResultSchema
>;

export function mapDraftRefinementAgentResult(
  result: DraftRefinementAgentResult,
): DraftRefinementResult {
  return {
    title_draft: result.title,
    description_draft: result.description,
    proposed_ticket_type: result.ticket_type,
    proposed_acceptance_criteria: result.acceptance_criteria,
    split_proposal_summary: result.split_proposal_summary,
  };
}

export const draftAnalysisTimeoutMs = 540_000;

export type ModelSelection = {
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
};
