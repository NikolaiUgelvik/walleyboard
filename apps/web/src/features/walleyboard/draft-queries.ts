import { useQueries } from "@tanstack/react-query";
import type {
  DraftTicketState,
  Project,
} from "../../../../../packages/contracts/src/index.js";

import { fetchJson } from "./shared-api.js";
import type { DraftEventsResponse, DraftsResponse } from "./shared-types.js";
import { parseDraftEventMeta } from "./shared-utils.js";

export function useGlobalDrafts(projects: Project[]) {
  const globalDraftsQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: ["projects", project.id, "drafts"],
      queryFn: () =>
        fetchJson<DraftsResponse>(`/projects/${project.id}/drafts`),
    })),
  });

  return {
    globalDrafts: globalDraftsQueries.flatMap(
      (query) => query.data?.drafts ?? [],
    ),
    globalDraftsQueries,
  };
}

export function useDraftRefinementActivity(drafts: DraftTicketState[]) {
  const draftEventSummaries = useQueries({
    queries: drafts.map((draft) => ({
      queryKey: ["drafts", draft.id, "events"],
      queryFn: () =>
        fetchJson<DraftEventsResponse>(`/drafts/${draft.id}/events`),
      retry: false,
    })),
  });

  const draftRefinementActiveById = new Map(
    drafts.map((draft, index) => {
      const data = draftEventSummaries[index]?.data;
      const latestEvent = data?.events.at(0);
      const latestEventMeta = latestEvent
        ? parseDraftEventMeta(latestEvent)
        : null;

      return [
        draft.id,
        data?.active_run === true &&
          latestEventMeta?.operation === "refine" &&
          latestEventMeta.status === "started",
      ] as const;
    }),
  );

  return {
    isDraftRefinementActive: (draftId: string): boolean =>
      draftRefinementActiveById.get(draftId) === true,
  };
}
