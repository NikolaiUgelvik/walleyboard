import { nanoid } from "nanoid";

import type {
  RequestedChangeNote,
  ReviewPackage,
} from "../../../../../packages/contracts/src/index.js";

import type { CreateReviewPackageInput } from "../store.js";
import { nowIso } from "../time.js";
import {
  mapRequestedChangeNote,
  mapReviewPackage,
  requireValue,
  type SqliteStoreContext,
  stringifyJson,
} from "./shared.js";

export class ReviewRepository {
  constructor(private readonly context: SqliteStoreContext) {}

  getReviewPackage(ticketId: number): ReviewPackage | undefined {
    const row = this.context.db
      .prepare(
        "SELECT * FROM review_packages WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(ticketId) as Record<string, unknown> | undefined;
    return row ? mapReviewPackage(row) : undefined;
  }

  createReviewPackage(input: CreateReviewPackageInput): ReviewPackage {
    const id = nanoid();
    const timestamp = nowIso();

    this.context.db
      .prepare(
        `
          INSERT INTO review_packages (
            id, ticket_id, session_id, diff_ref, commit_refs, change_summary,
            validation_results, remaining_risks, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        id,
        input.ticket_id,
        input.session_id,
        input.diff_ref,
        stringifyJson(input.commit_refs),
        input.change_summary,
        stringifyJson(input.validation_results),
        stringifyJson(input.remaining_risks),
        timestamp,
      );

    this.context.recordStructuredEvent(
      "review_package",
      id,
      "review_package.generated",
      {
        ticket_id: input.ticket_id,
        session_id: input.session_id,
        diff_ref: input.diff_ref,
        commit_refs: input.commit_refs,
      },
    );

    return requireValue(
      this.getReviewPackage(input.ticket_id),
      "Review package not found after creation",
    );
  }

  getRequestedChangeNote(noteId: string): RequestedChangeNote | undefined {
    const row = this.context.db
      .prepare("SELECT * FROM requested_change_notes WHERE id = ?")
      .get(noteId) as Record<string, unknown> | undefined;
    return row ? mapRequestedChangeNote(row) : undefined;
  }
}
