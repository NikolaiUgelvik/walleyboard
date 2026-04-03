import { nanoid } from "nanoid";

import type {
  RequestedChangeNote,
  ReviewPackage,
  ReviewRun,
} from "../../../../../packages/contracts/src/index.js";

import type {
  CreateReviewPackageInput,
  CreateReviewRunInput,
  UpdateReviewRunInput,
} from "../store.js";
import { nowIso } from "../time.js";
import {
  mapRequestedChangeNote,
  mapReviewPackage,
  mapReviewRun,
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

  getLatestReviewRun(ticketId: number): ReviewRun | undefined {
    const row = this.context.db
      .prepare(
        "SELECT * FROM review_runs WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(ticketId) as Record<string, unknown> | undefined;
    return row ? mapReviewRun(row) : undefined;
  }

  listReviewRuns(ticketId: number): ReviewRun[] {
    const rows = this.context.db
      .prepare(
        "SELECT * FROM review_runs WHERE ticket_id = ? ORDER BY created_at ASC, id ASC",
      )
      .all(ticketId) as Record<string, unknown>[];
    return rows.map(mapReviewRun);
  }

  countAutomaticReviewRuns(ticketId: number): number {
    const row = this.context.db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM review_runs
          WHERE ticket_id = ?
            AND trigger_source = 'automatic'
        `,
      )
      .get(ticketId) as { count: number };
    return Number(row.count);
  }

  createReviewRun(
    input: CreateReviewRunInput & {
      trigger_source?: "automatic" | "manual";
    },
  ): ReviewRun {
    const id = nanoid();
    const timestamp = nowIso();

    this.context.db
      .prepare(
        `
          INSERT INTO review_runs (
            id, ticket_id, review_package_id, implementation_session_id, trigger_source, status,
            adapter_session_ref, report, failure_message, created_at, updated_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        id,
        input.ticket_id,
        input.review_package_id,
        input.implementation_session_id,
        input.trigger_source ?? "manual",
        "running",
        null,
        null,
        null,
        timestamp,
        timestamp,
        null,
      );

    this.context.recordStructuredEvent("review_run", id, "review_run.started", {
      ticket_id: input.ticket_id,
      review_package_id: input.review_package_id,
      implementation_session_id: input.implementation_session_id,
    });

    return requireValue(
      this.getReviewRun(id),
      "Review run not found after creation",
    );
  }

  updateReviewRun(
    reviewRunId: string,
    input: UpdateReviewRunInput,
  ): ReviewRun | undefined {
    const existingRun = this.getReviewRun(reviewRunId);
    if (!existingRun) {
      return undefined;
    }

    const completedAt =
      input.completed_at !== undefined
        ? input.completed_at
        : input.status && input.status !== "running"
          ? nowIso()
          : existingRun.completed_at;

    this.context.db
      .prepare(
        `
          UPDATE review_runs
          SET status = ?,
              adapter_session_ref = ?,
              report = ?,
              failure_message = ?,
              updated_at = ?,
              completed_at = ?
          WHERE id = ?
        `,
      )
      .run(
        input.status ?? existingRun.status,
        input.adapter_session_ref !== undefined
          ? input.adapter_session_ref
          : existingRun.adapter_session_ref,
        input.report !== undefined
          ? input.report === null
            ? null
            : stringifyJson(input.report)
          : existingRun.report === null
            ? null
            : stringifyJson(existingRun.report),
        input.failure_message !== undefined
          ? input.failure_message
          : existingRun.failure_message,
        nowIso(),
        completedAt,
        reviewRunId,
      );

    const updatedRun = this.getReviewRun(reviewRunId);
    if (!updatedRun) {
      return undefined;
    }

    if (updatedRun.status === "completed") {
      this.context.recordStructuredEvent(
        "review_run",
        reviewRunId,
        "review_run.completed",
        {
          ticket_id: updatedRun.ticket_id,
          review_package_id: updatedRun.review_package_id,
          actionable_findings:
            updatedRun.report?.actionable_findings.length ?? 0,
        },
      );
    } else if (updatedRun.status === "failed") {
      this.context.recordStructuredEvent(
        "review_run",
        reviewRunId,
        "review_run.failed",
        {
          ticket_id: updatedRun.ticket_id,
          review_package_id: updatedRun.review_package_id,
          failure_message: updatedRun.failure_message,
        },
      );
    }

    return updatedRun;
  }

  getRequestedChangeNote(noteId: string): RequestedChangeNote | undefined {
    const row = this.context.db
      .prepare("SELECT * FROM requested_change_notes WHERE id = ?")
      .get(noteId) as Record<string, unknown> | undefined;
    return row ? mapRequestedChangeNote(row) : undefined;
  }

  getReviewRun(reviewRunId: string): ReviewRun | undefined {
    const row = this.context.db
      .prepare("SELECT * FROM review_runs WHERE id = ?")
      .get(reviewRunId) as Record<string, unknown> | undefined;
    return row ? mapReviewRun(row) : undefined;
  }
}
