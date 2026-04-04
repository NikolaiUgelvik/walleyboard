import { ticketsTable } from "@walleyboard/db";
import { and, inArray, isNull } from "drizzle-orm";
import {
  collectTicketReferenceIds,
  type TicketReference,
} from "../../../../../packages/contracts/src/index.js";

import type { SqliteStoreContext } from "./shared.js";

export class TicketReferenceValidationError extends Error {}

export function resolveTicketReferences(
  context: SqliteStoreContext,
  texts: string[],
): TicketReference[] {
  const referenceIds = collectTicketReferenceIds(texts);
  if (referenceIds.length === 0) {
    return [];
  }
  const rows = context.db
    .select({
      id: ticketsTable.id,
      title: ticketsTable.title,
      status: ticketsTable.status,
    })
    .from(ticketsTable)
    .where(
      and(
        inArray(ticketsTable.id, referenceIds),
        isNull(ticketsTable.archivedAt),
      ),
    )
    .all();

  const referenceById = new Map(
    rows.map((row) => [
      row.id,
      {
        ticket_id: row.id,
        title: row.title,
        status: row.status as TicketReference["status"],
      } satisfies TicketReference,
    ]),
  );

  return referenceIds.flatMap((ticketId) => {
    const reference = referenceById.get(ticketId);
    return reference ? [reference] : [];
  });
}

export function validateTicketReferences(
  context: SqliteStoreContext,
  texts: string[],
): void {
  const referenceIds = collectTicketReferenceIds(texts);
  if (referenceIds.length === 0) {
    return;
  }

  const resolvedIds = new Set(
    resolveTicketReferences(context, texts).map(
      (reference) => reference.ticket_id,
    ),
  );
  const missingReferenceLabels = referenceIds
    .filter((ticketId) => !resolvedIds.has(ticketId))
    .map((ticketId) => `#${ticketId}`);

  if (missingReferenceLabels.length === 0) {
    return;
  }

  throw new TicketReferenceValidationError(
    missingReferenceLabels.length === 1
      ? `Ticket reference ${missingReferenceLabels[0]} does not exist.`
      : `Ticket references ${missingReferenceLabels.join(", ")} do not exist.`,
  );
}
