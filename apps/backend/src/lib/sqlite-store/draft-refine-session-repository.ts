import { draftRefineSessionsTable } from "@walleyboard/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type {
  DraftRefineSession,
  DraftRefineSessionPersistence,
  DraftRefineSessionStatus,
} from "../store.js";
import { nowIso } from "../time.js";
import type { SqliteStoreContext } from "./shared.js";

function mapRow(
  row: typeof draftRefineSessionsTable.$inferSelect,
): DraftRefineSession {
  return {
    id: row.id,
    draft_id: row.draftId,
    project_id: row.projectId,
    repository_id: row.repositoryId,
    adapter_session_ref: row.adapterSessionRef,
    attempt_count: row.attemptCount,
    status: row.status as DraftRefineSessionStatus,
    created_at: row.createdAt,
    last_attempt_at: row.lastAttemptAt,
  };
}

export class DraftRefineSessionRepository
  implements DraftRefineSessionPersistence
{
  constructor(private readonly context: SqliteStoreContext) {}

  create(input: {
    draftId: string;
    projectId: string;
    repositoryId: string;
  }): DraftRefineSession {
    const now = nowIso();
    const id = nanoid();
    this.context.db
      .insert(draftRefineSessionsTable)
      .values({
        id,
        draftId: input.draftId,
        projectId: input.projectId,
        repositoryId: input.repositoryId,
        attemptCount: 0,
        status: "running",
        createdAt: now,
        lastAttemptAt: now,
      })
      .run();

    return {
      id,
      draft_id: input.draftId,
      project_id: input.projectId,
      repository_id: input.repositoryId,
      adapter_session_ref: null,
      attempt_count: 0,
      status: "running",
      created_at: now,
      last_attempt_at: now,
    };
  }

  recordAttempt(
    id: string,
    input: {
      adapterSessionRef: string | null;
      attemptCount: number;
    },
  ): DraftRefineSession | undefined {
    const now = nowIso();
    this.context.db
      .update(draftRefineSessionsTable)
      .set({
        adapterSessionRef: input.adapterSessionRef,
        attemptCount: input.attemptCount,
        lastAttemptAt: now,
      })
      .where(eq(draftRefineSessionsTable.id, id))
      .run();

    const row = this.context.db
      .select()
      .from(draftRefineSessionsTable)
      .where(eq(draftRefineSessionsTable.id, id))
      .get();
    return row ? mapRow(row) : undefined;
  }

  complete(id: string, status: "completed" | "failed"): void {
    this.context.db
      .update(draftRefineSessionsTable)
      .set({ status, lastAttemptAt: nowIso() })
      .where(eq(draftRefineSessionsTable.id, id))
      .run();
  }
}
