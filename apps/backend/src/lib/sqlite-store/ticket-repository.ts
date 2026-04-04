import { sql } from "drizzle-orm";
import type {
  PullRequestRef,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import type { ListProjectTicketsOptions } from "../store.js";
import { nowIso } from "../time.js";
import { mapTicket, type SqliteStoreContext, stringifyJson } from "./shared.js";
import { resolveTicketReferences } from "./ticket-references.js";

export class TicketRepository {
  constructor(private readonly context: SqliteStoreContext) {}

  #mapTicketRow(row: Record<string, unknown>): TicketFrontmatter {
    return mapTicket(row, [
      ...resolveTicketReferences(this.context, [
        String(row.title ?? ""),
        row.description === null ? "" : String(row.description),
      ]),
    ]);
  }

  listProjectTickets(
    projectId: string,
    options: ListProjectTicketsOptions = {},
  ): TicketFrontmatter[] {
    const { archivedOnly = false, includeArchived = false } = options;
    const archivedClause = archivedOnly
      ? sql`AND archived_at IS NOT NULL`
      : includeArchived
        ? sql.empty()
        : sql`AND archived_at IS NULL`;
    const rows = this.context.db.all<Record<string, unknown>>(sql`
      SELECT *
      FROM tickets
      WHERE project_id = ${projectId}
        ${archivedClause}
      ORDER BY updated_at DESC, id DESC
    `);
    return rows.map((row) => this.#mapTicketRow(row));
  }

  getTicket(ticketId: number): TicketFrontmatter | undefined {
    const row = this.context.db.get<Record<string, unknown>>(sql`
      SELECT *
      FROM tickets
      WHERE id = ${ticketId}
    `);
    return row ? this.#mapTicketRow(row) : undefined;
  }

  updateTicketStatus(
    ticketId: number,
    status: TicketFrontmatter["status"],
  ): TicketFrontmatter | undefined {
    const ticket = this.getTicket(ticketId);
    if (!ticket) {
      return undefined;
    }

    this.context.db.run(sql`
      UPDATE tickets
      SET status = ${status},
          updated_at = ${nowIso()}
      WHERE id = ${ticketId}
    `);

    return this.getTicket(ticketId);
  }

  updateTicketLinkedPr(
    ticketId: number,
    linkedPr: PullRequestRef | null,
  ): TicketFrontmatter | undefined {
    const ticket = this.getTicket(ticketId);
    if (!ticket) {
      return undefined;
    }

    this.context.db.run(sql`
      UPDATE tickets
      SET linked_pr = ${linkedPr === null ? null : stringifyJson(linkedPr)},
          updated_at = ${nowIso()}
      WHERE id = ${ticketId}
    `);

    return this.getTicket(ticketId);
  }

  archiveTicket(ticketId: number): TicketFrontmatter | undefined {
    const ticketRow = this.context.db.get<{
      status: string;
      archived_at: string | null;
    }>(sql`
      SELECT status, archived_at
      FROM tickets
      WHERE id = ${ticketId}
    `);

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
    this.context.db.run(sql`
      UPDATE tickets
      SET archived_at = ${timestamp},
          updated_at = ${timestamp}
      WHERE id = ${ticketId}
    `);

    return this.getTicket(ticketId);
  }

  restoreTicket(ticketId: number): TicketFrontmatter | undefined {
    const ticketRow = this.context.db.get<{ archived_at: string | null }>(sql`
      SELECT archived_at
      FROM tickets
      WHERE id = ${ticketId}
    `);

    if (!ticketRow) {
      return undefined;
    }

    if (ticketRow.archived_at === null) {
      throw new Error("Ticket is not archived");
    }

    const timestamp = nowIso();
    this.context.db.run(sql`
      UPDATE tickets
      SET archived_at = NULL,
          updated_at = ${timestamp}
      WHERE id = ${ticketId}
    `);

    return this.getTicket(ticketId);
  }

  deleteTicket(ticketId: number): TicketFrontmatter | undefined {
    const ticket = this.getTicket(ticketId);
    if (!ticket) {
      return undefined;
    }

    const reviewPackageRows = this.context.db.all<{ id: string }>(sql`
      SELECT id
      FROM review_packages
      WHERE ticket_id = ${ticketId}
    `);
    const reviewPackageIds = reviewPackageRows.map((row) => row.id);
    const reviewRunRows = this.context.db.all<{ id: string }>(sql`
      SELECT id
      FROM review_runs
      WHERE ticket_id = ${ticketId}
    `);
    const reviewRunIds = reviewRunRows.map((row) => row.id);

    const sessionId = ticket.session_id;
    const attemptRows =
      sessionId === null
        ? []
        : this.context.db.all<{ id: string }>(sql`
            SELECT id
            FROM execution_attempts
            WHERE session_id = ${sessionId}
          `);
    const attemptIds = attemptRows.map((row) => row.id);

    this.context.db.run(sql`
      DELETE FROM requested_change_notes
      WHERE ticket_id = ${ticketId}
    `);
    this.context.db.run(sql`
      DELETE FROM review_packages
      WHERE ticket_id = ${ticketId}
    `);
    this.context.db.run(sql`
      DELETE FROM review_runs
      WHERE ticket_id = ${ticketId}
    `);

    if (sessionId) {
      this.context.db.run(sql`
        DELETE FROM session_logs
        WHERE session_id = ${sessionId}
      `);
      this.context.db.run(sql`
        DELETE FROM execution_attempts
        WHERE session_id = ${sessionId}
      `);
      this.context.db.run(sql`
        DELETE FROM execution_sessions
        WHERE id = ${sessionId}
      `);
      this.context.db.run(sql`
        DELETE FROM structured_events
        WHERE entity_type = 'session' AND entity_id = ${sessionId}
      `);
    }

    for (const reviewPackageId of reviewPackageIds) {
      this.context.db.run(sql`
        DELETE FROM structured_events
        WHERE entity_type = 'review_package' AND entity_id = ${reviewPackageId}
      `);
    }

    for (const reviewRunId of reviewRunIds) {
      this.context.db.run(sql`
        DELETE FROM structured_events
        WHERE entity_type = 'review_run' AND entity_id = ${reviewRunId}
      `);
    }

    for (const attemptId of attemptIds) {
      this.context.db.run(sql`
        DELETE FROM structured_events
        WHERE entity_type = 'attempt' AND entity_id = ${attemptId}
      `);
    }

    this.context.db.run(sql`
      DELETE FROM structured_events
      WHERE entity_type = 'ticket' AND entity_id = ${String(ticketId)}
    `);

    this.context.db.run(sql`
      DELETE FROM tickets
      WHERE id = ${ticketId}
    `);

    return ticket;
  }
}
