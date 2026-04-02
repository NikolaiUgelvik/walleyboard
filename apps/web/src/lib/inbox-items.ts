import type {
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
  sessionId: string;
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
  projects: Project[];
  tickets: TicketFrontmatter[];
  sessionsById: Map<string, ExecutionSession>;
}): InboxItem[] {
  const projectNameById = new Map(
    input.projects.map((project) => [project.id, project.name]),
  );

  return [...input.tickets]
    .sort((left, right) => {
      const updatedAtComparison = right.updated_at.localeCompare(
        left.updated_at,
      );
      return updatedAtComparison !== 0
        ? updatedAtComparison
        : right.id - left.id;
    })
    .flatMap((ticket): InboxItem[] => {
      const projectName =
        projectNameById.get(ticket.project) ?? "Unknown project";
      const session =
        ticket.session_id === null
          ? null
          : (input.sessionsById.get(ticket.session_id) ?? null);

      if (ticket.status === "review" && ticket.session_id) {
        return [
          {
            key: `review-${ticket.id}`,
            color: "blue",
            title: `Review ready for ticket #${ticket.id}`,
            message: `${ticket.title} is ready for review and can be merged or sent back for changes.`,
            sessionId: ticket.session_id,
            actionLabel: "Open Review",
            projectId: ticket.project,
            projectName,
          },
        ];
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

        return [
          {
            key: `session-${ticket.id}`,
            color: "yellow",
            title,
            message,
            sessionId: session.id,
            actionLabel: "Open Session",
            projectId: ticket.project,
            projectName,
          },
        ];
      }

      return [];
    });
}
