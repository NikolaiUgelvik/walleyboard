import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import readline from "node:readline";

import type { ExecutionSession, Project, RepositoryConfig, TicketFrontmatter } from "@orchestrator/contracts";

import { makeProtocolEvent, type EventHub } from "./event-hub.js";
import type { Store } from "./store.js";

type ExecutionRuntimeOptions = {
  eventHub: EventHub;
  store: Store;
};

type StartExecutionInput = {
  project: Project;
  repository: RepositoryConfig;
  ticket: TicketFrontmatter;
  session: ExecutionSession;
};

function truncate(value: string, maxLength = 600): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

function runGit(repoPath: string, args: string[]): string {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function writeReviewDiff(project: Project, ticketId: number, diff: string): string {
  const reviewDir = join(process.cwd(), ".local", "review-packages", project.slug);
  ensureDirectory(reviewDir);
  const diffPath = join(reviewDir, `ticket-${ticketId}.patch`);
  writeFileSync(diffPath, diff, "utf8");
  return diffPath;
}

function buildOutputSummaryPath(project: Project, ticketId: number, sessionId: string): string {
  const summaryDir = join(process.cwd(), ".local", "codex-summaries", project.slug);
  ensureDirectory(summaryDir);
  return join(summaryDir, `ticket-${ticketId}-${sessionId}.txt`);
}

function buildCodexPrompt(ticket: TicketFrontmatter, repository: RepositoryConfig): string {
  const acceptanceCriteria =
    ticket.acceptance_criteria.length > 0
      ? ticket.acceptance_criteria.map((criterion) => `- ${criterion}`).join("\n")
      : "- Preserve the intended user workflow and keep the change small and focused.";

  return [
    `Implement ticket #${ticket.id} in the repository ${repository.name}.`,
    "",
    `Title: ${ticket.title}`,
    `Description: ${ticket.description}`,
    "",
    "Acceptance criteria:",
    acceptanceCriteria,
    "",
    "Execution rules:",
    "- Make the smallest complete change that satisfies the ticket.",
    "- Stay inside this repository worktree.",
    "- Run lightweight validation when it is obvious and inexpensive.",
    "- Create a git commit before finishing if you made code changes.",
    "- End with a concise summary that includes changed files, validation run, and remaining risks."
  ].join("\n");
}

function summarizeCodexJsonLine(line: string): string {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const eventType =
      typeof parsed.type === "string"
        ? parsed.type
        : typeof parsed.event === "string"
          ? parsed.event
          : "event";

    if (typeof parsed.message === "string") {
      return `[codex ${eventType}] ${truncate(parsed.message)}`;
    }

    if (typeof parsed.text === "string") {
      return `[codex ${eventType}] ${truncate(parsed.text)}`;
    }

    if (typeof parsed.output === "string") {
      return `[codex ${eventType}] ${truncate(parsed.output)}`;
    }

    return `[codex ${eventType}] ${truncate(JSON.stringify(parsed))}`;
  } catch {
    return `[codex raw] ${truncate(line)}`;
  }
}

function streamLines(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void
): void {
  const lineReader = readline.createInterface({
    input: stream,
    crlfDelay: Number.POSITIVE_INFINITY
  });

  lineReader.on("line", onLine);
}

export class ExecutionRuntime {
  readonly #eventHub: EventHub;
  readonly #store: Store;
  readonly #activeSessions = new Map<string, ReturnType<typeof spawn>>();

  constructor({ eventHub, store }: ExecutionRuntimeOptions) {
    this.#eventHub = eventHub;
    this.#store = store;
  }

  startExecution({ project, repository, ticket, session }: StartExecutionInput): void {
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

    const prompt = buildCodexPrompt(ticket, repository);
    const outputSummaryPath = buildOutputSummaryPath(project, ticket.id, session.id);
    const args = [
      "exec",
      "--json",
      "--full-auto",
      "--output-last-message",
      outputSummaryPath,
      prompt
    ];

    const child = spawn("codex", args, {
      cwd: session.worktree_path,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    this.#activeSessions.set(session.id, child);
    this.#store.updateExecutionAttempt(attemptId, {
      pty_pid: child.pid ?? null
    });
    const runningSession = this.#store.updateSessionStatus(
      session.id,
      "running",
      "Codex execution is running inside the prepared worktree."
    );
    this.#emitSessionUpdated(runningSession);
    this.#log(session.id, attemptId, `Launching Codex in ${session.worktree_path}`);
    this.#log(session.id, attemptId, `Command: codex ${args.slice(0, -1).join(" ")} <prompt>`);

    streamLines(child.stdout, (line) => {
      this.#log(session.id, attemptId, summarizeCodexJsonLine(line));
    });

    streamLines(child.stderr, (line) => {
      this.#log(session.id, attemptId, `[codex stderr] ${truncate(line)}`);
    });

    child.once("error", (error) => {
      this.#finishFailure({
        ticket,
        sessionId: session.id,
        attemptId,
        reason: `Codex failed to start: ${error.message}`
      });
    });

    child.once("close", (code, signal) => {
      const finalSummary = existsSync(outputSummaryPath)
        ? readFileSync(outputSummaryPath, "utf8").trim()
        : null;

      if (code === 0) {
        this.#finishSuccess({
          project,
          repository,
          ticketId: ticket.id,
          sessionId: session.id,
          attemptId,
          targetBranch: ticket.target_branch,
          summary:
            finalSummary && finalSummary.length > 0
              ? finalSummary
              : "Codex finished successfully, but no final summary was captured."
        });
        return;
      }

      this.#finishFailure({
        ticket,
        sessionId: session.id,
        attemptId,
        reason: `Codex exited with ${code === null ? "unknown code" : `code ${code}`}${
          signal ? ` and signal ${signal}` : ""
        }.${finalSummary ? ` Final summary: ${finalSummary}` : ""}`
      });
    });
  }

  #emitSessionUpdated(session: ExecutionSession | undefined): void {
    if (!session) {
      return;
    }

    this.#eventHub.publish(
      makeProtocolEvent("session.updated", "session", session.id, {
        session
      })
    );
  }

  #emitTicketUpdated(ticket: TicketFrontmatter | undefined): void {
    if (!ticket) {
      return;
    }

    this.#eventHub.publish(
      makeProtocolEvent("ticket.updated", "ticket", String(ticket.id), {
        ticket
      })
    );
  }

  #log(sessionId: string, attemptId: string, line: string): void {
    const sequence = this.#store.appendSessionLog(sessionId, line);
    this.#eventHub.publish(
      makeProtocolEvent("session.output", "session", sessionId, {
        session_id: sessionId,
        attempt_id: attemptId,
        sequence,
        chunk: line
      })
    );
  }

  #finishSuccess(input: {
    project: Project;
    repository: RepositoryConfig;
    ticketId: number;
    sessionId: string;
    attemptId: string;
    targetBranch: string;
    summary: string;
  }): void {
    this.#activeSessions.delete(input.sessionId);
    this.#store.updateExecutionAttempt(input.attemptId, {
      status: "completed",
      end_reason: "completed"
    });

    const session = this.#store.getSession(input.sessionId);
    const worktreePath = session?.worktree_path;
    if (!session || !worktreePath) {
      return;
    }

    let commitRefs: string[] = [];
    let diffRef = "";

    try {
      commitRefs = runGit(worktreePath, ["log", "--format=%H", `${input.targetBranch}..HEAD`])
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      if (commitRefs.length === 0) {
        throw new Error("Codex finished without creating a commit on the working branch.");
      }

      const diff = runGit(worktreePath, ["diff", `${input.targetBranch}...HEAD`]);
      diffRef = writeReviewDiff(input.project, input.ticketId, diff);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Unable to collect review artifacts";
      this.#finishFailure({
        ticket: this.#store.getTicket(input.ticketId)!,
        sessionId: input.sessionId,
        attemptId: input.attemptId,
        reason
      });
      return;
    }

    const reviewPackage = this.#store.createReviewPackage({
      ticket_id: input.ticketId,
      session_id: input.sessionId,
      diff_ref: diffRef,
      commit_refs: commitRefs,
      change_summary: input.summary,
      validation_results: [],
      remaining_risks: ["Validation runner is not implemented yet in this build."]
    });

    const ticket = this.#store.updateTicketStatus(input.ticketId, "review");
    const completedSession = this.#store.completeSession(input.sessionId, {
      status: "completed",
      last_summary: input.summary,
      latest_review_package_id: reviewPackage.id
    });

    this.#log(input.sessionId, input.attemptId, "Codex finished successfully.");
    this.#log(input.sessionId, input.attemptId, `Review package ready: ${reviewPackage.diff_ref}`);
    this.#eventHub.publish(
      makeProtocolEvent("review_package.generated", "review_package", reviewPackage.id, {
        review_package: reviewPackage
      })
    );
    this.#emitTicketUpdated(ticket);
    this.#emitSessionUpdated(completedSession);
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
      end_reason: input.reason
    });
    const failedSession = this.#store.completeSession(input.sessionId, {
      status: "failed",
      last_summary: input.reason
    });
    this.#log(input.sessionId, input.attemptId, `[runtime failure] ${input.reason}`);
    this.#emitSessionUpdated(failedSession);
  }
}
