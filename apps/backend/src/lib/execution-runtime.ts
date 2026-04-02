import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { nanoid } from "nanoid";
import { type IPty, spawn as spawnPty } from "node-pty";

import type {
  DraftTicketState,
  ExecutionSession,
  Project,
  RepositoryConfig,
  StructuredEvent,
  TicketFrontmatter,
  ValidationResult,
} from "../../../../packages/contracts/src/index.js";

import type { DockerRuntimeManager } from "./docker-runtime.js";
import { preserveDraftArtifactImages } from "./draft-artifact-images.js";
import { type EventHub, makeProtocolEvent } from "./event-hub.js";
import {
  appendContextSections,
  appendCriteriaSections,
  appendMarkdownSection,
  buildDraftAnalysisOutputPath,
  buildMergeConflictSummaryPath,
  buildOutputSummaryPath,
  buildProcessEnv,
  buildValidationLogPath,
  buildWorkspaceOutputPath,
  extractCodexSessionIdFromJsonLine,
  extractPersistedAttemptGuidance,
  formatCodexExitReason,
  formatDraftAnalysisExitReason,
  formatMarkdownLog,
  hasMeaningfulContent,
  normalizeOptionalModel,
  normalizeOptionalReasoningEffort,
  parseCodexJsonResult,
  resolveValidationWorkingDirectory,
  runGit,
  streamLines,
  summarizeCodexJsonLine,
  summarizeDraftQuestions,
  summarizeDraftRefinement,
  truncate,
  writeReviewDiff,
} from "./execution-runtime/helpers.js";
import {
  appendCodexExecutionModeArgs,
  appendCodexModelArgs,
  appendDangerousDockerArgs,
  buildCodexImplementationPrompt,
  buildCodexPlanPrompt,
  buildDraftQuestionsPrompt,
  buildDraftRefinementPrompt,
  buildMergeConflictResolutionPrompt,
} from "./execution-runtime/prompts.js";
import {
  publishDraftUpdated,
  publishSessionOutput,
  publishSessionUpdated,
  publishStructuredEvent,
  publishTicketUpdated,
} from "./execution-runtime/publishers.js";
import type {
  DraftAnalysisInput,
  DraftAnalysisMode,
  DraftFeasibilityResult,
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
import { nowIso } from "./time.js";

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
        publishSessionUpdated(this.#eventHub, failedSession);
        continue;
      }

      publishSessionOutput(
        this.#eventHub,
        this.#store,
        session.id,
        attemptId,
        "A project execution slot opened. Launching this queued session.",
      );
      publishSessionUpdated(this.#eventHub, session);

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
        publishSessionUpdated(this.#eventHub, failedSession);
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
    publishSessionOutput(
      this.#eventHub,
      this.#store,
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
          publishSessionOutput(
            this.#eventHub,
            this.#store,
            sessionId,
            logAttemptId,
            `[terminal] ${line}`,
          );
        }
      }
    });

    child.onExit(() => {
      if (pendingBuffer.trim().length > 0) {
        publishSessionOutput(
          this.#eventHub,
          this.#store,
          sessionId,
          logAttemptId,
          `[terminal] ${pendingBuffer.trim()}`,
        );
        pendingBuffer = "";
      }

      this.#stoppingManualTerminals.delete(sessionId);
      this.#manualTerminals.delete(sessionId);
      publishSessionOutput(
        this.#eventHub,
        this.#store,
        sessionId,
        logAttemptId,
        "Manual terminal closed.",
      );
      resolveTrackedExit(this.#manualExitWaiters, sessionId, true);
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
    publishStructuredEvent(this.#eventHub, startedEvent);

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
          publishStructuredEvent(this.#eventHub, completedEvent);
          publishDraftUpdated(this.#eventHub, updatedDraft);
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
        publishStructuredEvent(this.#eventHub, completedEvent);
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
    publishSessionUpdated(this.#eventHub, runningSession);
    publishSessionOutput(
      this.#eventHub,
      this.#store,
      session.id,
      attemptId,
      useDockerRuntime
        ? `Launching Codex in Docker for ${session.worktree_path}`
        : `Launching Codex in ${session.worktree_path}`,
    );
    publishSessionOutput(
      this.#eventHub,
      this.#store,
      session.id,
      attemptId,
      `Command: codex ${args.slice(0, -1).join(" ")} <prompt>`,
    );
    if (shouldResumeCodex) {
      publishSessionOutput(
        this.#eventHub,
        this.#store,
        session.id,
        attemptId,
        `Resuming Codex session: ${codexSessionId}`,
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
    if (session.planning_enabled) {
      publishSessionOutput(
        this.#eventHub,
        this.#store,
        session.id,
        attemptId,
        executionMode === "plan"
          ? "Planning mode enabled: Codex will outline a plan before editing."
          : "Approved plan confirmed: Codex will now implement the ticket.",
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
        publishSessionUpdated(this.#eventHub, updatedSession);
      }

      publishSessionOutput(
        this.#eventHub,
        this.#store,
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
        publishSessionOutput(
          this.#eventHub,
          this.#store,
          session.id,
          attemptId,
          summarizeCodexJsonLine(line),
        );
      }
    });

    child.onExit(async ({ exitCode, signal }) => {
      const stopReason = this.#stoppingSessions.get(session.id);
      if (stopReason) {
        this.#stoppingSessions.delete(session.id);
        this.#activeSessions.delete(session.id);
        this.cleanupExecutionEnvironment(session.id);
        resolveTrackedExit(this.#exitWaiters, session.id, true);
        return;
      }

      if (pendingBuffer.trim().length > 0) {
        persistCodexSessionId(pendingBuffer);
        publishSessionOutput(
          this.#eventHub,
          this.#store,
          session.id,
          attemptId,
          summarizeCodexJsonLine(pendingBuffer),
        );
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
        resolveTrackedExit(this.#exitWaiters, session.id, true);
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
      resolveTrackedExit(this.#exitWaiters, session.id, true);
    });
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
      const summary =
        "Codex finished, but one or more required validation commands failed.";
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
      publishSessionUpdated(this.#eventHub, failedSession);
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
      "Codex finished successfully.",
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
    publishSessionUpdated(this.#eventHub, completedSession);
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
    publishSessionUpdated(this.#eventHub, waitingSession);
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
    publishSessionUpdated(this.#eventHub, failedSession);
    this.startQueuedSessions(input.ticket.project);
  }
}
