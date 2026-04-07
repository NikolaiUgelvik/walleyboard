import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { IPty } from "node-pty";
import type {
  ExecutionSession,
  Project,
  RepositoryConfig,
  ReviewPackage,
  ReviewReport,
  TicketFrontmatter,
} from "../../../../packages/contracts/src/index.js";
import { resolveProjectAgentConfigFileOverrides } from "./agent-adapters/agent-config-overrides.js";
import type { AgentAdapterRegistry } from "./agent-adapters/registry.js";
import type { AgentCliAdapter } from "./agent-adapters/types.js";
import type { DockerRuntime } from "./docker-runtime.js";
import { type EventHub, makeProtocolEvent } from "./event-hub.js";
import {
  clearExecutionActivity,
  updateExecutionActivity,
} from "./execution-runtime/activity-observability.js";
import { startDraftAnalysis } from "./execution-runtime/draft-analysis.js";
import { forwardExecutionInput } from "./execution-runtime/forward-input.js";
import {
  buildMergeConflictSummaryPath,
  buildOutputSummaryPath,
  buildProcessEnv,
  extractPersistedAttemptGuidance,
  extractSuppressedDockerFailureDetail,
  formatMarkdownLog,
  formatPreparedRunCommand,
  hasMeaningfulContent,
  resolveTargetBranch,
  runGit,
  shouldSuppressDockerAdapterLine,
  streamChildProcessLines,
  writeReviewDiff,
} from "./execution-runtime/helpers.js";
import { HostSidecarRegistry } from "./execution-runtime/host-sidecar-registry.js";
import { inspectWorktreeRecoveryState } from "./execution-runtime/inspect-worktree-recovery.js";
import type { MergeRecoveryKind } from "./execution-runtime/merge-recovery.js";
import {
  publishReviewRunUpdated,
  publishSessionOutput,
  publishSessionUpdated,
  publishTicketUpdated,
} from "./execution-runtime/publishers.js";
import { buildReferencedTicketContextSections } from "./execution-runtime/referenced-ticket-context.js";
import type { ReviewReadyHandler } from "./execution-runtime/review-ready.js";
import { runTicketReviewSession } from "./execution-runtime/review-runner.js";
import { runMergeRecovery } from "./execution-runtime/run-merge-recovery.js";
import { spawnUnattendedProcessInSession } from "./execution-runtime/spawn-unattended-process.js";
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
  ExecutionMode,
  ExecutionRuntimeOptions,
  ForwardedInputTarget,
  ManualTerminalStartInput,
  PromptContextSection,
  StartExecutionInput,
} from "./execution-runtime/types.js";
import { runValidationProfile } from "./execution-runtime/validation.js";
import {
  resolveTrackedExit,
  waitForTrackedExit,
} from "./execution-runtime/waiters.js";
import { getAgentEnvOverridesCached } from "./walleyboard-conf.js";

type ActiveSessionProcess = ChildProcessWithoutNullStreams;

export class ExecutionRuntime {
  readonly #adapterRegistry: AgentAdapterRegistry;
  readonly #dockerRuntime: DockerRuntime;
  readonly #eventHub: EventHub;
  readonly #store: ExecutionRuntimeOptions["store"];
  readonly #activeSessions = new Map<string, ActiveSessionProcess>();
  readonly #activeDraftRuns = new Map<
    string,
    { kill(signal?: NodeJS.Signals): unknown }
  >();
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
  readonly #hostSidecars = new HostSidecarRegistry();
  readonly #stoppingSessions = new Map<string, string>();
  readonly #stoppingManualTerminals = new Map<string, string>();
  readonly #exitWaiters = new Map<string, Set<(didExit: boolean) => void>>();
  readonly #reviewRunExitWaiters = new Map<
    string,
    Set<(didExit: boolean) => void>
  >();
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

  #getProjectDraftAdapter(project: Project): AgentCliAdapter {
    return this.#adapterRegistry.get(project.draft_analysis_agent_adapter);
  }

  #getSessionAdapter(session: ExecutionSession): AgentCliAdapter {
    return this.#adapterRegistry.get(session.agent_adapter);
  }

  assertProjectExecutionBackendAvailable(
    project: Project,
    agentAdapter: Project["agent_adapter"],
  ): void {
    if (project.execution_backend !== "docker") {
      throw new Error(
        "Host execution is no longer supported. Configure the project to use Docker.",
      );
    }
    this.#dockerRuntime.assertAvailable();
    if (agentAdapter === "claude-code") {
      this.#dockerRuntime.assertClaudeCodeAvailable();
    }
  }

  registerHostSidecar(sessionId: string, sidecar: { kill: () => void }): void {
    this.#hostSidecars.register(sessionId, sidecar);
  }

  cleanupExecutionEnvironment(sessionId: string): void {
    this.#hostSidecars.cleanup(sessionId);
    this.#dockerRuntime.cleanupSessionContainer(sessionId);
  }

  dispose(): void {
    this.#hostSidecars.dispose();
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

  hasActiveReviewRun(reviewRunId: string): boolean {
    return this.#activeReviewRuns.has(reviewRunId);
  }

  async stopReviewRun(
    reviewRunId: string,
    timeoutMs = 1_500,
  ): Promise<boolean> {
    const child = this.#activeReviewRuns.get(reviewRunId);
    if (!child) {
      this.cleanupExecutionEnvironment(`review-${reviewRunId}`);
      return false;
    }

    child.kill("SIGTERM");

    const exitedAfterTerm = await waitForTrackedExit(
      this.#activeReviewRuns,
      this.#reviewRunExitWaiters,
      reviewRunId,
      timeoutMs,
    );
    if (exitedAfterTerm) {
      return true;
    }

    child.kill("SIGKILL");
    return await waitForTrackedExit(
      this.#activeReviewRuns,
      this.#reviewRunExitWaiters,
      reviewRunId,
      1_000,
    );
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

      try {
        this.assertProjectExecutionBackendAvailable(
          project,
          project.ticket_work_agent_adapter,
        );
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
    this.assertProjectExecutionBackendAvailable(
      input.project,
      input.project.ticket_work_agent_adapter,
    );

    return runTicketReviewSession({
      activeReviewRuns: this.#activeReviewRuns,
      adapter: this.#getSessionAdapter(input.session),
      cleanupExecutionEnvironment: (sessionId) => {
        this.cleanupExecutionEnvironment(sessionId);
      },
      registerHostSidecar: (sessionId, sidecar) => {
        this.registerHostSidecar(sessionId, sidecar);
      },
      onLogLine: (line) => {
        publishSessionOutput(
          this.#eventHub,
          this.#store,
          input.session.id,
          input.session.current_attempt_id ?? input.session.id,
          line,
        );
      },
      dockerRuntime: this.#dockerRuntime,
      onPreparedRun: ({ prompt }) => {
        const reviewRun = this.#store.updateReviewRun(input.reviewRunId, {
          prompt,
        });
        publishReviewRunUpdated(this.#eventHub, reviewRun);
      },
      project: input.project,
      repository: input.repository,
      reviewPackage: input.reviewPackage,
      reviewRunExitWaiters: this.#reviewRunExitWaiters,
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
      onLogLine: (line) => {
        publishSessionOutput(
          this.#eventHub,
          this.#store,
          input.session.id,
          input.session.current_attempt_id ?? input.session.id,
          line,
        );
      },
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
    return forwardExecutionInput({
      activeSession: this.#activeSessions.get(sessionId),
      body,
      eventHub: this.#eventHub,
      manualTerminal: this.#manualTerminals.get(sessionId),
      sessionId,
      store: this.#store,
    });
  }

  async #startDraftAnalysis({
    mode,
    draft,
    project,
    repository,
    instruction,
  }: DraftAnalysisInput & { mode: DraftAnalysisMode }): Promise<void> {
    this.assertProjectExecutionBackendAvailable(
      project,
      project.draft_analysis_agent_adapter,
    );

    return startDraftAnalysis(
      {
        activeDraftRuns: this.#activeDraftRuns,
        adapter: this.#getProjectDraftAdapter(project),
        cleanupExecutionEnvironment: (sessionId) => {
          this.cleanupExecutionEnvironment(sessionId);
        },
        dockerRuntime: this.#dockerRuntime,
        eventHub: this.#eventHub,
        registerHostSidecar: (sessionId, sidecar) => {
          this.registerHostSidecar(sessionId, sidecar);
        },
        store: this.#store,
      },
      { mode, draft, project, repository, instruction },
    );
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
    const extraInstructions: PromptContextSection[] =
      buildReferencedTicketContextSections({
        store: this.#store,
        ticket,
        worktreePath: session.worktree_path,
      });
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
    const outputSummaryPath = recoveryState
      ? buildMergeConflictSummaryPath(project, ticket.id, session.id)
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
          useDockerRuntime: true,
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
          useDockerRuntime: true,
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

    const processEnv = buildProcessEnv(getAgentEnvOverridesCached(adapter.id));
    let child: ChildProcessWithoutNullStreams;
    const startedAt = new Date().toISOString();

    try {
      if (!run.dockerSpec) {
        throw new Error(
          `${adapter.label} does not provide a Docker execution configuration.`,
        );
      }
      const t0 = performance.now();
      this.#dockerRuntime.ensureSessionContainer({
        configFileOverrides: resolveProjectAgentConfigFileOverrides(
          adapter.id,
          project,
        ),
        dockerSpec: run.dockerSpec,
        sessionId: session.id,
        projectId: project.id,
        ticketId: ticket.id,
        worktreePath: session.worktree_path,
      });
      const t1 = performance.now();
      if (t1 - t0 > 500) {
        console.warn(
          `[startExecution] ensureSessionContainer took ${Math.round(t1 - t0)}ms`,
        );
      }
      child = spawnUnattendedProcessInSession({
        cwd: session.worktree_path,
        dockerRuntime: this.#dockerRuntime,
        env: processEnv,
        run,
        sessionId: session.id,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `${adapter.label} process failed to start`;
      this.cleanupExecutionEnvironment(session.id);
      clearExecutionActivity(session.id);
      this.#finishFailure({
        ticket,
        sessionId: session.id,
        attemptId,
        reason: `${adapter.label} failed to start: ${message}`,
      });
      return;
    }

    this.#activeSessions.set(session.id, child);
    updateExecutionActivity(this.#dockerRuntime, {
      activityId: session.id,
      activityType: "session",
      adapter: adapter.id,
      startedAt,
      ticketId: ticket.id,
    });
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
      `Launching ${adapter.label}${recoveryState ? " merge recovery" : ""} in Docker for ${session.worktree_path}`,
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
      `Command: ${formatPreparedRunCommand(run)}`,
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

    streamChildProcessLines(child, {
      onError: (error) => {
        clearExecutionActivity(session.id);
        this.#finishFailure({
          ticket,
          sessionId: session.id,
          attemptId,
          reason: `${adapter.label} runtime failed: ${error.message}`,
        });
        resolveTrackedExit(this.#exitWaiters, session.id, true);
      },
      onExit: async ({ exitCode }) => {
        console.warn(
          `[onExit] session=${session.id} exitCode=${exitCode} ticketId=${ticket.id}`,
        );
        const _tExit0 = performance.now();
        const stopReason = this.#stoppingSessions.get(session.id);
        if (stopReason) {
          this.#stoppingSessions.delete(session.id);
          this.#activeSessions.delete(session.id);
          clearExecutionActivity(session.id);
          this.cleanupExecutionEnvironment(session.id);
          resolveTrackedExit(this.#exitWaiters, session.id, true);
          return;
        }
        clearExecutionActivity(session.id);

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
        const tCleanup0 = performance.now();
        this.cleanupExecutionEnvironment(session.id);
        const tCleanup1 = performance.now();
        if (tCleanup1 - tCleanup0 > 500) {
          console.warn(
            `[onExit] cleanupExecutionEnvironment took ${Math.round(tCleanup1 - tCleanup0)}ms`,
          );
        }

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
              targetBranch: resolveTargetBranch(
                repository,
                ticket.target_branch,
              ),
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
      },
      onLine: (line) => {
        const interpreted = processAdapterLine(line);
        updateExecutionActivity(this.#dockerRuntime, {
          activityId: session.id,
          activityType: "session",
          adapter: adapter.id,
          lastOutputAt: new Date().toISOString(),
          startedAt,
          ticketId: ticket.id,
        });
        if (shouldSuppressDockerAdapterLine(adapter.id, interpreted.logLine)) {
          suppressedDockerFailureDetail =
            extractSuppressedDockerFailureDetail(interpreted.logLine) ??
            suppressedDockerFailureDetail;
          return;
        }
        publishSessionOutput(
          this.#eventHub,
          this.#store,
          session.id,
          attemptId,
          interpreted.logLine,
        );
      },
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
      const tGit0 = performance.now();
      commitRefs = runGit(worktreePath, [
        "log",
        "--format=%H",
        `${input.targetBranch}..HEAD`,
      ])
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const tGit1 = performance.now();

      if (commitRefs.length === 0) {
        throw new Error(
          `${input.adapterLabel} finished without creating a commit on the working branch.`,
        );
      }

      const diff = runGit(worktreePath, [
        "diff",
        `${input.targetBranch}...HEAD`,
      ]);
      const tGit2 = performance.now();
      console.warn(
        `[#finishSuccess] ticketId=${input.ticketId} git-log=${Math.round(tGit1 - tGit0)}ms git-diff=${Math.round(tGit2 - tGit1)}ms diffLength=${diff.length}`,
      );
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
