import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type SetStateAction, useState } from "react";
import type {
  RepositoryConfig,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import {
  fetchJson,
  postJson,
  type RepositoryWorkspacePreview,
  type RepositoryWorkspacePreviewResponse,
  type WorkspaceModalKind,
  type WorkspaceTerminalContext,
} from "./shared.js";

export function buildProjectTerminalContext(input: {
  projectId: string;
  repositories: RepositoryConfig[];
}): WorkspaceTerminalContext {
  return {
    kind: "repository_tabs",
    repositories: input.repositories.map((repository) => ({
      id: repository.id,
      label: repository.name,
      socketPath: `/projects/${input.projectId}/repositories/${repository.id}/workspace/terminal`,
      worktreePath: null,
    })),
    surfaceLabel: "repository",
  };
}

export function useSelectedRepositoryWorkspace(input: {
  repositories: RepositoryConfig[];
  selectedProjectId: string | null;
  selectedRepository: RepositoryConfig | null;
  setWorkspaceModal: Dispatch<SetStateAction<WorkspaceModalKind | null>>;
  setWorkspaceTerminalContext: Dispatch<
    SetStateAction<WorkspaceTerminalContext | null>
  >;
  setWorkspaceTicket: Dispatch<SetStateAction<TicketFrontmatter | null>>;
}) {
  const queryClient = useQueryClient();
  const [repositoryPreviewActionError, setRepositoryPreviewActionError] =
    useState<string | null>(null);
  const [repositoryPreviewActionPending, setRepositoryPreviewActionPending] =
    useState(false);
  const [repositoryTerminalPending, setRepositoryTerminalPending] =
    useState(false);
  const repositoryWorkspacePreviewQuery = useQuery({
    queryKey: [
      "projects",
      input.selectedProjectId,
      "repositories",
      input.selectedRepository?.id ?? null,
      "workspace",
      "preview",
    ],
    queryFn: () =>
      fetchJson<RepositoryWorkspacePreviewResponse>(
        `/projects/${input.selectedProjectId}/repositories/${input.selectedRepository?.id}/workspace/preview`,
      ),
    enabled:
      input.selectedProjectId !== null && input.selectedRepository !== null,
    refetchInterval:
      input.selectedProjectId !== null && input.selectedRepository !== null
        ? 2_000
        : false,
    retry: false,
  });
  const repositoryWorkspacePreview =
    repositoryWorkspacePreviewQuery.data?.preview ?? null;

  const setRepositoryWorkspacePreview = (
    preview: RepositoryWorkspacePreview,
  ): void => {
    if (input.selectedProjectId === null || input.selectedRepository === null) {
      return;
    }

    queryClient.setQueryData<RepositoryWorkspacePreviewResponse>(
      [
        "projects",
        input.selectedProjectId,
        "repositories",
        input.selectedRepository.id,
        "workspace",
        "preview",
      ],
      { preview },
    );
  };

  const handleSelectedRepositoryPreviewAction = (): void => {
    if (input.selectedProjectId === null || input.selectedRepository === null) {
      return;
    }
    const repository = input.selectedRepository;

    setRepositoryPreviewActionError(null);
    setRepositoryPreviewActionPending(true);

    if (repositoryWorkspacePreview?.state === "ready") {
      void (async () => {
        try {
          const response = await postJson<RepositoryWorkspacePreviewResponse>(
            `/projects/${input.selectedProjectId}/repositories/${repository.id}/workspace/preview/stop`,
            {},
          );
          setRepositoryWorkspacePreview(response.preview);
        } catch (error) {
          setRepositoryPreviewActionError(
            error instanceof Error ? error.message : "Unable to stop preview",
          );
        } finally {
          setRepositoryPreviewActionPending(false);
        }
      })();
      return;
    }

    const previewWindow = window.open("", "_blank");
    if (previewWindow) {
      previewWindow.document.title = `${repository.name} preview`;
      previewWindow.document.body.innerHTML =
        '<p style="font-family: sans-serif; padding: 24px;">Starting preview...</p>';
    }

    void (async () => {
      try {
        const response = await postJson<RepositoryWorkspacePreviewResponse>(
          `/projects/${input.selectedProjectId}/repositories/${repository.id}/workspace/preview`,
          {},
        );
        setRepositoryWorkspacePreview(response.preview);
        if (
          response.preview.state !== "ready" ||
          !response.preview.preview_url
        ) {
          throw new Error(
            response.preview.error ?? "Preview server did not become ready",
          );
        }

        if (!previewWindow) {
          setRepositoryPreviewActionError(
            "Preview is running, but the browser blocked opening a new tab.",
          );
          return;
        }

        previewWindow.location.replace(response.preview.preview_url);
      } catch (error) {
        previewWindow?.close();
        setRepositoryPreviewActionError(
          error instanceof Error ? error.message : "Unable to start preview",
        );
      } finally {
        setRepositoryPreviewActionPending(false);
      }
    })();
  };

  const openSelectedRepositoryWorkspaceTerminal = (): void => {
    if (
      input.selectedProjectId === null ||
      input.selectedRepository === null ||
      input.repositories.length === 0
    ) {
      return;
    }

    setRepositoryTerminalPending(true);
    input.setWorkspaceTicket(null);
    input.setWorkspaceTerminalContext(
      buildProjectTerminalContext({
        projectId: input.selectedProjectId,
        repositories: input.repositories,
      }),
    );
    input.setWorkspaceModal("terminal");
    setRepositoryTerminalPending(false);
  };

  return {
    handleSelectedRepositoryPreviewAction,
    openSelectedRepositoryWorkspaceTerminal,
    repositoryPreviewActionError,
    repositoryPreviewActionPending,
    repositoryTerminalPending,
    repositoryWorkspacePreview,
    repositoryWorkspacePreviewQuery,
  };
}
