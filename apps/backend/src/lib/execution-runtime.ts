import {
  type ChildProcessWithoutNullStreams,
  execFileSync,
  spawn,
} from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";
import { nanoid } from "nanoid";
import { type IPty, spawn as spawnPty } from "node-pty";
import { z } from "zod";

import type {
  DraftTicketState,
  ExecutionSession,
  Project,
  ReasoningEffort,
  RepositoryConfig,
  StructuredEvent,
  TicketFrontmatter,
  ValidationCommand,
  ValidationResult,
} from "../../../../packages/contracts/src/index.js";
import { ticketTypeSchema } from "../../../../packages/contracts/src/index.js";

import type { DockerRuntimeManager } from "./docker-runtime.js";
import { preserveDraftArtifactImages } from "./draft-artifact-images.js";
import { type EventHub, makeProtocolEvent } from "./event-hub.js";
import type { Store } from "./store.js";
import { nowIso } from "./time.js";

type ExecutionRuntimeOptions = {
  dockerRuntime: DockerRuntimeManager;
  eventHub: EventHub;
  store: Store;
};

type StartExecutionInput = {
  project: Project;
  repository: RepositoryConfig;
  ticket: TicketFrontmatter;
  session: ExecutionSession;
  additionalInstruction?: string;
};

type DraftAnalysisInput = {
  draft: DraftTicketState;
  project: Project;
  repository: RepositoryConfig;
  instruction?: string | undefined;
};

type DraftAnalysisMode = "refine" | "questions";

type ManualTerminalStartInput = {
  sessionId: string;
  worktreePath: string;
  attemptId: string | null;
};

type ForwardedInputTarget = "agent" | "terminal";
type ExecutionMode = "plan" | "implementation";
type PromptContextSection = {
  label: string;
  content: string;
};

const draftRefinementResultSchema = z.object({
  title_draft: z.string().min(1),
  description_draft: z.string().min(1),
  proposed_ticket_type: ticketTypeSchema,
  proposed_acceptance_criteria: z.array(z.string().min(1)),
  split_proposal_summary: z.string().nullable().optional(),
});

const draftFeasibilityResultSchema = z.object({
  verdict: z.string().min(1),
  summary: z.string().min(1),
  assumptions: z.array(z.string().min(1)).default([]),
  open_questions: z.array(z.string().min(1)).default([]),
  risks: z.array(z.string().min(1)).default([]),
  suggested_draft_edits: z.array(z.string().min(1)).default([]),
});

type DraftRefinementResult = z.infer<typeof draftRefinementResultSchema>;
type DraftFeasibilityResult = z.infer<typeof draftFeasibilityResultSchema>;

const draftAnalysisTimeoutMs = 180_000;

function truncate(value: string, maxLength = 600): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}

function hasMeaningfulContent(
  value: string | null | undefined,
): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function formatMarkdownLog(label: string, body: string): string {
  return `${label}:\n${body}`;
}

function extractMarkdownLogBody(
  summary: string | null | undefined,
  label: string,
): string | null {
  if (!hasMeaningfulContent(summary)) {
    return null;
  }

  const prefix = `${label}:\n`;
  if (!summary.startsWith(prefix)) {
    return null;
  }

  const body = summary.slice(prefix.length).trim();
  return body.length > 0 ? body : null;
}

function extractPersistedAttemptGuidance(
  summary: string | null | undefined,
): string | null {
  return (
    extractMarkdownLogBody(summary, "Execution resume requested") ??
    extractMarkdownLogBody(summary, "Execution restart requested")
  );
}

function appendMarkdownSection(
  sections: string[],
  label: string,
  content: string | null | undefined,
): void {
  sections.push(`${label}:`, hasMeaningfulContent(content) ? content : "None.");
}

function appendCriteriaSections(
  sections: string[],
  criteria: string[],
  emptyFallback: string,
): void {
  sections.push("Acceptance criteria:");

  if (criteria.length === 0) {
    sections.push(emptyFallback);
    return;
  }

  for (const [index, criterion] of criteria.entries()) {
    sections.push(`Criterion ${index + 1}:`, criterion);
    if (index < criteria.length - 1) {
      sections.push("");
    }
  }
}

function appendContextSections(
  sections: string[],
  label: string,
  items: PromptContextSection[],
): void {
  if (items.length === 0) {
    return;
  }

  sections.push("", `${label}:`);
  for (const [index, item] of items.entries()) {
    sections.push(`${item.label}:`, item.content);
    if (index < items.length - 1) {
      sections.push("");
    }
  }
}

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

function normalizeOptionalModel(model: string | null): string | null {
  if (model === null) {
    return null;
  }

  const trimmed = model.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalReasoningEffort(
  effort: ReasoningEffort | null,
): ReasoningEffort | null {
  return effort ?? null;
}

function buildProcessEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => {
      return typeof entry[1] === "string";
    }),
  );
}

function runGit(repoPath: string, args: string[]): string {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function writeReviewDiff(
  project: Project,
  ticketId: number,
  diff: string,
): string {
  const reviewDir = join(
    process.cwd(),
    ".local",
    "review-packages",
    project.slug,
  );
  ensureDirectory(reviewDir);
  const diffPath = join(reviewDir, `ticket-${ticketId}.patch`);
  writeFileSync(diffPath, diff, "utf8");
  return diffPath;
}

function buildValidationLogPath(
  project: Project,
  ticketId: number,
  validationId: string,
): string {
  const validationDir = join(
    process.cwd(),
    ".local",
    "validation-logs",
    project.slug,
    `ticket-${ticketId}`,
  );
  ensureDirectory(validationDir);
  return join(validationDir, `${validationId}.log`);
}

function buildOutputSummaryPath(
  project: Project,
  ticketId: number,
  sessionId: string,
): string {
  const summaryDir = join(
    process.cwd(),
    ".local",
    "codex-summaries",
    project.slug,
  );
  ensureDirectory(summaryDir);
  return join(summaryDir, `ticket-${ticketId}-${sessionId}.txt`);
}

function buildWorkspaceOutputPath(
  worktreePath: string,
  sessionId: string,
  suffix = "summary",
): string {
  const outputDir = join(worktreePath, ".orchestrator");
  ensureDirectory(outputDir);
  return join(outputDir, `${sessionId}-${suffix}.txt`);
}

function buildMergeConflictSummaryPath(
  project: Project,
  ticketId: number,
  sessionId: string,
): string {
  const summaryDir = join(
    process.cwd(),
    ".local",
    "codex-summaries",
    project.slug,
  );
  ensureDirectory(summaryDir);
  return join(summaryDir, `ticket-${ticketId}-${sessionId}-merge-conflict.txt`);
}

function buildDraftAnalysisOutputPath(
  project: Project,
  draftId: string,
  runId: string,
  mode: DraftAnalysisMode,
): string {
  const analysisDir = join(
    process.cwd(),
    ".local",
    "draft-analyses",
    project.slug,
  );
  ensureDirectory(analysisDir);
  return join(analysisDir, `${draftId}-${mode}-${runId}.json`);
}

function appendCodexModelArgs(
  args: string[],
  options: {
    model: string | null;
    reasoningEffort: ReasoningEffort | null;
  },
): void {
  const model = normalizeOptionalModel(options.model);
  const reasoningEffort = normalizeOptionalReasoningEffort(
    options.reasoningEffort,
  );

  if (model) {
    args.push("--model", model);
  }

  if (reasoningEffort) {
    args.push("--config", `model_reasoning_effort="${reasoningEffort}"`);
  }
}

function appendCodexExecutionModeArgs(
  args: string[],
  executionMode: ExecutionMode,
): void {
  const sandboxMode =
    executionMode === "plan" ? "read-only" : "workspace-write";

  args.push("--config", 'approval_policy="on-request"');
  args.push("--config", `sandbox_mode="${sandboxMode}"`);
}

function appendDangerousDockerArgs(args: string[]): void {
  args.push("--dangerously-bypass-approvals-and-sandbox");
}

function buildCodexImplementationPrompt(
  ticket: TicketFrontmatter,
  repository: RepositoryConfig,
  extraInstructions: PromptContextSection[],
  approvedPlanSummary?: string | null,
): string {
  const sections = [
    `Implement ticket #${ticket.id} in the repository ${repository.name}.`,
    "",
  ];

  appendMarkdownSection(sections, "Title", ticket.title);
  sections.push("");
  appendMarkdownSection(sections, "Description", ticket.description);
  sections.push("");
  appendCriteriaSections(
    sections,
    ticket.acceptance_criteria,
    "Preserve the intended user workflow and keep the change small and focused.",
  );
  sections.push(
    "",
    "Execution rules:",
    "- Make the smallest complete change that satisfies the ticket.",
    "- Stay inside this repository worktree.",
    "- Run lightweight validation when it is obvious and inexpensive.",
    "- Create a git commit before finishing if you made code changes.",
    "- End with a concise summary that includes changed files, validation run, and remaining risks.",
  );

  if (hasMeaningfulContent(approvedPlanSummary)) {
    sections.push("");
    appendMarkdownSection(sections, "Approved plan", approvedPlanSummary);
  }

  appendContextSections(sections, "Additional context", extraInstructions);

  return sections.join("\n");
}

function buildCodexPlanPrompt(
  ticket: TicketFrontmatter,
  repository: RepositoryConfig,
  extraInstructions: PromptContextSection[],
): string {
  const sections = [
    `Plan ticket #${ticket.id} in the repository ${repository.name}.`,
    "",
  ];

  appendMarkdownSection(sections, "Title", ticket.title);
  sections.push("");
  appendMarkdownSection(sections, "Description", ticket.description);
  sections.push("");
  appendCriteriaSections(
    sections,
    ticket.acceptance_criteria,
    "Preserve the intended user workflow and keep the change small and focused.",
  );
  sections.push(
    "",
    "Execution rules:",
    "- Stay inside this repository worktree.",
    "- Read files and inspect the repository as needed.",
    "- Do not modify files, create commits, or run write operations.",
    "- Return a concise implementation plan only.",
    "- End with a short plan summary that the user can approve or revise.",
  );
  appendContextSections(sections, "Additional context", extraInstructions);

  return sections.join("\n");
}

function buildMergeConflictResolutionPrompt(input: {
  ticket: TicketFrontmatter;
  repository: RepositoryConfig;
  targetBranch: string;
  stage: "rebase" | "merge";
  conflictedFiles: string[];
  failureMessage: string;
}): string {
  const sections = [
    `Resolve the active git ${input.stage} conflicts for ticket #${input.ticket.id} in repository ${input.repository.name}.`,
    "You are running inside the existing ticket worktree and must preserve the ticket's intended scope.",
    "",
  ];

  appendMarkdownSection(sections, "Title", input.ticket.title);
  sections.push("");
  appendMarkdownSection(sections, "Description", input.ticket.description);
  sections.push("");
  appendCriteriaSections(
    sections,
    input.ticket.acceptance_criteria,
    "Preserve the ticket intent while resolving the git conflicts.",
  );
  sections.push("");
  appendMarkdownSection(sections, "Target branch", input.targetBranch);
  sections.push("");
  appendMarkdownSection(sections, "Conflict stage", input.stage);
  sections.push("");
  appendMarkdownSection(
    sections,
    "Conflicted files",
    input.conflictedFiles.length > 0
      ? input.conflictedFiles.join("\n")
      : "Git did not report individual conflicted files.",
  );
  sections.push("");
  appendMarkdownSection(sections, "Git failure", input.failureMessage);
  sections.push(
    "",
    "Requirements:",
    "- Stay inside this repository worktree.",
    "- Make the smallest safe conflict resolution that keeps the ticket intent and the latest target-branch behavior.",
    "- If a rebase is in progress, resolve conflicts, stage the files, and run `git rebase --continue` until the rebase finishes.",
    "- If a merge is in progress, resolve conflicts, stage the files, and finish the merge.",
    "- Do not abort the rebase or merge unless it is impossible to resolve safely.",
    "- Do not open a PR or change ticket metadata.",
    "- End with a concise summary stating whether the git operation finished cleanly.",
  );

  return sections.join("\n");
}

function buildDraftRefinementPrompt(
  draft: DraftTicketState,
  repository: RepositoryConfig,
  instruction?: string,
): string {
  const sections = [
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
  sections.push("");
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

function buildDraftQuestionsPrompt(
  draft: DraftTicketState,
  repository: RepositoryConfig,
  instruction?: string,
): string {
  const sections = [
    `Assess feasibility for the draft ticket inside repository ${repository.name}.`,
    "Read repository context as needed, but do not modify any files.",
    "Return JSON only with no markdown fences or commentary.",
    "",
    "Draft under review:",
  ];

  appendMarkdownSection(sections, "title_draft", draft.title_draft);
  sections.push("");
  appendMarkdownSection(sections, "description_draft", draft.description_draft);
  sections.push("");
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

function parseCodexJsonResult<T>(rawOutput: string, schema: z.ZodType<T>): T {
  const trimmed = rawOutput.trim();
  if (trimmed.length === 0) {
    throw new Error("Codex returned no JSON output.");
  }

  const candidates = [trimmed];
  if (trimmed.startsWith("```")) {
    candidates.push(
      trimmed
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```$/i, "")
        .trim(),
    );
  }

  for (const candidate of candidates) {
    try {
      return schema.parse(JSON.parse(candidate));
    } catch {
      // Try the next candidate shape.
    }
  }

  throw new Error("Codex did not return valid JSON output.");
}

function summarizeDraftRefinement(result: DraftRefinementResult): string {
  if (
    result.split_proposal_summary &&
    result.split_proposal_summary.trim().length > 0
  ) {
    return truncate(result.split_proposal_summary.trim(), 240);
  }

  return `Updated draft proposal with ${result.proposed_acceptance_criteria.length} acceptance criteria.`;
}

function summarizeDraftQuestions(result: DraftFeasibilityResult): string {
  return truncate(result.summary, 240);
}

function formatDraftAnalysisExitReason(
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  rawOutput: string,
): string {
  const summary =
    rawOutput.trim().length > 0
      ? ` Final output: ${truncate(rawOutput.trim(), 240)}`
      : "";
  return `Codex exited with ${exitCode === null ? "unknown code" : `code ${exitCode}`}${
    signal ? ` and signal ${signal}` : ""
  }.${summary}`;
}

function formatCodexExitReason(
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  rawOutput: string,
): string {
  const summary =
    rawOutput.trim().length > 0
      ? ` Final output: ${truncate(rawOutput.trim(), 240)}`
      : "";
  return `Codex exited with ${exitCode === null ? "unknown code" : `code ${exitCode}`}${
    signal ? ` and signal ${signal}` : ""
  }.${summary}`;
}

function summarizeCodexJsonLine(line: string): string {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const payload =
      parsed.payload && typeof parsed.payload === "object"
        ? (parsed.payload as Record<string, unknown>)
        : null;

    if (
      parsed.type === "session_meta" &&
      payload &&
      typeof payload.id === "string"
    ) {
      return `[codex session] ${payload.id}`;
    }

    const eventType =
      typeof parsed.type === "string"
        ? parsed.type
        : typeof parsed.event === "string"
          ? parsed.event
          : "event";

    if (typeof parsed.message === "string") {
      return `[codex ${eventType}] ${truncate(parsed.message)}`;
    }

    if (typeof parsed.text === "string") {
      return `[codex ${eventType}] ${truncate(parsed.text)}`;
    }

    if (typeof parsed.output === "string") {
      return `[codex ${eventType}] ${truncate(parsed.output)}`;
    }

    return `[codex ${eventType}] ${truncate(JSON.stringify(parsed))}`;
  } catch {
    return `[codex raw] ${truncate(line)}`;
  }
}

function extractCodexSessionIdFromJsonLine(line: string): string | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const payload =
      parsed.payload && typeof parsed.payload === "object"
        ? (parsed.payload as Record<string, unknown>)
        : null;

    if (
      parsed.type === "session_meta" &&
      payload &&
      typeof payload.id === "string"
    ) {
      return payload.id;
    }

    if (typeof parsed.session_id === "string") {
      return parsed.session_id;
    }

    if (payload && typeof payload.session_id === "string") {
      return payload.session_id;
    }

    const thread =
      payload?.thread && typeof payload.thread === "object"
        ? (payload.thread as Record<string, unknown>)
        : null;
    if (thread && typeof thread.id === "string") {
      return thread.id;
    }
  } catch {
    return null;
  }

  return null;
}

function streamLines(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
): void {
  const lineReader = readline.createInterface({
    input: stream,
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  lineReader.on("line", onLine);
}

function resolveValidationWorkingDirectory(
  command: ValidationCommand,
  repository: RepositoryConfig,
  worktreePath: string,
): string {
  if (command.working_directory === repository.path) {
    return worktreePath;
  }

  if (command.working_directory.startsWith(`${repository.path}/`)) {
    return command.working_directory.replace(repository.path, worktreePath);
  }

  return worktreePath;
}

export class ExecutionRuntime {
  readonly #dockerRuntime: DockerRuntimeManager;
  readonly #eventHub: EventHub;
  readonly #store: Store;
  readonly #activeSessions = new Map<string, IPty>();
  readonly #activeDraftRuns = new Map<string, ChildProcessWithoutNullStreams>();
  readonly #manualTerminals = new Map<
    string,
    {
      pty: IPty;
      attemptId: string | null;
    }
  >();
  readonly #stoppingSessions = new Map<string, string>();
  readonly #stoppingManualTerminals = new Map<string, string>();
  readonly #exitWaiters = new Map<string, Set<(didExit: boolean) => void>>();
  readonly #manualExitWaiters = new Map<
    string,
    Set<(didExit: boolean) => void>
  >();

  constructor({ dockerRuntime, eventHub, store }: ExecutionRuntimeOptions) {
    this.#dockerRuntime = dockerRuntime;
    this.#eventHub = eventHub;
    this.#store = store;
  }

  assertProjectExecutionBackendAvailable(project: Project): void {
    if (project.execution_backend !== "docker") {
      return;
    }

    this.#dockerRuntime.assertAvailable();
  }

  cleanupExecutionEnvironment(sessionId: string): void {
    this.#dockerRuntime.cleanupSessionContainer(sessionId);
  }

  dispose(): void {
    this.#dockerRuntime.dispose();
  }

  async stopExecution(
    sessionId: string,
    reason = "Execution stopped by user.",
    timeoutMs = 1_500,
  ): Promise<boolean> {
    const child = this.#activeSessions.get(sessionId);
    if (!child) {
      this.cleanupExecutionEnvironment(sessionId);
      return false;
    }

    this.#stoppingSessions.set(sessionId, reason);
    child.kill("SIGTERM");

    const exitedAfterTerm = await this.#waitForSessionExit(
      sessionId,
      timeoutMs,
    );
    if (exitedAfterTerm) {
      return true;
    }

    child.kill("SIGKILL");
    return this.#waitForSessionExit(sessionId, 1_000);
  }

  hasActiveExecution(sessionId: string): boolean {
    return this.#activeSessions.has(sessionId);
  }

  hasActiveDraftRun(draftId: string): boolean {
    return this.#activeDraftRuns.has(draftId);
  }

  hasManualTerminal(sessionId: string): boolean {
    return this.#manualTerminals.has(sessionId);
  }

  startQueuedSessions(projectId: string): void {
    while (true) {
      const session = this.#store.claimNextQueuedSession(projectId);
      if (!session) {
        return;
      }

      const ticket = this.#store.getTicket(session.ticket_id);
      const project = ticket
        ? this.#store.getProject(ticket.project)
        : undefined;
      const repository = ticket
        ? this.#store.getRepository(ticket.repo)
        : undefined;
      const attemptId = session.current_attempt_id;

      if (!ticket || !project || !repository || !attemptId) {
        const reason =
          "Queued execution could not start because required session metadata was missing.";

        if (attemptId) {
          this.#store.updateExecutionAttempt(attemptId, {
            status: "failed",
            end_reason: reason,
          });
          this.#log(session.id, attemptId, `[runtime failure] ${reason}`);
        }

        const failedSession = this.#store.completeSession(session.id, {
          status: "failed",
          last_summary: reason,
        });
        this.#emitSessionUpdated(failedSession);
        continue;
      }

      this.#log(
        session.id,
        attemptId,
        "A project execution slot opened. Launching this queued session.",
      );
      this.#emitSessionUpdated(session);

      try {
        this.startExecution({
          project,
          repository,
          ticket,
          session,
        });
      } catch (error) {
        const reason =
          error instanceof Error
            ? `Queued execution failed to start: ${error.message}`
            : "Queued execution failed to start.";

        this.#store.updateExecutionAttempt(attemptId, {
          status: "failed",
          end_reason: reason,
        });
        const failedSession = this.#store.completeSession(session.id, {
          status: "failed",
          last_summary: reason,
        });
        this.#log(session.id, attemptId, `[runtime failure] ${reason}`);
        this.#emitSessionUpdated(failedSession);
      }
    }
  }

  runDraftRefinement({
    draft,
    project,
    repository,
    instruction,
  }: DraftAnalysisInput): void {
    this.#startDraftAnalysis({
      mode: "refine",
      draft,
      project,
      repository,
      instruction,
    });
  }

  runDraftFeasibility({
    draft,
    project,
    repository,
    instruction,
  }: DraftAnalysisInput): void {
    this.#startDraftAnalysis({
      mode: "questions",
      draft,
      project,
      repository,
      instruction,
    });
  }

  async resolveMergeConflicts(input: {
    project: Project;
    repository: RepositoryConfig;
    ticket: TicketFrontmatter;
    session: ExecutionSession;
    targetBranch: string;
    stage: "rebase" | "merge";
    conflictedFiles: string[];
    failureMessage: string;
  }): Promise<{
    resolved: boolean;
    logs: string[];
    note?: string;
  }> {
    const worktreePath = input.session.worktree_path;
    if (!worktreePath) {
      throw new Error("Execution session has no prepared worktree");
    }

    const useDockerRuntime = input.project.execution_backend === "docker";
    const outputSummaryPath = useDockerRuntime
      ? buildWorkspaceOutputPath(
          worktreePath,
          input.session.id,
          "merge-conflict",
        )
      : buildMergeConflictSummaryPath(
          input.project,
          input.ticket.id,
          input.session.id,
        );
    const prompt = buildMergeConflictResolutionPrompt({
      ticket: input.ticket,
      repository: input.repository,
      targetBranch: input.targetBranch,
      stage: input.stage,
      conflictedFiles: input.conflictedFiles,
      failureMessage: input.failureMessage,
    });
    const args = ["exec", "--json", "--output-last-message", outputSummaryPath];
    if (useDockerRuntime) {
      appendDangerousDockerArgs(args);
    } else {
      args.push("--full-auto");
    }
    const model = normalizeOptionalModel(input.project.ticket_work_model);
    const reasoningEffort = normalizeOptionalReasoningEffort(
      input.project.ticket_work_reasoning_effort,
    );
    appendCodexModelArgs(args, {
      model,
      reasoningEffort,
    });
    args.push(prompt);

    const logs = [
      `Launching Codex merge-conflict resolution in ${input.session.worktree_path}`,
      `Command: codex ${args.slice(0, -1).join(" ")} <prompt>`,
    ];
    if (model) {
      logs.push(`Model override: ${model}`);
    }
    if (reasoningEffort) {
      logs.push(`Reasoning effort override: ${reasoningEffort}`);
    }

    const ptyEnv = buildProcessEnv();
    writeFileSync(outputSummaryPath, "", "utf8");

    return await new Promise((resolve) => {
      let settled = false;
      let codexOutput = "";

      const finish = (result: {
        resolved: boolean;
        logs: string[];
        note?: string;
      }) => {
        if (settled) {
          return;
        }
        settled = true;
        if (useDockerRuntime) {
          this.cleanupExecutionEnvironment(input.session.id);
        }
        resolve(result);
      };

      let child: ChildProcessWithoutNullStreams;
      try {
        if (useDockerRuntime) {
          this.#dockerRuntime.ensureSessionContainer({
            sessionId: input.session.id,
            projectId: input.project.id,
            ticketId: input.ticket.id,
            worktreePath,
          });
          child = this.#dockerRuntime.spawnProcessInSession(
            input.session.id,
            "codex",
            args,
            {
              cwd: worktreePath,
              env: ptyEnv,
            },
          );
        } else {
          child = spawn("codex", args, {
            cwd: worktreePath,
            env: ptyEnv,
          });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Codex failed to start";
        finish({
          resolved: false,
          logs,
          note: `Codex could not start while resolving ${input.stage} conflicts: ${message}`,
        });
        return;
      }

      const captureCodexLine = (line: string) => {
        if (logs.length < 16) {
          logs.push(summarizeCodexJsonLine(line));
        }
        codexOutput += `${line}\n`;
      };

      streamLines(child.stdout, captureCodexLine);
      streamLines(child.stderr, (line) => {
        if (logs.length < 16) {
          logs.push(`[codex stderr] ${truncate(line)}`);
        }
        codexOutput += `${line}\n`;
      });

      child.once("error", (error) => {
        const message =
          error instanceof Error ? error.message : "Codex execution failed";
        finish({
          resolved: false,
          logs,
          note: `Codex execution failed while resolving ${input.stage} conflicts: ${message}`,
        });
      });

      child.once("close", (exitCode, signal) => {
        const summary = existsSync(outputSummaryPath)
          ? readFileSync(outputSummaryPath, "utf8").trim()
          : "";
        if (summary.length > 0) {
          logs.push(`Merge-conflict resolution summary: ${truncate(summary)}`);
        }

        if (exitCode === 0) {
          finish({
            resolved: true,
            logs,
          });
          return;
        }

        const reason = formatCodexExitReason(
          exitCode,
          signal,
          summary || codexOutput,
        );
        finish({
          resolved: false,
          logs,
          note: `Codex could not finish resolving the ${input.stage} conflicts. ${reason}`,
        });
      });
    });
  }

  startManualTerminal({
    sessionId,
    worktreePath,
    attemptId,
  }: ManualTerminalStartInput): void {
    if (this.#manualTerminals.has(sessionId)) {
      return;
    }

    let child: IPty;

    try {
      child = spawnPty("bash", ["--noprofile", "--norc"], {
        cwd: worktreePath,
        env: {
          ...buildProcessEnv(),
          TERM: "dumb",
        },
        cols: 120,
        rows: 32,
        name: "xterm-256color",
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Manual terminal failed to start";
      throw new Error(message);
    }

    const logAttemptId =
      attemptId ??
      this.#store.getSession(sessionId)?.current_attempt_id ??
      sessionId;
    this.#manualTerminals.set(sessionId, {
      pty: child,
      attemptId,
    });
    this.#log(
      sessionId,
      logAttemptId,
      `Manual terminal opened in ${worktreePath}`,
    );

    let pendingBuffer = "";

    child.onData((chunk) => {
      pendingBuffer += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

      while (pendingBuffer.includes("\n")) {
        const newlineIndex = pendingBuffer.indexOf("\n");
        const line = pendingBuffer.slice(0, newlineIndex);
        pendingBuffer = pendingBuffer.slice(newlineIndex + 1);
        if (line.length > 0) {
          this.#log(sessionId, logAttemptId, `[terminal] ${line}`);
        }
      }
    });

    child.onExit(() => {
      if (pendingBuffer.trim().length > 0) {
        this.#log(
          sessionId,
          logAttemptId,
          `[terminal] ${pendingBuffer.trim()}`,
        );
        pendingBuffer = "";
      }

      this.#stoppingManualTerminals.delete(sessionId);
      this.#manualTerminals.delete(sessionId);
      this.#log(sessionId, logAttemptId, "Manual terminal closed.");
      this.#resolveManualTerminalExitWaiters(sessionId, true);
    });
  }

  async stopManualTerminal(
    sessionId: string,
    timeoutMs = 1_500,
  ): Promise<boolean> {
    const terminal = this.#manualTerminals.get(sessionId);
    if (!terminal) {
      return false;
    }

    this.#stoppingManualTerminals.set(sessionId, "terminal_restore");
    terminal.pty.kill("SIGTERM");

    const exitedAfterTerm = await this.#waitForManualTerminalExit(
      sessionId,
      timeoutMs,
    );
    if (exitedAfterTerm) {
      return true;
    }

    terminal.pty.kill("SIGKILL");
    return this.#waitForManualTerminalExit(sessionId, 1_000);
  }

  forwardInput(sessionId: string, body: string): ForwardedInputTarget | null {
    if (!hasMeaningfulContent(body)) {
      return null;
    }

    const manualTerminal = this.#manualTerminals.get(sessionId);
    if (manualTerminal) {
      manualTerminal.pty.write(`${body}\r`);
      this.#log(
        sessionId,
        manualTerminal.attemptId ??
          this.#store.getSession(sessionId)?.current_attempt_id ??
          sessionId,
        `[terminal input] ${body}`,
      );
      return "terminal";
    }

    const agentSession = this.#activeSessions.get(sessionId);
    if (!agentSession) {
      return null;
    }

    const attemptId =
      this.#store.getSession(sessionId)?.current_attempt_id ?? sessionId;
    agentSession.write(`${body}\r`);
    this.#log(sessionId, attemptId, `[agent input]\n${body}`);
    return "agent";
  }

  #startDraftAnalysis({
    mode,
    draft,
    project,
    repository,
    instruction,
  }: DraftAnalysisInput & { mode: DraftAnalysisMode }): void {
    if (this.#activeDraftRuns.has(draft.id)) {
      throw new Error("Draft analysis already running");
    }

    const runId = nanoid();
    const startedEvent = this.#store.recordDraftEvent(
      draft.id,
      `draft.${mode}.started`,
      {
        run_id: runId,
        operation: mode,
        status: "started",
        repository_id: repository.id,
        repository_name: repository.name,
        instruction: hasMeaningfulContent(instruction) ? instruction : null,
        summary:
          mode === "refine"
            ? `Codex is refining this draft in ${repository.name}.`
            : `Codex is checking draft feasibility in ${repository.name}.`,
      },
    );
    this.#emitStructuredEvent(startedEvent);

    const prompt =
      mode === "refine"
        ? buildDraftRefinementPrompt(draft, repository, instruction)
        : buildDraftQuestionsPrompt(draft, repository, instruction);
    const outputPath = buildDraftAnalysisOutputPath(
      project,
      draft.id,
      runId,
      mode,
    );
    const child = spawn(
      "codex",
      (() => {
        const model = normalizeOptionalModel(project.draft_analysis_model);
        const reasoningEffort = normalizeOptionalReasoningEffort(
          project.draft_analysis_reasoning_effort,
        );
        const args = [
          "exec",
          "--json",
          "--full-auto",
          "--output-last-message",
          outputPath,
        ];

        appendCodexModelArgs(args, {
          model,
          reasoningEffort,
        });
        args.push(prompt);
        return args;
      })(),
      {
        cwd: repository.path,
        env: buildProcessEnv(),
      },
    );
    child.stdin.end();

    this.#activeDraftRuns.set(draft.id, child);

    let finalized = false;
    const capturedOutput: string[] = [];
    const captureLine = (line: string) => {
      const normalized = line.trim();
      if (normalized.length === 0) {
        return;
      }

      capturedOutput.push(truncate(normalized, 400));
      if (capturedOutput.length > 40) {
        capturedOutput.shift();
      }
    };

    streamLines(child.stdout, (line) => {
      captureLine(summarizeCodexJsonLine(line));
    });
    streamLines(child.stderr, (line) => {
      captureLine(`[stderr] ${line}`);
    });

    const failRun = (reason: string): void => {
      if (finalized) {
        return;
      }

      finalized = true;
      this.#activeDraftRuns.delete(draft.id);
      const failedEvent = this.#store.recordDraftEvent(
        draft.id,
        `draft.${mode}.failed`,
        {
          run_id: runId,
          operation: mode,
          status: "failed",
          repository_id: repository.id,
          repository_name: repository.name,
          summary: reason,
          error: reason,
          captured_output: capturedOutput,
        },
      );
      this.#emitStructuredEvent(failedEvent);
    };

    const timeoutId = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!finalized) {
          child.kill("SIGKILL");
        }
      }, 1_000);
      failRun(
        `Codex ${mode === "refine" ? "refinement" : "feasibility"} timed out after ${Math.round(
          draftAnalysisTimeoutMs / 1_000,
        )} seconds.`,
      );
    }, draftAnalysisTimeoutMs);

    child.once("error", (error) => {
      clearTimeout(timeoutId);
      const message =
        error instanceof Error ? error.message : "Codex failed to start";
      failRun(`Codex failed to start: ${message}`);
    });

    child.once("close", (exitCode, signal) => {
      clearTimeout(timeoutId);
      if (finalized) {
        return;
      }

      const rawOutput = existsSync(outputPath)
        ? readFileSync(outputPath, "utf8").trim()
        : "";

      if (exitCode !== 0) {
        failRun(formatDraftAnalysisExitReason(exitCode, signal, rawOutput));
        return;
      }

      try {
        if (mode === "refine") {
          const beforeDraft = this.#store.getDraft(draft.id);
          const result = parseCodexJsonResult(
            rawOutput,
            draftRefinementResultSchema,
          );
          const refinedDescription = preserveDraftArtifactImages({
            projectId: project.id,
            artifactScopeId: draft.artifact_scope_id,
            originalDescription: draft.description_draft,
            refinedDescription: result.description_draft,
          });
          const finalResult: DraftRefinementResult = {
            ...result,
            description_draft: refinedDescription,
          };
          const updatedDraft = this.#store.updateDraft(draft.id, {
            title_draft: finalResult.title_draft,
            description_draft: finalResult.description_draft,
            proposed_ticket_type: finalResult.proposed_ticket_type,
            proposed_acceptance_criteria:
              finalResult.proposed_acceptance_criteria,
            split_proposal_summary: finalResult.split_proposal_summary ?? null,
            wizard_status: "awaiting_confirmation",
          });

          finalized = true;
          this.#activeDraftRuns.delete(draft.id);
          const completedEvent = this.#store.recordDraftEvent(
            draft.id,
            "draft.refine.completed",
            {
              run_id: runId,
              operation: mode,
              status: "completed",
              repository_id: repository.id,
              repository_name: repository.name,
              summary: summarizeDraftRefinement(finalResult),
              before_draft: beforeDraft ?? null,
              after_draft: updatedDraft,
              result: finalResult,
            },
          );
          this.#emitStructuredEvent(completedEvent);
          this.#emitDraftUpdated(updatedDraft);
          return;
        }

        const result = parseCodexJsonResult(
          rawOutput,
          draftFeasibilityResultSchema,
        );
        finalized = true;
        this.#activeDraftRuns.delete(draft.id);
        const completedEvent = this.#store.recordDraftEvent(
          draft.id,
          "draft.questions.completed",
          {
            run_id: runId,
            operation: mode,
            status: "completed",
            repository_id: repository.id,
            repository_name: repository.name,
            summary: summarizeDraftQuestions(result),
            result,
          },
        );
        this.#emitStructuredEvent(completedEvent);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to process Codex output";
        failRun(message);
      }
    });
  }

  startExecution({
    project,
    repository,
    ticket,
    session,
    additionalInstruction,
  }: StartExecutionInput): void {
    if (session.status === "queued") {
      return;
    }
    if (!session.worktree_path) {
      throw new Error("Execution session has no worktree path");
    }
    if (this.#activeSessions.has(session.id)) {
      throw new Error("Execution session is already running");
    }

    const attemptId = session.current_attempt_id;
    if (!attemptId) {
      throw new Error("Execution session has no current attempt");
    }

    const extraInstructions: PromptContextSection[] = [];
    const persistedResumeGuidance = hasMeaningfulContent(additionalInstruction)
      ? null
      : extractPersistedAttemptGuidance(session.last_summary);
    const requestedChangeNote = session.latest_requested_change_note_id
      ? this.#store.getRequestedChangeNote(
          session.latest_requested_change_note_id,
        )
      : undefined;
    if (requestedChangeNote) {
      extraInstructions.push({
        label: "Latest requested changes",
        content: requestedChangeNote.body,
      });
    }
    if (hasMeaningfulContent(additionalInstruction)) {
      extraInstructions.push({
        label: "Resume guidance",
        content: additionalInstruction,
      });
    } else if (persistedResumeGuidance) {
      extraInstructions.push({
        label: "Resume guidance",
        content: persistedResumeGuidance,
      });
    }

    const executionMode: ExecutionMode =
      session.planning_enabled && session.plan_status !== "approved"
        ? "plan"
        : "implementation";
    const prompt =
      executionMode === "plan"
        ? buildCodexPlanPrompt(ticket, repository, extraInstructions)
        : buildCodexImplementationPrompt(
            ticket,
            repository,
            extraInstructions,
            session.plan_summary,
          );
    const useDockerRuntime = project.execution_backend === "docker";
    const outputSummaryPath = useDockerRuntime
      ? buildWorkspaceOutputPath(session.worktree_path, session.id)
      : buildOutputSummaryPath(project, ticket.id, session.id);
    const codexSessionId = hasMeaningfulContent(session.codex_session_id)
      ? session.codex_session_id
      : null;
    const shouldResumeCodex = codexSessionId !== null;
    const args = shouldResumeCodex
      ? ["exec", "resume", "--json"]
      : ["exec", "--json"];
    if (useDockerRuntime) {
      appendDangerousDockerArgs(args);
    } else {
      appendCodexExecutionModeArgs(args, executionMode);
    }
    args.push("--output-last-message", outputSummaryPath);
    const model = normalizeOptionalModel(project.ticket_work_model);
    const reasoningEffort = normalizeOptionalReasoningEffort(
      project.ticket_work_reasoning_effort,
    );
    appendCodexModelArgs(args, {
      model,
      reasoningEffort,
    });
    if (codexSessionId) {
      args.push(codexSessionId);
    }
    args.push(prompt);

    const ptyEnv = buildProcessEnv();
    let child: IPty;

    try {
      if (useDockerRuntime) {
        this.#dockerRuntime.ensureSessionContainer({
          sessionId: session.id,
          projectId: project.id,
          ticketId: ticket.id,
          worktreePath: session.worktree_path,
        });
        child = this.#dockerRuntime.spawnPtyInSession(
          session.id,
          "codex",
          args,
          {
            cwd: session.worktree_path,
            env: ptyEnv,
            cols: 120,
            rows: 32,
            name: "xterm-256color",
          },
        );
      } else {
        child = spawnPty("codex", args, {
          cwd: session.worktree_path,
          env: ptyEnv,
          cols: 120,
          rows: 32,
          name: "xterm-256color",
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Codex PTY failed to start";
      this.cleanupExecutionEnvironment(session.id);
      this.#finishFailure({
        ticket,
        sessionId: session.id,
        attemptId,
        reason: `Codex failed to start: ${message}`,
      });
      return;
    }

    this.#activeSessions.set(session.id, child);
    this.#store.updateExecutionAttempt(attemptId, {
      status: "running",
      pty_pid: child.pid ?? null,
    });
    const runningSession = this.#store.updateSessionStatus(
      session.id,
      "running",
      "Codex execution is running inside the prepared worktree.",
    );
    this.#emitSessionUpdated(runningSession);
    this.#log(
      session.id,
      attemptId,
      useDockerRuntime
        ? `Launching Codex in Docker for ${session.worktree_path}`
        : `Launching Codex in ${session.worktree_path}`,
    );
    this.#log(
      session.id,
      attemptId,
      `Command: codex ${args.slice(0, -1).join(" ")} <prompt>`,
    );
    if (shouldResumeCodex) {
      this.#log(
        session.id,
        attemptId,
        `Resuming Codex session: ${codexSessionId}`,
      );
    }
    if (model) {
      this.#log(session.id, attemptId, `Model override: ${model}`);
    }
    if (reasoningEffort) {
      this.#log(
        session.id,
        attemptId,
        `Reasoning effort override: ${reasoningEffort}`,
      );
    }
    if (session.planning_enabled) {
      this.#log(
        session.id,
        attemptId,
        executionMode === "plan"
          ? "Planning mode enabled: Codex will outline a plan before editing."
          : "Approved plan confirmed: Codex will now implement the ticket.",
      );
    }
    if (requestedChangeNote) {
      this.#log(
        session.id,
        attemptId,
        formatMarkdownLog("Latest requested changes", requestedChangeNote.body),
      );
    }
    if (hasMeaningfulContent(additionalInstruction)) {
      this.#log(
        session.id,
        attemptId,
        formatMarkdownLog("Resume guidance", additionalInstruction),
      );
    } else if (persistedResumeGuidance) {
      this.#log(
        session.id,
        attemptId,
        formatMarkdownLog("Resume guidance", persistedResumeGuidance),
      );
    }

    let pendingBuffer = "";
    let activeCodexSessionId = codexSessionId;

    const persistCodexSessionId = (line: string) => {
      const discoveredSessionId = extractCodexSessionIdFromJsonLine(line);
      if (!hasMeaningfulContent(discoveredSessionId)) {
        return;
      }
      if (discoveredSessionId === activeCodexSessionId) {
        return;
      }

      const previousSessionId = activeCodexSessionId;
      activeCodexSessionId = discoveredSessionId;

      const updatedSession = this.#store.updateSessionCodexSessionId(
        session.id,
        discoveredSessionId,
      );
      if (updatedSession) {
        this.#emitSessionUpdated(updatedSession);
      }

      this.#log(
        session.id,
        attemptId,
        previousSessionId
          ? `Codex session updated: ${previousSessionId} -> ${discoveredSessionId}`
          : `Codex session attached: ${discoveredSessionId}`,
      );
    };

    child.onData((chunk) => {
      pendingBuffer += chunk.replace(/\r\n/g, "\n");

      while (pendingBuffer.includes("\n")) {
        const newlineIndex = pendingBuffer.indexOf("\n");
        const line = pendingBuffer.slice(0, newlineIndex);
        pendingBuffer = pendingBuffer.slice(newlineIndex + 1);
        persistCodexSessionId(line);
        this.#log(session.id, attemptId, summarizeCodexJsonLine(line));
      }
    });

    child.onExit(async ({ exitCode, signal }) => {
      const stopReason = this.#stoppingSessions.get(session.id);
      if (stopReason) {
        this.#stoppingSessions.delete(session.id);
        this.#activeSessions.delete(session.id);
        this.cleanupExecutionEnvironment(session.id);
        this.#resolveExitWaiters(session.id, true);
        return;
      }

      if (pendingBuffer.trim().length > 0) {
        persistCodexSessionId(pendingBuffer);
        this.#log(session.id, attemptId, summarizeCodexJsonLine(pendingBuffer));
        pendingBuffer = "";
      }

      const finalSummary = existsSync(outputSummaryPath)
        ? readFileSync(outputSummaryPath, "utf8").trim()
        : null;
      this.cleanupExecutionEnvironment(session.id);

      if (exitCode === 0) {
        const summary =
          finalSummary && finalSummary.length > 0
            ? finalSummary
            : executionMode === "plan"
              ? "Codex finished planning, but no plan summary was captured."
              : "Codex finished successfully, but no final summary was captured.";

        if (executionMode === "plan") {
          this.#finishPlanSuccess({
            projectId: ticket.project,
            sessionId: session.id,
            attemptId,
            summary,
          });
        } else {
          await this.#finishSuccess({
            project,
            repository,
            ticketId: ticket.id,
            sessionId: session.id,
            attemptId,
            targetBranch: ticket.target_branch,
            summary,
          });
        }
        this.#resolveExitWaiters(session.id, true);
        return;
      }

      this.#finishFailure({
        ticket,
        sessionId: session.id,
        attemptId,
        reason: `Codex exited with ${exitCode === undefined ? "unknown code" : `code ${exitCode}`}${
          signal ? ` and signal ${signal}` : ""
        }.${finalSummary ? ` Final summary: ${finalSummary}` : ""}`,
      });
      this.#resolveExitWaiters(session.id, true);
    });
  }

  #waitForSessionExit(sessionId: string, timeoutMs: number): Promise<boolean> {
    if (!this.#activeSessions.has(sessionId)) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      const resolver = (didExit: boolean) => {
        clearTimeout(timeoutId);
        const waiters = this.#exitWaiters.get(sessionId);
        waiters?.delete(resolver);
        if (waiters && waiters.size === 0) {
          this.#exitWaiters.delete(sessionId);
        }
        resolve(didExit);
      };

      const waiters = this.#exitWaiters.get(sessionId) ?? new Set();
      waiters.add(resolver);
      this.#exitWaiters.set(sessionId, waiters);

      const timeoutId = setTimeout(() => {
        resolver(false);
      }, timeoutMs);
    });
  }

  #resolveExitWaiters(sessionId: string, didExit: boolean): void {
    const waiters = this.#exitWaiters.get(sessionId);
    if (!waiters) {
      return;
    }

    this.#exitWaiters.delete(sessionId);
    for (const resolve of waiters) {
      resolve(didExit);
    }
  }

  #waitForManualTerminalExit(
    sessionId: string,
    timeoutMs: number,
  ): Promise<boolean> {
    if (!this.#manualTerminals.has(sessionId)) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      const resolver = (didExit: boolean) => {
        clearTimeout(timeoutId);
        const waiters = this.#manualExitWaiters.get(sessionId);
        waiters?.delete(resolver);
        if (waiters && waiters.size === 0) {
          this.#manualExitWaiters.delete(sessionId);
        }
        resolve(didExit);
      };

      const waiters = this.#manualExitWaiters.get(sessionId) ?? new Set();
      waiters.add(resolver);
      this.#manualExitWaiters.set(sessionId, waiters);

      const timeoutId = setTimeout(() => {
        resolver(false);
      }, timeoutMs);
    });
  }

  #resolveManualTerminalExitWaiters(sessionId: string, didExit: boolean): void {
    const waiters = this.#manualExitWaiters.get(sessionId);
    if (!waiters) {
      return;
    }

    this.#manualExitWaiters.delete(sessionId);
    for (const resolve of waiters) {
      resolve(didExit);
    }
  }

  #emitSessionUpdated(session: ExecutionSession | undefined): void {
    if (!session) {
      return;
    }

    this.#eventHub.publish(
      makeProtocolEvent("session.updated", "session", session.id, {
        session,
      }),
    );
  }

  #emitDraftUpdated(draft: DraftTicketState | undefined): void {
    if (!draft) {
      return;
    }

    this.#eventHub.publish(
      makeProtocolEvent("draft.updated", "draft", draft.id, {
        draft,
      }),
    );
  }

  #emitStructuredEvent(event: StructuredEvent | undefined): void {
    if (!event) {
      return;
    }

    this.#eventHub.publish(
      makeProtocolEvent(
        "structured_event.created",
        event.entity_type,
        event.entity_id,
        {
          structured_event: event,
        },
      ),
    );
  }

  #emitTicketUpdated(ticket: TicketFrontmatter | undefined): void {
    if (!ticket) {
      return;
    }

    this.#eventHub.publish(
      makeProtocolEvent("ticket.updated", "ticket", String(ticket.id), {
        ticket,
      }),
    );
  }

  #log(sessionId: string, attemptId: string, line: string): void {
    const sequence = this.#store.appendSessionLog(sessionId, line);
    this.#eventHub.publish(
      makeProtocolEvent("session.output", "session", sessionId, {
        session_id: sessionId,
        attempt_id: attemptId,
        sequence,
        chunk: line,
      }),
    );
  }

  async #finishSuccess(input: {
    project: Project;
    repository: RepositoryConfig;
    ticketId: number;
    sessionId: string;
    attemptId: string;
    targetBranch: string;
    summary: string;
  }): Promise<void> {
    this.#activeSessions.delete(input.sessionId);
    this.#store.updateExecutionAttempt(input.attemptId, {
      status: "completed",
      end_reason: "completed",
    });

    const session = this.#store.getSession(input.sessionId);
    const worktreePath = session?.worktree_path;
    if (!session || !worktreePath) {
      return;
    }

    let commitRefs: string[] = [];
    let diffRef = "";

    try {
      commitRefs = runGit(worktreePath, [
        "log",
        "--format=%H",
        `${input.targetBranch}..HEAD`,
      ])
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      if (commitRefs.length === 0) {
        throw new Error(
          "Codex finished without creating a commit on the working branch.",
        );
      }

      const diff = runGit(worktreePath, [
        "diff",
        `${input.targetBranch}...HEAD`,
      ]);
      diffRef = writeReviewDiff(input.project, input.ticketId, diff);
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : "Unable to collect review artifacts";
      const ticket = this.#store.getTicket(input.ticketId);
      if (!ticket) {
        throw new Error("Ticket not found while collecting review artifacts");
      }
      this.#finishFailure({
        ticket,
        sessionId: input.sessionId,
        attemptId: input.attemptId,
        reason,
      });
      return;
    }

    const {
      results: validationResults,
      blockingFailure,
      remainingRisks,
    } = await this.#runValidationProfile({
      project: input.project,
      repository: input.repository,
      ticketId: input.ticketId,
      sessionId: input.sessionId,
      attemptId: input.attemptId,
      worktreePath,
    });

    if (blockingFailure) {
      const summary =
        "Codex finished, but one or more required validation commands failed.";
      const failedSession = this.#store.completeSession(input.sessionId, {
        status: "failed",
        last_summary: summary,
      });
      this.#log(input.sessionId, input.attemptId, summary);
      this.#emitSessionUpdated(failedSession);
      this.startQueuedSessions(input.project.id);
      return;
    }

    const reviewPackage = this.#store.createReviewPackage({
      ticket_id: input.ticketId,
      session_id: input.sessionId,
      diff_ref: diffRef,
      commit_refs: commitRefs,
      change_summary: input.summary,
      validation_results: validationResults,
      remaining_risks: remainingRisks,
    });

    const ticket = this.#store.updateTicketStatus(input.ticketId, "review");
    const completedSession = this.#store.completeSession(input.sessionId, {
      status: "completed",
      last_summary: input.summary,
      latest_review_package_id: reviewPackage.id,
    });

    this.#log(input.sessionId, input.attemptId, "Codex finished successfully.");
    this.#log(
      input.sessionId,
      input.attemptId,
      `Review package ready: ${reviewPackage.diff_ref}`,
    );
    this.#eventHub.publish(
      makeProtocolEvent(
        "review_package.generated",
        "review_package",
        reviewPackage.id,
        {
          review_package: reviewPackage,
        },
      ),
    );
    this.#emitTicketUpdated(ticket);
    this.#emitSessionUpdated(completedSession);
    this.startQueuedSessions(input.project.id);
  }

  #finishPlanSuccess(input: {
    projectId: string;
    sessionId: string;
    attemptId: string;
    summary: string;
  }): void {
    this.#activeSessions.delete(input.sessionId);
    this.#store.updateExecutionAttempt(input.attemptId, {
      status: "completed",
      end_reason: "plan_completed",
    });

    const waitingSession = this.#store.updateSessionPlan(input.sessionId, {
      status: "paused_checkpoint",
      plan_status: "awaiting_feedback",
      plan_summary: input.summary,
      last_summary:
        "Implementation plan ready. Confirm the plan to start execution or request changes to revise it.",
    });

    this.#log(
      input.sessionId,
      input.attemptId,
      formatMarkdownLog("Plan summary", input.summary),
    );
    this.#log(
      input.sessionId,
      input.attemptId,
      "Plan feedback requested: confirm the plan to continue or request changes to revise it.",
    );
    this.#emitSessionUpdated(waitingSession);
    this.startQueuedSessions(input.projectId);
  }

  async #runValidationProfile(input: {
    project: Project;
    repository: RepositoryConfig;
    ticketId: number;
    sessionId: string;
    attemptId: string;
    worktreePath: string;
  }): Promise<{
    results: ValidationResult[];
    blockingFailure: boolean;
    remainingRisks: string[];
  }> {
    if (input.repository.validation_profile.length === 0) {
      return {
        results: [],
        blockingFailure: false,
        remainingRisks: [
          "No validation commands are configured for this repository.",
        ],
      };
    }

    const results: ValidationResult[] = [];
    let blockingFailure = false;
    const remainingRisks: string[] = [];

    for (const command of input.repository.validation_profile) {
      this.#log(
        input.sessionId,
        input.attemptId,
        `Running validation: ${command.label} (${command.command})`,
      );
      const startedAt = nowIso();
      const workingDirectory = resolveValidationWorkingDirectory(
        command,
        input.repository,
        input.worktreePath,
      );
      const logLines: string[] = [];
      const child = spawn(command.command, {
        cwd: workingDirectory,
        env: process.env,
        shell: command.shell,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const result = await new Promise<ValidationResult>((resolve) => {
        let timedOut = false;
        const timeout = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, command.timeout_ms);

        streamLines(child.stdout, (line) => {
          logLines.push(line);
          this.#log(
            input.sessionId,
            input.attemptId,
            `[validation ${command.label}] ${line}`,
          );
        });

        streamLines(child.stderr, (line) => {
          logLines.push(line);
          this.#log(
            input.sessionId,
            input.attemptId,
            `[validation ${command.label} stderr] ${line}`,
          );
        });

        child.once("error", (error) => {
          clearTimeout(timeout);
          const endedAt = nowIso();
          const logRef = buildValidationLogPath(
            input.project,
            input.ticketId,
            command.id,
          );
          writeFileSync(logRef, logLines.join("\n"), "utf8");
          resolve({
            command_id: command.id,
            label: command.label,
            status: "failed",
            started_at: startedAt,
            ended_at: endedAt,
            exit_code: null,
            failure_overridden: false,
            summary: `Validation failed to start: ${error.message}`,
            log_ref: logRef,
          });
        });

        child.once("close", (code) => {
          clearTimeout(timeout);
          const endedAt = nowIso();
          const logRef = buildValidationLogPath(
            input.project,
            input.ticketId,
            command.id,
          );
          writeFileSync(logRef, logLines.join("\n"), "utf8");
          resolve({
            command_id: command.id,
            label: command.label,
            status: code === 0 && !timedOut ? "passed" : "failed",
            started_at: startedAt,
            ended_at: endedAt,
            exit_code: code === null ? null : code,
            failure_overridden: false,
            summary:
              code === 0 && !timedOut
                ? `${command.label} passed.`
                : timedOut
                  ? `${command.label} timed out after ${command.timeout_ms}ms.`
                  : `${command.label} failed with exit code ${code === null ? "unknown" : code}.`,
            log_ref: logRef,
          });
        });
      });

      results.push(result);
      this.#eventHub.publish(
        makeProtocolEvent("validation.updated", "session", input.sessionId, {
          session_id: input.sessionId,
          result,
        }),
      );

      if (result.status === "failed") {
        if (command.required_for_review) {
          blockingFailure = true;
        } else {
          remainingRisks.push(`${command.label} failed during validation.`);
        }
      }
    }

    return {
      results,
      blockingFailure,
      remainingRisks,
    };
  }

  #finishFailure(input: {
    ticket: TicketFrontmatter;
    sessionId: string;
    attemptId: string;
    reason: string;
  }): void {
    this.#activeSessions.delete(input.sessionId);
    this.#store.updateExecutionAttempt(input.attemptId, {
      status: "failed",
      end_reason: input.reason,
    });
    const failedSession = this.#store.completeSession(input.sessionId, {
      status: "failed",
      last_summary: input.reason,
    });
    this.#log(
      input.sessionId,
      input.attemptId,
      `[runtime failure] ${input.reason}`,
    );
    this.#emitSessionUpdated(failedSession);
    this.startQueuedSessions(input.ticket.project);
  }
}
