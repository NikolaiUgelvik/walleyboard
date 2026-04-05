import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { z } from "zod";

import type {
  Project,
  RepositoryConfig,
  TicketFrontmatter,
} from "../../../../packages/contracts/src/index.js";

import { resolveProjectAgentConfigFileOverrides } from "./agent-adapters/agent-config-overrides.js";
import type {
  AgentCliAdapter,
  PullRequestBodyResult,
  PullRequestBodyRunInput,
} from "./agent-adapters/types.js";
import {
  clearObservedExecutionActivity,
  upsertObservedExecutionActivity,
} from "./backend-observability.js";
import type { DockerRuntime } from "./docker-runtime.js";
import {
  buildProcessEnv,
  buildPullRequestBodyOutputPath,
  hasMeaningfulContent,
  streamChildProcessLines,
} from "./execution-runtime/helpers.js";
import { spawnUnattendedProcessInSession } from "./execution-runtime/spawn-unattended-process.js";

const pullRequestBodyResultSchema = z
  .object({
    body: z.string(),
  })
  .strict();

export type PullRequestBodyGenerationContext = Omit<
  PullRequestBodyRunInput,
  | "outputPath"
  | "project"
  | "repository"
  | "session"
  | "ticket"
  | "useDockerRuntime"
> & {
  project: Project;
  repository: RepositoryConfig;
  session: PullRequestBodyRunInput["session"];
  ticket: TicketFrontmatter;
};

export async function generatePullRequestBody(input: {
  adapter: AgentCliAdapter;
  context: PullRequestBodyGenerationContext;
  dockerRuntime: DockerRuntime;
  onLogLine?: (line: string) => void;
  onPreparedRun?: (run: { prompt: string }) => void;
}): Promise<PullRequestBodyResult> {
  const worktreePath = input.context.session.worktree_path;
  if (!worktreePath) {
    throw new Error("Execution session has no prepared worktree");
  }

  const outputPath = buildPullRequestBodyOutputPath(
    input.context.project,
    input.context.ticket.id,
    input.context.session.id,
  );
  const run = input.adapter.buildPullRequestBodyRun({
    ...input.context,
    outputPath,
    useDockerRuntime: true,
  });
  input.onPreparedRun?.({ prompt: run.prompt });

  const activityId = `pr-body-${input.context.ticket.id}-${input.context.session.id}`;
  const launchLines = [
    `Launching ${input.adapter.label} pull request body generation in Docker for ${worktreePath}`,
    `Command: ${run.command} ${run.args.slice(0, -1).join(" ")} <prompt>`,
  ];
  for (const line of launchLines) {
    input.onLogLine?.(line);
  }

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
          input.context.project,
        ),
        dockerSpec: run.dockerSpec,
        sessionId: activityId,
        projectId: input.context.project.id,
        ticketId: input.context.ticket.id,
        worktreePath,
      });
      child = spawnUnattendedProcessInSession({
        cwd: worktreePath,
        dockerRuntime: input.dockerRuntime,
        env: buildProcessEnv(),
        run,
        sessionId: activityId,
      });
    } catch (error) {
      reject(
        error instanceof Error
          ? error
          : new Error(
              `${input.adapter.label} failed to start pull request body generation.`,
            ),
      );
      return;
    }

    let lastOutputContent: string | null = null;
    let rawOutput = "";
    let settled = false;

    upsertObservedExecutionActivity({
      activityId,
      activityType: "review",
      adapter: input.adapter.id,
      containerId:
        input.dockerRuntime.getSessionContainerInfo(activityId)?.id ?? null,
      containerName:
        input.dockerRuntime.getSessionContainerInfo(activityId)?.name ?? null,
      executionMode: "non_pty",
      lastOutputAt: null,
      startedAt,
      ticketId: input.context.ticket.id,
    });

    const cleanup = () => {
      if (settled) {
        return false;
      }

      settled = true;
      clearObservedExecutionActivity(activityId);
      input.dockerRuntime.cleanupSessionContainer(activityId);
      return true;
    };

    const finish = (body: PullRequestBodyResult) => {
      if (!cleanup()) {
        return;
      }
      resolve(body);
    };

    streamChildProcessLines(child, {
      onError: (error) => {
        if (!cleanup()) {
          return;
        }
        reject(error);
      },
      onExit: ({ exitCode, signal }) => {
        const outputFromFile = existsSync(outputPath)
          ? readFileSync(outputPath, "utf8").trim()
          : "";
        const bodyOutput =
          outputFromFile || lastOutputContent?.trim() || rawOutput.trim() || "";

        if (exitCode !== 0) {
          if (!cleanup()) {
            return;
          }
          reject(
            new Error(
              input.adapter.formatExitReason(
                exitCode ?? null,
                signal,
                bodyOutput,
              ),
            ),
          );
          return;
        }

        try {
          const parsed = input.adapter.parseDraftResult(
            bodyOutput,
            pullRequestBodyResultSchema,
          );
          const trimmedBody = parsed.body.trim();
          if (!hasMeaningfulContent(trimmedBody)) {
            throw new Error("Generated pull request body is empty.");
          }
          finish({ body: trimmedBody });
        } catch (error) {
          if (!cleanup()) {
            return;
          }
          reject(
            error instanceof Error
              ? error
              : new Error("Unable to parse the generated pull request body."),
          );
        }
      },
      onLine: (line) => {
        rawOutput += `${line}\n`;
        const interpreted = input.adapter.interpretOutputLine(line);
        input.onLogLine?.(interpreted.logLine);
        if (hasMeaningfulContent(interpreted.outputContent)) {
          lastOutputContent = interpreted.outputContent;
        }
        upsertObservedExecutionActivity({
          activityId,
          activityType: "review",
          adapter: input.adapter.id,
          containerId:
            input.dockerRuntime.getSessionContainerInfo(activityId)?.id ?? null,
          containerName:
            input.dockerRuntime.getSessionContainerInfo(activityId)?.name ??
            null,
          executionMode: "non_pty",
          lastOutputAt: new Date().toISOString(),
          startedAt,
          ticketId: input.context.ticket.id,
        });
      },
    });
  });
}
