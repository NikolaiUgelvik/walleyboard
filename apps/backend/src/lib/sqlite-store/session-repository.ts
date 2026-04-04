import {
  executionAttemptsTable,
  executionSessionsTable,
  sessionLogsTable,
} from "@walleyboard/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import type {
  ExecutionAttempt,
  ExecutionSession,
  Project,
} from "../../../../../packages/contracts/src/index.js";

import type {
  CompleteSessionInput,
  StartupRecoveryResult,
  UpdateExecutionAttemptInput,
  UpdateSessionPlanInput,
} from "../store.js";
import { nowIso } from "../time.js";
import {
  formatMarkdownLog,
  mapExecutionAttempt,
  mapExecutionSession,
  requireValue,
  type SqliteStoreContext,
} from "./shared.js";

function isTrackedProcessAlive(pid: number | null | undefined): boolean {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
    ) {
      return error.code === "EPERM";
    }

    return false;
  }
}

export class SessionRepository {
  constructor(private readonly context: SqliteStoreContext) {}

  getSession(sessionId: string): ExecutionSession | undefined {
    const row = this.context.db
      .select()
      .from(executionSessionsTable)
      .where(eq(executionSessionsTable.id, sessionId))
      .get();
    return row ? mapExecutionSession(row) : undefined;
  }

  getSessionLogs(sessionId: string): string[] {
    const rows = this.context.db
      .select({ line: sessionLogsTable.line })
      .from(sessionLogsTable)
      .where(eq(sessionLogsTable.sessionId, sessionId))
      .orderBy(asc(sessionLogsTable.id))
      .all();
    return rows.map((row) => row.line);
  }

  listSessionAttempts(sessionId: string): ExecutionAttempt[] {
    const rows = this.context.db
      .select()
      .from(executionAttemptsTable)
      .where(eq(executionAttemptsTable.sessionId, sessionId))
      .orderBy(asc(executionAttemptsTable.attemptNumber))
      .all();
    return rows.map(mapExecutionAttempt);
  }

  addSessionInput(sessionId: string, body: string): ExecutionSession {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const timestamp = nowIso();
    const summary =
      "User input was recorded for the session. If no live process was attached, the note will be available for the next attempt.";

    this.context.appendSessionLog(
      sessionId,
      formatMarkdownLog("User input recorded", body),
    );

    this.context.db
      .update(executionSessionsTable)
      .set({
        lastHeartbeatAt: timestamp,
        lastSummary: summary,
        status: "awaiting_input",
      })
      .where(eq(executionSessionsTable.id, sessionId))
      .run();

    this.context.recordStructuredEvent(
      "session",
      sessionId,
      "session.input_recorded",
      {
        body,
        received_at: timestamp,
      },
    );

    return requireValue(
      this.getSession(sessionId),
      "Session not found after input",
    );
  }

  updateSessionPlan(
    sessionId: string,
    input: UpdateSessionPlanInput,
  ): ExecutionSession | undefined {
    const existingSession = this.getSession(sessionId);
    if (!existingSession) {
      return undefined;
    }

    this.context.db
      .update(executionSessionsTable)
      .set({
        status: input.status ?? existingSession.status,
        planStatus: input.plan_status ?? existingSession.plan_status,
        planSummary:
          input.plan_summary !== undefined
            ? input.plan_summary
            : existingSession.plan_summary,
        lastHeartbeatAt: nowIso(),
        lastSummary: input.last_summary ?? existingSession.last_summary,
      })
      .where(eq(executionSessionsTable.id, sessionId))
      .run();

    return this.getSession(sessionId);
  }

  updateSessionStatus(
    sessionId: string,
    status: ExecutionSession["status"],
    lastSummary?: string | null,
  ): ExecutionSession | undefined {
    const existingSession = this.getSession(sessionId);
    if (!existingSession) {
      return undefined;
    }

    this.context.db
      .update(executionSessionsTable)
      .set({
        status,
        lastHeartbeatAt: nowIso(),
        lastSummary: lastSummary ?? existingSession.last_summary,
      })
      .where(eq(executionSessionsTable.id, sessionId))
      .run();

    return this.getSession(sessionId);
  }

  updateSessionWorktreePath(
    sessionId: string,
    worktreePath: string | null,
  ): ExecutionSession | undefined {
    const existingSession = this.getSession(sessionId);
    if (!existingSession) {
      return undefined;
    }

    if (existingSession.worktree_path === worktreePath) {
      return existingSession;
    }

    this.context.db
      .update(executionSessionsTable)
      .set({
        worktreePath,
        lastHeartbeatAt: nowIso(),
      })
      .where(eq(executionSessionsTable.id, sessionId))
      .run();

    return this.getSession(sessionId);
  }

  updateSessionAdapterSessionRef(
    sessionId: string,
    adapterSessionRef: string,
  ): ExecutionSession | undefined {
    const existingSession = this.getSession(sessionId);
    if (!existingSession) {
      return undefined;
    }

    if (existingSession.adapter_session_ref === adapterSessionRef) {
      return existingSession;
    }

    this.context.db
      .update(executionSessionsTable)
      .set({
        adapterSessionRef,
        lastHeartbeatAt: nowIso(),
      })
      .where(eq(executionSessionsTable.id, sessionId))
      .run();

    return this.getSession(sessionId);
  }

  claimNextQueuedSession(project: Project): ExecutionSession | undefined {
    if (
      this.context.countOccupiedExecutionSlotsForProject(project.id) >=
      project.max_concurrent_sessions
    ) {
      return undefined;
    }

    const queuedSession = this.context.db
      .select({ id: executionSessionsTable.id })
      .from(executionSessionsTable)
      .where(
        and(
          eq(executionSessionsTable.projectId, project.id),
          eq(executionSessionsTable.status, "queued"),
        ),
      )
      .orderBy(
        asc(executionSessionsTable.queueEnteredAt),
        asc(executionSessionsTable.startedAt),
        asc(executionSessionsTable.id),
      )
      .get();

    if (!queuedSession) {
      return undefined;
    }

    this.context.db
      .update(executionSessionsTable)
      .set({
        status: "awaiting_input",
        queueEnteredAt: null,
        lastHeartbeatAt: nowIso(),
      })
      .where(eq(executionSessionsTable.id, queuedSession.id))
      .run();

    return this.getSession(queuedSession.id);
  }

  completeSession(
    sessionId: string,
    input: CompleteSessionInput,
  ): ExecutionSession | undefined {
    const existingSession = this.getSession(sessionId);
    if (!existingSession) {
      return undefined;
    }

    this.context.db
      .update(executionSessionsTable)
      .set({
        status: input.status,
        lastHeartbeatAt: nowIso(),
        completedAt: nowIso(),
        lastSummary: input.last_summary ?? existingSession.last_summary,
        latestReviewPackageId:
          input.latest_review_package_id ??
          existingSession.latest_review_package_id,
      })
      .where(eq(executionSessionsTable.id, sessionId))
      .run();

    return this.getSession(sessionId);
  }

  updateExecutionAttempt(
    attemptId: string,
    input: UpdateExecutionAttemptInput,
  ): ExecutionAttempt | undefined {
    const row = this.context.db
      .select()
      .from(executionAttemptsTable)
      .where(eq(executionAttemptsTable.id, attemptId))
      .get();
    if (!row) {
      return undefined;
    }

    const existingAttempt = mapExecutionAttempt(row);
    const nextStatus = input.status ?? existingAttempt.status;
    const shouldEnd = input.status !== undefined && input.status !== "running";

    this.context.db
      .update(executionAttemptsTable)
      .set({
        status: nextStatus,
        promptKind:
          input.prompt_kind !== undefined
            ? input.prompt_kind
            : existingAttempt.prompt_kind,
        prompt:
          input.prompt !== undefined ? input.prompt : existingAttempt.prompt,
        ptyPid:
          input.pty_pid !== undefined ? input.pty_pid : existingAttempt.pty_pid,
        endedAt: shouldEnd ? nowIso() : existingAttempt.ended_at,
        endReason: input.end_reason ?? existingAttempt.end_reason,
      })
      .where(eq(executionAttemptsTable.id, attemptId))
      .run();

    const updatedRow = this.context.db
      .select()
      .from(executionAttemptsTable)
      .where(eq(executionAttemptsTable.id, attemptId))
      .get();
    return updatedRow ? mapExecutionAttempt(updatedRow) : undefined;
  }

  recoverInterruptedSessions(): StartupRecoveryResult {
    const rows = this.context.db
      .select()
      .from(executionSessionsTable)
      .where(
        inArray(executionSessionsTable.status, [
          "queued",
          "running",
          "paused_checkpoint",
          "paused_user_control",
          "awaiting_input",
        ]),
      )
      .orderBy(
        asc(executionSessionsTable.startedAt),
        asc(executionSessionsTable.id),
      )
      .all();

    const interruptedSessions: ExecutionSession[] = [];
    const activeSessionIds: string[] = [];

    for (const row of rows) {
      const session = mapExecutionSession(row);
      const activeAttemptRow = session.current_attempt_id
        ? this.context.db
            .select({ ptyPid: executionAttemptsTable.ptyPid })
            .from(executionAttemptsTable)
            .where(eq(executionAttemptsTable.id, session.current_attempt_id))
            .get()
        : undefined;

      if (isTrackedProcessAlive(activeAttemptRow?.ptyPid)) {
        activeSessionIds.push(session.id);
        continue;
      }

      const timestamp = nowIso();
      const summary =
        "The backend restarted while this session was active. The session was marked interrupted and can be resumed on the existing worktree.";

      this.context.db
        .update(executionSessionsTable)
        .set({
          status: "interrupted",
          lastHeartbeatAt: timestamp,
          lastSummary: summary,
        })
        .where(eq(executionSessionsTable.id, session.id))
        .run();

      if (session.current_attempt_id) {
        this.updateExecutionAttempt(session.current_attempt_id, {
          status: "interrupted",
          end_reason: "backend_restart",
        });
      }

      this.context.appendSessionLog(
        session.id,
        "Session was marked interrupted after backend startup recovery.",
      );

      this.context.recordStructuredEvent(
        "session",
        session.id,
        "session.interrupted",
        {
          ticket_id: session.ticket_id,
          reason: "backend_restart",
        },
      );
      this.context.recordStructuredEvent(
        "ticket",
        String(session.ticket_id),
        "ticket.interrupted",
        {
          ticket_id: session.ticket_id,
          session_id: session.id,
          reason: "backend_restart",
        },
      );

      interruptedSessions.push(
        requireValue(
          this.getSession(session.id),
          "Session not found after recovery",
        ),
      );
    }

    return {
      activeSessionIds,
      sessions: interruptedSessions,
    };
  }
}
