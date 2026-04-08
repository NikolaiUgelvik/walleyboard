import type {
  ExecutionSession,
  InboxAlertItem,
  Project,
  ProtocolEvent,
  ReviewRun,
  TicketFrontmatter,
} from "../../../../packages/contracts/src/index.js";

import { type EventHub, makeProtocolEvent } from "./event-hub.js";
import type { WalleyboardPersistence } from "./store.js";

export type InboxAlertCoordinatorControls = {
  beginBatch: () => void;
  endBatch: () => void;
};

type InboxAlertSnapshotItem = InboxAlertItem & {
  updated_at: string;
};

const attentionNeededSessionStatuses = [
  "awaiting_input",
  "failed",
  "interrupted",
  "paused_checkpoint",
  "paused_user_control",
] satisfies ExecutionSession["status"][];

function hasActiveLinkedPullRequest(
  linkedPr: TicketFrontmatter["linked_pr"],
): boolean {
  return (
    linkedPr !== null &&
    linkedPr.state !== "closed" &&
    linkedPr.state !== "merged"
  );
}

function isAttentionNeededSessionStatus(
  status: ExecutionSession["status"],
): status is (typeof attentionNeededSessionStatuses)[number] {
  return attentionNeededSessionStatuses.includes(
    status as (typeof attentionNeededSessionStatuses)[number],
  );
}

function isReviewAlertable(input: {
  latestReviewRun: ReviewRun | undefined;
  project: Project;
  session: ExecutionSession;
  ticket: TicketFrontmatter;
}): boolean {
  if (input.session.status === "running" || input.session.status === "queued") {
    return false;
  }

  if (input.ticket.status !== "review") {
    return false;
  }

  if (!input.ticket.session_id) {
    return false;
  }

  if (hasActiveLinkedPullRequest(input.ticket.linked_pr)) {
    return false;
  }

  if (input.project.automatic_agent_review) {
    return (
      input.latestReviewRun !== undefined &&
      input.latestReviewRun.status !== "running"
    );
  }

  return (
    input.latestReviewRun === undefined ||
    input.latestReviewRun.status !== "running"
  );
}

function sortByUpdatedAtThenKey(
  left: { notification_key: string; updated_at: string },
  right: { notification_key: string; updated_at: string },
): number {
  const updatedAtComparison = right.updated_at.localeCompare(left.updated_at);
  return updatedAtComparison !== 0
    ? updatedAtComparison
    : right.notification_key.localeCompare(left.notification_key);
}

function collectInboxAlertSnapshot(
  store: WalleyboardPersistence,
  sessionControlsById: ReadonlyMap<string, boolean>,
): {
  alerts: InboxAlertSnapshotItem[];
  notificationKeys: string[];
} {
  const alerts: InboxAlertSnapshotItem[] = [];

  for (const project of store.listProjects()) {
    for (const draft of store.listProjectDrafts(project.id)) {
      if (draft.wizard_status !== "awaiting_confirmation") {
        continue;
      }

      alerts.push({
        kind: "draft",
        notification_key: `draft-${draft.id}`,
        project_id: draft.project_id,
        item_key: `draft-${draft.id}`,
        target_kind: "draft",
        target_id: draft.id,
        draft_id: draft.id,
        updated_at: draft.updated_at,
      });
    }

    for (const ticket of store.listProjectTickets(project.id)) {
      const sessionId = ticket.session_id;
      if (!sessionId) {
        continue;
      }

      const session = store.getSession(sessionId);
      if (!session) {
        continue;
      }

      const latestReviewRun = store.getLatestReviewRun(ticket.id);
      if (
        isReviewAlertable({
          latestReviewRun,
          project,
          session,
          ticket,
        })
      ) {
        alerts.push({
          kind: "review",
          notification_key: `review-${ticket.id}:${session.id}:${session.current_attempt_id ?? "none"}`,
          project_id: ticket.project,
          item_key: `review-${ticket.id}`,
          target_kind: "session",
          target_id: session.id,
          ticket_id: ticket.id,
          session_id: session.id,
          updated_at: ticket.updated_at,
        });
        continue;
      }

      if (
        !sessionControlsById.get(session.id) &&
        isAttentionNeededSessionStatus(session.status)
      ) {
        alerts.push({
          kind: "session",
          notification_key:
            `session-${ticket.id}:` +
            `${session.id}:` +
            `${session.current_attempt_id ?? "none"}:` +
            `${session.status}:` +
            `${session.plan_status}:` +
            `${session.latest_requested_change_note_id ?? "none"}`,
          project_id: ticket.project,
          item_key: `session-${ticket.id}`,
          target_kind: "session",
          target_id: session.id,
          ticket_id: ticket.id,
          session_id: session.id,
          updated_at: ticket.updated_at,
        });
      }
    }
  }

  alerts.sort(sortByUpdatedAtThenKey);

  return {
    alerts,
    notificationKeys: alerts.map((alert) => alert.notification_key),
  };
}

function toAlertPayload(alert: InboxAlertSnapshotItem): InboxAlertItem {
  return {
    kind: alert.kind,
    notification_key: alert.notification_key,
    project_id: alert.project_id,
    item_key: alert.item_key,
    target_kind: alert.target_kind,
    target_id: alert.target_id,
    ...(alert.draft_id ? { draft_id: alert.draft_id } : {}),
    ...(alert.ticket_id !== undefined ? { ticket_id: alert.ticket_id } : {}),
    ...(alert.session_id ? { session_id: alert.session_id } : {}),
  };
}

export class InboxAlertCoordinator implements InboxAlertCoordinatorControls {
  readonly #eventHub: EventHub;
  readonly #store: WalleyboardPersistence;
  #batchDepth = 0;
  #baselineSeeded = false;
  #dirty = false;
  #lastNotificationKeys = new Set<string>();
  #scheduledFlushTimeout: ReturnType<typeof setTimeout> | null = null;
  #sessionControlsById = new Map<string, boolean>();
  #unsubscribe: (() => void) | null = null;

  constructor(input: { eventHub: EventHub; store: WalleyboardPersistence }) {
    this.#eventHub = input.eventHub;
    this.#store = input.store;
  }

  seedBaseline(activeSessionIds: readonly string[] = []): void {
    this.#clearScheduledFlush();
    this.#dirty = false;
    this.#sessionControlsById.clear();
    for (const sessionId of activeSessionIds) {
      this.#sessionControlsById.set(sessionId, true);
    }
    this.#lastNotificationKeys = new Set(
      collectInboxAlertSnapshot(this.#store, this.#sessionControlsById)
        .notificationKeys,
    );
    this.#baselineSeeded = true;
  }

  start(): void {
    if (this.#unsubscribe !== null) {
      return;
    }

    this.#unsubscribe = this.#eventHub.subscribe((event) => {
      this.#handleEvent(event);
    });
  }

  stop(): void {
    this.#clearScheduledFlush();
    this.#dirty = false;
    this.#batchDepth = 0;
    this.#lastNotificationKeys = new Set();
    this.#baselineSeeded = false;
    this.#sessionControlsById.clear();

    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  beginBatch(): void {
    this.#batchDepth += 1;
    this.#clearScheduledFlush();
  }

  endBatch(): void {
    if (this.#batchDepth === 0) {
      return;
    }

    this.#batchDepth -= 1;
    if (this.#batchDepth === 0 && this.#dirty) {
      this.evaluateNow();
    }
  }

  evaluateNow(): void {
    this.#clearScheduledFlush();
    this.#dirty = false;

    if (!this.#baselineSeeded) {
      this.seedBaseline();
      return;
    }

    const snapshot = collectInboxAlertSnapshot(
      this.#store,
      this.#sessionControlsById,
    );
    const newAlerts = snapshot.alerts.filter(
      (alert) => !this.#lastNotificationKeys.has(alert.notification_key),
    );
    this.#lastNotificationKeys = new Set(snapshot.notificationKeys);

    if (newAlerts.length === 0) {
      return;
    }

    this.#eventHub.publish(
      makeProtocolEvent("inbox.alert", "system", "inbox", {
        alerts: newAlerts.map((alert) => toAlertPayload(alert)),
        notification_keys: newAlerts.map((alert) => alert.notification_key),
      }),
    );
  }

  #clearScheduledFlush(): void {
    if (this.#scheduledFlushTimeout === null) {
      return;
    }

    clearTimeout(this.#scheduledFlushTimeout);
    this.#scheduledFlushTimeout = null;
  }

  #handleEvent(event: ProtocolEvent): void {
    if (!this.#isRelevantEventType(event.event_type)) {
      return;
    }

    if (event.event_type === "session.updated") {
      const session = event.payload.session as ExecutionSession | undefined;
      const agentControlsWorktree = event.payload.agent_controls_worktree as
        | boolean
        | undefined;
      if (session) {
        this.#sessionControlsById.set(
          session.id,
          agentControlsWorktree ?? false,
        );
      }
    }

    this.#dirty = true;
    if (this.#batchDepth > 0 || this.#scheduledFlushTimeout !== null) {
      return;
    }

    this.#scheduledFlushTimeout = setTimeout(() => {
      this.#scheduledFlushTimeout = null;
      this.evaluateNow();
    }, 0);
  }

  #isRelevantEventType(eventType: ProtocolEvent["event_type"]): boolean {
    return (
      eventType === "draft.updated" ||
      eventType === "draft.deleted" ||
      eventType === "draft.ready" ||
      eventType === "ticket.updated" ||
      eventType === "ticket.archived" ||
      eventType === "ticket.deleted" ||
      eventType === "review_run.updated" ||
      eventType === "review_package.generated" ||
      eventType === "session.updated"
    );
  }
}
