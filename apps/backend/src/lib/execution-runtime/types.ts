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
import type { DockerRuntimeManager } from "../docker-runtime.js";
import type { EventHub } from "../event-hub.js";
import type { Store } from "../store.js";

export type ExecutionRuntimeOptions = {
  adapterRegistry: AgentAdapterRegistry;
  dockerRuntime: DockerRuntimeManager;
  eventHub: EventHub;
  store: Store;
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

export type DraftRefinementResult = z.infer<typeof draftRefinementResultSchema>;
export type DraftFeasibilityResult = z.infer<
  typeof draftFeasibilityResultSchema
>;

export const draftAnalysisTimeoutMs = 180_000;

export type ModelSelection = {
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
};
