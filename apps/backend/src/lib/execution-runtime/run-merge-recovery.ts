import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import type {
  ExecutionSession,
  Project,
  RepositoryConfig,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";
import { resolveProjectAgentConfigFileOverrides } from "../agent-adapters/agent-config-overrides.js";
import type { AgentCliAdapter } from "../agent-adapters/types.js";
import {
  clearObservedExecutionActivity,
  upsertObservedExecutionActivity,
} from "../backend-observability.js";
import type { DockerRuntime } from "../docker-runtime.js";
import {
  buildMergeConflictSummaryPath,
  buildProcessEnv,
  formatPreparedRunCommand,
  hasMeaningfulContent,
  streamChildProcessLines,
  truncate,
} from "./helpers.js";
import type { MergeRecoveryKind } from "./merge-recovery.js";
import {
  formatMergeRecoveryFailureNote,
  formatMergeRecoveryLaunchLabel,
} from "./merge-recovery.js";
import { spawnUnattendedProcessInSession } from "./spawn-unattended-process.js";

export async function runMergeRecovery(input: {
  adapter: AgentCliAdapter;
  cleanupExecutionEnvironment: (sessionId: string) => void;
  conflictedFiles: string[];
  dockerRuntime: DockerRuntime;
  failureMessage: string;
  onLogLine?: (line: string) => void;
  project: Project;
  recoveryKind: MergeRecoveryKind;
  repository: RepositoryConfig;
  session: ExecutionSession;
  stage: "rebase" | "merge";
  targetBranch: string;
  ticket: TicketFrontmatter;
}): Promise<{
  resolved: boolean;
  logs: string[];
  note?: string;
}> {
  const worktreePath = input.session.worktree_path;
  if (!worktreePath) {
    throw new Error("Execution session has no prepared worktree");
  }

  const outputSummaryPath = buildMergeConflictSummaryPath(
    input.project,
    input.ticket.id,
    input.session.id,
  );
  const run = input.adapter.buildMergeConflictRun({
    conflictedFiles: input.conflictedFiles,
    failureMessage: input.failureMessage,
    outputPath: outputSummaryPath,
    project: input.project,
    recoveryKind: input.recoveryKind,
    repository: input.repository,
    session: input.session,
    stage: input.stage,
    targetBranch: input.targetBranch,
    ticket: input.ticket,
    useDockerRuntime: true,
  });
  const { model, reasoningEffort } = input.adapter.resolveModelSelection(
    input.project,
    "ticket",
  );

  const logs = [
    `Launching ${input.adapter.label} ${formatMergeRecoveryLaunchLabel(input.recoveryKind)} in ${input.session.worktree_path}`,
    `Command: ${formatPreparedRunCommand(run)}`,
  ];
  if (model) {
    logs.push(`Model override: ${model}`);
  }
  if (reasoningEffort) {
    logs.push(`Reasoning effort override: ${reasoningEffort}`);
  }
  for (const line of logs) {
    input.onLogLine?.(line);
  }

  const ptyEnv = buildProcessEnv();
  writeFileSync(outputSummaryPath, "", "utf8");

  return await new Promise((resolve) => {
    let settled = false;
    let adapterOutput = "";
    const startedAt = new Date().toISOString();

    const finish = (result: {
      resolved: boolean;
      logs: string[];
      note?: string;
    }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearObservedExecutionActivity(input.session.id);
      input.cleanupExecutionEnvironment(input.session.id);
      resolve(result);
    };

    let child: ChildProcessWithoutNullStreams;
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
        sessionId: input.session.id,
        projectId: input.project.id,
        ticketId: input.ticket.id,
        worktreePath,
      });
      child = spawnUnattendedProcessInSession({
        cwd: worktreePath,
        dockerRuntime: input.dockerRuntime,
        env: ptyEnv,
        run,
        sessionId: input.session.id,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `${input.adapter.label} failed to start`;
      finish({
        resolved: false,
        logs,
        note: formatMergeRecoveryFailureNote({
          adapterLabel: input.adapter.label,
          message,
          recoveryKind: input.recoveryKind,
          stage: input.stage,
          targetBranch: input.targetBranch,
          when: "start",
        }),
      });
      return;
    }
    upsertObservedExecutionActivity({
      activityId: input.session.id,
      activityType: "session",
      adapter: input.adapter.id,
      containerId:
        input.dockerRuntime.getSessionContainerInfo(input.session.id)?.id ??
        null,
      containerName:
        input.dockerRuntime.getSessionContainerInfo(input.session.id)?.name ??
        null,
      executionMode: "non_pty",
      lastOutputAt: null,
      startedAt,
      ticketId: input.ticket.id,
    });

    let lastOutputContent: string | undefined;
    const captureAdapterLine = (line: string) => {
      const interpreted = input.adapter.interpretOutputLine(line);
      if (hasMeaningfulContent(interpreted.outputContent)) {
        lastOutputContent = interpreted.outputContent;
      }
      input.onLogLine?.(interpreted.logLine);
      if (logs.length < 16) {
        logs.push(interpreted.logLine);
      }
      adapterOutput += `${line}\n`;
    };

    streamChildProcessLines(child, {
      onError: (error) => {
        finish({
          resolved: false,
          logs,
          note: formatMergeRecoveryFailureNote({
            adapterLabel: input.adapter.label,
            message: error.message,
            recoveryKind: input.recoveryKind,
            stage: input.stage,
            targetBranch: input.targetBranch,
            when: "finish",
          }),
        });
      },
      onExit: ({ exitCode }) => {
        let summary = existsSync(outputSummaryPath)
          ? readFileSync(outputSummaryPath, "utf8").trim()
          : "";
        if (summary.length === 0 && lastOutputContent) {
          writeFileSync(outputSummaryPath, lastOutputContent, "utf8");
          summary = lastOutputContent.trim();
        }
        if (summary.length > 0) {
          const summaryLine = `Merge-conflict resolution summary: ${truncate(summary)}`;
          logs.push(summaryLine);
          input.onLogLine?.(summaryLine);
        }

        if (exitCode === 0) {
          finish({
            resolved: true,
            logs,
          });
          return;
        }

        const reason = input.adapter.formatExitReason(
          exitCode,
          null,
          summary || adapterOutput,
        );
        finish({
          resolved: false,
          logs,
          note: formatMergeRecoveryFailureNote({
            adapterLabel: input.adapter.label,
            message: reason,
            recoveryKind: input.recoveryKind,
            stage: input.stage,
            targetBranch: input.targetBranch,
            when: "finish",
          }),
        });
      },
      onLine: (line) => {
        captureAdapterLine(line);
        upsertObservedExecutionActivity({
          activityId: input.session.id,
          activityType: "session",
          adapter: input.adapter.id,
          containerId:
            input.dockerRuntime.getSessionContainerInfo(input.session.id)?.id ??
            null,
          containerName:
            input.dockerRuntime.getSessionContainerInfo(input.session.id)
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
