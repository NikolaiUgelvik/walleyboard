import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type { IPty } from "node-pty";

import {
  type ExecutionSession,
  type Project,
  type RepositoryConfig,
  type ReviewPackage,
  type ReviewReport,
  reviewReportSchema,
  type TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import type { AgentCliAdapter } from "../agent-adapters/types.js";
import type { DockerRuntime } from "../docker-runtime.js";
import {
  buildProcessEnv,
  buildReviewRunOutputPath,
  buildWorkspaceOutputPath,
  hasMeaningfulContent,
  streamLines,
} from "./helpers.js";

export async function runTicketReviewSession(input: {
  activeReviewRuns: Map<string, { kill(signal?: NodeJS.Signals): unknown }>;
  adapter: AgentCliAdapter;
  cleanupExecutionEnvironment: (sessionId: string) => void;
  dockerRuntime: DockerRuntime;
  onPreparedRun?: (run: { prompt: string }) => void;
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
  const worktreePath = input.session.worktree_path;
  if (!worktreePath) {
    throw new Error("Execution session has no prepared worktree");
  }

  const useDockerRuntime = input.project.execution_backend === "docker";
  const outputPath = useDockerRuntime
    ? buildWorkspaceOutputPath(worktreePath, input.reviewRunId, "review")
    : buildReviewRunOutputPath(
        input.project,
        input.ticket.id,
        input.reviewRunId,
      );
  const run = input.adapter.buildReviewRun({
    outputPath,
    project: input.project,
    repository: input.repository,
    reviewPackage: input.reviewPackage,
    session: input.session,
    ticket: input.ticket,
    useDockerRuntime,
  });
  input.onPreparedRun?.({ prompt: run.prompt });
  const reviewSessionId = `review-${input.reviewRunId}`;

  return await new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams | IPty;
    try {
      if (useDockerRuntime) {
        if (!run.dockerSpec) {
          throw new Error(
            `${input.adapter.label} does not provide a Docker execution configuration.`,
          );
        }
        input.dockerRuntime.ensureSessionContainer({
          dockerSpec: run.dockerSpec,
          sessionId: reviewSessionId,
          projectId: input.project.id,
          ticketId: input.ticket.id,
          worktreePath,
        });
        child = input.dockerRuntime.spawnPtyInSession(
          reviewSessionId,
          run.command,
          run.args,
          {
            cols: 120,
            rows: 32,
            cwd: worktreePath,
            env: buildProcessEnv(),
            name: "xterm-256color",
          },
        );
      } else {
        child = spawn(run.command, run.args, {
          cwd: worktreePath,
          env: buildProcessEnv(),
        });
      }
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

    const finish = (
      handler: () => {
        adapterSessionRef: string | null;
        report: ReviewReport;
      },
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      input.activeReviewRuns.delete(input.reviewRunId);
      if (useDockerRuntime) {
        input.cleanupExecutionEnvironment(reviewSessionId);
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
        input.activeReviewRuns.delete(input.reviewRunId);
        if (useDockerRuntime) {
          input.cleanupExecutionEnvironment(reviewSessionId);
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

    if (useDockerRuntime) {
      const dockerChild = child as IPty;
      input.activeReviewRuns.set(input.reviewRunId, dockerChild);
      let pendingBuffer = "";
      dockerChild.onData((chunk: string) => {
        pendingBuffer += chunk.replace(/\r\n/g, "\n");

        while (pendingBuffer.includes("\n")) {
          const newlineIndex = pendingBuffer.indexOf("\n");
          const line = pendingBuffer.slice(0, newlineIndex);
          pendingBuffer = pendingBuffer.slice(newlineIndex + 1);
          handleLine(line);
        }
      });
      dockerChild.onExit(
        ({
          exitCode,
          signal: _signal,
        }: {
          exitCode: number;
          signal?: number;
        }) => {
          if (pendingBuffer.trim().length > 0) {
            handleLine(pendingBuffer);
            pendingBuffer = "";
          }
          handleExit(exitCode, null);
        },
      );
      return;
    }

    const processChild = child as ChildProcessWithoutNullStreams;
    input.activeReviewRuns.set(input.reviewRunId, processChild);
    streamLines(processChild.stdout, handleLine);
    streamLines(processChild.stderr, (line) => {
      rawOutput += `${line}\n`;
    });

    processChild.once("error", (error: Error) => {
      finish(() => {
        throw error instanceof Error
          ? error
          : new Error(`${input.adapter.label} review execution failed.`);
      });
    });

    processChild.once("close", (exitCode, signal) => {
      handleExit(exitCode, signal);
    });
  });
}
