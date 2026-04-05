import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

import type {
  Project,
  RepositoryConfig,
  ValidationResult,
} from "../../../../../packages/contracts/src/index.js";

import { type EventHub, makeProtocolEvent } from "../event-hub.js";
import type { SessionPersistence } from "../store.js";
import { nowIso } from "../time.js";
import {
  buildValidationLogPath,
  resolveValidationWorkingDirectory,
  streamLines,
} from "./helpers.js";
import { publishSessionOutput } from "./publishers.js";

export async function runValidationProfile(input: {
  eventHub: EventHub;
  store: SessionPersistence;
  project: Project;
  repository: RepositoryConfig;
  ticketId: number;
  sessionId: string;
  attemptId: string;
  worktreePath: string;
}): Promise<{
  results: ValidationResult[];
  blockingFailure: boolean;
  remainingRisks: string[];
}> {
  if (input.repository.validation_profile.length === 0) {
    return {
      results: [],
      blockingFailure: false,
      remainingRisks: [],
    };
  }

  const results: ValidationResult[] = [];
  let blockingFailure = false;
  const remainingRisks: string[] = [];

  for (const command of input.repository.validation_profile) {
    publishSessionOutput(
      input.eventHub,
      input.store,
      input.sessionId,
      input.attemptId,
      `Running validation: ${command.label} (${command.command})`,
    );
    const startedAt = nowIso();
    const workingDirectory = resolveValidationWorkingDirectory(
      command,
      input.repository,
      input.worktreePath,
    );
    const logLines: string[] = [];
    const child = spawn(command.command, {
      cwd: workingDirectory,
      env: process.env,
      shell: command.shell,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const result = await new Promise<ValidationResult>((resolve) => {
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, command.timeout_ms);

      streamLines(child.stdout, (line) => {
        logLines.push(line);
        publishSessionOutput(
          input.eventHub,
          input.store,
          input.sessionId,
          input.attemptId,
          `[validation ${command.label}] ${line}`,
        );
      });

      streamLines(child.stderr, (line) => {
        logLines.push(line);
        publishSessionOutput(
          input.eventHub,
          input.store,
          input.sessionId,
          input.attemptId,
          `[validation ${command.label} stderr] ${line}`,
        );
      });

      child.once("error", (error) => {
        clearTimeout(timeout);
        const endedAt = nowIso();
        const logRef = buildValidationLogPath(
          input.project,
          input.ticketId,
          command.id,
        );
        writeFileSync(logRef, logLines.join("\n"), "utf8");
        resolve({
          command_id: command.id,
          label: command.label,
          status: "failed",
          started_at: startedAt,
          ended_at: endedAt,
          exit_code: null,
          failure_overridden: false,
          summary: `Validation failed to start: ${error.message}`,
          log_ref: logRef,
        });
      });

      child.once("close", (code) => {
        clearTimeout(timeout);
        const endedAt = nowIso();
        const logRef = buildValidationLogPath(
          input.project,
          input.ticketId,
          command.id,
        );
        writeFileSync(logRef, logLines.join("\n"), "utf8");
        resolve({
          command_id: command.id,
          label: command.label,
          status: code === 0 && !timedOut ? "passed" : "failed",
          started_at: startedAt,
          ended_at: endedAt,
          exit_code: code === null ? null : code,
          failure_overridden: false,
          summary:
            code === 0 && !timedOut
              ? `${command.label} passed.`
              : timedOut
                ? `${command.label} timed out after ${command.timeout_ms}ms.`
                : `${command.label} failed with exit code ${code === null ? "unknown" : code}.`,
          log_ref: logRef,
        });
      });
    });

    results.push(result);
    input.eventHub.publish(
      makeProtocolEvent("validation.updated", "session", input.sessionId, {
        session_id: input.sessionId,
        result,
      }),
    );

    if (result.status === "failed") {
      if (command.required_for_review) {
        blockingFailure = true;
      } else {
        remainingRisks.push(`${command.label} failed during validation.`);
      }
    }
  }

  return {
    results,
    blockingFailure,
    remainingRisks,
  };
}
