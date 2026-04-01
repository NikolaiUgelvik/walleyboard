import {
  Alert,
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
  type ProtocolEvent,
  type Project,
  type RepositoryConfig,
  type ReviewPackage,
  type TicketFrontmatter
} from "@orchestrator/contracts";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { SectionCard } from "./components/SectionCard.js";
import { SessionTerminal } from "./components/SessionTerminal.js";

const apiBaseUrl = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4000";
const websocketUrl = apiBaseUrl.replace(/^http/, "ws") + "/ws";
const boardColumns = [
  "draft",
  "ready",
  "in_progress",
  "review",
  "done"
] satisfies TicketFrontmatter["status"][];
const stoppableSessionStatuses = [
  "queued",
  "running",
  "paused_checkpoint",
  "paused_user_control",
  "awaiting_input"
] satisfies ExecutionSession["status"][];

function isStoppableSessionStatus(
  status: ExecutionSession["status"]
): status is (typeof stoppableSessionStatuses)[number] {
  return stoppableSessionStatuses.includes(
    status as (typeof stoppableSessionStatuses)[number]
  );
}

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

type ReviewPackageResponse = {
  review_package: ReviewPackage;
};

type ActionItem = {
  key: string;
  color: "blue" | "yellow";
  title: string;
  message: string;
  sessionId: string;
  actionLabel: string;
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

function upsertById<T extends { id: string | number }>(items: T[], nextItem: T): T[] {
  const existingIndex = items.findIndex((item) => item.id === nextItem.id);
  if (existingIndex === -1) {
    return [nextItem, ...items];
  }

  return items.map((item, index) => (index === existingIndex ? nextItem : item));
}

export function App() {
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [validationCommandsText, setValidationCommandsText] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [requestedChangesBody, setRequestedChangesBody] = useState("");
  const [resumeReason, setResumeReason] = useState("");

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
    enabled: selectedProjectId !== null,
    refetchInterval: selectedProjectId === null ? false : 2_000
  });

  const sessionSummaries = useQueries({
    queries: (ticketsQuery.data?.tickets ?? [])
      .filter((ticket) => ticket.session_id !== null)
      .map((ticket) => ({
        queryKey: ["sessions", ticket.session_id],
        queryFn: () => fetchJson<SessionResponse>(`/sessions/${ticket.session_id}`),
        enabled: ticket.session_id !== null,
        refetchInterval: 2_000
      }))
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

  useEffect(() => {
    const socket = new WebSocket(websocketUrl);

    socket.onmessage = (messageEvent) => {
      const event = JSON.parse(messageEvent.data) as ProtocolEvent;

      if (event.event_type === "draft.updated") {
        const draft = event.payload.draft as DraftTicketState | undefined;
        if (!draft) {
          return;
        }

        queryClient.setQueryData<DraftsResponse>(
          ["projects", draft.project_id, "drafts"],
          (previous) => ({
            drafts: upsertById(previous?.drafts ?? [], draft)
          })
        );
        return;
      }

      if (event.event_type === "draft.ready") {
        const draftId = event.payload.draft_id as string | undefined;
        if (!draftId || selectedProjectId === null) {
          return;
        }

        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "drafts"]
        });
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
            tickets: upsertById(previous?.tickets ?? [], ticket)
          })
        );
        if (ticket.session_id) {
          queryClient.invalidateQueries({
            queryKey: ["sessions", ticket.session_id]
          });
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
            tickets: (previous?.tickets ?? []).filter((ticket) => ticket.id !== ticketId)
          })
        );

        if (deletedSessionId) {
          queryClient.removeQueries({
            queryKey: ["sessions", deletedSessionId]
          });
          queryClient.removeQueries({
            queryKey: ["sessions", deletedSessionId, "logs"]
          });
          if (selectedSessionId === deletedSessionId) {
            setSelectedSessionId(null);
          }
        }
        return;
      }

      if (event.event_type === "session.updated") {
        const session = event.payload.session as ExecutionSession | undefined;
        if (!session) {
          return;
        }

        queryClient.setQueryData<SessionResponse>(["sessions", session.id], {
          session
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
                logs: [...logs, chunk]
              };
            }

            if (logs.length <= sequence) {
              return {
                session_id: sessionId,
                logs
              };
            }

            const nextLogs = [...logs];
            nextLogs[sequence] = chunk;
            return {
              session_id: sessionId,
              logs: nextLogs
            };
          }
        );
        return;
      }

      if (event.event_type === "review_package.generated") {
        const reviewPackage = event.payload.review_package as ReviewPackage | undefined;
        if (!reviewPackage) {
          return;
        }

        queryClient.setQueryData<ReviewPackageResponse>(
          ["tickets", reviewPackage.ticket_id, "review-package"],
          {
            review_package: reviewPackage
          }
        );
      }
    };

    return () => {
      socket.close();
    };
  }, [queryClient, selectedProjectId]);

  const sessionQuery = useQuery({
    queryKey: ["sessions", selectedSessionId],
    queryFn: () => fetchJson<SessionResponse>(`/sessions/${selectedSessionId}`),
    enabled: selectedSessionId !== null,
    refetchInterval: selectedSessionId === null ? false : 2_000
  });

  const sessionLogsQuery = useQuery({
    queryKey: ["sessions", selectedSessionId, "logs"],
    queryFn: () => fetchJson<SessionLogsResponse>(`/sessions/${selectedSessionId}/logs`),
    enabled: selectedSessionId !== null,
    refetchInterval: selectedSessionId === null ? false : 2_000
  });

  const selectedSessionTicketId =
    ticketsQuery.data?.tickets.find((ticket) => ticket.session_id === selectedSessionId)?.id ??
    null;
  const selectedSessionTicketStatus =
    ticketsQuery.data?.tickets.find((ticket) => ticket.session_id === selectedSessionId)
      ?.status ?? null;

  const reviewPackageQuery = useQuery({
    queryKey: ["tickets", selectedSessionTicketId, "review-package"],
    queryFn: () =>
      fetchJson<ReviewPackageResponse>(`/tickets/${selectedSessionTicketId}/review-package`),
    enabled: selectedSessionTicketId !== null && selectedSessionTicketStatus === "review"
  });

  const createProjectMutation = useMutation({
    mutationFn: (input: {
      name: string;
      repositoryPath: string;
      defaultTargetBranch: string;
      validationCommands: string[];
    }) =>
      postJson<CommandAck>("/projects", {
        name: input.name,
        slug: slugify(input.name),
        default_target_branch: input.defaultTargetBranch,
        repository: {
          name: deriveRepositoryName(input.repositoryPath, input.name),
          path: input.repositoryPath,
          target_branch: input.defaultTargetBranch,
          validation_commands: input.validationCommands
        }
      }),
    onSuccess: async (ack) => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      const nextProjectId = ack.resource_refs.project_id ?? null;
      setSelectedProjectId(nextProjectId);
      setProjectName("");
      setRepositoryPath("");
      setDefaultBranch("main");
      setValidationCommandsText("");
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

  const stopTicketMutation = useMutation({
    mutationFn: (input: { ticketId: number; reason?: string }) =>
      postJson<CommandAck>(`/tickets/${input.ticketId}/stop`, {
        reason: input.reason && input.reason.trim().length > 0 ? input.reason : undefined
      }),
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"]
        }),
        queryClient.invalidateQueries({
          queryKey: ["tickets", variables.ticketId, "review-package"]
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId]
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId, "logs"]
        })
      ]);
    }
  });

  const deleteTicketMutation = useMutation({
    mutationFn: (input: { ticketId: number; sessionId?: string | null }) =>
      postJson<CommandAck>(`/tickets/${input.ticketId}/delete`, {}),
    onSuccess: async (_, variables) => {
      if (variables.sessionId && selectedSessionId === variables.sessionId) {
        setSelectedSessionId(null);
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"]
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "drafts"]
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
      setResumeReason("");
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

  const mergeTicketMutation = useMutation({
    mutationFn: (ticketId: number) => postJson<CommandAck>(`/tickets/${ticketId}/merge`, {}),
    onSuccess: async (_, ticketId) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"]
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId]
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId, "logs"]
        }),
        queryClient.invalidateQueries({
          queryKey: ["tickets", ticketId, "review-package"]
        })
      ]);
    }
  });

  const requestChangesMutation = useMutation({
    mutationFn: (input: { ticketId: number; body: string }) =>
      postJson<CommandAck>(`/tickets/${input.ticketId}/request-changes`, {
        body: input.body
      }),
    onSuccess: async (_, variables) => {
      setRequestedChangesBody("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"]
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId]
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId, "logs"]
        }),
        queryClient.invalidateQueries({
          queryKey: ["tickets", variables.ticketId, "review-package"]
        })
      ]);
    }
  });

  const resumeTicketMutation = useMutation({
    mutationFn: (input: { ticketId: number; reason?: string }) =>
      postJson<CommandAck>(`/tickets/${input.ticketId}/resume`, {
        reason: input.reason && input.reason.trim().length > 0 ? input.reason : undefined
      }),
    onSuccess: async () => {
      setResumeReason("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"]
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId]
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId, "logs"]
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
  const reviewPackage = reviewPackageQuery.data?.review_package ?? null;
  const sessionById = new Map(
    sessionSummaries
      .map((query) => query.data?.session)
      .filter((value): value is ExecutionSession => value !== undefined)
      .map((item) => [item.id, item])
  );

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

  const actionItems: ActionItem[] = tickets.flatMap((ticket): ActionItem[] => {
    const sessionForTicket =
      ticket.session_id !== null ? sessionById.get(ticket.session_id) ?? null : null;

    if (ticket.status === "review" && ticket.session_id) {
      return [
        {
          key: `review-${ticket.id}`,
          color: "blue" as const,
          title: `Review ready for ticket #${ticket.id}`,
          message: `${ticket.title} is ready for review and can be merged or sent back for changes.`,
          sessionId: ticket.session_id,
          actionLabel: "Open Review"
        }
      ];
    }

    if (
      sessionForTicket &&
      ["awaiting_input", "failed", "interrupted", "paused_checkpoint", "paused_user_control"].includes(
        sessionForTicket.status
      )
    ) {
      const label =
        sessionForTicket.status === "failed"
          ? `Execution failed for ticket #${ticket.id}`
          : `Input needed for ticket #${ticket.id}`;
      const message =
        sessionForTicket.last_summary ??
        `${ticket.title} needs your attention before the next attempt can continue.`;

      return [
        {
          key: `session-${ticket.id}`,
          color: "yellow" as const,
          title: label,
          message,
          sessionId: sessionForTicket.id,
          actionLabel: "Open Session"
        }
      ];
    }

    return [];
  });

  const selectedSessionTicketSession =
    selectedSessionTicket && selectedSessionTicket.session_id
      ? sessionById.get(selectedSessionTicket.session_id) ?? session
      : session;

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
            the resulting ticket on the board. Starting a ticket now launches a real
            Codex exec run in its prepared worktree and moves successful runs into
            local review. Review approval can now merge the branch back into the target
            branch and clean up local artifacts. Review feedback and failed runs can now
            relaunch the same logical session as a new attempt. In-progress tickets can now
            be stopped without losing their branch or worktree, and tickets can be deleted
            with cleanup of orchestrator-managed local artifacts. Session output now renders
            inside a terminal-style view, and backend restarts now recover active sessions
            into an explicit interrupted state. Full keyboard handoff remains the next major
            milestone.
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
                <List.Item>Prepared git worktrees per started ticket</List.Item>
                <List.Item>Real Codex exec runs with streaming session logs</List.Item>
                <List.Item>Configurable validation commands that gate review handoff</List.Item>
                <List.Item>Automatic transition into local review with a generated diff artifact</List.Item>
                <List.Item>Request changes and resume flows that reuse the same session</List.Item>
                <List.Item>Stop action that preserves the current worktree and branch for resume</List.Item>
                <List.Item>Delete action that removes ticket metadata and local orchestrator artifacts</List.Item>
                <List.Item>Visible in-app action cards for review-ready and waiting sessions</List.Item>
                <List.Item>Read-only terminal rendering for session output</List.Item>
                <List.Item>Conservative restart recovery that preserves interrupted sessions</List.Item>
                <List.Item>WebSocket-driven updates for the board, session, and review cache</List.Item>
                <List.Item>Direct merge from review into the target branch with cleanup</List.Item>
              </List>
          </SectionCard>
        </SimpleGrid>

        {actionItems.length > 0 ? (
          <SectionCard
            title="Action Required"
            description="These tickets need a review decision or user input before the workflow can move forward."
          >
            <Stack gap="sm">
              {actionItems.map((item) => (
                <Alert key={item.key} color={item.color} title={item.title}>
                  <Stack gap="xs">
                    <Text size="sm">{item.message}</Text>
                    <Group justify="flex-end">
                      <Button variant="light" onClick={() => setSelectedSessionId(item.sessionId)}>
                        {item.actionLabel}
                      </Button>
                    </Group>
                  </Stack>
                </Alert>
              ))}
            </Stack>
          </SectionCard>
        ) : null}

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
                  defaultTargetBranch: defaultBranch,
                  validationCommands: validationCommandsText
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean)
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
                <Textarea
                  id="validation-commands"
                  name="validationCommands"
                  label="Validation commands"
                  placeholder={"npm run test\nnpm run lint"}
                  description="Optional. One shell command per line. Required commands block review if they fail."
                  value={validationCommandsText}
                  onChange={(event) => setValidationCommandsText(event.currentTarget.value)}
                  minRows={3}
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
                <Stack gap={4}>
                  <Text fw={600}>Validation</Text>
                  <Text>{repositories[0]?.validation_profile.length ?? 0} configured command(s)</Text>
                  <Text c="dimmed" size="sm">
                    Validation runs after Codex finishes and before review handoff.
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
              description="Starting a ready ticket now prepares a git worktree, launches Codex exec, and streams backend-captured session logs while the run is active."
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
                    <Stack gap={4}>
                      <Text fw={600}>Worktree</Text>
                      <Code>{session.worktree_path ?? "pending"}</Code>
                    </Stack>
                  </SimpleGrid>

                  <Text size="sm" c="dimmed">
                    {session.last_summary ??
                      "No session summary is available yet."}
                  </Text>

                  {selectedSessionTicket ? (
                    <Group justify="space-between">
                      {selectedSessionTicket.status === "in_progress" &&
                      selectedSessionTicketSession &&
                      isStoppableSessionStatus(selectedSessionTicketSession.status) ? (
                        <Button
                          color="orange"
                          variant="light"
                          loading={
                            stopTicketMutation.isPending &&
                            stopTicketMutation.variables?.ticketId === selectedSessionTicket.id
                          }
                          onClick={() =>
                            stopTicketMutation.mutate({
                              ticketId: selectedSessionTicket.id
                            })
                          }
                        >
                          Stop Ticket
                        </Button>
                      ) : (
                        <span />
                      )}
                      <Button
                        color="red"
                        variant="light"
                        loading={
                          deleteTicketMutation.isPending &&
                          deleteTicketMutation.variables?.ticketId === selectedSessionTicket.id
                        }
                        onClick={() => {
                          const confirmed = window.confirm(
                            `Delete ticket #${selectedSessionTicket.id}? This removes local ticket metadata and will try to clean up its worktree and branch.`
                          );
                          if (!confirmed) {
                            return;
                          }

                          deleteTicketMutation.mutate({
                            ticketId: selectedSessionTicket.id,
                            sessionId: selectedSessionTicket.session_id
                          });
                        }}
                      >
                        Delete Ticket
                      </Button>
                    </Group>
                  ) : null}

                  {stopTicketMutation.isError ? (
                    <Text size="sm" c="red">
                      {stopTicketMutation.error.message}
                    </Text>
                  ) : null}
                  {deleteTicketMutation.isError ? (
                    <Text size="sm" c="red">
                      {deleteTicketMutation.error.message}
                    </Text>
                  ) : null}

                  {selectedSessionTicket?.status === "review" ? (
                    reviewPackageQuery.isPending ? (
                      <Loader size="sm" />
                    ) : reviewPackage ? (
                      <Stack gap={4}>
                        <Text fw={600}>Review Package</Text>
                        <Text size="sm" c="dimmed">
                          Diff artifact: <Code>{reviewPackage.diff_ref}</Code>
                        </Text>
                        <Text size="sm" c="dimmed">
                          Validation results: {reviewPackage.validation_results.length}
                        </Text>
                        {reviewPackage.validation_results.length > 0 ? (
                          <List size="sm" spacing={4}>
                            {reviewPackage.validation_results.map((result) => (
                              <List.Item key={result.command_id}>
                                {result.label}: {result.status}
                              </List.Item>
                            ))}
                          </List>
                        ) : null}
                        {mergeTicketMutation.isError ? (
                          <Text size="sm" c="red">
                            {mergeTicketMutation.error.message}
                          </Text>
                        ) : null}
                        {requestChangesMutation.isError ? (
                          <Text size="sm" c="red">
                            {requestChangesMutation.error.message}
                          </Text>
                        ) : null}
                        <Textarea
                          label="Requested changes"
                          placeholder="Ask Codex to adjust the current review before you approve it."
                          value={requestedChangesBody}
                          onChange={(event) => setRequestedChangesBody(event.currentTarget.value)}
                          minRows={3}
                        />
                        <Group justify="space-between">
                          <Button
                            variant="light"
                            loading={
                              requestChangesMutation.isPending &&
                              requestChangesMutation.variables?.ticketId ===
                                selectedSessionTicket.id
                            }
                            disabled={requestedChangesBody.trim().length === 0}
                            onClick={() =>
                              requestChangesMutation.mutate({
                                ticketId: selectedSessionTicket.id,
                                body: requestedChangesBody
                              })
                            }
                          >
                            Request Changes
                          </Button>
                          <Button
                            loading={
                              mergeTicketMutation.isPending &&
                              mergeTicketMutation.variables === selectedSessionTicket.id
                            }
                            onClick={() => mergeTicketMutation.mutate(selectedSessionTicket.id)}
                          >
                            Merge to {selectedSessionTicket.target_branch}
                          </Button>
                        </Group>
                      </Stack>
                    ) : null
                  ) : null}

                  <Stack gap={4}>
                    <Text fw={600}>Session Terminal</Text>
                    <SessionTerminal logs={sessionLogs} sessionId={session.id} />
                  </Stack>

                  {selectedSessionTicket &&
                  ["awaiting_input", "failed", "interrupted", "paused_checkpoint", "paused_user_control"].includes(
                    session.status
                  ) ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        resumeTicketMutation.mutate({
                          ticketId: selectedSessionTicket.id,
                          reason: resumeReason
                        });
                      }}
                    >
                      <Stack gap="sm">
                        <Textarea
                          id="resume-reason"
                          name="resumeReason"
                          label="Resume guidance"
                          placeholder="Optional. Clarify what Codex should address on the next attempt."
                          value={resumeReason}
                          onChange={(event) => setResumeReason(event.currentTarget.value)}
                          minRows={3}
                        />
                        {resumeTicketMutation.isError ? (
                          <Text size="sm" c="red">
                            {resumeTicketMutation.error.message}
                          </Text>
                        ) : null}
                        <Group justify="space-between">
                          <Button
                            variant="subtle"
                            type="button"
                            onClick={() => {
                              if (!selectedSessionId) {
                                return;
                              }

                              sessionInputMutation.mutate({
                                sessionId: selectedSessionId,
                                body: resumeReason || "Resume requested from the session view."
                              });
                            }}
                            loading={sessionInputMutation.isPending}
                          >
                            Record Note Only
                          </Button>
                          <Button
                            type="submit"
                            loading={resumeTicketMutation.isPending}
                          >
                            Resume Execution
                          </Button>
                        </Group>
                      </Stack>
                    </form>
                  ) : (
                    <Text size="sm" c="dimmed">
                      Direct mid-run input is not wired yet for Codex exec sessions. The
                      log and summary above reflect the current run state.
                    </Text>
                  )}
                </Stack>
              ) : (
                <Text size="sm" c="dimmed">
                  Session details are not available yet.
                </Text>
              )}
            </SectionCard>

            <SectionCard
              title="Board"
              description="Tickets persist, run inside isolated worktrees, and move across the board as session state changes."
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
                            <Text size="sm" c="dimmed">
                            {ticket.description}
                          </Text>
                          {(() => {
                            const ticketSession =
                              ticket.session_id !== null
                                ? sessionById.get(ticket.session_id) ?? null
                                : null;
                            const canStop =
                              ticket.status === "in_progress" &&
                              ticketSession !== null &&
                              isStoppableSessionStatus(ticketSession.status);

                            return (
                              <>
                            <Group justify="space-between" align="center">
                              <Badge variant="light">{ticket.status}</Badge>
                              <Text size="sm" c="dimmed">
                                Session: {ticket.session_id ?? "not started"}
                              </Text>
                            </Group>
                            <Text size="sm" c="dimmed">
                              Branch: {ticket.working_branch ?? "not created yet"}
                            </Text>
                            <Text size="sm" c="dimmed">
                              Acceptance criteria: {ticket.acceptance_criteria.length}
                            </Text>
                            {column === "ready" ? (
                              <>
                                {startTicketMutation.isError ? (
                                  <Text size="sm" c="red">
                                    {startTicketMutation.error.message}
                                  </Text>
                                ) : null}
                                {deleteTicketMutation.isError &&
                                deleteTicketMutation.variables?.ticketId === ticket.id ? (
                                  <Text size="sm" c="red">
                                    {deleteTicketMutation.error.message}
                                  </Text>
                                ) : null}
                                <Group justify="space-between">
                                  <Button
                                    color="red"
                                    variant="subtle"
                                    loading={
                                      deleteTicketMutation.isPending &&
                                      deleteTicketMutation.variables?.ticketId === ticket.id
                                    }
                                    onClick={() => {
                                      const confirmed = window.confirm(
                                        `Delete ticket #${ticket.id}? This removes local ticket metadata and will try to clean up its worktree and branch.`
                                      );
                                      if (!confirmed) {
                                        return;
                                      }

                                      deleteTicketMutation.mutate({
                                        ticketId: ticket.id,
                                        sessionId: ticket.session_id
                                      });
                                    }}
                                  >
                                    Delete
                                  </Button>
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
                            ) : column === "review" ? (
                              <>
                                {mergeTicketMutation.isError ? (
                                  <Text size="sm" c="red">
                                    {mergeTicketMutation.error.message}
                                  </Text>
                                ) : null}
                                {deleteTicketMutation.isError &&
                                deleteTicketMutation.variables?.ticketId === ticket.id ? (
                                  <Text size="sm" c="red">
                                    {deleteTicketMutation.error.message}
                                  </Text>
                                ) : null}
                                <Group justify="space-between">
                                  <Button
                                    variant="light"
                                    onClick={() => ticket.session_id && setSelectedSessionId(ticket.session_id)}
                                  >
                                    View Review
                                  </Button>
                                  <Group gap="xs">
                                    <Button
                                      color="red"
                                      variant="subtle"
                                      loading={
                                        deleteTicketMutation.isPending &&
                                        deleteTicketMutation.variables?.ticketId === ticket.id
                                      }
                                      onClick={() => {
                                        const confirmed = window.confirm(
                                          `Delete ticket #${ticket.id}? This removes local ticket metadata and will try to clean up its worktree and branch.`
                                        );
                                        if (!confirmed) {
                                          return;
                                        }

                                        deleteTicketMutation.mutate({
                                          ticketId: ticket.id,
                                          sessionId: ticket.session_id
                                        });
                                      }}
                                    >
                                      Delete
                                    </Button>
                                    <Button
                                      loading={
                                        mergeTicketMutation.isPending &&
                                        mergeTicketMutation.variables === ticket.id
                                      }
                                      onClick={() => mergeTicketMutation.mutate(ticket.id)}
                                    >
                                      Merge
                                    </Button>
                                  </Group>
                                </Group>
                              </>
                            ) : ticket.session_id ? (
                              <>
                                {(stopTicketMutation.isError &&
                                  stopTicketMutation.variables?.ticketId === ticket.id) ||
                                (deleteTicketMutation.isError &&
                                  deleteTicketMutation.variables?.ticketId === ticket.id) ? (
                                  <Text size="sm" c="red">
                                    {stopTicketMutation.variables?.ticketId === ticket.id
                                      ? stopTicketMutation.error?.message
                                      : deleteTicketMutation.error?.message}
                                  </Text>
                                ) : null}
                                <Group justify="space-between">
                                  <Button
                                    color="red"
                                    variant="subtle"
                                    loading={
                                      deleteTicketMutation.isPending &&
                                      deleteTicketMutation.variables?.ticketId === ticket.id
                                    }
                                    onClick={() => {
                                      const confirmed = window.confirm(
                                        `Delete ticket #${ticket.id}? This removes local ticket metadata and will try to clean up its worktree and branch.`
                                      );
                                      if (!confirmed) {
                                        return;
                                      }

                                      deleteTicketMutation.mutate({
                                        ticketId: ticket.id,
                                        sessionId: ticket.session_id
                                      });
                                    }}
                                  >
                                    Delete
                                  </Button>
                                  <Group gap="xs">
                                    {canStop ? (
                                      <Button
                                        color="orange"
                                        variant="light"
                                        loading={
                                          stopTicketMutation.isPending &&
                                          stopTicketMutation.variables?.ticketId === ticket.id
                                        }
                                        onClick={() =>
                                          stopTicketMutation.mutate({
                                            ticketId: ticket.id
                                          })
                                        }
                                      >
                                        Stop
                                      </Button>
                                    ) : null}
                                    <Button
                                      variant="light"
                                      onClick={() => setSelectedSessionId(ticket.session_id)}
                                    >
                                      View Session
                                    </Button>
                                  </Group>
                                </Group>
                              </>
                            ) : (
                              <>
                                {deleteTicketMutation.isError &&
                                deleteTicketMutation.variables?.ticketId === ticket.id ? (
                                  <Text size="sm" c="red">
                                    {deleteTicketMutation.error.message}
                                  </Text>
                                ) : null}
                                <Group justify="flex-end">
                                  <Button
                                    color="red"
                                    variant="subtle"
                                    loading={
                                      deleteTicketMutation.isPending &&
                                      deleteTicketMutation.variables?.ticketId === ticket.id
                                    }
                                    onClick={() => {
                                      const confirmed = window.confirm(
                                        `Delete ticket #${ticket.id}? This removes local ticket metadata and will try to clean up its worktree and branch.`
                                      );
                                      if (!confirmed) {
                                        return;
                                      }

                                      deleteTicketMutation.mutate({
                                        ticketId: ticket.id,
                                        sessionId: ticket.session_id
                                      });
                                    }}
                                  >
                                    Delete
                                  </Button>
                                </Group>
                              </>
                            )}
                              </>
                            );
                          })()}
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
