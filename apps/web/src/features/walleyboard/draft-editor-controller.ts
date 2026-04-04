import type { QueryClient } from "@tanstack/react-query";
import type { ClipboardEvent } from "react";
import type { DraftTicketState } from "../../../../../packages/contracts/src/index.js";

import {
  buildPendingDraftEditorSync,
  emptyDraftEditorFields,
} from "../../lib/draft-editor-sync.js";
import { blobToBase64, buildMarkdownImageInsertion } from "./shared-api.js";
import type {
  DraftArtifactUploadResponse,
  DraftsResponse,
  NewDraftAction,
} from "./shared-types.js";

type CreateDraftMutationLike = {
  mutateAsync(input: {
    projectId: string;
    artifactScopeId: string | null;
    title: string;
    description: string;
    proposedTicketType: DraftTicketState["proposed_ticket_type"];
    proposedAcceptanceCriteria: string[];
  }): Promise<{
    resource_refs?: { draft_id?: string | undefined } | undefined;
  }>;
};

type UploadDraftArtifactMutationLike = {
  mutateAsync(input: {
    projectId: string;
    artifactScopeId: string | null;
    mimeType: string;
    dataBase64: string;
  }): Promise<DraftArtifactUploadResponse>;
};

export function createDraftEditorController(input: {
  createDraftMutation: CreateDraftMutationLike;
  draftEditorAcceptanceCriteria: string;
  draftEditorAcceptanceCriteriaLines: string[];
  draftEditorArtifactScopeId: string | null;
  draftEditorDescription: string;
  draftEditorProjectId: string | null;
  draftEditorTicketType: DraftTicketState["proposed_ticket_type"];
  draftEditorTitle: string;
  queryClient: QueryClient;
  setDraftEditorAcceptanceCriteria: (value: string) => void;
  setDraftEditorArtifactScopeId: (value: string | null) => void;
  setDraftEditorDescription: (value: string) => void;
  setDraftEditorProjectId: (value: string | null) => void;
  setDraftEditorSourceId: (value: string | null) => void;
  setDraftEditorTicketType: (
    value: DraftTicketState["proposed_ticket_type"],
  ) => void;
  setDraftEditorTitle: (value: string) => void;
  setDraftEditorUploadError: (value: string | null) => void;
  setPendingDraftEditorSync: (
    value: ReturnType<typeof buildPendingDraftEditorSync> | null,
  ) => void;
  setPendingNewDraftAction: (value: NewDraftAction | null) => void;
  uploadDraftArtifactMutation: UploadDraftArtifactMutationLike;
}) {
  const initializeNewDraftEditor = (projectId: string | null): void => {
    input.setDraftEditorProjectId(projectId);
    input.setDraftEditorSourceId(emptyDraftEditorFields.sourceId);
    input.setDraftEditorArtifactScopeId(null);
    input.setDraftEditorTitle(emptyDraftEditorFields.title);
    input.setDraftEditorDescription(emptyDraftEditorFields.description);
    input.setDraftEditorTicketType(emptyDraftEditorFields.ticketType);
    input.setDraftEditorAcceptanceCriteria(
      emptyDraftEditorFields.acceptanceCriteria,
    );
    input.setDraftEditorUploadError(null);
    input.setPendingDraftEditorSync(null);
    input.setPendingNewDraftAction(null);
  };

  const persistNewDraftFromEditor = async (
    action: NewDraftAction,
  ): Promise<string | null> => {
    if (!input.draftEditorProjectId) {
      return null;
    }

    input.setPendingNewDraftAction(action);

    try {
      const ack = await input.createDraftMutation.mutateAsync({
        projectId: input.draftEditorProjectId,
        artifactScopeId: input.draftEditorArtifactScopeId,
        title: input.draftEditorTitle,
        description: input.draftEditorDescription,
        proposedTicketType: input.draftEditorTicketType,
        proposedAcceptanceCriteria: input.draftEditorAcceptanceCriteriaLines,
      });

      const draftId = ack.resource_refs?.draft_id ?? null;
      if (action === "refine" && draftId) {
        const createdDraft = input.queryClient
          .getQueryData<DraftsResponse>([
            "projects",
            input.draftEditorProjectId,
            "drafts",
          ])
          ?.drafts.find((draft) => draft.id === draftId);
        input.setPendingDraftEditorSync(
          buildPendingDraftEditorSync({
            acceptanceCriteria: input.draftEditorAcceptanceCriteria,
            description: input.draftEditorDescription,
            draftId,
            sourceUpdatedAt: createdDraft?.updated_at ?? null,
            ticketType: input.draftEditorTicketType,
            title: input.draftEditorTitle,
          }),
        );
      }

      return draftId;
    } catch {
      return null;
    } finally {
      input.setPendingNewDraftAction(null);
    }
  };

  const handleDraftDescriptionPaste = async (
    file: File,
    selection: { start: number; end: number },
  ): Promise<{ cursorOffset: number; value: string } | null> => {
    if (!input.draftEditorProjectId) {
      return null;
    }
    input.setDraftEditorUploadError(null);

    try {
      const response = await input.uploadDraftArtifactMutation.mutateAsync({
        projectId: input.draftEditorProjectId,
        artifactScopeId: input.draftEditorArtifactScopeId,
        mimeType: file.type,
        dataBase64: await blobToBase64(file),
      });
      const insertion = buildMarkdownImageInsertion(
        input.draftEditorDescription,
        response.markdown_image,
        selection.start,
        selection.end,
      );

      input.setDraftEditorArtifactScopeId(response.artifact_scope_id);
      return insertion;
    } catch (error) {
      input.setDraftEditorUploadError(
        error instanceof Error ? error.message : "Unable to paste screenshot",
      );
      return null;
    }
  };

  const handleDraftDescriptionTextareaPaste = (
    event: ClipboardEvent<HTMLTextAreaElement>,
  ): void => {
    const imageItem = Array.from(event.clipboardData.items).find((item) =>
      item.type.startsWith("image/"),
    );
    if (!imageItem) {
      return;
    }

    const file = imageItem.getAsFile();
    if (!file) {
      return;
    }

    event.preventDefault();
    const target = event.currentTarget;
    void (async () => {
      const result = await handleDraftDescriptionPaste(file, {
        start: target.selectionStart,
        end: target.selectionEnd,
      });
      if (!result) {
        return;
      }

      input.setDraftEditorDescription(result.value);
      window.requestAnimationFrame(() => {
        target.selectionStart = result.cursorOffset;
        target.selectionEnd = result.cursorOffset;
        target.focus();
      });
    })();
  };

  return {
    handleDraftDescriptionTextareaPaste,
    initializeNewDraftEditor,
    persistNewDraftFromEditor,
  };
}
