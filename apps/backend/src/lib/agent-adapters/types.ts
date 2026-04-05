import type { z } from "zod";

import type {
  AgentAdapter,
  DraftTicketState,
  ExecutionAttempt,
  ExecutionSession,
  Project,
  ReasoningEffort,
  RepositoryConfig,
  ReviewPackage,
  ReviewRun,
  StructuredEvent,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";
import type {
  DraftAnalysisMode,
  ExecutionMode,
  PromptContextSection,
} from "../execution-runtime/types.js";

export type AgentAdapterId = AgentAdapter;

export type PreparedAgentRun = {
  command: string;
  args: string[];
  prompt: string;
  outputPath: string | null;
  dockerSpec: null | {
    imageTag: string;
    dockerfilePath: string;
    homePath: string;
    configMountPath: string;
  };
};

export type InterpretedAdapterLine = {
  logLine: string;
  sessionRef?: string;
  outputContent?: string;
  /** Set only for ExitPlanMode tool_use blocks. Takes priority over
   *  outputContent when capturing plan summaries, so later assistant
   *  text messages cannot overwrite the actual plan. */
  planContent?: string;
};

export type DraftRunInput = {
  draft: DraftTicketState;
  mode: DraftAnalysisMode;
  instruction?: string;
  outputPath: string;
  project: Project;
  repository: RepositoryConfig;
  useDockerRuntime: boolean;
};

export type ExecutionRunInput = {
  executionMode: ExecutionMode;
  extraInstructions: PromptContextSection[];
  outputPath: string;
  planSummary: string | null;
  project: Project;
  repository: RepositoryConfig;
  session: ExecutionSession;
  ticket: TicketFrontmatter;
  useDockerRuntime: boolean;
};

export type MergeConflictRunInput = {
  conflictedFiles: string[];
  failureMessage: string;
  outputPath: string;
  project: Project;
  recoveryKind: "conflicts" | "target_branch_advanced";
  repository: RepositoryConfig;
  session: ExecutionSession;
  stage: "rebase" | "merge";
  targetBranch: string;
  ticket: TicketFrontmatter;
  useDockerRuntime: boolean;
};

export type ReviewRunInput = {
  outputPath: string;
  project: Project;
  repository: RepositoryConfig;
  reviewPackage: ReviewPackage;
  session: ExecutionSession;
  ticket: TicketFrontmatter;
  useDockerRuntime: boolean;
};

export type PullRequestBodyRunInput = {
  attempts: ExecutionAttempt[];
  baseBranch: string;
  headBranch: string;
  outputPath: string;
  patch: string;
  project: Project;
  repository: RepositoryConfig;
  reviewPackage: ReviewPackage;
  reviewRuns: ReviewRun[];
  session: ExecutionSession;
  sessionLogs: string[];
  ticket: TicketFrontmatter;
  ticketEvents: StructuredEvent[];
  useDockerRuntime: boolean;
};

export type PullRequestBodyResult = {
  body: string;
};

export interface AgentCliAdapter {
  readonly id: AgentAdapterId;
  readonly label: string;
  buildDraftRun(input: DraftRunInput): PreparedAgentRun;
  buildExecutionRun(input: ExecutionRunInput): PreparedAgentRun;
  buildMergeConflictRun(input: MergeConflictRunInput): PreparedAgentRun;
  buildReviewRun(input: ReviewRunInput): PreparedAgentRun;
  buildPullRequestBodyRun(input: PullRequestBodyRunInput): PreparedAgentRun;
  interpretOutputLine(line: string): InterpretedAdapterLine;
  parseDraftResult<T>(rawOutput: string, schema: z.ZodType<T>): T;
  formatExitReason(
    exitCode: number | null,
    signal: NodeJS.Signals | null,
    rawOutput: string,
  ): string;
  resolveModelSelection(
    project: Project,
    scope: "draft" | "ticket",
  ): {
    model: string | null;
    reasoningEffort: ReasoningEffort | null;
  };
}
