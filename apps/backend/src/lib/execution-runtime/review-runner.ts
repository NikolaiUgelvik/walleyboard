import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
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

import type { AgentCliAdapter } from "../agent-adapters/types.js";
import type { DockerRuntimeManager } from "../docker-runtime.js";
import {
  buildProcessEnv,
  buildReviewRunOutputPath,
  buildWorkspaceOutputPath,
  hasMeaningfulContent,
  streamLines,
} from "./helpers.js";

export async function runTicketReviewSession(input: {
  activeReviewRuns: Map<string, ChildProcessWithoutNullStreams>;
  adapter: AgentCliAdapter;
  cleanupExecutionEnvironment: (sessionId: string) => void;
  dockerRuntime: DockerRuntimeManager;
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
  const reviewSessionId = `review-${input.reviewRunId}`;

  return await new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
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
        child = input.dockerRuntime.spawnProcessInSession(
          reviewSessionId,
          run.command,
          run.args,
          {
            cwd: worktreePath,
            env: buildProcessEnv(),
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

    input.activeReviewRuns.set(input.reviewRunId, child);

    let adapterSessionRef: string | null = null;
    let lastOutputContent: string | null = null;
    let rawOutput = "";

    const finish = (
      handler: () => {
        adapterSessionRef: string | null;
        report: ReviewReport;
      },
    ) => {
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

    streamLines(child.stdout, (line) => {
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
    });
    streamLines(child.stderr, (line) => {
      rawOutput += `${line}\n`;
    });

    child.once("error", (error) => {
      input.activeReviewRuns.delete(input.reviewRunId);
      if (useDockerRuntime) {
        input.cleanupExecutionEnvironment(reviewSessionId);
      }
      reject(
        error instanceof Error
          ? error
          : new Error(`${input.adapter.label} review execution failed.`),
      );
    });

    child.once("close", (exitCode, signal) => {
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
    });
  });
}
