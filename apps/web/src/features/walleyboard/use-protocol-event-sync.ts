import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef } from "react";
import type {
  DraftTicketState,
  ExecutionSession,
  ProtocolEvent,
  ReviewPackage,
  ReviewRun,
  StructuredEvent,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";
import { connectWalleyboardSocket } from "../../lib/socket-io.js";
import type {
  DraftEventsResponse,
  DraftsResponse,
  InspectorState,
  ReviewPackageResponse,
  ReviewRunResponse,
  ReviewRunsResponse,
  SessionLogsResponse,
  SessionResponse,
  TicketEventsResponse,
  TicketsResponse,
  TicketWorkspaceSummaryResponse,
} from "./shared-types.js";
import { parseDraftEventMeta, upsertById } from "./shared-utils.js";

function isRealtimeBackedQueryKey(queryKey: readonly unknown[]): boolean {
  if (queryKey[0] === "sessions") {
    return (
      queryKey[2] === undefined ||
      queryKey[2] === "logs" ||
      queryKey[2] === "attempts"
    );
  }

  if (queryKey[0] === "drafts" && queryKey[2] === "events") {
    return true;
  }

  if (queryKey[0] === "tickets") {
    return (
      queryKey[2] === "review-package" ||
      queryKey[2] === "review-run" ||
      queryKey[2] === "review-runs" ||
      queryKey[2] === "events" ||
      (queryKey[2] === "workspace" &&
        (queryKey[3] === "diff" ||
          queryKey[3] === "preview" ||
          queryKey[3] === "summary"))
    );
  }

  return (
    queryKey[0] === "projects" &&
    (queryKey[2] === "drafts" || queryKey[2] === "tickets")
  );
}

export function useProtocolEventSync({
  queryClient,
  selectedDraftId,
  selectedProjectId,
  selectedSessionId,
  setInspectorState,
}: {
  queryClient: QueryClient;
  selectedDraftId: string | null;
  selectedProjectId: string | null;
  selectedSessionId: string | null;
  setInspectorState: Dispatch<SetStateAction<InspectorState>>;
}) {
  const handleProtocolEventRef = useRef<(event: ProtocolEvent) => void>(
    () => {},
  );
  const hasConnectedRef = useRef(false);

  handleProtocolEventRef.current = (event: ProtocolEvent) => {
    if (event.event_type === "draft.updated") {
      const draft = event.payload.draft as DraftTicketState | undefined;
      if (!draft) {
        return;
      }

      queryClient.setQueryData<DraftsResponse>(
        ["projects", draft.project_id, "drafts"],
        (previous) => ({
          drafts: upsertById(previous?.drafts ?? [], draft),
        }),
      );
      return;
    }

    if (event.event_type === "draft.ready") {
      const draftId = event.payload.draft_id as string | undefined;
      const projectId = event.payload.project_id as string | undefined;
      if (!draftId) {
        return;
      }

      if (projectId) {
        queryClient.setQueryData<DraftsResponse>(
          ["projects", projectId, "drafts"],
          (previous) => ({
            drafts: (previous?.drafts ?? []).filter(
              (draft) => draft.id !== draftId,
            ),
          }),
        );
      } else if (selectedProjectId !== null) {
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "drafts"],
        });
      }

      queryClient.removeQueries({
        queryKey: ["drafts", draftId, "events"],
      });
      return;
    }

    if (event.event_type === "draft.deleted") {
      const draftId = event.payload.draft_id as string | undefined;
      const projectId = event.payload.project_id as string | undefined;
      if (!draftId || !projectId) {
        return;
      }

      queryClient.setQueryData<DraftsResponse>(
        ["projects", projectId, "drafts"],
        (previous) => ({
          drafts: (previous?.drafts ?? []).filter(
            (draft) => draft.id !== draftId,
          ),
        }),
      );

      if (selectedDraftId === draftId) {
        setInspectorState({ kind: "hidden" });
      }
      return;
    }

    if (event.event_type === "ticket.updated") {
      const ticket = event.payload.ticket as TicketFrontmatter | undefined;
      if (!ticket) {
        return;
      }

      queryClient.setQueryData<TicketsResponse>(
        ["projects", ticket.project, "tickets"],
        (previous) => ({
          tickets: upsertById(previous?.tickets ?? [], ticket),
        }),
      );
      queryClient.setQueryData<TicketsResponse>(
        ["projects", ticket.project, "tickets", "archived"],
        (previous) => ({
          tickets: (previous?.tickets ?? []).filter(
            (archivedTicket) => archivedTicket.id !== ticket.id,
          ),
        }),
      );
      if (ticket.session_id) {
        queryClient.invalidateQueries({
          queryKey: ["sessions", ticket.session_id],
        });
      }
      queryClient.invalidateQueries({
        queryKey: ["tickets", ticket.id, "events"],
      });
      return;
    }

    if (event.event_type === "ticket.workspace.updated") {
      const ticketId = event.payload.ticket_id as number | undefined;
      const kind = event.payload.kind as
        | "diff"
        | "preview"
        | "summary"
        | undefined;
      if (ticketId === undefined) {
        return;
      }

      if (!kind || kind === "diff") {
        queryClient.invalidateQueries({
          queryKey: ["tickets", ticketId, "workspace", "diff"],
        });
      }

      if (!kind || kind === "preview") {
        queryClient.invalidateQueries({
          queryKey: ["tickets", ticketId, "workspace", "preview"],
        });
      }

      if (!kind || kind === "summary") {
        const summary = event.payload.summary;
        if (summary) {
          queryClient.setQueryData<TicketWorkspaceSummaryResponse>(
            ["tickets", ticketId, "workspace", "summary"],
            {
              workspace_summary:
                summary as TicketWorkspaceSummaryResponse["workspace_summary"],
            },
          );
        } else {
          queryClient.invalidateQueries({
            queryKey: ["tickets", ticketId, "workspace", "summary"],
          });
        }
      }
      return;
    }

    if (event.event_type === "ticket.deleted") {
      const ticketId = event.payload.ticket_id as number | undefined;
      const projectId = event.payload.project_id as string | undefined;
      const deletedSessionId = event.payload.session_id as string | undefined;

      if (ticketId === undefined || !projectId) {
        return;
      }

      queryClient.setQueryData<TicketsResponse>(
        ["projects", projectId, "tickets"],
        (previous) => ({
          tickets: (previous?.tickets ?? []).filter(
            (ticket) => ticket.id !== ticketId,
          ),
        }),
      );
      queryClient.setQueryData<TicketsResponse>(
        ["projects", projectId, "tickets", "archived"],
        (previous) => ({
          tickets: (previous?.tickets ?? []).filter(
            (ticket) => ticket.id !== ticketId,
          ),
        }),
      );

      if (deletedSessionId) {
        queryClient.removeQueries({
          queryKey: ["sessions", deletedSessionId],
        });
        queryClient.removeQueries({
          queryKey: ["sessions", deletedSessionId, "logs"],
        });
        if (selectedSessionId === deletedSessionId) {
          setInspectorState({ kind: "hidden" });
        }
      }
      queryClient.removeQueries({
        queryKey: ["tickets", ticketId, "workspace", "diff"],
      });
      queryClient.removeQueries({
        queryKey: ["tickets", ticketId, "workspace", "preview"],
      });
      queryClient.removeQueries({
        queryKey: ["tickets", ticketId, "workspace", "summary"],
      });
      return;
    }

    if (event.event_type === "ticket.archived") {
      const ticketId = event.payload.ticket_id as number | undefined;
      const projectId = event.payload.project_id as string | undefined;
      const archivedSessionId = event.payload.session_id as string | undefined;

      if (ticketId === undefined || !projectId) {
        return;
      }

      queryClient.setQueryData<TicketsResponse>(
        ["projects", projectId, "tickets"],
        (previous) => ({
          tickets: (previous?.tickets ?? []).filter(
            (ticket) => ticket.id !== ticketId,
          ),
        }),
      );
      queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "tickets", "archived"],
      });

      if (archivedSessionId && selectedSessionId === archivedSessionId) {
        setInspectorState({ kind: "hidden" });
      }
      queryClient.invalidateQueries({
        queryKey: ["tickets", ticketId, "events"],
      });
      return;
    }

    if (event.event_type === "session.updated") {
      const session = event.payload.session as ExecutionSession | undefined;
      const agentControlsWorktree = event.payload.agent_controls_worktree as
        | boolean
        | undefined;
      if (!session) {
        return;
      }

      queryClient.setQueryData<SessionResponse>(["sessions", session.id], {
        session,
        agent_controls_worktree: agentControlsWorktree ?? false,
      });
      queryClient.invalidateQueries({
        queryKey: ["sessions", session.id, "attempts"],
      });
      return;
    }

    if (event.event_type === "session.output") {
      const sessionId = event.payload.session_id as string | undefined;
      const sequence = event.payload.sequence as number | undefined;
      const chunk = event.payload.chunk as string | undefined;

      if (!sessionId || sequence === undefined || chunk === undefined) {
        return;
      }

      queryClient.setQueryData<SessionLogsResponse>(
        ["sessions", sessionId, "logs"],
        (previous) => {
          const logs = previous?.logs ?? [];
          if (logs.length === sequence) {
            return {
              session_id: sessionId,
              logs: [...logs, chunk],
            };
          }

          if (logs.length <= sequence) {
            return {
              session_id: sessionId,
              logs,
            };
          }

          const nextLogs = [...logs];
          nextLogs[sequence] = chunk;
          return {
            session_id: sessionId,
            logs: nextLogs,
          };
        },
      );
      return;
    }

    if (event.event_type === "structured_event.created") {
      const structuredEvent = event.payload.structured_event as
        | StructuredEvent
        | undefined;
      if (!structuredEvent) {
        return;
      }

      if (structuredEvent.entity_type === "ticket") {
        const ticketId = Number.parseInt(structuredEvent.entity_id, 10);
        if (Number.isNaN(ticketId)) {
          return;
        }

        queryClient.setQueryData<TicketEventsResponse>(
          ["tickets", ticketId, "events"],
          (previous) => ({
            events: [
              structuredEvent,
              ...(previous?.events ?? []).filter(
                (item) => item.id !== structuredEvent.id,
              ),
            ],
          }),
        );
        return;
      }

      if (structuredEvent.entity_type !== "draft") {
        return;
      }

      queryClient.setQueryData<DraftEventsResponse>(
        ["drafts", structuredEvent.entity_id, "events"],
        (previous) => ({
          active_run: (() => {
            const meta = parseDraftEventMeta(structuredEvent);
            if (!meta) {
              return previous?.active_run ?? false;
            }

            return meta.status === "started";
          })(),
          events: [
            structuredEvent,
            ...(previous?.events ?? []).filter(
              (item) => item.id !== structuredEvent.id,
            ),
          ],
        }),
      );
      return;
    }

    if (event.event_type === "review_package.generated") {
      const reviewPackage = event.payload.review_package as
        | ReviewPackage
        | undefined;
      if (!reviewPackage) {
        return;
      }

      queryClient.setQueryData<ReviewPackageResponse>(
        ["tickets", reviewPackage.ticket_id, "review-package"],
        {
          review_package: reviewPackage,
        },
      );
      queryClient.invalidateQueries({
        queryKey: ["tickets", reviewPackage.ticket_id, "review-runs"],
      });
      return;
    }

    if (event.event_type === "review_run.updated") {
      const reviewRun = event.payload.review_run as ReviewRun | undefined;
      if (!reviewRun) {
        return;
      }

      queryClient.setQueryData<ReviewRunResponse>(
        ["tickets", reviewRun.ticket_id, "review-run"],
        {
          review_run: reviewRun,
        },
      );
      queryClient.setQueryData<ReviewRunsResponse>(
        ["tickets", reviewRun.ticket_id, "review-runs"],
        (previous) =>
          previous
            ? {
                review_runs: upsertById(previous.review_runs, reviewRun).sort(
                  (left, right) =>
                    left.created_at.localeCompare(right.created_at) ||
                    left.id.localeCompare(right.id),
                ),
              }
            : previous,
      );
      queryClient.invalidateQueries({
        queryKey: ["tickets", reviewRun.ticket_id, "review-runs"],
      });
    }
  };

  useEffect(() => {
    const socket = connectWalleyboardSocket("/events");

    socket.on("connect", () => {
      if (!hasConnectedRef.current) {
        hasConnectedRef.current = true;
        return;
      }

      void queryClient.invalidateQueries({
        predicate: (query) => isRealtimeBackedQueryKey(query.queryKey),
      });
    });
    socket.on("protocol.event", (event) => {
      handleProtocolEventRef.current(event);
    });

    return () => {
      socket.disconnect();
    };
  }, [queryClient]);
}
