import {
  executionAttemptsTable,
  reviewPackagesTable,
  reviewRunsTable,
  structuredEventsTable,
  ticketsTable,
} from "@walleyboard/db";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type {
  PullRequestRef,
  TicketFrontmatter,
  TicketReference,
} from "../../../../../packages/contracts/src/index.js";

import type {
  ListProjectTicketsOptions,
  SearchProjectTicketReferencesInput,
} from "../store.js";
import { nowIso } from "../time.js";
import { mapTicket, type SqliteStoreContext } from "./shared.js";
import { resolveTicketReferences } from "./ticket-references.js";

function escapeSqlLikePattern(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

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
    const where = archivedOnly
      ? and(
          eq(ticketsTable.projectId, projectId),
          isNotNull(ticketsTable.archivedAt),
        )
      : includeArchived
        ? eq(ticketsTable.projectId, projectId)
        : and(
            eq(ticketsTable.projectId, projectId),
            isNull(ticketsTable.archivedAt),
          );
    const rows = this.context.db
      .select()
      .from(ticketsTable)
      .where(where)
      .orderBy(desc(ticketsTable.updatedAt), desc(ticketsTable.id))
      .all();
    return rows.map((row) => this.#mapTicketRow(row));
  }

  searchProjectTicketReferences(
    projectId: string,
    input: SearchProjectTicketReferencesInput,
  ): TicketReference[] {
    const normalizedQuery = input.query.trim().toLowerCase();
    const limit = Math.max(1, input.limit);
    const idText = sql<string>`cast(${ticketsTable.id} as text)`;
    const normalizedTitle = sql<string>`lower(${ticketsTable.title})`;
    const baseWhere = and(
      eq(ticketsTable.projectId, projectId),
      isNull(ticketsTable.archivedAt),
    );

    const rows =
      normalizedQuery.length === 0
        ? this.context.db
            .select({
              id: ticketsTable.id,
              status: ticketsTable.status,
              title: ticketsTable.title,
            })
            .from(ticketsTable)
            .where(baseWhere)
            .orderBy(desc(ticketsTable.updatedAt), desc(ticketsTable.id))
            .limit(limit)
            .all()
        : (() => {
            const escapedQuery = escapeSqlLikePattern(normalizedQuery);
            const startsWithPattern = `${escapedQuery}%`;
            const containsPattern = `%${escapedQuery}%`;
            const scoreExpression = sql<number>`
              case
                when ${idText} = ${normalizedQuery} then 0
                when ${idText} like ${startsWithPattern} escape '\\' then 1
                when ${normalizedTitle} like ${startsWithPattern} escape '\\' then 2
                when ${idText} like ${containsPattern} escape '\\' then 3
                when ${normalizedTitle} like ${containsPattern} escape '\\' then 4
                else 5
              end
            `;

            return this.context.db
              .select({
                id: ticketsTable.id,
                status: ticketsTable.status,
                title: ticketsTable.title,
              })
              .from(ticketsTable)
              .where(
                and(
                  baseWhere,
                  or(
                    sql`${idText} like ${containsPattern} escape '\\'`,
                    sql`${normalizedTitle} like ${containsPattern} escape '\\'`,
                  ),
                ),
              )
              .orderBy(
                scoreExpression,
                desc(ticketsTable.updatedAt),
                asc(ticketsTable.id),
              )
              .limit(limit)
              .all();
          })();

    return rows.map((row) => ({
      status: row.status as TicketReference["status"],
      ticket_id: row.id,
      title: row.title,
    }));
  }

  getTicket(ticketId: number): TicketFrontmatter | undefined {
    const row = this.context.db
      .select()
      .from(ticketsTable)
      .where(eq(ticketsTable.id, ticketId))
      .get();
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

    this.context.db
      .update(ticketsTable)
      .set({
        status,
        updatedAt: nowIso(),
      })
      .where(eq(ticketsTable.id, ticketId))
      .run();

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

    this.context.db
      .update(ticketsTable)
      .set({
        linkedPr,
        updatedAt: nowIso(),
      })
      .where(eq(ticketsTable.id, ticketId))
      .run();

    return this.getTicket(ticketId);
  }

  archiveTicket(ticketId: number): TicketFrontmatter | undefined {
    const ticketRow = this.context.db
      .select({
        status: ticketsTable.status,
        archivedAt: ticketsTable.archivedAt,
      })
      .from(ticketsTable)
      .where(eq(ticketsTable.id, ticketId))
      .get();

    if (!ticketRow) {
      return undefined;
    }

    if (ticketRow.archivedAt !== null) {
      throw new Error("Ticket already archived");
    }

    if (ticketRow.status !== "done") {
      throw new Error("Only completed tickets can be archived");
    }

    const timestamp = nowIso();
    this.context.db
      .update(ticketsTable)
      .set({
        archivedAt: timestamp,
        updatedAt: timestamp,
      })
      .where(eq(ticketsTable.id, ticketId))
      .run();

    return this.getTicket(ticketId);
  }

  restoreTicket(ticketId: number): TicketFrontmatter | undefined {
    const ticketRow = this.context.db
      .select({ archivedAt: ticketsTable.archivedAt })
      .from(ticketsTable)
      .where(eq(ticketsTable.id, ticketId))
      .get();

    if (!ticketRow) {
      return undefined;
    }

    if (ticketRow.archivedAt === null) {
      throw new Error("Ticket is not archived");
    }

    const timestamp = nowIso();
    this.context.db
      .update(ticketsTable)
      .set({
        archivedAt: null,
        updatedAt: timestamp,
      })
      .where(eq(ticketsTable.id, ticketId))
      .run();

    return this.getTicket(ticketId);
  }

  deleteTicket(ticketId: number): TicketFrontmatter | undefined {
    const ticket = this.getTicket(ticketId);
    if (!ticket) {
      return undefined;
    }

    const reviewPackageRows = this.context.db
      .select({ id: reviewPackagesTable.id })
      .from(reviewPackagesTable)
      .where(eq(reviewPackagesTable.ticketId, ticketId))
      .all();
    const reviewPackageIds = reviewPackageRows.map((row) => row.id);
    const reviewRunRows = this.context.db
      .select({ id: reviewRunsTable.id })
      .from(reviewRunsTable)
      .where(eq(reviewRunsTable.ticketId, ticketId))
      .all();
    const reviewRunIds = reviewRunRows.map((row) => row.id);

    const sessionId = ticket.session_id;
    const attemptRows =
      sessionId === null
        ? []
        : this.context.db
            .select({ id: executionAttemptsTable.id })
            .from(executionAttemptsTable)
            .where(eq(executionAttemptsTable.sessionId, sessionId))
            .all();
    const attemptIds = attemptRows.map((row) => row.id);

    if (sessionId) {
      this.context.db
        .delete(structuredEventsTable)
        .where(
          and(
            eq(structuredEventsTable.entityType, "session"),
            eq(structuredEventsTable.entityId, sessionId),
          ),
        )
        .run();
    }

    if (reviewPackageIds.length > 0) {
      this.context.db
        .delete(structuredEventsTable)
        .where(
          and(
            eq(structuredEventsTable.entityType, "review_package"),
            inArray(structuredEventsTable.entityId, reviewPackageIds),
          ),
        )
        .run();
    }

    if (reviewRunIds.length > 0) {
      this.context.db
        .delete(structuredEventsTable)
        .where(
          and(
            eq(structuredEventsTable.entityType, "review_run"),
            inArray(structuredEventsTable.entityId, reviewRunIds),
          ),
        )
        .run();
    }

    if (attemptIds.length > 0) {
      this.context.db
        .delete(structuredEventsTable)
        .where(
          and(
            eq(structuredEventsTable.entityType, "attempt"),
            inArray(structuredEventsTable.entityId, attemptIds),
          ),
        )
        .run();
    }

    this.context.db
      .delete(structuredEventsTable)
      .where(
        and(
          eq(structuredEventsTable.entityType, "ticket"),
          eq(structuredEventsTable.entityId, String(ticketId)),
        ),
      )
      .run();
    this.context.db
      .delete(ticketsTable)
      .where(eq(ticketsTable.id, ticketId))
      .run();

    return ticket;
  }
}
