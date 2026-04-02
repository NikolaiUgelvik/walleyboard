import type { TicketFrontmatter } from "../../../../../packages/contracts/src/index.js";

import type { ListProjectTicketsOptions } from "../store.js";
import { nowIso } from "../time.js";
import { type SqliteStoreContext, mapTicket } from "./shared.js";

export class TicketRepository {
  constructor(private readonly context: SqliteStoreContext) {}

  listProjectTickets(
    projectId: string,
    options: ListProjectTicketsOptions = {},
  ): TicketFrontmatter[] {
    const { archivedOnly = false, includeArchived = false } = options;
    const statement = archivedOnly
      ? this.context.db.prepare(
          `
            SELECT *
            FROM tickets
            WHERE project_id = ?
              AND archived_at IS NOT NULL
            ORDER BY updated_at DESC, id DESC
          `,
        )
      : includeArchived
        ? this.context.db.prepare(
            `
              SELECT *
              FROM tickets
              WHERE project_id = ?
              ORDER BY updated_at DESC, id DESC
            `,
          )
        : this.context.db.prepare(
            `
              SELECT *
              FROM tickets
              WHERE project_id = ?
                AND archived_at IS NULL
              ORDER BY updated_at DESC, id DESC
            `,
          );
    const rows = statement.all(projectId) as Record<string, unknown>[];
    return rows.map(mapTicket);
  }

  getTicket(ticketId: number): TicketFrontmatter | undefined {
    const row = this.context.db
      .prepare("SELECT * FROM tickets WHERE id = ?")
      .get(ticketId) as Record<string, unknown> | undefined;
    return row ? mapTicket(row) : undefined;
  }

  updateTicketStatus(
    ticketId: number,
    status: TicketFrontmatter["status"],
  ): TicketFrontmatter | undefined {
    const ticket = this.getTicket(ticketId);
    if (!ticket) {
      return undefined;
    }

    this.context.db
      .prepare(
        `
          UPDATE tickets
          SET status = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(status, nowIso(), ticketId);

    return this.getTicket(ticketId);
  }

  archiveTicket(ticketId: number): TicketFrontmatter | undefined {
    const ticketRow = this.context.db
      .prepare("SELECT status, archived_at FROM tickets WHERE id = ?")
      .get(ticketId) as
      | { status: string; archived_at: string | null }
      | undefined;

    if (!ticketRow) {
      return undefined;
    }

    if (ticketRow.archived_at !== null) {
      throw new Error("Ticket already archived");
    }

    if (ticketRow.status !== "done") {
      throw new Error("Only completed tickets can be archived");
    }

    const timestamp = nowIso();
    this.context.db
      .prepare(
        `
          UPDATE tickets
          SET archived_at = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(timestamp, timestamp, ticketId);

    return this.getTicket(ticketId);
  }

  restoreTicket(ticketId: number): TicketFrontmatter | undefined {
    const ticketRow = this.context.db
      .prepare("SELECT archived_at FROM tickets WHERE id = ?")
      .get(ticketId) as { archived_at: string | null } | undefined;

    if (!ticketRow) {
      return undefined;
    }

    if (ticketRow.archived_at === null) {
      throw new Error("Ticket is not archived");
    }

    const timestamp = nowIso();
    this.context.db
      .prepare(
        `
          UPDATE tickets
          SET archived_at = NULL, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(timestamp, ticketId);

    return this.getTicket(ticketId);
  }

  deleteTicket(ticketId: number): TicketFrontmatter | undefined {
    const ticket = this.getTicket(ticketId);
    if (!ticket) {
      return undefined;
    }

    const reviewPackageRows = this.context.db
      .prepare("SELECT id FROM review_packages WHERE ticket_id = ?")
      .all(ticketId) as Array<{ id: string }>;
    const reviewPackageIds = reviewPackageRows.map((row) => row.id);

    const sessionId = ticket.session_id;
    const attemptRows =
      sessionId === null
        ? []
        : (this.context.db
            .prepare("SELECT id FROM execution_attempts WHERE session_id = ?")
            .all(sessionId) as Array<{ id: string }>);
    const attemptIds = attemptRows.map((row) => row.id);

    this.context.db
      .prepare("DELETE FROM requested_change_notes WHERE ticket_id = ?")
      .run(ticketId);
    this.context.db
      .prepare("DELETE FROM review_packages WHERE ticket_id = ?")
      .run(ticketId);

    if (sessionId) {
      this.context.db
        .prepare("DELETE FROM session_logs WHERE session_id = ?")
        .run(sessionId);
      this.context.db
        .prepare("DELETE FROM execution_attempts WHERE session_id = ?")
        .run(sessionId);
      this.context.db
        .prepare("DELETE FROM execution_sessions WHERE id = ?")
        .run(sessionId);
      this.context.db
        .prepare(
          `
            DELETE FROM structured_events
            WHERE entity_type = 'session' AND entity_id = ?
          `,
        )
        .run(sessionId);
    }

    for (const reviewPackageId of reviewPackageIds) {
      this.context.db
        .prepare(
          `
            DELETE FROM structured_events
            WHERE entity_type = 'review_package' AND entity_id = ?
          `,
        )
        .run(reviewPackageId);
    }

    for (const attemptId of attemptIds) {
      this.context.db
        .prepare(
          `
            DELETE FROM structured_events
            WHERE entity_type = 'attempt' AND entity_id = ?
          `,
        )
        .run(attemptId);
    }

    this.context.db
      .prepare(
        `
          DELETE FROM structured_events
          WHERE entity_type = 'ticket' AND entity_id = ?
        `,
      )
      .run(String(ticketId));

    this.context.db.prepare("DELETE FROM tickets WHERE id = ?").run(ticketId);

    return ticket;
  }
}
