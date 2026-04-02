import type {
  DraftTicketState,
  ExecutionSession,
  Project,
  TicketFrontmatter,
} from "../../../../packages/contracts/src/index.js";

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
  title: string;
  message: string;
  targetKind: "draft" | "session";
  targetId: string;
  actionLabel: string;
  projectId: string;
  projectName: string;
};

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
  sessionsById: Map<string, ExecutionSession>;
}): InboxItem[] {
  const projectNameById = new Map(
    input.projects.map((project) => [project.id, project.name]),
  );
  const items = [] as Array<InboxItem & { updatedAt: string }>;

  for (const draft of input.drafts) {
    if (draft.wizard_status !== "awaiting_confirmation") {
      continue;
    }

    const projectName =
      projectNameById.get(draft.project_id) ?? "Unknown project";
    items.push({
      key: `draft-${draft.id}`,
      color: "blue",
      title: "Draft ready to review",
      message: `Review the refined draft for **${draft.title_draft}**.`,
      targetKind: "draft",
      targetId: draft.id,
      actionLabel: "Open Draft",
      projectId: draft.project_id,
      projectName,
      updatedAt: draft.updated_at,
    });
  }

  for (const ticket of input.tickets) {
    const projectName =
      projectNameById.get(ticket.project) ?? "Unknown project";
    const session =
      ticket.session_id === null
        ? null
        : (input.sessionsById.get(ticket.session_id) ?? null);

    if (ticket.status === "review" && ticket.session_id) {
      items.push({
        key: `review-${ticket.id}`,
        color: "blue",
        title: `Review ready for ticket #${ticket.id}`,
        message:
          ticket.linked_pr === null
            ? `${ticket.title} is ready for review and can be merged or sent back for changes.`
            : `${ticket.title} is linked to PR #${ticket.linked_pr.number} and is waiting on GitHub review.`,
        targetKind: "session",
        targetId: ticket.session_id,
        actionLabel: "Open Review",
        projectId: ticket.project,
        projectName,
        updatedAt: ticket.updated_at,
      });
      continue;
    }

    if (session && isAttentionNeededSessionStatus(session.status)) {
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
        color: "yellow",
        title,
        message,
        targetKind: "session",
        targetId: session.id,
        actionLabel: "Open Session",
        projectId: ticket.project,
        projectName,
        updatedAt: ticket.updated_at,
      });
    }
  }

  items.sort((left, right) => {
    const updatedAtComparison = right.updatedAt.localeCompare(left.updatedAt);
    return updatedAtComparison !== 0
      ? updatedAtComparison
      : right.key.localeCompare(left.key);
  });

  return items.map(({ updatedAt: _updatedAt, ...item }) => item);
}
