import { useQueries } from "@tanstack/react-query";
import { useState } from "react";
import type {
  TicketFrontmatter,
  TicketWorkspacePreview,
} from "../../../../../packages/contracts/src/index.js";

import { fetchJson, type TicketWorkspacePreviewResponse } from "./shared.js";

type StartPreviewMutation = {
  mutateAsync: (ticketId: number) => Promise<TicketWorkspacePreviewResponse>;
};

type StopPreviewMutation = {
  mutate: (
    ticketId: number,
    options?: {
      onError?: (error: Error) => void;
      onSuccess?: () => void;
    },
  ) => void;
};

export function useTicketWorkspacePreview(input: {
  startPreviewMutation: StartPreviewMutation;
  stopPreviewMutation: StopPreviewMutation;
  tickets: TicketFrontmatter[];
}) {
  const [previewActionErrorByTicketId, setPreviewActionErrorByTicketId] =
    useState<Record<number, string>>({});
  const ticketWorkspacePreviewQueries = useQueries({
    queries: input.tickets.map((ticket) => ({
      queryKey: ["tickets", ticket.id, "workspace", "preview"],
      queryFn: () =>
        fetchJson<TicketWorkspacePreviewResponse>(
          `/tickets/${ticket.id}/workspace/preview`,
        ),
      enabled: ticket.session_id !== null,
      retry: false,
    })),
  });

  const ticketWorkspacePreviewByTicketId = new Map<
    number,
    TicketWorkspacePreview
  >(
    ticketWorkspacePreviewQueries.flatMap((query, index) => {
      const ticket = input.tickets[index];
      const preview = query.data?.preview;
      return ticket && preview ? [[ticket.id, preview]] : [];
    }),
  );

  const clearPreviewActionError = (ticketId: number): void => {
    setPreviewActionErrorByTicketId((current) => {
      if (!(ticketId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[ticketId];
      return next;
    });
  };

  const setPreviewActionError = (ticketId: number, message: string): void => {
    setPreviewActionErrorByTicketId((current) => ({
      ...current,
      [ticketId]: message,
    }));
  };

  const handleTicketPreviewAction = (ticket: TicketFrontmatter): void => {
    if (!ticket.session_id) {
      return;
    }

    clearPreviewActionError(ticket.id);
    const preview = ticketWorkspacePreviewByTicketId.get(ticket.id) ?? null;
    if (preview?.state === "ready") {
      input.stopPreviewMutation.mutate(ticket.id, {
        onSuccess: () => {
          clearPreviewActionError(ticket.id);
        },
        onError: (error) => {
          setPreviewActionError(
            ticket.id,
            error instanceof Error ? error.message : "Unable to stop preview",
          );
        },
      });
      return;
    }

    const previewWindow = window.open("", "_blank");
    if (previewWindow) {
      previewWindow.document.title = `Ticket #${ticket.id} preview`;
      previewWindow.document.body.innerHTML =
        '<p style="font-family: sans-serif; padding: 24px;">Starting preview...</p>';
    }

    void (async () => {
      try {
        const response = await input.startPreviewMutation.mutateAsync(
          ticket.id,
        );
        const startedPreview = response.preview;
        if (startedPreview.state !== "ready" || !startedPreview.preview_url) {
          throw new Error(
            startedPreview.error ?? "Preview server did not become ready",
          );
        }

        if (!previewWindow) {
          setPreviewActionError(
            ticket.id,
            "Preview is running, but the browser blocked opening a new tab.",
          );
          return;
        }

        previewWindow.location.replace(startedPreview.preview_url);
      } catch (error) {
        previewWindow?.close();
        setPreviewActionError(
          ticket.id,
          error instanceof Error ? error.message : "Unable to start preview",
        );
      }
    })();
  };

  return {
    handleTicketPreviewAction,
    previewActionErrorByTicketId,
    ticketWorkspacePreviewByTicketId,
  };
}
