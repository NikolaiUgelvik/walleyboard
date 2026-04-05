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
  projectModalOpen: boolean;
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
    enabled: input.projectModalOpen && input.projectOptionsProjectId !== null,
    retry: false,
  });

  const draftsQuery = useQuery({
    queryKey: ["projects", input.selectedProjectId, "drafts"],
    queryFn: () =>
      fetchJson<DraftsResponse>(`/projects/${input.selectedProjectId}/drafts`),
    enabled: input.selectedProjectId !== null,
  });

  const ticketsQuery = useQuery({
    queryKey: ["projects", input.selectedProjectId, "tickets"],
    queryFn: () =>
      fetchJson<TicketsResponse>(
        `/projects/${input.selectedProjectId}/tickets`,
      ),
    enabled: input.selectedProjectId !== null,
  });

  const archivedTicketsQuery = useQuery({
    queryKey: ["projects", input.selectedProjectId, "tickets", "archived"],
    queryFn: () =>
      fetchJson<TicketsResponse>(
        `/projects/${input.selectedProjectId}/archived-tickets`,
      ),
    enabled: input.selectedProjectId !== null && input.archiveModalOpen,
  });

  const draftEventsQuery = useQuery({
    queryKey: ["drafts", input.selectedDraftId, "events"],
    queryFn: () =>
      fetchJson<DraftEventsResponse>(`/drafts/${input.selectedDraftId}/events`),
    enabled: input.selectedDraftId !== null,
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
      })),
  });

  const sessionQuery = useQuery({
    queryKey: ["sessions", input.selectedSessionId],
    queryFn: () =>
      fetchJson<SessionResponse>(`/sessions/${input.selectedSessionId}`),
    enabled: input.selectedSessionId !== null,
  });

  const sessionLogsQuery = useQuery({
    queryKey: ["sessions", input.selectedSessionId, "logs"],
    queryFn: () =>
      fetchJson<SessionLogsResponse>(
        `/sessions/${input.selectedSessionId}/logs`,
      ),
    enabled: input.selectedSessionId !== null,
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
