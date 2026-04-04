import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { nanoid } from "nanoid";
import { type IPty, spawn as spawnPty } from "node-pty";

import type {
  ExecutionSession,
  Project,
  RepositoryConfig,
  ReviewPackage,
  ReviewReport,
  TicketFrontmatter,
} from "../../../../packages/contracts/src/index.js";

import type { AgentAdapterRegistry } from "./agent-adapters/registry.js";
import type { AgentCliAdapter } from "./agent-adapters/types.js";
import type { DockerRuntime } from "./docker-runtime.js";
import { preserveDraftArtifactImages } from "./draft-artifact-images.js";
import { type EventHub, makeProtocolEvent } from "./event-hub.js";
import {
  buildDraftAnalysisOutputPath,
  buildMergeConflictSummaryPath,
  buildOutputSummaryPath,
  buildProcessEnv,
  buildWorkspaceOutputPath,
  extractPersistedAttemptGuidance,
  formatMarkdownLog,
  hasMeaningfulContent,
  resolveTargetBranch,
  runGit,
  streamLines,
  summarizeDraftQuestions,
  summarizeDraftRefinement,
  truncate,
  writeReviewDiff,
} from "./execution-runtime/helpers.js";
import type { MergeRecoveryKind } from "./execution-runtime/merge-recovery.js";
import {
  publishDraftUpdated,
  publishSessionOutput,
  publishSessionUpdated,
  publishStructuredEvent,
  publishTicketUpdated,
} from "./execution-runtime/publishers.js";
import { runTicketReviewSession } from "./execution-runtime/review-runner.js";
import { runMergeRecovery } from "./execution-runtime/run-merge-recovery.js";
import {
  closeTrackedWorkspaceTerminals,
  disposeTrackedWorkspaceTerminals,
  startTrackedManualTerminal,
  startTrackedWorkspaceTerminal,
  type WorkspaceTerminalRuntime,
} from "./execution-runtime/terminal-runtime.js";
import type {
  DraftAnalysisInput,
  DraftAnalysisMode,
  DraftRefinementResult,
  ExecutionMode,
  ExecutionRuntimeOptions,
  ForwardedInputTarget,
  ManualTerminalStartInput,
  PromptContextSection,
  StartExecutionInput,
} from "./execution-runtime/types.js";
import {
  draftAnalysisTimeoutMs,
  draftFeasibilityResultSchema,
  draftRefinementResultSchema,
} from "./execution-runtime/types.js";
import { runValidationProfile } from "./execution-runtime/validation.js";
import {
  resolveTrackedExit,
  waitForTrackedExit,
} from "./execution-runtime/waiters.js";
import type { Store } from "./store.js";

type ReviewReadyInput = {
  project: Project;
  repository: RepositoryConfig;
  reviewPackage: ReviewPackage;
  session: ExecutionSession;
  ticket: TicketFrontmatter;
};
type ReviewReadyHandler = (input: ReviewReadyInput) => Promise<void>;

type WorktreeRecoveryState = {
  conflictedFiles: string[];
  failureMessage: string;
  stage: "rebase" | "merge";
};

function inspectWorktreeRecoveryState(
  worktreePath: string,
): WorktreeRecoveryState | null {
  try {
    const conflictedFiles = runGit(worktreePath, [
      "diff",
      "--name-only",
      "--diff-filter=U",
    ])
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const mergeHeadPath = runGit(worktreePath, [
      "rev-parse",
      "--git-path",
      "MERGE_HEAD",
    ]);
    const rebaseMergePath = runGit(worktreePath, [
      "rev-parse",
      "--git-path",
      "rebase-merge",
    ]);
    const rebaseApplyPath = runGit(worktreePath, [
      "rev-parse",
      "--git-path",
      "rebase-apply",
    ]);
    const currentBranch = runGit(worktreePath, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]);
    const mergeInProgress = existsSync(mergeHeadPath);
    const rebaseInProgress =
      existsSync(rebaseMergePath) || existsSync(rebaseApplyPath);
    const detachedHead = currentBranch === "HEAD";

    if (!mergeInProgress && !rebaseInProgress && conflictedFiles.length === 0) {
      return null;
    }

    const stage = rebaseInProgress ? "rebase" : "merge";
    const failureMessage = rebaseInProgress
      ? "Resume detected an unfinished git rebase in the preserved worktree."
      : mergeInProgress
        ? "Resume detected an unfinished git merge in the preserved worktree."
        : detachedHead
          ? "Resume detected unresolved git conflicts in a detached worktree."
          : "Resume detected unresolved git conflicts in the preserved worktree.";

    return {
      conflictedFiles,
      failureMessage,
      stage,
    };
  } catch {
    return null;
  }
}

export class ExecutionRuntime {
  readonly #adapterRegistry: AgentAdapterRegistry;
  readonly #dockerRuntime: DockerRuntime;
  readonly #eventHub: EventHub;
  readonly #store: Store;
  readonly #activeSessions = new Map<string, IPty>();
  readonly #activeDraftRuns = new Map<string, ChildProcessWithoutNullStreams>();
  readonly #activeReviewRuns = new Map<
    string,
    { kill(signal?: NodeJS.Signals): unknown }
  >();
  readonly #workspaceTerminals = new Map<
    string,
    Set<WorkspaceTerminalRuntime>
  >();
  readonly #manualTerminals = new Map<
    string,
    { pty: IPty; attemptId: string | null }
  >();
  readonly #stoppingSessions = new Map<string, string>();
  readonly #stoppingManualTerminals = new Map<string, string>();
  readonly #exitWaiters = new Map<string, Set<(didExit: boolean) => void>>();
  readonly #manualExitWaiters = new Map<
    string,
    Set<(didExit: boolean) => void>
  >();
  #reviewReadyHandler: ReviewReadyHandler | null = null;

  constructor({
    adapterRegistry,
    dockerRuntime,
    eventHub,
    store,
  }: ExecutionRuntimeOptions) {
    this.#adapterRegistry = adapterRegistry;
    this.#dockerRuntime = dockerRuntime;
    this.#eventHub = eventHub;
    this.#store = store;
  }

  #getProjectAdapter(project: Project): AgentCliAdapter {
    return this.#adapterRegistry.get(project.agent_adapter);
  }

  #getSessionAdapter(session: ExecutionSession): AgentCliAdapter {
    return this.#adapterRegistry.get(session.agent_adapter);
  }

  assertProjectExecutionBackendAvailable(project: Project): void {
    if (project.execution_backend !== "docker") return;
    this.#dockerRuntime.assertAvailable();
  }

  cleanupExecutionEnvironment(sessionId: string): void {
    this.#dockerRuntime.cleanupSessionContainer(sessionId);
  }

  dispose(): void {
    for (const child of this.#activeReviewRuns.values()) {
      child.kill("SIGTERM");
    }
    disposeTrackedWorkspaceTerminals(this.#workspaceTerminals);
    this.#dockerRuntime.dispose();
  }

  setReviewReadyHandler(handler: ReviewReadyHandler | null): void {
    this.#reviewReadyHandler = handler;
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

    const exitedAfterTerm = await waitForTrackedExit(
      this.#activeSessions,
      this.#exitWaiters,
      sessionId,
      timeoutMs,
    );
    if (exitedAfterTerm) {
      return true;
    }

    child.kill("SIGKILL");
    return waitForTrackedExit(
      this.#activeSessions,
      this.#exitWaiters,
      sessionId,
      1_000,
    );
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

  startWorkspaceTerminal(input: {
    sessionId: string;
    worktreePath: string;
  }): WorkspaceTerminalRuntime {
    return startTrackedWorkspaceTerminal({
      sessionId: input.sessionId,
      worktreePath: input.worktreePath,
      workspaceTerminals: this.#workspaceTerminals,
    });
  }

  closeWorkspaceTerminals(sessionId: string, exitMessage: string): void {
    closeTrackedWorkspaceTerminals(
      this.#workspaceTerminals,
      sessionId,
      exitMessage,
    );
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
          publishSessionOutput(
            this.#eventHub,
            this.#store,
            session.id,
            attemptId,
            `[runtime failure] ${reason}`,
          );
        }

        const failedSession = this.#store.completeSession(session.id, {
          status: "failed",
          last_summary: reason,
        });
        publishSessionUpdated(
          this.#eventHub,
          failedSession,
          failedSession ? this.hasActiveExecution(failedSession.id) : false,
        );
        continue;
      }

      publishSessionOutput(
        this.#eventHub,
        this.#store,
        session.id,
        attemptId,
        "A project execution slot opened. Launching this queued session.",
      );
      publishSessionUpdated(
        this.#eventHub,
        session,
        this.hasActiveExecution(session.id),
      );

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
        publishSessionOutput(
          this.#eventHub,
          this.#store,
          session.id,
          attemptId,
          `[runtime failure] ${reason}`,
        );
        publishSessionUpdated(
          this.#eventHub,
          failedSession,
          failedSession ? this.hasActiveExecution(failedSession.id) : false,
        );
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

  async runTicketReview(input: {
    project: Project;
    repository: RepositoryConfig;
    reviewPackage: ReviewPackage;
    reviewRunId: string;
    session: ExecutionSession;
    ticket: TicketFrontmatter;
  }): Promise<{
    adapterSessionRef: string | null;
    report: ReviewReport;
  }> {
    return runTicketReviewSession({
      activeReviewRuns: this.#activeReviewRuns,
      adapter: this.#getSessionAdapter(input.session),
      cleanupExecutionEnvironment: (sessionId) => {
        this.cleanupExecutionEnvironment(sessionId);
      },
      dockerRuntime: this.#dockerRuntime,
      onPreparedRun: ({ prompt }) => {
        this.#store.updateReviewRun(input.reviewRunId, {
          prompt,
        });
      },
      project: input.project,
      repository: input.repository,
      reviewPackage: input.reviewPackage,
      reviewRunId: input.reviewRunId,
      session: input.session,
      ticket: input.ticket,
    });
  }

  async resolveMergeConflicts(input: {
    project: Project;
    recoveryKind: MergeRecoveryKind;
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
    const adapter = this.#getSessionAdapter(input.session);
    return await runMergeRecovery({
      adapter,
      cleanupExecutionEnvironment: (sessionId) => {
        this.cleanupExecutionEnvironment(sessionId);
      },
      conflictedFiles: input.conflictedFiles,
      dockerRuntime: this.#dockerRuntime,
      failureMessage: input.failureMessage,
      project: input.project,
      recoveryKind: input.recoveryKind,
      repository: input.repository,
      session: input.session,
      stage: input.stage,
      targetBranch: input.targetBranch,
      ticket: input.ticket,
    });
  }

  startManualTerminal({
    sessionId,
    worktreePath,
    attemptId,
  }: ManualTerminalStartInput): void {
    startTrackedManualTerminal({
      attemptId,
      eventHub: this.#eventHub,
      manualExitWaiters: this.#manualExitWaiters,
      manualTerminals: this.#manualTerminals,
      sessionId,
      stoppingManualTerminals: this.#stoppingManualTerminals,
      store: this.#store,
      worktreePath,
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

    const exitedAfterTerm = await waitForTrackedExit(
      this.#manualTerminals,
      this.#manualExitWaiters,
      sessionId,
      timeoutMs,
    );
    if (exitedAfterTerm) {
      return true;
    }

    terminal.pty.kill("SIGKILL");
    return waitForTrackedExit(
      this.#manualTerminals,
      this.#manualExitWaiters,
      sessionId,
      1_000,
    );
  }

  forwardInput(sessionId: string, body: string): ForwardedInputTarget | null {
    if (!hasMeaningfulContent(body)) {
      return null;
    }

    const manualTerminal = this.#manualTerminals.get(sessionId);
    if (manualTerminal) {
      manualTerminal.pty.write(`${body}\r`);
      publishSessionOutput(
        this.#eventHub,
        this.#store,
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
    publishSessionOutput(
      this.#eventHub,
      this.#store,
      sessionId,
      attemptId,
      `[agent input]\n${body}`,
    );
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

    const adapter = this.#getProjectAdapter(project);
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
            ? `${adapter.label} is refining this draft in ${repository.name}.`
            : `${adapter.label} is checking draft feasibility in ${repository.name}.`,
      },
    );
    publishStructuredEvent(this.#eventHub, startedEvent);

    const outputPath = buildDraftAnalysisOutputPath(
      project,
      draft.id,
      runId,
      mode,
    );
    const run = adapter.buildDraftRun({
      draft,
      mode,
      outputPath,
      project,
      repository,
      ...(hasMeaningfulContent(instruction) ? { instruction } : {}),
    });
    const child = spawn(run.command, run.args, {
      cwd: repository.path,
      env: buildProcessEnv(),
    });
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
      captureLine(adapter.interpretOutputLine(line).logLine);
    });
    streamLines(child.stderr, (line) => {
      captureLine(`[${adapter.id} stderr] ${line}`);
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
      publishStructuredEvent(this.#eventHub, failedEvent);
    };

    const timeoutId = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!finalized) {
          child.kill("SIGKILL");
        }
      }, 1_000);
      failRun(
        `${adapter.label} ${mode === "refine" ? "refinement" : "feasibility"} timed out after ${Math.round(
          draftAnalysisTimeoutMs / 1_000,
        )} seconds.`,
      );
    }, draftAnalysisTimeoutMs);

    child.once("error", (error) => {
      clearTimeout(timeoutId);
      const message =
        error instanceof Error
          ? error.message
          : `${adapter.label} failed to start`;
      failRun(`${adapter.label} failed to start: ${message}`);
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
        failRun(adapter.formatExitReason(exitCode, signal, rawOutput));
        return;
      }

      try {
        if (mode === "refine") {
          const beforeDraft = this.#store.getDraft(draft.id);
          const result = adapter.parseDraftResult(
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
          publishStructuredEvent(this.#eventHub, completedEvent);
          publishDraftUpdated(this.#eventHub, updatedDraft);
          return;
        }

        const result = adapter.parseDraftResult(
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
        publishStructuredEvent(this.#eventHub, completedEvent);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : `Unable to process ${adapter.label} output`;
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

    const adapter = this.#getSessionAdapter(session);
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
    const recoveryState =
      executionMode === "implementation"
        ? inspectWorktreeRecoveryState(session.worktree_path)
        : null;
    const useDockerRuntime = project.execution_backend === "docker";
    const outputSummaryPath = recoveryState
      ? useDockerRuntime
        ? buildWorkspaceOutputPath(
            session.worktree_path,
            session.id,
            "merge-conflict",
          )
        : buildMergeConflictSummaryPath(project, ticket.id, session.id)
      : useDockerRuntime
        ? buildWorkspaceOutputPath(session.worktree_path, session.id)
        : buildOutputSummaryPath(project, ticket.id, session.id);
    const run = recoveryState
      ? adapter.buildMergeConflictRun({
          conflictedFiles: recoveryState.conflictedFiles,
          failureMessage: recoveryState.failureMessage,
          outputPath: outputSummaryPath,
          project,
          recoveryKind: "conflicts",
          repository,
          session,
          stage: recoveryState.stage,
          targetBranch: ticket.target_branch ?? repository.target_branch,
          ticket,
          useDockerRuntime,
        })
      : adapter.buildExecutionRun({
          executionMode,
          extraInstructions,
          outputPath: outputSummaryPath,
          planSummary: session.plan_summary,
          project,
          repository,
          session,
          ticket,
          useDockerRuntime,
        });
    this.#store.updateExecutionAttempt(attemptId, {
      prompt_kind: recoveryState
        ? "merge_conflict"
        : executionMode === "plan"
          ? "plan"
          : "implementation",
      prompt: run.prompt,
    });
    const activeSessionRef = hasMeaningfulContent(session.adapter_session_ref)
      ? session.adapter_session_ref
      : null;
    const shouldResumeAgent = activeSessionRef !== null;
    const { model, reasoningEffort } = adapter.resolveModelSelection(
      project,
      "ticket",
    );

    const ptyEnv = buildProcessEnv();
    let child: IPty;

    try {
      if (useDockerRuntime) {
        if (!run.dockerSpec) {
          throw new Error(
            `${adapter.label} does not provide a Docker execution configuration.`,
          );
        }
        this.#dockerRuntime.ensureSessionContainer({
          dockerSpec: run.dockerSpec,
          sessionId: session.id,
          projectId: project.id,
          ticketId: ticket.id,
          worktreePath: session.worktree_path,
        });
        child = this.#dockerRuntime.spawnPtyInSession(
          session.id,
          run.command,
          run.args,
          {
            cwd: session.worktree_path,
            env: ptyEnv,
            cols: 120,
            rows: 32,
            name: "xterm-256color",
          },
        );
      } else {
        child = spawnPty(run.command, run.args, {
          cwd: session.worktree_path,
          env: ptyEnv,
          cols: 120,
          rows: 32,
          name: "xterm-256color",
        });
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `${adapter.label} PTY failed to start`;
      this.cleanupExecutionEnvironment(session.id);
      this.#finishFailure({
        ticket,
        sessionId: session.id,
        attemptId,
        reason: `${adapter.label} failed to start: ${message}`,
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
      recoveryState
        ? `${adapter.label} merge recovery is running inside the prepared worktree.`
        : `${adapter.label} execution is running inside the prepared worktree.`,
    );
    publishSessionUpdated(
      this.#eventHub,
      runningSession,
      runningSession ? this.hasActiveExecution(runningSession.id) : false,
    );
    publishSessionOutput(
      this.#eventHub,
      this.#store,
      session.id,
      attemptId,
      useDockerRuntime
        ? `Launching ${adapter.label}${recoveryState ? " merge recovery" : ""} in Docker for ${session.worktree_path}`
        : `Launching ${adapter.label}${recoveryState ? " merge recovery" : ""} in ${session.worktree_path}`,
    );
    if (recoveryState) {
      publishSessionOutput(
        this.#eventHub,
        this.#store,
        session.id,
        attemptId,
        `${recoveryState.failureMessage} Completing the in-progress git ${recoveryState.stage} before any new ticket work continues.`,
      );
    }
    publishSessionOutput(
      this.#eventHub,
      this.#store,
      session.id,
      attemptId,
      `Command: ${run.command} ${run.args.slice(0, -1).join(" ")} <prompt>`,
    );
    if (shouldResumeAgent) {
      publishSessionOutput(
        this.#eventHub,
        this.#store,
        session.id,
        attemptId,
        `Resuming ${adapter.label} session: ${activeSessionRef}`,
      );
    }
    if (model) {
      publishSessionOutput(
        this.#eventHub,
        this.#store,
        session.id,
        attemptId,
        `Model override: ${model}`,
      );
    }
    if (reasoningEffort) {
      publishSessionOutput(
        this.#eventHub,
        this.#store,
        session.id,
        attemptId,
        `Reasoning effort override: ${reasoningEffort}`,
      );
    }
    if (session.planning_enabled && !recoveryState) {
      publishSessionOutput(
        this.#eventHub,
        this.#store,
        session.id,
        attemptId,
        executionMode === "plan"
          ? "Planning mode enabled: the agent will outline a plan before editing."
          : "Approved plan confirmed: the agent will now implement the ticket.",
      );
    }
    if (requestedChangeNote) {
      publishSessionOutput(
        this.#eventHub,
        this.#store,
        session.id,
        attemptId,
        formatMarkdownLog("Latest requested changes", requestedChangeNote.body),
      );
    }
    if (hasMeaningfulContent(additionalInstruction)) {
      publishSessionOutput(
        this.#eventHub,
        this.#store,
        session.id,
        attemptId,
        formatMarkdownLog("Resume guidance", additionalInstruction),
      );
    } else if (persistedResumeGuidance) {
      publishSessionOutput(
        this.#eventHub,
        this.#store,
        session.id,
        attemptId,
        formatMarkdownLog("Resume guidance", persistedResumeGuidance),
      );
    }

    let pendingBuffer = "";
    let persistedSessionRef = activeSessionRef;
    let lastOutputContent: string | undefined;
    let lastPlanContent: string | undefined;
    let suppressedDockerFailureDetail: string | undefined;

    const processAdapterLine = (line: string) => {
      const interpreted = adapter.interpretOutputLine(line);
      if (hasMeaningfulContent(interpreted.planContent)) {
        lastPlanContent = interpreted.planContent;
      }
      if (hasMeaningfulContent(interpreted.outputContent)) {
        lastOutputContent = interpreted.outputContent;
      }
      if (
        hasMeaningfulContent(interpreted.sessionRef) &&
        interpreted.sessionRef !== persistedSessionRef
      ) {
        const previousSessionRef = persistedSessionRef;
        persistedSessionRef = interpreted.sessionRef;

        const updatedSession = this.#store.updateSessionAdapterSessionRef(
          session.id,
          interpreted.sessionRef,
        );
        if (updatedSession) {
          publishSessionUpdated(
            this.#eventHub,
            updatedSession,
            updatedSession ? this.hasActiveExecution(updatedSession.id) : false,
          );
        }

        publishSessionOutput(
          this.#eventHub,
          this.#store,
          session.id,
          attemptId,
          previousSessionRef
            ? `${adapter.label} session updated: ${previousSessionRef} -> ${interpreted.sessionRef}`
            : `${adapter.label} session attached: ${interpreted.sessionRef}`,
        );
      }
      return interpreted;
    };

    const shouldSuppressDockerAdapterLine = (line: string) =>
      useDockerRuntime &&
      adapter.id === "codex" &&
      line.startsWith("[codex raw]");

    const recordSuppressedDockerFailureDetail = (line: string) => {
      const detail = line.replace(/^\[codex raw\]\s*/, "").trim();
      if (detail.length > 0) {
        suppressedDockerFailureDetail = detail;
      }
    };

    child.onData((chunk) => {
      pendingBuffer += chunk.replace(/\r\n/g, "\n");

      while (pendingBuffer.includes("\n")) {
        const newlineIndex = pendingBuffer.indexOf("\n");
        const line = pendingBuffer.slice(0, newlineIndex);
        pendingBuffer = pendingBuffer.slice(newlineIndex + 1);
        const interpreted = processAdapterLine(line);
        if (shouldSuppressDockerAdapterLine(interpreted.logLine)) {
          recordSuppressedDockerFailureDetail(interpreted.logLine);
          continue;
        }
        publishSessionOutput(
          this.#eventHub,
          this.#store,
          session.id,
          attemptId,
          interpreted.logLine,
        );
      }
    });

    child.onExit(async ({ exitCode }) => {
      const stopReason = this.#stoppingSessions.get(session.id);
      if (stopReason) {
        this.#stoppingSessions.delete(session.id);
        this.#activeSessions.delete(session.id);
        this.cleanupExecutionEnvironment(session.id);
        resolveTrackedExit(this.#exitWaiters, session.id, true);
        return;
      }

      if (pendingBuffer.trim().length > 0) {
        const interpreted = processAdapterLine(pendingBuffer);
        if (shouldSuppressDockerAdapterLine(interpreted.logLine)) {
          recordSuppressedDockerFailureDetail(interpreted.logLine);
        } else {
          publishSessionOutput(
            this.#eventHub,
            this.#store,
            session.id,
            attemptId,
            interpreted.logLine,
          );
        }
        pendingBuffer = "";
      }

      // Prefer plan content (from ExitPlanMode) over generic output content.
      // Plan content is set only for ExitPlanMode tool_use blocks, so later
      // assistant text messages cannot overwrite the actual plan.
      const bestOutputContent = lastPlanContent ?? lastOutputContent;
      let finalSummary = existsSync(outputSummaryPath)
        ? readFileSync(outputSummaryPath, "utf8").trim()
        : null;
      if ((!finalSummary || finalSummary.length === 0) && bestOutputContent) {
        writeFileSync(outputSummaryPath, bestOutputContent, "utf8");
        finalSummary = bestOutputContent.trim();
      }
      this.cleanupExecutionEnvironment(session.id);

      if (exitCode === 0) {
        const summary =
          finalSummary && finalSummary.length > 0
            ? finalSummary
            : executionMode === "plan"
              ? `${adapter.label} finished planning, but no plan summary was captured.`
              : `${adapter.label} finished successfully, but no final summary was captured.`;

        if (executionMode === "plan") {
          this.#finishPlanSuccess({
            projectId: ticket.project,
            sessionId: session.id,
            attemptId,
            summary,
          });
        } else {
          await this.#finishSuccess({
            adapterLabel: adapter.label,
            project,
            repository,
            ticketId: ticket.id,
            sessionId: session.id,
            attemptId,
            targetBranch: resolveTargetBranch(repository, ticket.target_branch),
            summary,
          });
        }
        resolveTrackedExit(this.#exitWaiters, session.id, true);
        return;
      }

      this.#finishFailure({
        ticket,
        sessionId: session.id,
        attemptId,
        reason: adapter.formatExitReason(
          exitCode ?? null,
          null,
          finalSummary ?? suppressedDockerFailureDetail ?? "",
        ),
      });
      resolveTrackedExit(this.#exitWaiters, session.id, true);
    });
  }

  async #finishSuccess(input: {
    adapterLabel: string;
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
          `${input.adapterLabel} finished without creating a commit on the working branch.`,
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
    } = await runValidationProfile({
      eventHub: this.#eventHub,
      store: this.#store,
      project: input.project,
      repository: input.repository,
      ticketId: input.ticketId,
      sessionId: input.sessionId,
      attemptId: input.attemptId,
      worktreePath,
    });

    if (blockingFailure) {
      const summary = `${input.adapterLabel} finished, but one or more required validation commands failed.`;
      const failedSession = this.#store.completeSession(input.sessionId, {
        status: "failed",
        last_summary: summary,
      });
      publishSessionOutput(
        this.#eventHub,
        this.#store,
        input.sessionId,
        input.attemptId,
        summary,
      );
      publishSessionUpdated(
        this.#eventHub,
        failedSession,
        failedSession ? this.hasActiveExecution(failedSession.id) : false,
      );
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

    publishSessionOutput(
      this.#eventHub,
      this.#store,
      input.sessionId,
      input.attemptId,
      `${input.adapterLabel} finished successfully.`,
    );
    publishSessionOutput(
      this.#eventHub,
      this.#store,
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
    publishTicketUpdated(this.#eventHub, ticket);
    publishSessionUpdated(
      this.#eventHub,
      completedSession,
      completedSession ? this.hasActiveExecution(completedSession.id) : false,
    );

    if (this.#reviewReadyHandler && ticket && completedSession) {
      try {
        await this.#reviewReadyHandler({
          project: input.project,
          repository: input.repository,
          reviewPackage,
          session: completedSession,
          ticket,
        });
      } catch (error) {
        publishSessionOutput(
          this.#eventHub,
          this.#store,
          input.sessionId,
          input.attemptId,
          `[review follow-up warning] ${
            error instanceof Error
              ? error.message
              : "Unable to complete review follow-up actions"
          }`,
        );
      }
    }

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

    publishSessionOutput(
      this.#eventHub,
      this.#store,
      input.sessionId,
      input.attemptId,
      formatMarkdownLog("Plan summary", input.summary),
    );
    publishSessionOutput(
      this.#eventHub,
      this.#store,
      input.sessionId,
      input.attemptId,
      "Plan feedback requested: confirm the plan to continue or request changes to revise it.",
    );
    publishSessionUpdated(
      this.#eventHub,
      waitingSession,
      waitingSession ? this.hasActiveExecution(waitingSession.id) : false,
    );
    this.startQueuedSessions(input.projectId);
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
    publishSessionOutput(
      this.#eventHub,
      this.#store,
      input.sessionId,
      input.attemptId,
      `[runtime failure] ${input.reason}`,
    );
    publishSessionUpdated(
      this.#eventHub,
      failedSession,
      failedSession ? this.hasActiveExecution(failedSession.id) : false,
    );
    this.startQueuedSessions(input.ticket.project);
  }
}
