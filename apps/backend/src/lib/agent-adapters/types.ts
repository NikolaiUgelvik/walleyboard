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

export type HostSidecar = {
  command: string;
  args: string[];
  /** Extra environment variables for the sidecar process. */
  env?: Record<string, string>;
  /** Host to health-check (defaults to 127.0.0.1). */
  healthCheckHost?: string;
  /** Port to health-check before running the main command. */
  healthCheckPort: number;
  /** Max time in ms to wait for the health-check port to open. */
  healthCheckTimeoutMs?: number;
};

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
  /** Optional sidecar process to run on the host before executing the main command in Docker. */
  hostSidecar?: HostSidecar;
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
  /** Port for the host-side MCP sidecar (when using structured output). */
  mcpPort?: number;
  outputPath: string;
  project: Project;
  resultSchema: z.ZodType<unknown>;
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
  /** Port for the host-side MCP sidecar (when using structured output). */
  mcpPort?: number;
  outputPath: string;
  project: Project;
  repository: RepositoryConfig;
  resultSchema: z.ZodType<unknown>;
  reviewPackage: ReviewPackage;
  session: ExecutionSession;
  ticket: TicketFrontmatter;
  useDockerRuntime: boolean;
};

export type PullRequestBodyRunInput = {
  attempts: ExecutionAttempt[];
  baseBranch: string;
  headBranch: string;
  /** Port for the host-side MCP sidecar (when using structured output). */
  mcpPort?: number;
  outputPath: string;
  patch: string;
  project: Project;
  repository: RepositoryConfig;
  resultSchema: z.ZodType<unknown>;
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
