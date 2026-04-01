import {
  Badge,
  Button,
  Code,
  Container,
  Group,
  List,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title
} from "@mantine/core";
import {
  type CommandAck,
  type DraftTicketState,
  type ExecutionSession,
  type Project,
  type RepositoryConfig,
  type TicketFrontmatter
} from "@orchestrator/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { SectionCard } from "./components/SectionCard.js";

const apiBaseUrl = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4000";
const boardColumns = [
  "draft",
  "ready",
  "in_progress",
  "review",
  "done"
] satisfies TicketFrontmatter["status"][];

type HealthResponse = {
  ok: true;
  service: "backend";
  timestamp: string;
};

type ProjectsResponse = {
  projects: Project[];
};

type RepositoriesResponse = {
  repositories: RepositoryConfig[];
};

type DraftsResponse = {
  drafts: DraftTicketState[];
};

type TicketsResponse = {
  tickets: TicketFrontmatter[];
};

type SessionResponse = {
  session: ExecutionSession;
};

type SessionLogsResponse = {
  session_id: string;
  logs: string[];
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function deriveRepositoryName(path: string, fallback: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? (slugify(fallback) || "repo");
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`);

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;

    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) {
        message = body.error;
      }
    } catch {
      // Keep the default message when the response is not JSON.
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;

    try {
      const payload = (await response.json()) as { error?: string; message?: string };
      message = payload.error ?? payload.message ?? message;
    } catch {
      // Keep the default message when the response is not JSON.
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

function humanizeTicketStatus(status: TicketFrontmatter["status"]): string {
  switch (status) {
    case "in_progress":
      return "In Progress";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

export function App() {
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionInput, setSessionInput] = useState("");

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => fetchJson<HealthResponse>("/health"),
    retry: false
  });

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => fetchJson<ProjectsResponse>("/projects"),
    retry: false
  });

  const repositoriesQuery = useQuery({
    queryKey: ["projects", selectedProjectId, "repositories"],
    queryFn: () =>
      fetchJson<RepositoriesResponse>(`/projects/${selectedProjectId}/repositories`),
    enabled: selectedProjectId !== null
  });

  const draftsQuery = useQuery({
    queryKey: ["projects", selectedProjectId, "drafts"],
    queryFn: () => fetchJson<DraftsResponse>(`/projects/${selectedProjectId}/drafts`),
    enabled: selectedProjectId !== null
  });

  const ticketsQuery = useQuery({
    queryKey: ["projects", selectedProjectId, "tickets"],
    queryFn: () => fetchJson<TicketsResponse>(`/projects/${selectedProjectId}/tickets`),
    enabled: selectedProjectId !== null
  });

  const inferredSessionId =
    ticketsQuery.data?.tickets.find((ticket) => ticket.session_id)?.session_id ?? null;

  useEffect(() => {
    const firstProjectId = projectsQuery.data?.projects[0]?.id ?? null;
    if (selectedProjectId === null) {
      setSelectedProjectId(firstProjectId);
      return;
    }

    const stillExists = projectsQuery.data?.projects.some(
      (project) => project.id === selectedProjectId
    );
    if (!stillExists) {
      setSelectedProjectId(firstProjectId);
    }
  }, [projectsQuery.data?.projects, selectedProjectId]);

  useEffect(() => {
    if (selectedSessionId === null) {
      setSelectedSessionId(inferredSessionId);
      return;
    }

    const stillExists =
      ticketsQuery.data?.tickets.some((ticket) => ticket.session_id === selectedSessionId) ??
      false;
    if (!stillExists) {
      setSelectedSessionId(inferredSessionId);
    }
  }, [inferredSessionId, selectedSessionId, ticketsQuery.data?.tickets]);

  const sessionQuery = useQuery({
    queryKey: ["sessions", selectedSessionId],
    queryFn: () => fetchJson<SessionResponse>(`/sessions/${selectedSessionId}`),
    enabled: selectedSessionId !== null
  });

  const sessionLogsQuery = useQuery({
    queryKey: ["sessions", selectedSessionId, "logs"],
    queryFn: () => fetchJson<SessionLogsResponse>(`/sessions/${selectedSessionId}/logs`),
    enabled: selectedSessionId !== null
  });

  const createProjectMutation = useMutation({
    mutationFn: (input: {
      name: string;
      repositoryPath: string;
      defaultTargetBranch: string;
    }) =>
      postJson<CommandAck>("/projects", {
        name: input.name,
        slug: slugify(input.name),
        default_target_branch: input.defaultTargetBranch,
        repository: {
          name: deriveRepositoryName(input.repositoryPath, input.name),
          path: input.repositoryPath,
          target_branch: input.defaultTargetBranch
        }
      }),
    onSuccess: async (ack) => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      const nextProjectId = ack.resource_refs.project_id ?? null;
      setSelectedProjectId(nextProjectId);
      setProjectName("");
      setRepositoryPath("");
      setDefaultBranch("main");
    }
  });

  const createDraftMutation = useMutation({
    mutationFn: (input: { projectId: string; title: string; description: string }) =>
      postJson<CommandAck>("/drafts", {
        project_id: input.projectId,
        title: input.title,
        description: input.description
      }),
    onSuccess: async () => {
      if (selectedProjectId) {
        await queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "drafts"]
        });
      }
      setDraftTitle("");
      setDraftDescription("");
    }
  });

  const refineDraftMutation = useMutation({
    mutationFn: (draftId: string) => postJson<CommandAck>(`/drafts/${draftId}/refine`, {}),
    onSuccess: async () => {
      if (selectedProjectId) {
        await queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "drafts"]
        });
      }
    }
  });

  const confirmDraftMutation = useMutation({
    mutationFn: (input: {
      draft: DraftTicketState;
      repository: RepositoryConfig;
      project: Project;
    }) =>
      postJson<CommandAck>(`/drafts/${input.draft.id}/confirm`, {
        title: input.draft.title_draft,
        description: input.draft.description_draft,
        repo_id: input.repository.id,
        ticket_type: input.draft.proposed_ticket_type ?? "feature",
        acceptance_criteria:
          input.draft.proposed_acceptance_criteria.length > 0
            ? input.draft.proposed_acceptance_criteria
            : [`Implement ${input.draft.title_draft}.`],
        target_branch:
          input.repository.target_branch ??
          input.project.default_target_branch ??
          "main"
      }),
    onSuccess: async () => {
      if (!selectedProjectId) {
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "drafts"]
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"]
        })
      ]);
    }
  });

  const startTicketMutation = useMutation({
    mutationFn: (ticketId: number) =>
      postJson<CommandAck>(`/tickets/${ticketId}/start`, {
        planning_enabled: false
      }),
    onSuccess: async (ack) => {
      if (!selectedProjectId) {
        return;
      }

      setSelectedSessionId(ack.resource_refs.session_id ?? null);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"]
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "drafts"]
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", ack.resource_refs.session_id]
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", ack.resource_refs.session_id, "logs"]
        })
      ]);
    }
  });

  const sessionInputMutation = useMutation({
    mutationFn: (input: { sessionId: string; body: string }) =>
      postJson<CommandAck>(`/sessions/${input.sessionId}/input`, {
        body: input.body
      }),
    onSuccess: async (_, variables) => {
      setSessionInput("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["sessions", variables.sessionId]
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", variables.sessionId, "logs"]
        })
      ]);
    }
  });

  const selectedProject =
    projectsQuery.data?.projects.find((project) => project.id === selectedProjectId) ?? null;
  const repositories = repositoriesQuery.data?.repositories ?? [];
  const drafts = draftsQuery.data?.drafts ?? [];
  const tickets = ticketsQuery.data?.tickets ?? [];
  const session = sessionQuery.data?.session ?? null;
  const sessionLogs = sessionLogsQuery.data?.logs ?? [];
  const selectedSessionTicket =
    tickets.find((ticket) => ticket.session_id === selectedSessionId) ?? null;

  const groupedTickets = {
    draft: [] as TicketFrontmatter[],
    ready: [] as TicketFrontmatter[],
    in_progress: [] as TicketFrontmatter[],
    review: [] as TicketFrontmatter[],
    done: [] as TicketFrontmatter[]
  };

  for (const ticket of tickets) {
    groupedTickets[ticket.status].push(ticket);
  }

  return (
    <Container size="xl" py="xl">
      <Stack gap="xl">
        <Stack gap="xs">
          <Group justify="space-between" align="center">
            <Title order={1}>Orchestrator MVP Workbench</Title>
            <Badge color={healthQuery.data?.ok ? "green" : "gray"} variant="light">
              {healthQuery.data?.ok ? "Backend reachable" : "Backend pending"}
            </Badge>
          </Group>
          <Text c="dimmed" maw={900}>
            This build now covers the first usable local workflow: configure a project,
            create a draft ticket, refine it into an execution-ready shape, and place
            the resulting ticket on the board. Codex execution, terminal control, and
            review/merge automation are still the next milestones.
          </Text>
        </Stack>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
          <SectionCard
            title="Backend Status"
            description="The local backend is the authority for projects, drafts, tickets, and future session orchestration."
          >
            {healthQuery.isPending ? (
              <Loader size="sm" />
            ) : healthQuery.isError ? (
              <Text c="red" size="sm">
                {healthQuery.error.message}
              </Text>
            ) : (
              <List spacing="xs" size="sm">
                <List.Item>
                  Service: <Code>{healthQuery.data.service}</Code>
                </List.Item>
                <List.Item>
                  Timestamp: <Code>{healthQuery.data.timestamp}</Code>
                </List.Item>
                <List.Item>
                  API base URL: <Code>{apiBaseUrl}</Code>
                </List.Item>
                <List.Item>Persistence: local SQLite-backed store</List.Item>
              </List>
            )}
          </SectionCard>

          <SectionCard
            title="Current Slice"
            description="This is the thin vertical slice that is working now."
          >
            <List spacing="xs" size="sm">
              <List.Item>Manual project setup with one repository and target branch</List.Item>
              <List.Item>Persisted draft ticket creation</List.Item>
              <List.Item>Refinement pass that generates acceptance criteria</List.Item>
              <List.Item>Promotion of a draft into a ready ticket on the board</List.Item>
              <List.Item>Startable execution sessions with persisted waiting-state logs</List.Item>
            </List>
          </SectionCard>
        </SimpleGrid>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
          <SectionCard
            title="Create Project"
            description="Projects anchor repositories, drafts, and tickets. The MVP still assumes one repository per ticket."
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                createProjectMutation.mutate({
                  name: projectName,
                  repositoryPath,
                  defaultTargetBranch: defaultBranch
                });
              }}
            >
              <Stack gap="sm">
                <TextInput
                  id="project-name"
                  name="projectName"
                  label="Project name"
                  placeholder="receipt-designer"
                  value={projectName}
                  onChange={(event) => setProjectName(event.currentTarget.value)}
                  required
                />
                <TextInput
                  id="repository-path"
                  name="repositoryPath"
                  label="Repository path"
                  placeholder="/home/nikolai/git/receipt-designer"
                  value={repositoryPath}
                  onChange={(event) => setRepositoryPath(event.currentTarget.value)}
                  required
                />
                <TextInput
                  id="default-target-branch"
                  name="defaultTargetBranch"
                  label="Default target branch"
                  placeholder="main"
                  value={defaultBranch}
                  onChange={(event) => setDefaultBranch(event.currentTarget.value)}
                  required
                />
                {createProjectMutation.isError ? (
                  <Text size="sm" c="red">
                    {createProjectMutation.error.message}
                  </Text>
                ) : null}
                <Group justify="space-between" align="center">
                  <Text size="sm" c="dimmed">
                    Slug preview: <Code>{slugify(projectName || "project-name")}</Code>
                  </Text>
                  <Button type="submit" loading={createProjectMutation.isPending}>
                    Add Project
                  </Button>
                </Group>
              </Stack>
            </form>
          </SectionCard>

          <SectionCard
            title="Projects"
            description="Select a project to work on its drafts and tickets."
          >
            {projectsQuery.isPending ? (
              <Loader size="sm" />
            ) : projectsQuery.isError ? (
              <Text c="red" size="sm">
                {projectsQuery.error.message}
              </Text>
            ) : projectsQuery.data.projects.length === 0 ? (
              <Text size="sm" c="dimmed">
                No projects are configured yet.
              </Text>
            ) : (
              <Stack gap="sm">
                {projectsQuery.data.projects.map((project) => (
                  <Button
                    key={project.id}
                    variant={selectedProjectId === project.id ? "filled" : "light"}
                    justify="space-between"
                    onClick={() => setSelectedProjectId(project.id)}
                  >
                    <span>{project.name}</span>
                    <Code>{project.default_target_branch ?? "no branch"}</Code>
                  </Button>
                ))}
              </Stack>
            )}
          </SectionCard>
        </SimpleGrid>

        {selectedProject ? (
          <>
            <SectionCard
              title="Selected Project"
              description="This is the current execution context for drafts and tickets."
            >
              <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
                <Stack gap={4}>
                  <Text fw={600}>Project</Text>
                  <Text>{selectedProject.name}</Text>
                  <Text c="dimmed" size="sm">
                    <Code>{selectedProject.slug}</Code>
                  </Text>
                </Stack>
                <Stack gap={4}>
                  <Text fw={600}>Repository</Text>
                  <Text>{repositories[0]?.name ?? "Loading repository..."}</Text>
                  <Text c="dimmed" size="sm">
                    <Code>{repositories[0]?.path ?? "No repository configured"}</Code>
                  </Text>
                </Stack>
                <Stack gap={4}>
                  <Text fw={600}>Target branch</Text>
                  <Text>{repositories[0]?.target_branch ?? selectedProject.default_target_branch}</Text>
                  <Text c="dimmed" size="sm">
                    One running session globally is still the intended MVP ceiling.
                  </Text>
                </Stack>
              </SimpleGrid>
            </SectionCard>

            <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
              <SectionCard
                title="Create Draft Ticket"
                description="Start with the title and user-facing intent, then refine before execution."
              >
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    createDraftMutation.mutate({
                      projectId: selectedProject.id,
                      title: draftTitle,
                      description: draftDescription
                    });
                  }}
                >
                  <Stack gap="sm">
                    <TextInput
                      id="draft-title"
                      name="draftTitle"
                      label="Title"
                      placeholder="Add saved preset layouts"
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.currentTarget.value)}
                      required
                    />
                    <Textarea
                      id="draft-description"
                      name="draftDescription"
                      label="Description"
                      placeholder="Users should be able to save and reuse receipt layout presets."
                      value={draftDescription}
                      onChange={(event) => setDraftDescription(event.currentTarget.value)}
                      minRows={5}
                      required
                    />
                    {createDraftMutation.isError ? (
                      <Text size="sm" c="red">
                        {createDraftMutation.error.message}
                      </Text>
                    ) : null}
                    <Group justify="flex-end">
                      <Button type="submit" loading={createDraftMutation.isPending}>
                        Save Draft
                      </Button>
                    </Group>
                  </Stack>
                </form>
              </SectionCard>

              <SectionCard
                title="Draft Refinement"
                description="Refinement turns a raw draft into a ticket with clearer wording and acceptance criteria."
              >
                {draftsQuery.isPending ? (
                  <Loader size="sm" />
                ) : draftsQuery.isError ? (
                  <Text c="red" size="sm">
                    {draftsQuery.error.message}
                  </Text>
                ) : drafts.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    No open drafts for this project yet.
                  </Text>
                ) : (
                  <Stack gap="md">
                    {drafts.map((draft) => {
                      const repository =
                        repositories.find(
                          (item) =>
                            item.id === (draft.confirmed_repo_id ?? draft.proposed_repo_id)
                        ) ?? repositories[0];

                      return (
                        <Stack key={draft.id} gap="xs">
                          <Group justify="space-between" align="center">
                            <Text fw={600}>{draft.title_draft}</Text>
                            <Badge variant="light">{draft.wizard_status}</Badge>
                          </Group>
                          <Text size="sm" c="dimmed">
                            {draft.description_draft}
                          </Text>
                          <Text size="sm">
                            Repository: <Code>{repository?.name ?? "unassigned"}</Code>
                          </Text>
                          {draft.proposed_acceptance_criteria.length > 0 ? (
                            <List size="sm" spacing={4}>
                              {draft.proposed_acceptance_criteria.map((criterion) => (
                                <List.Item key={criterion}>{criterion}</List.Item>
                              ))}
                            </List>
                          ) : (
                            <Text size="sm" c="dimmed">
                              Run refinement to generate acceptance criteria and readiness guidance.
                            </Text>
                          )}
                          {refineDraftMutation.isError ? (
                            <Text size="sm" c="red">
                              {refineDraftMutation.error.message}
                            </Text>
                          ) : null}
                          {confirmDraftMutation.isError ? (
                            <Text size="sm" c="red">
                              {confirmDraftMutation.error.message}
                            </Text>
                          ) : null}
                          <Group justify="flex-end">
                            <Button
                              variant="light"
                              loading={
                                refineDraftMutation.isPending &&
                                refineDraftMutation.variables === draft.id
                              }
                              onClick={() => refineDraftMutation.mutate(draft.id)}
                            >
                              {draft.proposed_acceptance_criteria.length > 0
                                ? "Refine Again"
                                : "Run Refinement"}
                            </Button>
                            <Button
                              disabled={!repository}
                              loading={
                                confirmDraftMutation.isPending &&
                                confirmDraftMutation.variables?.draft.id === draft.id
                              }
                              onClick={() =>
                                repository &&
                                confirmDraftMutation.mutate({
                                  draft,
                                  repository,
                                  project: selectedProject
                                })
                              }
                            >
                              Create Ready Ticket
                            </Button>
                          </Group>
                        </Stack>
                      );
                    })}
                  </Stack>
                )}
              </SectionCard>
            </SimpleGrid>

            <SectionCard
              title="Execution Session"
              description="Starting a ready ticket now creates a persisted execution session and waiting-state log, even though the real Codex runner is still pending."
            >
              {selectedSessionId === null ? (
                <Text size="sm" c="dimmed">
                  Start a ready ticket to create the first execution session for this project.
                </Text>
              ) : sessionQuery.isPending || sessionLogsQuery.isPending ? (
                <Loader size="sm" />
              ) : sessionQuery.isError ? (
                <Text size="sm" c="red">
                  {sessionQuery.error.message}
                </Text>
              ) : session ? (
                <Stack gap="md">
                  <SimpleGrid cols={{ base: 1, md: 4 }} spacing="md">
                    <Stack gap={4}>
                      <Text fw={600}>Session</Text>
                      <Code>{session.id}</Code>
                    </Stack>
                    <Stack gap={4}>
                      <Text fw={600}>Ticket</Text>
                      <Text>
                        {selectedSessionTicket
                          ? `#${selectedSessionTicket.id} ${selectedSessionTicket.title}`
                          : `#${session.ticket_id}`}
                      </Text>
                    </Stack>
                    <Stack gap={4}>
                      <Text fw={600}>Status</Text>
                      <Badge variant="light">{session.status}</Badge>
                    </Stack>
                    <Stack gap={4}>
                      <Text fw={600}>Working branch</Text>
                      <Code>{selectedSessionTicket?.working_branch ?? "pending"}</Code>
                    </Stack>
                  </SimpleGrid>

                  <Text size="sm" c="dimmed">
                    {session.last_summary ??
                      "No session summary is available yet."}
                  </Text>

                  <Stack gap={4}>
                    <Text fw={600}>Session Log</Text>
                    {sessionLogs.length === 0 ? (
                      <Text size="sm" c="dimmed">
                        No log lines yet.
                      </Text>
                    ) : (
                      sessionLogs.map((line, index) => (
                        <Code key={`${session.id}-log-${index}`} block>
                          {line}
                        </Code>
                      ))
                    )}
                  </Stack>

                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!selectedSessionId) {
                        return;
                      }

                      sessionInputMutation.mutate({
                        sessionId: selectedSessionId,
                        body: sessionInput
                      });
                    }}
                  >
                    <Stack gap="sm">
                      <Textarea
                        id="session-input"
                        name="sessionInput"
                        label="Session input"
                        placeholder="Add the next instruction or clarification for the waiting session."
                        value={sessionInput}
                        onChange={(event) => setSessionInput(event.currentTarget.value)}
                        minRows={3}
                      />
                      {sessionInputMutation.isError ? (
                        <Text size="sm" c="red">
                          {sessionInputMutation.error.message}
                        </Text>
                      ) : null}
                      <Group justify="flex-end">
                        <Button
                          type="submit"
                          loading={sessionInputMutation.isPending}
                          disabled={sessionInput.trim().length === 0}
                        >
                          Record Input
                        </Button>
                      </Group>
                    </Stack>
                  </form>
                </Stack>
              ) : (
                <Text size="sm" c="dimmed">
                  Session details are not available yet.
                </Text>
              )}
            </SectionCard>

            <SectionCard
              title="Board"
              description="Tickets now persist, move into in-progress execution sessions, and expose their current state on the board."
            >
              {ticketsQuery.isPending ? (
                <Loader size="sm" />
              ) : ticketsQuery.isError ? (
                <Text c="red" size="sm">
                  {ticketsQuery.error.message}
                </Text>
              ) : (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} spacing="md">
                  {boardColumns.map((column) => (
                    <Stack key={column} gap="sm">
                      <Group justify="space-between">
                        <Text fw={600}>{humanizeTicketStatus(column)}</Text>
                        <Badge variant="outline">
                          {column === "draft" ? drafts.length : groupedTickets[column].length}
                        </Badge>
                      </Group>
                      {column === "draft" ? (
                        drafts.length === 0 ? (
                          <Text size="sm" c="dimmed">
                            No drafts here yet.
                          </Text>
                        ) : (
                          drafts.map((draft) => (
                            <SectionCard
                              key={`draft-${draft.id}`}
                              title={draft.title_draft}
                              description={`Wizard status: ${draft.wizard_status}`}
                            >
                              <Text size="sm" c="dimmed">
                                {draft.description_draft}
                              </Text>
                            </SectionCard>
                          ))
                        )
                      ) : groupedTickets[column].length === 0 ? (
                        <Text size="sm" c="dimmed">
                          No tickets here yet.
                        </Text>
                      ) : (
                        groupedTickets[column].map((ticket) => (
                          <SectionCard
                            key={`${column}-${ticket.id}`}
                            title={`#${ticket.id} ${ticket.title}`}
                            description={`Type: ${ticket.ticket_type} | Target branch: ${ticket.target_branch}`}
                          >
                            <Group justify="space-between" align="center">
                              <Badge variant="light">{ticket.status}</Badge>
                              <Text size="sm" c="dimmed">
                                Session: {ticket.session_id ?? "not started"}
                              </Text>
                            </Group>
                            <Text size="sm" c="dimmed">
                              Branch: {ticket.working_branch ?? "not created yet"}
                            </Text>
                            {column === "ready" ? (
                              <>
                                {startTicketMutation.isError ? (
                                  <Text size="sm" c="red">
                                    {startTicketMutation.error.message}
                                  </Text>
                                ) : null}
                                <Group justify="flex-end">
                                  <Button
                                    loading={
                                      startTicketMutation.isPending &&
                                      startTicketMutation.variables === ticket.id
                                    }
                                    onClick={() => startTicketMutation.mutate(ticket.id)}
                                  >
                                    Start Ticket
                                  </Button>
                                </Group>
                              </>
                            ) : ticket.session_id ? (
                              <Group justify="flex-end">
                                <Button
                                  variant="light"
                                  onClick={() => setSelectedSessionId(ticket.session_id)}
                                >
                                  View Session
                                </Button>
                              </Group>
                            ) : null}
                          </SectionCard>
                        ))
                      )}
                    </Stack>
                  ))}
                </SimpleGrid>
              )}
            </SectionCard>
          </>
        ) : null}
      </Stack>
    </Container>
  );
}
