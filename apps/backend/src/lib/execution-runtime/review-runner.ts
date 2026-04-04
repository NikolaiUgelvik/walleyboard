import { existsSync, readFileSync } from "node:fs";
import { type IPty } from "node-pty";

import {
  type ExecutionSession,
  type Project,
  type RepositoryConfig,
  type ReviewPackage,
  type ReviewReport,
  reviewReportSchema,
  type TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import { writeCodexConfigOverride } from "../agent-adapters/codex-config.js";
import type { AgentCliAdapter } from "../agent-adapters/types.js";
import type { DockerRuntime } from "../docker-runtime.js";
import {
  buildProcessEnv,
  buildWorkspaceOutputPath,
  hasMeaningfulContent,
  streamPtyLines,
} from "./helpers.js";

export async function runTicketReviewSession(input: {
  activeReviewRuns: Map<string, { kill(signal?: NodeJS.Signals): unknown }>;
  adapter: AgentCliAdapter;
  cleanupExecutionEnvironment: (sessionId: string) => void;
  dockerRuntime: DockerRuntime;
  onLogLine?: (line: string) => void;
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

  const outputPath = buildWorkspaceOutputPath(
    worktreePath,
    input.reviewRunId,
    "review",
  );
  const run = input.adapter.buildReviewRun({
    outputPath,
    project: input.project,
    repository: input.repository,
    reviewPackage: input.reviewPackage,
    session: input.session,
    ticket: input.ticket,
    useDockerRuntime: true,
  });
  input.onPreparedRun?.({ prompt: run.prompt });
  const reviewSessionId = `review-${input.reviewRunId}`;
  const launchLines = [
    `Launching ${input.adapter.label} review run in Docker for ${worktreePath}`,
    `Command: ${run.command} ${run.args.slice(0, -1).join(" ")} <prompt>`,
  ];
  for (const line of launchLines) {
    input.onLogLine?.(line);
  }

  return await new Promise((resolve, reject) => {
    let child: IPty;
    try {
      if (!run.dockerSpec) {
        throw new Error(
          `${input.adapter.label} does not provide a Docker execution configuration.`,
        );
      }
      input.dockerRuntime.ensureSessionContainer({
        configTomlPath:
          input.adapter.id === "codex"
            ? writeCodexConfigOverride(input.project)
            : null,
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
      input.cleanupExecutionEnvironment(reviewSessionId);
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
        input.activeReviewRuns.delete(input.reviewRunId);
        input.cleanupExecutionEnvironment(reviewSessionId);
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
    streamPtyLines(child, {
      onExit: ({ exitCode }) => {
        handleExit(exitCode, null);
      },
      onLine: handleLine,
    });
  });
}
