import { structuredEventsTable } from "@walleyboard/db";
import { and, desc, eq } from "drizzle-orm";
import type { StructuredEvent } from "../../../../../packages/contracts/src/index.js";

import { mapStructuredEvent, type SqliteStoreContext } from "./shared.js";

export class EventRepository {
  constructor(private readonly context: SqliteStoreContext) {}

  getDraftEvents(draftId: string): StructuredEvent[] {
    const rows = this.context.db
      .select()
      .from(structuredEventsTable)
      .where(
        and(
          eq(structuredEventsTable.entityType, "draft"),
          eq(structuredEventsTable.entityId, draftId),
        ),
      )
      .orderBy(desc(structuredEventsTable.occurredAt))
      .all();
    return rows.map(mapStructuredEvent);
  }

  recordDraftEvent(
    draftId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): StructuredEvent {
    return this.context.recordStructuredEvent(
      "draft",
      draftId,
      eventType,
      payload,
    );
  }

  getTicketEvents(ticketId: number): StructuredEvent[] {
    const rows = this.context.db
      .select()
      .from(structuredEventsTable)
      .where(
        and(
          eq(structuredEventsTable.entityType, "ticket"),
          eq(structuredEventsTable.entityId, String(ticketId)),
        ),
      )
      .orderBy(desc(structuredEventsTable.occurredAt))
      .all();
    return rows.map(mapStructuredEvent);
  }

  recordTicketEvent(
    ticketId: number,
    eventType: string,
    payload: Record<string, unknown>,
  ): StructuredEvent {
    return this.context.recordStructuredEvent(
      "ticket",
      String(ticketId),
      eventType,
      payload,
    );
  }
}
