import type { DraftTicketState } from "../../../../packages/contracts/src/index.js";

export type DraftEditorFields = {
  sourceId: string | null;
  title: string;
  description: string;
  ticketType: DraftTicketState["proposed_ticket_type"];
  acceptanceCriteria: string;
};

export type PendingDraftEditorSync = {
  draftId: string;
  sourceUpdatedAt: string | null;
  title: string;
  description: string;
  ticketType: DraftTicketState["proposed_ticket_type"];
  acceptanceCriteria: string;
};

export type DraftEditorSyncResult = {
  nextEditor: DraftEditorFields | undefined;
  nextPendingSync: PendingDraftEditorSync | null | undefined;
};

export const emptyDraftEditorFields: DraftEditorFields = {
  sourceId: null,
  title: "",
  description: "",
  ticketType: "feature",
  acceptanceCriteria: "",
};

export function buildPendingDraftEditorSync(input: {
  acceptanceCriteria: string;
  description: string;
  draftId: string;
  sourceUpdatedAt: string | null;
  ticketType: DraftTicketState["proposed_ticket_type"];
  title: string;
}): PendingDraftEditorSync {
  return {
    draftId: input.draftId,
    sourceUpdatedAt: input.sourceUpdatedAt,
    title: input.title,
    description: input.description,
    ticketType: input.ticketType,
    acceptanceCriteria: input.acceptanceCriteria,
  };
}

export function resolveDraftEditorSync(input: {
  draftFormDirty: boolean;
  editor: DraftEditorFields;
  pendingSync: PendingDraftEditorSync | null;
  selectedDraft: DraftTicketState | null;
}): DraftEditorSyncResult {
  const { draftFormDirty, editor, pendingSync, selectedDraft } = input;

  if (!selectedDraft) {
    return {
      nextEditor: emptyDraftEditorFields,
      nextPendingSync: null,
    };
  }

  const pendingSyncTargetsSelectedDraft =
    pendingSync?.draftId === selectedDraft.id;
  const pendingSyncMatchesCurrentEditor =
    pendingSyncTargetsSelectedDraft &&
    pendingSync.title === editor.title &&
    pendingSync.description === editor.description &&
    pendingSync.ticketType === editor.ticketType &&
    pendingSync.acceptanceCriteria === editor.acceptanceCriteria;

  if (pendingSyncTargetsSelectedDraft && !pendingSyncMatchesCurrentEditor) {
    return {
      nextEditor: undefined,
      nextPendingSync: null,
    };
  }

  if (
    pendingSyncTargetsSelectedDraft &&
    pendingSyncMatchesCurrentEditor &&
    pendingSync.sourceUpdatedAt === null
  ) {
    return {
      nextEditor: undefined,
      nextPendingSync: {
        ...pendingSync,
        sourceUpdatedAt: selectedDraft.updated_at,
      },
    };
  }

  const shouldApplyPendingDraftSync =
    pendingSyncMatchesCurrentEditor &&
    pendingSync.sourceUpdatedAt !== null &&
    pendingSync.sourceUpdatedAt !== selectedDraft.updated_at;

  if (
    editor.sourceId !== selectedDraft.id ||
    (pendingSync === null && !draftFormDirty) ||
    shouldApplyPendingDraftSync
  ) {
    return {
      nextEditor: {
        sourceId: selectedDraft.id,
        title: selectedDraft.title_draft,
        description: selectedDraft.description_draft,
        ticketType: selectedDraft.proposed_ticket_type,
        acceptanceCriteria:
          selectedDraft.proposed_acceptance_criteria.join("\n"),
      },
      nextPendingSync:
        pendingSync !== null &&
        (!pendingSyncTargetsSelectedDraft || shouldApplyPendingDraftSync)
          ? null
          : undefined,
    };
  }

  return {
    nextEditor: undefined,
    nextPendingSync: undefined,
  };
}
