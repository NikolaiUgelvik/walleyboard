import type {
  DraftTicketState,
  ExecutionSession,
  Project,
  SessionResponse,
  TicketFrontmatter,
} from "../../../../packages/contracts/src/index.js";
import { normalizeProjectColor } from "../features/walleyboard/shared-utils.js";

const attentionNeededSessionStatuses = [
  "awaiting_input",
  "failed",
  "interrupted",
  "paused_checkpoint",
  "paused_user_control",
] satisfies ExecutionSession["status"][];

export type InboxItem = {
  key: string;
  color: "blue" | "yellow";
  projectColor: string;
  title: string;
  message: string;
  targetKind: "draft" | "session";
  targetId: string;
  actionLabel: string;
  projectId: string;
  projectName: string;
};

export type ActionableInboxItem = InboxItem & {
  notificationKey: string;
};

type DerivedInboxItem = ActionableInboxItem & {
  updatedAt: string;
};

type DerivedNotificationEntry = {
  key: string;
  notificationKey: string;
  updatedAt: string;
};

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

export function deriveInboxItems(input: {
  drafts: DraftTicketState[];
  projects: Project[];
  tickets: TicketFrontmatter[];
  sessionsById: Map<string, SessionResponse>;
  ticketAiReviewActiveById?: ReadonlyMap<number, boolean>;
  ticketAiReviewResolvedById?: ReadonlyMap<number, boolean>;
}): InboxItem[] {
  return deriveInboxState(input).items.map(
    ({ notificationKey: _notificationKey, ...item }) => item,
  );
}

export function deriveInboxState(input: {
  drafts: DraftTicketState[];
  projects: Project[];
  tickets: TicketFrontmatter[];
  sessionsById: Map<string, SessionResponse>;
  ticketAiReviewActiveById?: ReadonlyMap<number, boolean>;
  ticketAiReviewResolvedById?: ReadonlyMap<number, boolean>;
}): {
  items: ActionableInboxItem[];
  notificationKeys: string[];
} {
  const projectNameById = new Map(
    input.projects.map((project) => [project.id, project.name]),
  );
  const projectColorById = new Map(
    input.projects.map((project) => [
      project.id,
      normalizeProjectColor(project.color),
    ]),
  );
  const ticketAiReviewActiveById = input.ticketAiReviewActiveById ?? new Map();
  const ticketAiReviewResolvedById =
    input.ticketAiReviewResolvedById ?? new Map();
  const items = [] as DerivedInboxItem[];
  const notificationEntries = [] as DerivedNotificationEntry[];

  for (const draft of input.drafts) {
    if (draft.wizard_status !== "awaiting_confirmation") {
      continue;
    }

    const projectName =
      projectNameById.get(draft.project_id) ?? "Unknown project";
    const projectColor =
      projectColorById.get(draft.project_id) ?? normalizeProjectColor(null);
    const notificationKey = `draft-${draft.id}`;
    items.push({
      key: `draft-${draft.id}`,
      notificationKey,
      color: "blue",
      projectColor,
      title: "Draft ready to review",
      message: `Review the refined draft for **${draft.title_draft}**.`,
      targetKind: "draft",
      targetId: draft.id,
      actionLabel: "Open Draft",
      projectId: draft.project_id,
      projectName,
      updatedAt: draft.updated_at,
    });
    notificationEntries.push({
      key: `draft-${draft.id}`,
      notificationKey,
      updatedAt: draft.updated_at,
    });
  }

  for (const ticket of input.tickets) {
    const projectName =
      projectNameById.get(ticket.project) ?? "Unknown project";
    const projectColor =
      projectColorById.get(ticket.project) ?? normalizeProjectColor(null);
    const sessionSummary =
      ticket.session_id === null
        ? null
        : (input.sessionsById.get(ticket.session_id) ?? null);
    const ticketAiReviewResolved =
      ticketAiReviewResolvedById.get(ticket.id) === true;
    const session = sessionSummary?.session ?? null;
    const reviewNotificationKey =
      ticket.status === "review" &&
      session &&
      ticket.session_id &&
      !hasActiveLinkedPullRequest(ticket.linked_pr)
        ? `review-${ticket.id}:${session.id}:${session.current_attempt_id ?? "none"}`
        : null;

    if (reviewNotificationKey !== null && session !== null) {
      if (ticketAiReviewActiveById.get(ticket.id) === true) {
        continue;
      }

      if (!ticketAiReviewResolved) {
        notificationEntries.push({
          key: `review-${ticket.id}`,
          notificationKey: reviewNotificationKey,
          updatedAt: ticket.updated_at,
        });
        continue;
      }

      items.push({
        key: `review-${ticket.id}`,
        notificationKey: reviewNotificationKey,
        color: "blue",
        projectColor,
        title: `Review ready for ticket #${ticket.id}`,
        message: `${ticket.title} is ready for review and can be merged or sent back for changes.`,
        targetKind: "session",
        targetId: session.id,
        actionLabel: "Open Review",
        projectId: ticket.project,
        projectName,
        updatedAt: ticket.updated_at,
      });
      notificationEntries.push({
        key: `review-${ticket.id}`,
        notificationKey: reviewNotificationKey,
        updatedAt: ticket.updated_at,
      });
      continue;
    }

    if (ticketAiReviewActiveById.get(ticket.id) === true) {
      continue;
    }

    if (
      session &&
      !sessionSummary?.agent_controls_worktree &&
      isAttentionNeededSessionStatus(session.status)
    ) {
      const title =
        session.plan_status === "awaiting_feedback"
          ? `Plan feedback needed for ticket #${ticket.id}`
          : session.status === "failed"
            ? `Execution failed for ticket #${ticket.id}`
            : session.status === "paused_user_control"
              ? `Manual terminal active for ticket #${ticket.id}`
              : `Input needed for ticket #${ticket.id}`;
      const message =
        (session.plan_status === "awaiting_feedback"
          ? session.plan_summary
          : null) ??
        session.last_summary ??
        (session.status === "paused_user_control"
          ? `${ticket.title} is in direct terminal mode on its worktree.`
          : `${ticket.title} needs your attention before the next attempt can continue.`);

      items.push({
        key: `session-${ticket.id}`,
        notificationKey:
          `session-${ticket.id}:` +
          `${session.id}:` +
          `${session.current_attempt_id ?? "none"}:` +
          `${session.status}:` +
          `${session.plan_status}:` +
          `${session.latest_requested_change_note_id ?? "none"}`,
        color: "yellow",
        projectColor,
        title,
        message,
        targetKind: "session",
        targetId: session.id,
        actionLabel: "Open Session",
        projectId: ticket.project,
        projectName,
        updatedAt: ticket.updated_at,
      });
      notificationEntries.push({
        key: `session-${ticket.id}`,
        notificationKey:
          `session-${ticket.id}:` +
          `${session.id}:` +
          `${session.current_attempt_id ?? "none"}:` +
          `${session.status}:` +
          `${session.plan_status}:` +
          `${session.latest_requested_change_note_id ?? "none"}`,
        updatedAt: ticket.updated_at,
      });
    }
  }

  const sortByUpdatedAtThenKey = (
    left: { key: string; updatedAt: string },
    right: { key: string; updatedAt: string },
  ): number => {
    const updatedAtComparison = right.updatedAt.localeCompare(left.updatedAt);
    return updatedAtComparison !== 0
      ? updatedAtComparison
      : right.key.localeCompare(left.key);
  };

  items.sort(sortByUpdatedAtThenKey);
  notificationEntries.sort(sortByUpdatedAtThenKey);

  return {
    items: items.map(({ updatedAt: _updatedAt, ...item }) => item),
    notificationKeys: notificationEntries.map((item) => item.notificationKey),
  };
}
