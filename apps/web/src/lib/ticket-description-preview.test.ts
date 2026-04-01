import assert from "node:assert/strict";
import test from "node:test";

import {
  BOARD_TICKET_DESCRIPTION_PREVIEW_LIMIT,
  getBoardTicketDescriptionPreview,
} from "./ticket-description-preview.js";

test("returns the full description when it is shorter than the preview limit", () => {
  const description = "a".repeat(BOARD_TICKET_DESCRIPTION_PREVIEW_LIMIT - 1);

  assert.equal(getBoardTicketDescriptionPreview(description), description);
});

test("returns the full description when it is exactly at the preview limit", () => {
  const description = "b".repeat(BOARD_TICKET_DESCRIPTION_PREVIEW_LIMIT);

  assert.equal(getBoardTicketDescriptionPreview(description), description);
});

test("truncates descriptions longer than the preview limit and appends an ellipsis", () => {
  const description = "c".repeat(BOARD_TICKET_DESCRIPTION_PREVIEW_LIMIT + 1);

  assert.equal(
    getBoardTicketDescriptionPreview(description),
    `${"c".repeat(BOARD_TICKET_DESCRIPTION_PREVIEW_LIMIT)}...`,
  );
});
