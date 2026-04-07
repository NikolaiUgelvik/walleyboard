import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import {
  type ExecutionSession,
  type Project,
  type RepositoryConfig,
  type ReviewPackage,
  type ReviewReport,
  reviewReportSchema,
  type TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import { resolveProjectAgentConfigFileOverrides } from "../agent-adapters/agent-config-overrides.js";
import type { AgentCliAdapter } from "../agent-adapters/types.js";
import {
  clearObservedExecutionActivity,
  upsertObservedExecutionActivity,
} from "../backend-observability.js";
import type { DockerRuntime } from "../docker-runtime.js";
import { getAgentEnvOverrides } from "../walleyboard-conf.js";
import {
  buildProcessEnv,
  buildReviewRunOutputPath,
  formatPreparedRunCommand,
  hasMeaningfulContent,
  streamChildProcessLines,
} from "./helpers.js";
import { allocatePort, startHostSidecar } from "./host-sidecar.js";
import { spawnUnattendedProcessInSession } from "./spawn-unattended-process.js";
import { resolveTrackedExit } from "./waiters.js";

export async function runTicketReviewSession(input: {
  activeReviewRuns: Map<string, { kill(signal?: NodeJS.Signals): unknown }>;
  adapter: AgentCliAdapter;
  cleanupExecutionEnvironment: (sessionId: string) => void;
  dockerRuntime: DockerRuntime;
  registerHostSidecar: (
    sessionId: string,
    sidecar: { kill: () => void },
  ) => void;
  onLogLine?: (line: string) => void;
  onPreparedRun?: (run: { prompt: string }) => void;
  project: Project;
  repository: RepositoryConfig;
  reviewPackage: ReviewPackage;
  reviewRunExitWaiters: Map<string, Set<(didExit: boolean) => void>>;
  reviewRunId: string;
  session: ExecutionSession;
  ticket: TicketFrontmatter;
}): Promise<{
  adapterSessionRef: string | null;
  report: ReviewReport;
}> {
  const worktreePath = input.session.worktree_path;
  if (!worktreePath) {
    throw new Error("Execution session has no prepared worktree");
  }

  const outputPath = buildReviewRunOutputPath(
    input.project,
    input.ticket.id,
    input.reviewRunId,
  );
  const mcpPort = await allocatePort();
  const run = input.adapter.buildReviewRun({
    mcpPort,
    outputPath,
    project: input.project,
    repository: input.repository,
    resultSchema: reviewReportSchema,
    reviewPackage: input.reviewPackage,
    session: input.session,
    ticket: input.ticket,
    useDockerRuntime: true,
  });
  input.onPreparedRun?.({ prompt: run.prompt });
  const reviewSessionId = `review-${input.reviewRunId}`;
  const launchLines = [
    `Launching ${input.adapter.label} review run in Docker for ${worktreePath}`,
    `Command: ${formatPreparedRunCommand(run)}`,
  ];
  for (const line of launchLines) {
    input.onLogLine?.(line);
  }

  if (run.hostSidecar) {
    const sidecar = await startHostSidecar(run.hostSidecar);
    input.registerHostSidecar(reviewSessionId, sidecar);
  }

  const agentEnvOverrides = await getAgentEnvOverrides(input.adapter.id);

  return await new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    const startedAt = new Date().toISOString();
    try {
      if (!run.dockerSpec) {
        throw new Error(
          `${input.adapter.label} does not provide a Docker execution configuration.`,
        );
      }
      input.dockerRuntime.ensureSessionContainer({
        configFileOverrides: resolveProjectAgentConfigFileOverrides(
          input.adapter.id,
          input.project,
        ),
        dockerSpec: run.dockerSpec,
        sessionId: reviewSessionId,
        projectId: input.project.id,
        ticketId: input.ticket.id,
        worktreePath,
      });
      child = spawnUnattendedProcessInSession({
        cwd: worktreePath,
        dockerRuntime: input.dockerRuntime,
        env: buildProcessEnv(agentEnvOverrides),
        run,
        sessionId: reviewSessionId,
      });
    } catch (error) {
      reject(
        error instanceof Error
          ? error
          : new Error(`${input.adapter.label} failed to start the review run.`),
      );
      return;
    }

    let adapterSessionRef: string | null = null;
    let lastOutputContent: string | null = null;
    let rawOutput = "";
    let settled = false;
    upsertObservedExecutionActivity({
      activityId: reviewSessionId,
      activityType: "review",
      adapter: input.adapter.id,
      containerId:
        input.dockerRuntime.getSessionContainerInfo(reviewSessionId)?.id ??
        null,
      containerName:
        input.dockerRuntime.getSessionContainerInfo(reviewSessionId)?.name ??
        null,
      executionMode: "non_pty",
      lastOutputAt: null,
      startedAt,
      ticketId: input.ticket.id,
    });

    const cleanupTrackedRun = () => {
      if (settled) {
        return false;
      }

      settled = true;
      input.activeReviewRuns.delete(input.reviewRunId);
      clearObservedExecutionActivity(reviewSessionId);
      input.cleanupExecutionEnvironment(reviewSessionId);
      resolveTrackedExit(input.reviewRunExitWaiters, input.reviewRunId, true);
      return true;
    };

    const finish = (
      handler: () => {
        adapterSessionRef: string | null;
        report: ReviewReport;
      },
    ) => {
      if (!cleanupTrackedRun()) {
        return;
      }
      try {
        resolve(handler());
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error("Unable to process the review run output."),
        );
      }
    };

    const handleLine = (line: string) => {
      rawOutput += `${line}\n`;
      const interpreted = input.adapter.interpretOutputLine(line);
      input.onLogLine?.(interpreted.logLine);
      if (
        hasMeaningfulContent(interpreted.sessionRef) &&
        interpreted.sessionRef !== adapterSessionRef
      ) {
        adapterSessionRef = interpreted.sessionRef;
      }
      if (hasMeaningfulContent(interpreted.outputContent)) {
        lastOutputContent = interpreted.outputContent;
      }
    };

    const handleExit = (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
    ) => {
      const outputFromFile = existsSync(outputPath)
        ? readFileSync(outputPath, "utf8").trim()
        : "";
      const reviewOutput =
        outputFromFile || lastOutputContent?.trim() || rawOutput.trim() || "";

      if (exitCode !== 0) {
        if (!cleanupTrackedRun()) {
          return;
        }
        reject(
          new Error(
            input.adapter.formatExitReason(
              exitCode ?? null,
              signal,
              reviewOutput,
            ),
          ),
        );
        return;
      }

      finish(() => ({
        adapterSessionRef,
        report: input.adapter.parseDraftResult(
          reviewOutput,
          reviewReportSchema,
        ),
      }));
    };

    input.activeReviewRuns.set(input.reviewRunId, child);
    streamChildProcessLines(child, {
      onError: (error) => {
        if (!cleanupTrackedRun()) {
          return;
        }
        reject(error);
      },
      onExit: ({ exitCode, signal }) => {
        handleExit(exitCode, signal);
      },
      onLine: (line) => {
        handleLine(line);
        upsertObservedExecutionActivity({
          activityId: reviewSessionId,
          activityType: "review",
          adapter: input.adapter.id,
          containerId:
            input.dockerRuntime.getSessionContainerInfo(reviewSessionId)?.id ??
            null,
          containerName:
            input.dockerRuntime.getSessionContainerInfo(reviewSessionId)
              ?.name ?? null,
          executionMode: "non_pty",
          lastOutputAt: new Date().toISOString(),
          startedAt,
          ticketId: input.ticket.id,
        });
      },
    });
  });
}
