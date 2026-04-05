import assert from "node:assert/strict";
import test from "node:test";

import type { TicketReference } from "../../../../packages/contracts/src/index.js";

import { getMatchingTicketReferences } from "./ticket-reference-suggestions.js";

function createTicketReference(
  overrides: Partial<TicketReference> = {},
): TicketReference {
  return {
    status: "ready",
    ticket_id: 33,
    title: "Ship the markdown editor cleanup",
    ...overrides,
  };
}

test("ticket reference suggestions prefer exact id matches", () => {
  const matches = getMatchingTicketReferences(
    [
      createTicketReference(),
      createTicketReference({
        ticket_id: 108,
        title: "Tidy receipt footer spacing",
      }),
    ],
    "33",
  );

  assert.deepEqual(
    matches.map((reference) => reference.ticket_id),
    [33],
  );
});

test("ticket reference suggestions match by title text", () => {
  const matches = getMatchingTicketReferences(
    [
      createTicketReference(),
      createTicketReference({
        status: "in_progress",
        ticket_id: 108,
        title: "Tidy receipt footer spacing",
      }),
    ],
    "receipt",
  );

  assert.deepEqual(
    matches.map((reference) => reference.ticket_id),
    [108],
  );
});
