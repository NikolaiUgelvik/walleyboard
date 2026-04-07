import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { nanoid } from "nanoid";

import type {
  DraftTicketState,
  Project,
  RepositoryConfig,
} from "../../../../../packages/contracts/src/index.js";

import { resolveProjectAgentConfigFileOverrides } from "../agent-adapters/agent-config-overrides.js";
import type { AgentCliAdapter } from "../agent-adapters/types.js";
import type { DockerRuntime } from "../docker-runtime.js";
import { preserveDraftArtifactImages } from "../draft-artifact-images.js";
import type { EventHub } from "../event-hub.js";
import type {
  DraftRefineSessionPersistence,
  ExecutionRuntimePersistence,
} from "../store.js";
import { getAgentEnvOverrides } from "../walleyboard-conf.js";
import {
  clearExecutionActivity,
  updateExecutionActivity,
} from "./activity-observability.js";
import {
  buildDraftAnalysisOutputPath,
  buildProcessEnv,
  hasMeaningfulContent,
  streamChildProcessLines,
  summarizeDraftQuestions,
  summarizeDraftRefinement,
  truncate,
} from "./helpers.js";
import { allocatePort, startHostSidecar } from "./host-sidecar.js";
import { publishDraftUpdated, publishStructuredEvent } from "./publishers.js";
import { spawnUnattendedProcessInSession } from "./spawn-unattended-process.js";
import {
  type DraftAnalysisMode,
  type DraftRefinementResult,
  draftAnalysisTimeoutMs,
  draftFeasibilityResultSchema,
  draftRefinementAgentResultSchema,
  mapDraftRefinementAgentResult,
} from "./types.js";

export type DraftAnalysisDeps = {
  activeDraftRuns: Map<string, { kill(signal?: NodeJS.Signals): unknown }>;
  adapter: AgentCliAdapter;
  cleanupExecutionEnvironment: (sessionId: string) => void;
  cleanupHostSidecar: (sessionId: string) => void;
  dockerRuntime: DockerRuntime;
  draftRefineSessionRepo: DraftRefineSessionPersistence | null;
  eventHub: EventHub;
  registerHostSidecar: (
    sessionId: string,
    sidecar: { kill: () => void },
  ) => void;
  store: ExecutionRuntimePersistence;
};

const maxDraftRefineAttempts = 3;

export async function startDraftAnalysis(
  deps: DraftAnalysisDeps,
  input: {
    mode: DraftAnalysisMode;
    draft: DraftTicketState;
    project: Project;
    repository: RepositoryConfig;
    instruction?: string | undefined;
  },
): Promise<void> {
  const { mode, draft, project, repository, instruction } = input;
  const {
    activeDraftRuns,
    adapter,
    cleanupExecutionEnvironment,
    cleanupHostSidecar,
    dockerRuntime,
    draftRefineSessionRepo,
    eventHub,
    registerHostSidecar: registerSidecar,
    store,
  } = deps;

  if (activeDraftRuns.has(draft.id)) {
    throw new Error("Draft analysis already running");
  }

  const runId = nanoid();

  let refineSession =
    mode === "refine" && draftRefineSessionRepo
      ? draftRefineSessionRepo.create({
          draftId: draft.id,
          projectId: project.id,
          repositoryId: repository.id,
        })
      : null;

  let attemptNumber = 0;
  let capturedSessionRef: string | null = null;

  const startedEvent = store.recordDraftEvent(
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
      attempt_number: attemptNumber,
      resumed: false,
    },
  );
  publishStructuredEvent(eventHub, startedEvent);

  const agentEnvOverrides = await getAgentEnvOverrides(adapter.id);
  const processEnv = buildProcessEnv(agentEnvOverrides);
  const startedAt = new Date().toISOString();

  const failEarly = (message: string): void => {
    cleanupExecutionEnvironment(runId);
    clearExecutionActivity(runId);
    if (refineSession) {
      draftRefineSessionRepo?.complete(refineSession.id, "failed");
    }
    const failedEvent = store.recordDraftEvent(
      draft.id,
      `draft.${mode}.failed`,
      {
        run_id: runId,
        operation: mode,
        status: "failed",
        repository_id: repository.id,
        repository_name: repository.name,
        summary: message,
        error: message,
        captured_output: [],
        attempt_number: attemptNumber,
        resumed: false,
      },
    );
    publishStructuredEvent(eventHub, failedEvent);
  };

  const spawnAttempt = async (): Promise<void> => {
    const outputPath = buildDraftAnalysisOutputPath(
      project,
      draft.id,
      runId,
      mode,
    );
    const mcpPort = await allocatePort();
    const run = adapter.buildDraftRun({
      draft,
      mcpPort,
      mode,
      outputPath,
      project,
      resultSchema:
        mode === "refine"
          ? draftRefinementAgentResultSchema
          : draftFeasibilityResultSchema,
      repository,
      useDockerRuntime: true,
      ...(hasMeaningfulContent(instruction) ? { instruction } : {}),
      ...(attemptNumber > 0 && capturedSessionRef
        ? { adapterSessionRef: capturedSessionRef }
        : {}),
      ...(attemptNumber > 0 ? { retryAttempt: attemptNumber } : {}),
    });

    let child: ChildProcessWithoutNullStreams;

    try {
      if (!run.dockerSpec) {
        throw new Error(
          `${adapter.label} does not provide a Docker execution configuration.`,
        );
      }
      dockerRuntime.ensureSessionContainer({
        configFileOverrides: resolveProjectAgentConfigFileOverrides(
          adapter.id,
          project,
        ),
        dockerSpec: run.dockerSpec,
        sessionId: runId,
        projectId: project.id,
        ticketId: 0,
        worktreePath: repository.path,
      });
      if (run.hostSidecar) {
        const sidecar = await startHostSidecar(run.hostSidecar);
        registerSidecar(runId, sidecar);
      }
      child = spawnUnattendedProcessInSession({
        cwd: repository.path,
        dockerRuntime,
        env: processEnv,
        run,
        sessionId: runId,
      });
    } catch (error) {
      failEarly(
        error instanceof Error
          ? error.message
          : `${adapter.label} failed to start`,
      );
      return;
    }

    activeDraftRuns.set(draft.id, child);
    updateExecutionActivity(dockerRuntime, {
      activityId: runId,
      activityType: "draft",
      adapter: adapter.id,
      startedAt,
      ticketId: 0,
    });

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

    const failRun = (reason: string): void => {
      if (finalized) {
        return;
      }

      finalized = true;
      activeDraftRuns.delete(draft.id);
      clearExecutionActivity(runId);
      cleanupExecutionEnvironment(runId);
      if (refineSession) {
        draftRefineSessionRepo?.complete(refineSession.id, "failed");
      }
      const failedEvent = store.recordDraftEvent(
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
          attempt_number: attemptNumber,
          resumed: attemptNumber > 0,
        },
      );
      publishStructuredEvent(eventHub, failedEvent);
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

    const completeRun = (exitCode: number): void => {
      clearTimeout(timeoutId);
      if (finalized) {
        return;
      }

      clearExecutionActivity(runId);

      const rawOutput = existsSync(outputPath)
        ? readFileSync(outputPath, "utf8").trim()
        : "";

      if (exitCode !== 0) {
        failRun(adapter.formatExitReason(exitCode, null, rawOutput));
        return;
      }

      try {
        if (mode === "refine") {
          const beforeDraft = store.getDraft(draft.id);
          const agentResult = adapter.parseDraftResult(
            rawOutput,
            draftRefinementAgentResultSchema,
          );
          const result = mapDraftRefinementAgentResult(agentResult);
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
          const updatedDraft = store.updateDraft(draft.id, {
            title_draft: finalResult.title_draft,
            description_draft: finalResult.description_draft,
            proposed_ticket_type: finalResult.proposed_ticket_type,
            proposed_acceptance_criteria:
              finalResult.proposed_acceptance_criteria,
            split_proposal_summary: finalResult.split_proposal_summary ?? null,
            wizard_status: "awaiting_confirmation",
          });

          finalized = true;
          activeDraftRuns.delete(draft.id);
          clearExecutionActivity(runId);
          cleanupExecutionEnvironment(runId);
          if (refineSession) {
            draftRefineSessionRepo?.complete(refineSession.id, "completed");
          }
          const completedEvent = store.recordDraftEvent(
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
              attempt_number: attemptNumber,
              resumed: attemptNumber > 0,
            },
          );
          publishStructuredEvent(eventHub, completedEvent);
          publishDraftUpdated(eventHub, updatedDraft);
          return;
        }

        const result = adapter.parseDraftResult(
          rawOutput,
          draftFeasibilityResultSchema,
        );
        finalized = true;
        activeDraftRuns.delete(draft.id);
        clearExecutionActivity(runId);
        cleanupExecutionEnvironment(runId);
        const completedEvent = store.recordDraftEvent(
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
            attempt_number: attemptNumber,
            resumed: attemptNumber > 0,
          },
        );
        publishStructuredEvent(eventHub, completedEvent);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : `Unable to process ${adapter.label} output`;

        const isJsonParseFailure =
          mode === "refine" &&
          error instanceof Error &&
          error.message.includes("did not return valid JSON output");

        if (isJsonParseFailure && attemptNumber + 1 < maxDraftRefineAttempts) {
          attemptNumber++;

          if (refineSession) {
            refineSession =
              draftRefineSessionRepo?.recordAttempt(refineSession.id, {
                adapterSessionRef: capturedSessionRef,
                attemptCount: attemptNumber,
              }) ?? refineSession;
          }

          const retryEvent = store.recordDraftEvent(
            draft.id,
            "draft.refine.retrying",
            {
              run_id: runId,
              operation: mode,
              status: "retrying",
              attempt_number: attemptNumber,
              resumed: capturedSessionRef != null,
              repository_id: repository.id,
              repository_name: repository.name,
              summary: `Retrying draft refinement (attempt ${attemptNumber + 1} of ${maxDraftRefineAttempts}) — previous attempt returned invalid JSON.`,
            },
          );
          publishStructuredEvent(eventHub, retryEvent);

          activeDraftRuns.delete(draft.id);
          cleanupHostSidecar(runId);

          finalized = true;

          spawnAttempt().catch((retryError) => {
            failEarly(
              retryError instanceof Error
                ? retryError.message
                : `${adapter.label} retry failed to start`,
            );
          });
          return;
        }

        failRun(message);
      }
    };

    streamChildProcessLines(child, {
      onError: (error) => {
        clearTimeout(timeoutId);
        failRun(error.message || `${adapter.label} failed to start`);
      },
      onExit: ({ exitCode }) => {
        completeRun(exitCode ?? -1);
      },
      onLine: (line) => {
        const interpreted = adapter.interpretOutputLine(line);
        captureLine(interpreted.logLine);
        if (interpreted.sessionRef) {
          capturedSessionRef = interpreted.sessionRef;
        }
        updateExecutionActivity(dockerRuntime, {
          activityId: runId,
          activityType: "draft",
          adapter: adapter.id,
          lastOutputAt: new Date().toISOString(),
          startedAt,
          ticketId: 0,
        });
      },
    });
  };

  await spawnAttempt();
}
