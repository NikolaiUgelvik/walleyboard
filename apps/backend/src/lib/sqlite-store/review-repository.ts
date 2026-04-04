import {
  requestedChangeNotesTable,
  reviewPackagesTable,
  reviewRunsTable,
} from "@walleyboard/db";
import { and, asc, count, desc, eq } from "drizzle-orm";
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
} from "./shared.js";

export class ReviewRepository {
  constructor(private readonly context: SqliteStoreContext) {}

  getReviewPackage(ticketId: number): ReviewPackage | undefined {
    const row = this.context.db
      .select()
      .from(reviewPackagesTable)
      .where(eq(reviewPackagesTable.ticketId, ticketId))
      .orderBy(desc(reviewPackagesTable.createdAt))
      .get();
    return row ? mapReviewPackage(row) : undefined;
  }

  createReviewPackage(input: CreateReviewPackageInput): ReviewPackage {
    const id = nanoid();
    const timestamp = nowIso();

    this.context.db
      .insert(reviewPackagesTable)
      .values({
        id,
        ticketId: input.ticket_id,
        sessionId: input.session_id,
        diffRef: input.diff_ref,
        commitRefs: input.commit_refs,
        changeSummary: input.change_summary,
        validationResults: input.validation_results,
        remainingRisks: input.remaining_risks,
        createdAt: timestamp,
      })
      .run();

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
      .select()
      .from(reviewRunsTable)
      .where(eq(reviewRunsTable.ticketId, ticketId))
      .orderBy(desc(reviewRunsTable.createdAt))
      .get();
    return row ? mapReviewRun(row) : undefined;
  }

  listReviewRuns(ticketId: number): ReviewRun[] {
    const rows = this.context.db
      .select()
      .from(reviewRunsTable)
      .where(eq(reviewRunsTable.ticketId, ticketId))
      .orderBy(asc(reviewRunsTable.createdAt), asc(reviewRunsTable.id))
      .all();
    return rows.map(mapReviewRun);
  }

  countAutomaticReviewRuns(ticketId: number): number {
    const row = this.context.db
      .select({ count: count() })
      .from(reviewRunsTable)
      .where(
        and(
          eq(reviewRunsTable.ticketId, ticketId),
          eq(reviewRunsTable.triggerSource, "automatic"),
        ),
      )
      .get();
    return Number(row?.count ?? 0);
  }

  createReviewRun(
    input: CreateReviewRunInput & {
      trigger_source?: "automatic" | "manual";
    },
  ): ReviewRun {
    const id = nanoid();
    const timestamp = nowIso();

    this.context.db
      .insert(reviewRunsTable)
      .values({
        id,
        ticketId: input.ticket_id,
        reviewPackageId: input.review_package_id,
        implementationSessionId: input.implementation_session_id,
        triggerSource: input.trigger_source ?? "manual",
        status: "running",
        adapterSessionRef: null,
        prompt: input.prompt ?? null,
        report: null,
        failureMessage: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
      })
      .run();

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
      .update(reviewRunsTable)
      .set({
        status: input.status ?? existingRun.status,
        adapterSessionRef:
          input.adapter_session_ref !== undefined
            ? input.adapter_session_ref
            : existingRun.adapter_session_ref,
        prompt: input.prompt !== undefined ? input.prompt : existingRun.prompt,
        report: input.report !== undefined ? input.report : existingRun.report,
        failureMessage:
          input.failure_message !== undefined
            ? input.failure_message
            : existingRun.failure_message,
        updatedAt: nowIso(),
        completedAt,
      })
      .where(eq(reviewRunsTable.id, reviewRunId))
      .run();

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
      .select()
      .from(requestedChangeNotesTable)
      .where(eq(requestedChangeNotesTable.id, noteId))
      .get();
    return row ? mapRequestedChangeNote(row) : undefined;
  }

  getReviewRun(reviewRunId: string): ReviewRun | undefined {
    const row = this.context.db
      .select()
      .from(reviewRunsTable)
      .where(eq(reviewRunsTable.id, reviewRunId))
      .get();
    return row ? mapReviewRun(row) : undefined;
  }
}
