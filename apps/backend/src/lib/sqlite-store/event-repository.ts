import { sql } from "drizzle-orm";
import type { StructuredEvent } from "../../../../../packages/contracts/src/index.js";

import { mapStructuredEvent, type SqliteStoreContext } from "./shared.js";

export class EventRepository {
  constructor(private readonly context: SqliteStoreContext) {}

  getDraftEvents(draftId: string): StructuredEvent[] {
    const rows = this.context.db.all<Record<string, unknown>>(sql`
      SELECT *
      FROM structured_events
      WHERE entity_type = 'draft' AND entity_id = ${draftId}
      ORDER BY occurred_at DESC
    `);
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
    const rows = this.context.db.all<Record<string, unknown>>(sql`
      SELECT *
      FROM structured_events
      WHERE entity_type = 'ticket' AND entity_id = ${String(ticketId)}
      ORDER BY occurred_at DESC
    `);
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
