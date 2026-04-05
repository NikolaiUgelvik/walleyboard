import type { TicketReference } from "../../../../packages/contracts/src/index.js";

const ticketReferenceSuggestionLimit = 50;

export function getMatchingTicketReferences(
  ticketReferences: TicketReference[],
  query: string,
): TicketReference[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (normalizedQuery.length === 0) {
    return ticketReferences.slice(0, ticketReferenceSuggestionLimit);
  }

  return ticketReferences
    .map((reference) => {
      const ticketId = String(reference.ticket_id);
      const title = reference.title.toLowerCase();
      const exactIdMatch = ticketId === normalizedQuery;
      const exactHashMatch = `#${ticketId}` === normalizedQuery;
      const idStartsWith = ticketId.startsWith(normalizedQuery);
      const titleStartsWith = title.startsWith(normalizedQuery);
      const idIncludes = ticketId.includes(normalizedQuery);
      const titleIncludes = title.includes(normalizedQuery);

      if (
        !exactIdMatch &&
        !exactHashMatch &&
        !idStartsWith &&
        !titleStartsWith &&
        !idIncludes &&
        !titleIncludes
      ) {
        return null;
      }

      const score =
        exactIdMatch || exactHashMatch
          ? 0
          : idStartsWith
            ? 1
            : titleStartsWith
              ? 2
              : idIncludes
                ? 3
                : 4;

      return {
        reference,
        score,
      };
    })
    .filter(
      (value): value is { reference: TicketReference; score: number } =>
        value !== null,
    )
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }

      return left.reference.ticket_id - right.reference.ticket_id;
    })
    .slice(0, ticketReferenceSuggestionLimit)
    .map((entry) => entry.reference);
}
