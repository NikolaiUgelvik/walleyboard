import type { QueryClient } from "@tanstack/react-query";
import type { DraftTicketState } from "../../../../../packages/contracts/src/index.js";
import { sanitizeDraftAcceptanceCriteria } from "../../lib/draft-acceptance-criteria.js";
import {
  buildPendingDraftEditorSync,
  emptyDraftEditorFields,
} from "../../lib/draft-editor-sync.js";
import { blobToBase64 } from "./shared-api.js";
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
  let draftEditorArtifactScopeId = input.draftEditorArtifactScopeId;

  const initializeNewDraftEditor = (projectId: string | null): void => {
    input.setDraftEditorProjectId(projectId);
    input.setDraftEditorSourceId(emptyDraftEditorFields.sourceId);
    draftEditorArtifactScopeId = null;
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
    const acceptanceCriteriaLines = sanitizeDraftAcceptanceCriteria(
      input.draftEditorAcceptanceCriteria,
    );

    try {
      const ack = await input.createDraftMutation.mutateAsync({
        projectId: input.draftEditorProjectId,
        artifactScopeId: draftEditorArtifactScopeId,
        title: input.draftEditorTitle,
        description: input.draftEditorDescription,
        proposedTicketType: input.draftEditorTicketType,
        proposedAcceptanceCriteria: acceptanceCriteriaLines,
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

      if (action === "save" || !draftId) {
        input.setPendingNewDraftAction(null);
      }

      return draftId;
    } catch {
      input.setPendingNewDraftAction(null);
      return null;
    }
  };

  const uploadDraftEditorImage = async (file: File): Promise<string> => {
    if (!input.draftEditorProjectId) {
      throw new Error("Choose a project before uploading images.");
    }
    input.setDraftEditorUploadError(null);

    try {
      const response = await input.uploadDraftArtifactMutation.mutateAsync({
        projectId: input.draftEditorProjectId,
        artifactScopeId: draftEditorArtifactScopeId,
        mimeType: file.type,
        dataBase64: await blobToBase64(file),
      });

      draftEditorArtifactScopeId = response.artifact_scope_id;
      input.setDraftEditorArtifactScopeId(response.artifact_scope_id);
      return response.markdown_image;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to paste screenshot";
      input.setDraftEditorUploadError(message);
      throw new Error(message);
    }
  };

  return {
    initializeNewDraftEditor,
    persistNewDraftFromEditor,
    uploadDraftEditorImage,
  };
}
