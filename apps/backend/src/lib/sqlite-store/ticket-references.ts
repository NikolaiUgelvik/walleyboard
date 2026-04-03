import type { TicketReference } from "../../../../../packages/contracts/src/index.js";

import type { SqliteStoreContext } from "./shared.js";

const ticketReferencePattern = /(?<![A-Za-z0-9_])#(?<ticketId>[1-9]\d*)\b/g;

export class TicketReferenceValidationError extends Error {}

export function collectTicketReferenceIds(texts: string[]): number[] {
  const seenIds = new Set<number>();
  const referenceIds: number[] = [];

  for (const text of texts) {
    for (const match of text.matchAll(ticketReferencePattern)) {
      const ticketId = Number(match.groups?.ticketId ?? "");
      if (
        !Number.isInteger(ticketId) ||
        ticketId <= 0 ||
        seenIds.has(ticketId)
      ) {
        continue;
      }

      seenIds.add(ticketId);
      referenceIds.push(ticketId);
    }
  }

  return referenceIds;
}

export function resolveTicketReferences(
  context: SqliteStoreContext,
  texts: string[],
): TicketReference[] {
  const referenceIds = collectTicketReferenceIds(texts);
  if (referenceIds.length === 0) {
    return [];
  }

  const placeholders = referenceIds.map(() => "?").join(", ");
  const rows = context.db
    .prepare(
      `
        SELECT id, title, status
        FROM tickets
        WHERE id IN (${placeholders})
      `,
    )
    .all(...referenceIds) as Array<{
    id: number;
    title: string;
    status: TicketReference["status"];
  }>;

  const referenceById = new Map(
    rows.map((row) => [
      row.id,
      {
        ticket_id: row.id,
        title: row.title,
        status: row.status,
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
