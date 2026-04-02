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
      .prepare("SELECT * FROM execution_sessions WHERE id = ?")
      .get(sessionId) as Record<string, unknown> | undefined;
    return row ? mapExecutionSession(row) : undefined;
  }

  getSessionLogs(sessionId: string): string[] {
    const rows = this.context.db
      .prepare(
        "SELECT line FROM session_logs WHERE session_id = ? ORDER BY id ASC",
      )
      .all(sessionId) as Array<{ line: string }>;
    return rows.map((row) => row.line);
  }

  listSessionAttempts(sessionId: string): ExecutionAttempt[] {
    const rows = this.context.db
      .prepare(
        "SELECT * FROM execution_attempts WHERE session_id = ? ORDER BY attempt_number ASC",
      )
      .all(sessionId) as Record<string, unknown>[];
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
      .prepare(
        `
          UPDATE execution_sessions
          SET last_heartbeat_at = ?, last_summary = ?, status = ?
          WHERE id = ?
        `,
      )
      .run(timestamp, summary, "awaiting_input", sessionId);

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
      .prepare(
        `
          UPDATE execution_sessions
          SET status = ?,
              plan_status = ?,
              plan_summary = ?,
              last_heartbeat_at = ?,
              last_summary = ?
          WHERE id = ?
        `,
      )
      .run(
        input.status ?? existingSession.status,
        input.plan_status ?? existingSession.plan_status,
        input.plan_summary !== undefined
          ? input.plan_summary
          : existingSession.plan_summary,
        nowIso(),
        input.last_summary ?? existingSession.last_summary,
        sessionId,
      );

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
      .prepare(
        `
          UPDATE execution_sessions
          SET status = ?, last_heartbeat_at = ?, last_summary = ?
          WHERE id = ?
        `,
      )
      .run(
        status,
        nowIso(),
        lastSummary ?? existingSession.last_summary,
        sessionId,
      );

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
      .prepare(
        `
          UPDATE execution_sessions
          SET adapter_session_ref = ?, last_heartbeat_at = ?
          WHERE id = ?
        `,
      )
      .run(adapterSessionRef, nowIso(), sessionId);

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
      .prepare(
        `
          SELECT id
          FROM execution_sessions
          WHERE project_id = ?
            AND status = 'queued'
          ORDER BY queue_entered_at ASC, started_at ASC, id ASC
          LIMIT 1
        `,
      )
      .get(project.id) as { id: string } | undefined;

    if (!queuedSession) {
      return undefined;
    }

    this.context.db
      .prepare(
        `
          UPDATE execution_sessions
          SET status = ?, queue_entered_at = ?, last_heartbeat_at = ?
          WHERE id = ?
        `,
      )
      .run("awaiting_input", null, nowIso(), queuedSession.id);

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
      .prepare(
        `
          UPDATE execution_sessions
          SET status = ?,
              last_heartbeat_at = ?,
              completed_at = ?,
              last_summary = ?,
              latest_review_package_id = ?
          WHERE id = ?
        `,
      )
      .run(
        input.status,
        nowIso(),
        nowIso(),
        input.last_summary ?? existingSession.last_summary,
        input.latest_review_package_id ??
          existingSession.latest_review_package_id,
        sessionId,
      );

    return this.getSession(sessionId);
  }

  updateExecutionAttempt(
    attemptId: string,
    input: UpdateExecutionAttemptInput,
  ): ExecutionAttempt | undefined {
    const row = this.context.db
      .prepare("SELECT * FROM execution_attempts WHERE id = ?")
      .get(attemptId) as Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }

    const existingAttempt = mapExecutionAttempt(row);
    const nextStatus = input.status ?? existingAttempt.status;
    const shouldEnd = input.status !== undefined && input.status !== "running";

    this.context.db
      .prepare(
        `
          UPDATE execution_attempts
          SET status = ?,
              pty_pid = ?,
              ended_at = ?,
              end_reason = ?
          WHERE id = ?
        `,
      )
      .run(
        nextStatus,
        input.pty_pid !== undefined ? input.pty_pid : existingAttempt.pty_pid,
        shouldEnd ? nowIso() : existingAttempt.ended_at,
        input.end_reason ?? existingAttempt.end_reason,
        attemptId,
      );

    const updatedRow = this.context.db
      .prepare("SELECT * FROM execution_attempts WHERE id = ?")
      .get(attemptId) as Record<string, unknown> | undefined;
    return updatedRow ? mapExecutionAttempt(updatedRow) : undefined;
  }

  recoverInterruptedSessions(): StartupRecoveryResult {
    const rows = this.context.db
      .prepare(
        `
          SELECT *
          FROM execution_sessions
          WHERE status IN ('queued', 'running', 'paused_checkpoint', 'paused_user_control', 'awaiting_input')
          ORDER BY started_at ASC, id ASC
        `,
      )
      .all() as Record<string, unknown>[];

    const interruptedSessions: ExecutionSession[] = [];

    for (const row of rows) {
      const session = mapExecutionSession(row);
      const activeAttemptRow = session.current_attempt_id
        ? (this.context.db
            .prepare("SELECT pty_pid FROM execution_attempts WHERE id = ?")
            .get(session.current_attempt_id) as
            | { pty_pid: number | null }
            | undefined)
        : undefined;

      if (isTrackedProcessAlive(activeAttemptRow?.pty_pid)) {
        continue;
      }

      const timestamp = nowIso();
      const summary =
        "The backend restarted while this session was active. The session was marked interrupted and can be resumed on the existing worktree.";

      this.context.db
        .prepare(
          `
            UPDATE execution_sessions
            SET status = ?,
                last_heartbeat_at = ?,
                last_summary = ?
            WHERE id = ?
          `,
        )
        .run("interrupted", timestamp, summary, session.id);

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
      sessions: interruptedSessions,
    };
  }
}
