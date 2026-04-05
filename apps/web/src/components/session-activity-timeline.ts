import type {
  ExecutionAttempt,
  ExecutionSession,
  ReviewRun,
  StructuredEvent,
} from "../../../../packages/contracts/src/index.js";
import type { ActivityTone, SessionActivity } from "./session-activity-log.js";
import {
  interpretSessionLog,
  parseExecutionSummary,
} from "./session-activity-log.js";

export type SessionTimelineEntry = {
  copyMarkdown?: string;
  detail: string | null;
  key: string;
  kicker: string;
  occurredAt: string;
  sortOrder: number;
  title: string;
  tone: ActivityTone;
};

type PendingTimelineLog = {
  activity: SessionActivity;
  index: number;
};

function createTimelineEntry(input: {
  copyMarkdown?: string | null;
  detail?: string | null;
  key: string;
  kicker: string;
  occurredAt: string;
  sortOrder: number;
  title: string;
  tone: ActivityTone;
}): SessionTimelineEntry {
  const entry: SessionTimelineEntry = {
    detail: input.detail ?? null,
    key: input.key,
    kicker: input.kicker,
    occurredAt: input.occurredAt,
    sortOrder: input.sortOrder,
    title: input.title,
    tone: input.tone,
  };

  if (input.copyMarkdown != null) {
    entry.copyMarkdown = input.copyMarkdown;
  }

  return entry;
}

function parseAttemptNumberFromLogLine(line: string): number | null {
  const match = line.match(
    /(?:Starting|Queued)(?: fresh)? execution attempt (\d+)/i,
  );
  if (!match?.[1]) {
    return null;
  }

  const attemptNumber = Number.parseInt(match[1], 10);
  return Number.isNaN(attemptNumber) ? null : attemptNumber;
}

function attemptPromptKicker(
  promptKind: ExecutionAttempt["prompt_kind"],
): string {
  if (promptKind === "plan") {
    return "PLAN PROMPT";
  }

  if (promptKind === "merge_conflict") {
    return "MERGE RECOVERY PROMPT";
  }

  return "EXECUTION PROMPT";
}

function attemptPromptTitle(attempt: ExecutionAttempt): string {
  if (attempt.prompt_kind === "plan") {
    return `Plan prompt prepared for attempt ${attempt.attempt_number}`;
  }

  if (attempt.prompt_kind === "merge_conflict") {
    return `Merge recovery prompt prepared for attempt ${attempt.attempt_number}`;
  }

  return `Implementation prompt prepared for attempt ${attempt.attempt_number}`;
}

function humanizeEndReason(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return null;
  }

  return normalized[0]?.toUpperCase() + normalized.slice(1);
}

function attemptResultTone(status: ExecutionAttempt["status"]): ActivityTone {
  switch (status) {
    case "completed":
      return "green";
    case "failed":
      return "red";
    case "interrupted":
      return "orange";
    case "running":
      return "blue";
    case "queued":
      return "gray";
  }
}

function attemptResultKicker(status: ExecutionAttempt["status"]): string {
  switch (status) {
    case "completed":
      return "EXECUTION RESULT";
    case "failed":
      return "EXECUTION FAILED";
    case "interrupted":
      return "EXECUTION INTERRUPTED";
    case "running":
      return "EXECUTION RUNNING";
    case "queued":
      return "EXECUTION QUEUED";
  }
}

function attemptResultTitle(attempt: ExecutionAttempt): string {
  switch (attempt.status) {
    case "completed":
      return `Attempt ${attempt.attempt_number} completed`;
    case "failed":
      return `Attempt ${attempt.attempt_number} failed`;
    case "interrupted":
      return `Attempt ${attempt.attempt_number} interrupted`;
    case "running":
      return `Attempt ${attempt.attempt_number} running`;
    case "queued":
      return `Attempt ${attempt.attempt_number} queued`;
  }
}

function buildAttemptResultDetail(
  attempt: ExecutionAttempt,
  latestAttemptId: string | null,
  session: ExecutionSession,
): string {
  if (
    attempt.id === latestAttemptId &&
    attempt.prompt_kind === "plan" &&
    session.plan_summary
  ) {
    return session.plan_summary;
  }

  if (attempt.id === latestAttemptId && session.last_summary) {
    const parsedSummary = parseExecutionSummary(session.last_summary);
    if (parsedSummary.overview.length > 0) {
      return parsedSummary.overview;
    }

    return session.last_summary;
  }

  const endReason = humanizeEndReason(attempt.end_reason);
  if (endReason) {
    return endReason;
  }

  switch (attempt.status) {
    case "completed":
      return "The execution attempt finished successfully.";
    case "failed":
      return "The execution attempt failed before review handoff.";
    case "interrupted":
      return "The execution attempt stopped before completion.";
    case "running":
      return "The execution attempt is still in progress.";
    case "queued":
      return "The execution attempt is queued and waiting to start.";
  }
}

function buildAttemptTimelineEntries(
  attempts: ExecutionAttempt[],
  session: ExecutionSession,
): SessionTimelineEntry[] {
  const latestAttemptId =
    attempts[attempts.length - 1]?.id ?? session.current_attempt_id ?? null;

  return attempts.flatMap((attempt) => {
    const entries: SessionTimelineEntry[] = [];

    if (attempt.prompt && attempt.prompt_kind) {
      entries.push(
        createTimelineEntry({
          copyMarkdown:
            attempt.prompt_kind === "implementation" ? attempt.prompt : null,
          detail: attempt.prompt,
          key: `attempt-prompt-${attempt.id}`,
          kicker: attemptPromptKicker(attempt.prompt_kind),
          occurredAt: attempt.started_at,
          sortOrder: 40 + attempt.attempt_number,
          title: attemptPromptTitle(attempt),
          tone: "blue",
        }),
      );
    }

    if (attempt.status !== "queued") {
      entries.push(
        createTimelineEntry({
          detail: buildAttemptResultDetail(attempt, latestAttemptId, session),
          key: `attempt-result-${attempt.id}`,
          kicker: attemptResultKicker(attempt.status),
          occurredAt: attempt.ended_at ?? attempt.started_at,
          sortOrder: 80 + attempt.attempt_number,
          title: attemptResultTitle(attempt),
          tone: attemptResultTone(attempt.status),
        }),
      );
    }

    return entries;
  });
}

function buildReviewTimelineEntries(
  reviewRuns: ReviewRun[],
): SessionTimelineEntry[] {
  return reviewRuns.flatMap((reviewRun, index) => {
    const entries: SessionTimelineEntry[] = [];

    if (reviewRun.prompt) {
      entries.push(
        createTimelineEntry({
          copyMarkdown: reviewRun.prompt,
          detail: reviewRun.prompt,
          key: `review-prompt-${reviewRun.id}`,
          kicker: "AI REVIEW PROMPT",
          occurredAt: reviewRun.created_at,
          sortOrder: 48 + index,
          title: "AI review prompt prepared",
          tone: "teal",
        }),
      );
    }

    const detail =
      reviewRun.report?.summary ??
      reviewRun.failure_message ??
      (reviewRun.status === "running"
        ? "The AI review is still running."
        : reviewRun.status === "completed"
          ? "No stored review summary is available for this run."
          : "The AI review did not complete successfully.");

    entries.push(
      createTimelineEntry({
        detail,
        key: `review-result-${reviewRun.id}`,
        kicker:
          reviewRun.status === "running"
            ? "AI REVIEW PENDING"
            : reviewRun.status === "failed"
              ? "AI REVIEW FAILED"
              : "AI REVIEW RESULT",
        occurredAt:
          reviewRun.completed_at ??
          reviewRun.updated_at ??
          reviewRun.created_at,
        sortOrder: reviewRun.status === "running" ? 72 + index : 88 + index,
        title:
          reviewRun.status === "running"
            ? "AI review pending"
            : reviewRun.status === "failed"
              ? "AI review failed"
              : "AI review completed",
        tone:
          reviewRun.status === "running"
            ? "yellow"
            : reviewRun.status === "failed"
              ? "red"
              : "green",
      }),
    );

    return entries;
  });
}

function buildTicketEventDetail(event: StructuredEvent): string | null {
  switch (event.event_type) {
    case "ticket.created":
      return typeof event.payload.title === "string"
        ? event.payload.title
        : null;
    case "ticket.started": {
      const branch =
        typeof event.payload.working_branch === "string"
          ? event.payload.working_branch
          : null;
      const worktree =
        typeof event.payload.worktree_path === "string"
          ? event.payload.worktree_path
          : null;
      return [
        branch ? `Branch: \`${branch}\`` : null,
        worktree ? `Worktree: \`${worktree}\`` : null,
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "ticket.stopped":
      return typeof event.payload.reason === "string"
        ? event.payload.reason
        : "The execution session was stopped by a user request.";
    case "ticket.changes_requested":
      return "Review feedback was recorded and the ticket moved back into implementation.";
    case "ticket.merge_failed":
      return "A merge conflict note was recorded and the ticket returned to implementation.";
    case "ticket.restarted": {
      const branch =
        typeof event.payload.working_branch === "string"
          ? event.payload.working_branch
          : null;
      const worktree =
        typeof event.payload.worktree_path === "string"
          ? event.payload.worktree_path
          : null;
      return [
        branch ? `Branch recreated: \`${branch}\`` : null,
        worktree ? `Worktree recreated: \`${worktree}\`` : null,
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "ticket.interrupted":
      return event.payload.reason === "backend_restart"
        ? "The backend restarted while the ticket was active."
        : typeof event.payload.reason === "string"
          ? String(event.payload.reason)
          : "The ticket session was interrupted before completion.";
    case "ticket.archived":
      return "The ticket was moved out of the active board.";
    case "ticket.restored":
      return "The ticket was restored to the active board.";
    case "ticket.merged": {
      const targetBranch =
        typeof event.payload.target_branch === "string"
          ? event.payload.target_branch
          : null;
      const warnings = Array.isArray(event.payload.cleanup_warnings)
        ? event.payload.cleanup_warnings
            .filter((warning): warning is string => typeof warning === "string")
            .join("\n")
        : "";
      return [
        targetBranch
          ? `Merged into \`${targetBranch}\`.`
          : "Ticket changes were merged.",
        warnings.length > 0 ? `Cleanup warnings:\n${warnings}` : null,
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    case "pull_request.created": {
      const number =
        typeof event.payload.number === "number" ? event.payload.number : null;
      const url =
        typeof event.payload.url === "string" ? event.payload.url : null;
      return [
        number !== null ? `Pull request #${number}` : null,
        url ? url : null,
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "pull_request.merged": {
      const number =
        typeof event.payload.number === "number" ? event.payload.number : null;
      const url =
        typeof event.payload.url === "string" ? event.payload.url : null;
      return [
        number !== null
          ? `Pull request #${number} merged.`
          : "The linked pull request was merged.",
        url ? url : null,
      ]
        .filter(Boolean)
        .join("\n");
    }
    default:
      return null;
  }
}

function buildTicketEventTimelineEntry(
  event: StructuredEvent,
  index: number,
): SessionTimelineEntry | null {
  const detail = buildTicketEventDetail(event);

  switch (event.event_type) {
    case "ticket.created":
      return createTimelineEntry({
        detail,
        key: `ticket-event-${event.id}`,
        kicker: "TICKET CREATED",
        occurredAt: event.occurred_at,
        sortOrder: 20 + index,
        title: "Ticket created",
        tone: "blue",
      });
    case "ticket.started":
      return createTimelineEntry({
        detail,
        key: `ticket-event-${event.id}`,
        kicker: "EXECUTION STARTED",
        occurredAt: event.occurred_at,
        sortOrder: 24 + index,
        title: "Execution started",
        tone: "blue",
      });
    case "ticket.stopped":
      return createTimelineEntry({
        detail,
        key: `ticket-event-${event.id}`,
        kicker: "EXECUTION STOPPED",
        occurredAt: event.occurred_at,
        sortOrder: 86 + index,
        title: "Execution stopped",
        tone: "orange",
      });
    case "ticket.changes_requested":
      return createTimelineEntry({
        detail,
        key: `ticket-event-${event.id}`,
        kicker: "RESTART REQUESTED",
        occurredAt: event.occurred_at,
        sortOrder: 90 + index,
        title: "Changes requested",
        tone: "orange",
      });
    case "ticket.merge_failed":
      return createTimelineEntry({
        detail,
        key: `ticket-event-${event.id}`,
        kicker: "MERGE FAILED",
        occurredAt: event.occurred_at,
        sortOrder: 92 + index,
        title: "Merge conflict recorded",
        tone: "red",
      });
    case "ticket.restarted":
      return createTimelineEntry({
        detail,
        key: `ticket-event-${event.id}`,
        kicker: "SESSION RESTARTED",
        occurredAt: event.occurred_at,
        sortOrder: 94 + index,
        title: "Fresh restart prepared",
        tone: "blue",
      });
    case "ticket.interrupted":
      return createTimelineEntry({
        detail,
        key: `ticket-event-${event.id}`,
        kicker: "SESSION INTERRUPTED",
        occurredAt: event.occurred_at,
        sortOrder: 96 + index,
        title: "Session interrupted",
        tone: "orange",
      });
    case "ticket.archived":
      return createTimelineEntry({
        detail,
        key: `ticket-event-${event.id}`,
        kicker: "TICKET ARCHIVED",
        occurredAt: event.occurred_at,
        sortOrder: 98 + index,
        title: "Ticket archived",
        tone: "gray",
      });
    case "ticket.restored":
      return createTimelineEntry({
        detail,
        key: `ticket-event-${event.id}`,
        kicker: "TICKET RESTORED",
        occurredAt: event.occurred_at,
        sortOrder: 100 + index,
        title: "Ticket restored",
        tone: "blue",
      });
    case "ticket.merged":
      return createTimelineEntry({
        detail,
        key: `ticket-event-${event.id}`,
        kicker: "MERGED",
        occurredAt: event.occurred_at,
        sortOrder: 104 + index,
        title: "Ticket merged",
        tone: "green",
      });
    case "pull_request.created":
      return createTimelineEntry({
        detail,
        key: `ticket-event-${event.id}`,
        kicker: "PULL REQUEST",
        occurredAt: event.occurred_at,
        sortOrder: 102 + index,
        title: "Pull request created",
        tone: "teal",
      });
    case "pull_request.merged":
      return createTimelineEntry({
        detail,
        key: `ticket-event-${event.id}`,
        kicker: "PULL REQUEST",
        occurredAt: event.occurred_at,
        sortOrder: 103 + index,
        title: "Pull request merged",
        tone: "green",
      });
    default:
      return null;
  }
}

function isPreAttemptPromptActivity(activity: SessionActivity): boolean {
  return [
    "Changes requested",
    "Plan approved",
    "Plan revision requested",
    "Resume guidance saved",
    "Resume requested",
    "Resume guidance",
    "Note recorded",
    "Live input sent",
    "Fresh restart guidance",
    "Fresh restart requested",
  ].includes(activity.label);
}

function createLogTimelineEntry(
  activity: SessionActivity,
  occurredAt: string,
  sortOrder: number,
): SessionTimelineEntry | null {
  switch (activity.label) {
    case "Changes requested":
      return createTimelineEntry({
        detail: activity.detail,
        key: `timeline-log-${activity.key}`,
        kicker: "RESTART PROMPT",
        occurredAt,
        sortOrder,
        title: "Requested changes recorded",
        tone: "orange",
      });
    case "Plan approved":
      return createTimelineEntry({
        detail: activity.detail,
        key: `timeline-log-${activity.key}`,
        kicker: "PLAN RESPONSE",
        occurredAt,
        sortOrder,
        title: "Plan approved",
        tone: "green",
      });
    case "Plan revision requested":
      return createTimelineEntry({
        detail: activity.detail,
        key: `timeline-log-${activity.key}`,
        kicker: "PLAN RESPONSE",
        occurredAt,
        sortOrder,
        title: "Plan revision requested",
        tone: "orange",
      });
    case "Resume guidance saved":
    case "Resume requested":
    case "Resume guidance":
      return createTimelineEntry({
        detail: activity.detail,
        key: `timeline-log-${activity.key}`,
        kicker: "RESUME PROMPT",
        occurredAt,
        sortOrder,
        title: activity.label,
        tone: "yellow",
      });
    case "Note recorded":
      return createTimelineEntry({
        detail: activity.detail,
        key: `timeline-log-${activity.key}`,
        kicker: "EXECUTION INPUT",
        occurredAt,
        sortOrder,
        title: "User input recorded",
        tone: "yellow",
      });
    case "Live input sent":
      return createTimelineEntry({
        detail: activity.detail,
        key: `timeline-log-${activity.key}`,
        kicker: "EXECUTION INPUT",
        occurredAt,
        sortOrder,
        title: "Live input sent",
        tone: "yellow",
      });
    case "Fresh restart guidance":
    case "Fresh restart requested":
      return createTimelineEntry({
        detail: activity.detail,
        key: `timeline-log-${activity.key}`,
        kicker: "RESTART PROMPT",
        occurredAt,
        sortOrder,
        title: activity.label,
        tone: "orange",
      });
    case "Manual terminal attached":
      return createTimelineEntry({
        detail: activity.detail,
        key: `timeline-log-${activity.key}`,
        kicker: "MANUAL CONTROL",
        occurredAt,
        sortOrder,
        title: "Manual terminal attached",
        tone: "yellow",
      });
    case "Manual terminal closed":
      return createTimelineEntry({
        detail: activity.detail,
        key: `timeline-log-${activity.key}`,
        kicker: "MANUAL CONTROL",
        occurredAt,
        sortOrder,
        title: "Manual terminal closed",
        tone: "gray",
      });
    case "Execution stopped":
      return createTimelineEntry({
        detail: activity.detail,
        key: `timeline-log-${activity.key}`,
        kicker: "SESSION UPDATE",
        occurredAt,
        sortOrder,
        title: "Execution stopped",
        tone: "orange",
      });
    case "Restart recovery":
      return createTimelineEntry({
        detail: activity.detail,
        key: `timeline-log-${activity.key}`,
        kicker: "SESSION UPDATE",
        occurredAt,
        sortOrder,
        title: "Backend restart recovery",
        tone: "orange",
      });
    case "Feedback requested":
      return createTimelineEntry({
        detail: activity.detail,
        key: `timeline-log-${activity.key}`,
        kicker: "CHECKPOINT",
        occurredAt,
        sortOrder,
        title: "Plan feedback requested",
        tone: "yellow",
      });
    default:
      return null;
  }
}

function resolveFallbackTimelineTimestamp(
  attempts: ExecutionAttempt[],
  session: ExecutionSession,
): string {
  return (
    attempts[attempts.length - 1]?.ended_at ??
    attempts[attempts.length - 1]?.started_at ??
    session.completed_at ??
    session.last_heartbeat_at ??
    session.started_at ??
    new Date(0).toISOString()
  );
}

function resolveCurrentAttemptTimestamp(
  attemptsByNumber: Map<number, ExecutionAttempt>,
  activeAttemptNumber: number | null,
  session: ExecutionSession,
): string {
  if (activeAttemptNumber !== null) {
    const attempt = attemptsByNumber.get(activeAttemptNumber);
    if (attempt) {
      return attempt.ended_at ?? attempt.started_at;
    }
  }

  return (
    session.last_heartbeat_at ??
    session.completed_at ??
    session.started_at ??
    new Date(0).toISOString()
  );
}

function buildLogTimelineEntries(
  logs: string[],
  attempts: ExecutionAttempt[],
  session: ExecutionSession,
): SessionTimelineEntry[] {
  const attemptsByNumber = new Map(
    attempts.map((attempt) => [attempt.attempt_number, attempt]),
  );
  let activeAttemptNumber = attempts[0]?.attempt_number ?? null;
  const entries: SessionTimelineEntry[] = [];
  let pendingPreAttemptEntries: PendingTimelineLog[] = [];

  const flushPendingEntries = (occurredAt: string, baseSortOrder: number) => {
    pendingPreAttemptEntries.forEach((pendingEntry, entryIndex) => {
      const timelineEntry = createLogTimelineEntry(
        pendingEntry.activity,
        occurredAt,
        baseSortOrder + entryIndex,
      );
      if (timelineEntry) {
        entries.push(timelineEntry);
      }
    });
    pendingPreAttemptEntries = [];
  };

  logs.forEach((line, index) => {
    const activity = interpretSessionLog(line, index, session);
    const startedAttemptNumber = parseAttemptNumberFromLogLine(line);
    if (startedAttemptNumber !== null) {
      const attempt = attemptsByNumber.get(startedAttemptNumber);
      flushPendingEntries(
        attempt?.started_at ??
          resolveFallbackTimelineTimestamp(attempts, session),
        30 + startedAttemptNumber,
      );
      activeAttemptNumber = startedAttemptNumber;
      return;
    }

    if (!activity) {
      return;
    }

    if (isPreAttemptPromptActivity(activity)) {
      pendingPreAttemptEntries.push({
        activity,
        index,
      });
      return;
    }

    const timelineEntry = createLogTimelineEntry(
      activity,
      resolveCurrentAttemptTimestamp(
        attemptsByNumber,
        activeAttemptNumber,
        session,
      ),
      70 + index,
    );
    if (timelineEntry) {
      entries.push(timelineEntry);
    }
  });

  if (pendingPreAttemptEntries.length > 0) {
    flushPendingEntries(
      resolveFallbackTimelineTimestamp(attempts, session),
      120,
    );
  }

  return entries;
}

export function buildSessionTimeline(input: {
  attempts: ExecutionAttempt[];
  events: StructuredEvent[];
  logs: string[];
  reviewRuns: ReviewRun[];
  session: ExecutionSession;
}): SessionTimelineEntry[] {
  const timelineEntries = [
    ...buildAttemptTimelineEntries(input.attempts, input.session),
    ...buildReviewTimelineEntries(input.reviewRuns),
    ...input.events
      .slice()
      .sort((left, right) => left.occurred_at.localeCompare(right.occurred_at))
      .map((event, index) => buildTicketEventTimelineEntry(event, index))
      .filter((entry): entry is SessionTimelineEntry => entry !== null),
    ...buildLogTimelineEntries(input.logs, input.attempts, input.session),
  ];

  return timelineEntries.sort((left, right) => {
    const leftTime = Date.parse(left.occurredAt);
    const rightTime = Date.parse(right.occurredAt);
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }

    if (left.sortOrder !== right.sortOrder) {
      return right.sortOrder - left.sortOrder;
    }

    return right.key.localeCompare(left.key);
  });
}
