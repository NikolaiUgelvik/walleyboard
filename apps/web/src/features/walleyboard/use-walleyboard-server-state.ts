import { useQueries, useQuery } from "@tanstack/react-query";
import type {
  HealthResponse,
  RepositoryBranchesResponse,
} from "../../../../../packages/contracts/src/index.js";

import { fetchJson } from "./shared-api.js";
import type {
  DraftEventsResponse,
  DraftsResponse,
  ProjectsResponse,
  RepositoriesResponse,
  SessionLogsResponse,
  SessionResponse,
  TicketsResponse,
} from "./shared-types.js";

export function useWalleyBoardServerState(input: {
  archiveModalOpen: boolean;
  draftEditorProjectId: string | null;
  projectOptionsProjectId: string | null;
  selectedDraftId: string | null;
  selectedProjectId: string | null;
  selectedSessionId: string | null;
}) {
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => fetchJson<HealthResponse>("/health"),
    retry: false,
  });

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => fetchJson<ProjectsResponse>("/projects"),
    retry: false,
  });

  const globalTicketsQueries = useQueries({
    queries: (projectsQuery.data?.projects ?? []).map((project) => ({
      queryKey: ["projects", project.id, "tickets"],
      queryFn: () =>
        fetchJson<TicketsResponse>(`/projects/${project.id}/tickets`),
      refetchInterval: 2_000,
    })),
  });

  const repositoriesQuery = useQuery({
    queryKey: ["projects", input.selectedProjectId, "repositories"],
    queryFn: () =>
      fetchJson<RepositoriesResponse>(
        `/projects/${input.selectedProjectId}/repositories`,
      ),
    enabled: input.selectedProjectId !== null,
  });

  const draftEditorRepositoriesQuery = useQuery({
    queryKey: [
      "projects",
      input.draftEditorProjectId,
      "repositories",
      "draft-editor",
    ],
    queryFn: () =>
      fetchJson<RepositoriesResponse>(
        `/projects/${input.draftEditorProjectId}/repositories`,
      ),
    enabled:
      input.draftEditorProjectId !== null &&
      input.draftEditorProjectId !== input.selectedProjectId,
  });

  const projectOptionsRepositoriesQuery = useQuery({
    queryKey: ["projects", input.projectOptionsProjectId, "repositories"],
    queryFn: () =>
      fetchJson<RepositoriesResponse>(
        `/projects/${input.projectOptionsProjectId}/repositories`,
      ),
    enabled: input.projectOptionsProjectId !== null,
  });

  const projectOptionsBranchesQuery = useQuery({
    queryKey: [
      "projects",
      input.projectOptionsProjectId,
      "repository-branches",
    ],
    queryFn: () =>
      fetchJson<RepositoryBranchesResponse>(
        `/projects/${input.projectOptionsProjectId}/repository-branches`,
      ),
    enabled: input.projectOptionsProjectId !== null,
    retry: false,
  });

  const draftsQuery = useQuery({
    queryKey: ["projects", input.selectedProjectId, "drafts"],
    queryFn: () =>
      fetchJson<DraftsResponse>(`/projects/${input.selectedProjectId}/drafts`),
    enabled: input.selectedProjectId !== null,
    refetchInterval: input.selectedProjectId === null ? false : 2_000,
  });

  const ticketsQuery = useQuery({
    queryKey: ["projects", input.selectedProjectId, "tickets"],
    queryFn: () =>
      fetchJson<TicketsResponse>(
        `/projects/${input.selectedProjectId}/tickets`,
      ),
    enabled: input.selectedProjectId !== null,
    refetchInterval: input.selectedProjectId === null ? false : 2_000,
  });

  const archivedTicketsQuery = useQuery({
    queryKey: ["projects", input.selectedProjectId, "tickets", "archived"],
    queryFn: () =>
      fetchJson<TicketsResponse>(
        `/projects/${input.selectedProjectId}/archived-tickets`,
      ),
    enabled: input.selectedProjectId !== null && input.archiveModalOpen,
    refetchInterval:
      input.selectedProjectId === null || !input.archiveModalOpen
        ? false
        : 2_000,
  });

  const draftEventsQuery = useQuery({
    queryKey: ["drafts", input.selectedDraftId, "events"],
    queryFn: () =>
      fetchJson<DraftEventsResponse>(`/drafts/${input.selectedDraftId}/events`),
    enabled: input.selectedDraftId !== null,
    refetchInterval: input.selectedDraftId === null ? false : 2_000,
    retry: false,
  });

  const sessionSummaries = useQueries({
    queries: (ticketsQuery.data?.tickets ?? [])
      .filter((ticket) => ticket.session_id !== null)
      .map((ticket) => ({
        queryKey: ["sessions", ticket.session_id],
        queryFn: () =>
          fetchJson<SessionResponse>(`/sessions/${ticket.session_id}`),
        enabled: ticket.session_id !== null,
        refetchInterval: 2_000,
      })),
  });

  const sessionQuery = useQuery({
    queryKey: ["sessions", input.selectedSessionId],
    queryFn: () =>
      fetchJson<SessionResponse>(`/sessions/${input.selectedSessionId}`),
    enabled: input.selectedSessionId !== null,
    refetchInterval: input.selectedSessionId === null ? false : 2_000,
  });

  const sessionLogsQuery = useQuery({
    queryKey: ["sessions", input.selectedSessionId, "logs"],
    queryFn: () =>
      fetchJson<SessionLogsResponse>(
        `/sessions/${input.selectedSessionId}/logs`,
      ),
    enabled: input.selectedSessionId !== null,
    refetchInterval: input.selectedSessionId === null ? false : 2_000,
  });

  return {
    archivedTicketsQuery,
    draftEditorRepositoriesQuery,
    draftEventsQuery,
    draftsQuery,
    globalTicketsQueries,
    healthQuery,
    projectOptionsBranchesQuery,
    projectOptionsRepositoriesQuery,
    projectsQuery,
    repositoriesQuery,
    sessionLogsQuery,
    sessionQuery,
    sessionSummaries,
    ticketsQuery,
  };
}
