import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Code,
  Group,
  List,
  Loader,
  Menu,
  Modal,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
  useMantineColorScheme
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

import "./app-shell.css";
import { SectionCard } from "./components/SectionCard.js";
import { SessionActivityFeed } from "./components/SessionActivityFeed.js";
import { SessionTerminalPanel } from "./components/SessionTerminalPanel.js";

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
const boardColumnMeta: Record<
  (typeof boardColumns)[number],
  { label: string; accent: string; empty: string }
> = {
  draft: {
    label: "Draft",
    accent: "#6b7280",
    empty: "No draft tickets yet. Use New Draft to capture the next task."
  },
  ready: {
    label: "Ready",
    accent: "#2563eb",
    empty: "No ready tickets waiting to start."
  },
  in_progress: {
    label: "In progress",
    accent: "#d97706",
    empty: "No active Codex runs at the moment."
  },
  review: {
    label: "In review",
    accent: "#7c3aed",
    empty: "Nothing is waiting for review right now."
  },
  done: {
    label: "Done",
    accent: "#16a34a",
    empty: "Nothing has been merged yet."
  }
};

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

type InspectorState =
  | { kind: "hidden" }
  | { kind: "new_draft" }
  | { kind: "draft"; draftId: string }
  | { kind: "session"; sessionId: string };

function isStoppableSessionStatus(
  status: ExecutionSession["status"]
): status is (typeof stoppableSessionStatuses)[number] {
  return stoppableSessionStatuses.includes(
    status as (typeof stoppableSessionStatuses)[number]
  );
}

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

function deriveWorkingBranchPreview(ticket: TicketFrontmatter): string {
  return `codex/ticket-${ticket.id}-${slugify(ticket.title).slice(0, 24)}`;
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

function ticketStatusColor(status: TicketFrontmatter["status"]): string {
  switch (status) {
    case "ready":
      return "blue";
    case "in_progress":
      return "orange";
    case "review":
      return "violet";
    case "done":
      return "green";
    default:
      return "gray";
  }
}

function sessionStatusColor(status: ExecutionSession["status"]): string {
  switch (status) {
    case "running":
      return "orange";
    case "completed":
      return "green";
    case "paused_user_control":
    case "paused_checkpoint":
    case "awaiting_input":
      return "yellow";
    case "failed":
      return "red";
    case "interrupted":
      return "gray";
    default:
      return "blue";
  }
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function draftMatchesSearch(draft: DraftTicketState, needle: string): boolean {
  if (needle.length === 0) {
    return true;
  }

  return [
    draft.title_draft,
    draft.description_draft,
    draft.proposed_ticket_type ?? "",
    ...draft.proposed_acceptance_criteria
  ]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function ticketMatchesSearch(ticket: TicketFrontmatter, needle: string): boolean {
  if (needle.length === 0) {
    return true;
  }

  return [
    String(ticket.id),
    ticket.title,
    ticket.description,
    ticket.ticket_type,
    ticket.target_branch,
    ticket.working_branch ?? "",
    ...ticket.acceptance_criteria
  ]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function focusElementById(id: string): void {
  const element = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!element) {
    return;
  }

  element.scrollIntoView({ behavior: "smooth", block: "center" });
  element.focus();
}

function ColorSchemeControl() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  return (
    <SegmentedControl
      size="xs"
      radius="xl"
      value={colorScheme}
      onChange={(value) => setColorScheme(value as "auto" | "light" | "dark")}
      data={[
        { label: "System", value: "auto" },
        { label: "Light", value: "light" },
        { label: "Dark", value: "dark" }
      ]}
    />
  );
}

export function App() {
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [inspectorState, setInspectorState] = useState<InspectorState>({ kind: "hidden" });
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [validationCommandsText, setValidationCommandsText] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [requestedChangesBody, setRequestedChangesBody] = useState("");
  const [resumeReason, setResumeReason] = useState("");
  const [terminalCommand, setTerminalCommand] = useState("");
  const [boardSearch, setBoardSearch] = useState("");
  const selectedDraftId = inspectorState.kind === "draft" ? inspectorState.draftId : null;
  const selectedSessionId =
    inspectorState.kind === "session" ? inspectorState.sessionId : null;
  const inspectorVisible = inspectorState.kind !== "hidden";

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
    if (inspectorState.kind === "draft") {
      const stillExists =
        draftsQuery.data?.drafts.some((draft) => draft.id === inspectorState.draftId) ?? false;
      if (!stillExists) {
        setInspectorState({ kind: "hidden" });
      }
      return;
    }

    if (inspectorState.kind === "session") {
      const stillExists =
        ticketsQuery.data?.tickets.some(
          (ticket) => ticket.session_id === inspectorState.sessionId
        ) ?? false;
      if (!stillExists) {
        setInspectorState({ kind: "hidden" });
      }
      return;
    }

    if (inspectorState.kind === "new_draft" && selectedProjectId === null) {
      setInspectorState({ kind: "hidden" });
    }
  }, [draftsQuery.data?.drafts, inspectorState, selectedProjectId, ticketsQuery.data?.tickets]);

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

      if (event.event_type === "draft.deleted") {
        const draftId = event.payload.draft_id as string | undefined;
        const projectId = event.payload.project_id as string | undefined;
        if (!draftId || !projectId) {
          return;
        }

        queryClient.setQueryData<DraftsResponse>(
          ["projects", projectId, "drafts"],
          (previous) => ({
            drafts: (previous?.drafts ?? []).filter((draft) => draft.id !== draftId)
          })
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
            setInspectorState({ kind: "hidden" });
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
  }, [queryClient, selectedDraftId, selectedProjectId, selectedSessionId]);

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
      setProjectModalOpen(false);
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

      setInspectorState({ kind: "hidden" });

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

  const deleteDraftMutation = useMutation({
    mutationFn: (draftId: string) =>
      postJson<CommandAck>(`/drafts/${draftId}/delete`, {}),
    onSuccess: async (_, draftId) => {
      if (selectedDraftId === draftId) {
        setInspectorState({ kind: "hidden" });
      }

      if (selectedProjectId) {
        await queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "drafts"]
        });
      }
    }
  });

  const startTicketMutation = useMutation({
    mutationFn: (input: { ticketId: number; planningEnabled: boolean }) =>
      postJson<CommandAck>(`/tickets/${input.ticketId}/start`, {
        planning_enabled: input.planningEnabled
      }),
    onSuccess: async (ack) => {
      if (!selectedProjectId) {
        return;
      }

      if (ack.resource_refs.session_id) {
        setInspectorState({
          kind: "session",
          sessionId: ack.resource_refs.session_id
        });
      } else {
        setInspectorState({ kind: "hidden" });
      }
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
        setInspectorState({ kind: "hidden" });
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

  const terminalInputMutation = useMutation({
    mutationFn: (input: { sessionId: string; body: string }) =>
      postJson<CommandAck>(`/sessions/${input.sessionId}/input`, {
        body: input.body
      }),
    onSuccess: async (_, variables) => {
      setTerminalCommand("");
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

  const terminalTakeoverMutation = useMutation({
    mutationFn: (sessionId: string) =>
      postJson<CommandAck>(`/sessions/${sessionId}/terminal/takeover`, {}),
    onSuccess: async (_, sessionId) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["sessions", sessionId]
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", sessionId, "logs"]
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"]
        })
      ]);
    }
  });

  const terminalRestoreMutation = useMutation({
    mutationFn: (sessionId: string) =>
      postJson<CommandAck>(`/sessions/${sessionId}/terminal/restore-agent`, {}),
    onSuccess: async (_, sessionId) => {
      setTerminalCommand("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["sessions", sessionId]
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", sessionId, "logs"]
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"]
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
  const selectedRepository = repositories[0] ?? null;
  const drafts = draftsQuery.data?.drafts ?? [];
  const selectedDraft = drafts.find((draft) => draft.id === selectedDraftId) ?? null;
  const selectedDraftRepository =
    selectedDraft === null
      ? null
      : repositories.find(
          (item) => item.id === (selectedDraft.confirmed_repo_id ?? selectedDraft.proposed_repo_id)
        ) ?? selectedRepository;
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

  const searchNeedle = normalizeText(boardSearch);
  const visibleDrafts = drafts.filter((draft) => draftMatchesSearch(draft, searchNeedle));
  const visibleTickets = tickets.filter((ticket) => ticketMatchesSearch(ticket, searchNeedle));

  const groupedTickets = {
    draft: [] as TicketFrontmatter[],
    ready: [] as TicketFrontmatter[],
    in_progress: [] as TicketFrontmatter[],
    review: [] as TicketFrontmatter[],
    done: [] as TicketFrontmatter[]
  };

  for (const ticket of visibleTickets) {
    groupedTickets[ticket.status].push(ticket);
  }

  const actionItems: ActionItem[] = tickets.flatMap((ticket): ActionItem[] => {
    const sessionForTicket =
      ticket.session_id !== null ? sessionById.get(ticket.session_id) ?? null : null;

    if (ticket.status === "review" && ticket.session_id) {
      return [
        {
          key: `review-${ticket.id}`,
          color: "blue",
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
          : sessionForTicket.status === "paused_user_control"
            ? `Manual terminal active for ticket #${ticket.id}`
            : `Input needed for ticket #${ticket.id}`;
      const message =
        sessionForTicket.last_summary ??
        (sessionForTicket.status === "paused_user_control"
          ? `${ticket.title} is in direct terminal mode on its worktree.`
          : `${ticket.title} needs your attention before the next attempt can continue.`);

      return [
        {
          key: `session-${ticket.id}`,
          color: "yellow",
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

  const boardLoading =
    (selectedProjectId !== null && draftsQuery.isPending) ||
    (selectedProjectId !== null && ticketsQuery.isPending);
  const boardError = draftsQuery.isError
    ? draftsQuery.error.message
    : ticketsQuery.isError
      ? ticketsQuery.error.message
      : null;

  const activeSessionCount = tickets.filter((ticket) => ticket.status === "in_progress").length;
  const reviewCount = tickets.filter((ticket) => ticket.status === "review").length;

  const deleteTicket = (ticket: TicketFrontmatter): void => {
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
  };

  const openNewDraft = (): void => {
    setInspectorState({ kind: "new_draft" });
    window.requestAnimationFrame(() => focusElementById("draft-title"));
  };

  const hideInspector = (): void => {
    setInspectorState({ kind: "hidden" });
  };

  const openTicketSession = (ticket: TicketFrontmatter): void => {
    if (!ticket.session_id) {
      return;
    }

    setInspectorState({ kind: "session", sessionId: ticket.session_id });
  };

  const openDraft = (draftId: string): void => {
    setInspectorState({ kind: "draft", draftId });
  };

  const renderTicketMenu = (ticket: TicketFrontmatter) => (
    <Menu withinPortal position="bottom-end">
      <Menu.Target>
        <ActionIcon
          aria-label={`More actions for ticket ${ticket.id}`}
          color="gray"
          variant="subtle"
          onClick={(event) => event.stopPropagation()}
        >
          ...
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(event) => event.stopPropagation()}>
        <Menu.Item
          color="red"
          onClick={(event) => {
            event.stopPropagation();
            deleteTicket(ticket);
          }}
        >
          Delete
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );

  return (
    <Box className="orchestrator-shell">
      <Box
        className={`orchestrator-layout${
          inspectorVisible ? " orchestrator-layout--with-detail" : ""
        }`}
      >
        <Box className="orchestrator-rail">
          <Stack gap="md">
            <SectionCard
              title="Projects"
              description="Switch the current board context and keep the left rail focused on project-level setup."
            >
              {projectsQuery.isPending ? (
                <Loader size="sm" />
              ) : projectsQuery.isError ? (
                <Text c="red" size="sm">
                  {projectsQuery.error.message}
                </Text>
              ) : projectsQuery.data.projects.length === 0 ? (
                <Text size="sm" c="dimmed">
                  No projects yet. Create the first one below.
                </Text>
              ) : (
                <Stack gap="xs">
                  {projectsQuery.data.projects.map((project) => (
                    <Button
                      key={project.id}
                      className="project-nav-button"
                      data-selected={selectedProjectId === project.id ? "true" : "false"}
                      variant={selectedProjectId === project.id ? "filled" : "subtle"}
                      justify="space-between"
                      onClick={() => setSelectedProjectId(project.id)}
                    >
                      <span>{project.name}</span>
                      <Code>{project.default_target_branch ?? "main"}</Code>
                    </Button>
                  ))}
                  <Button variant="light" onClick={() => setProjectModalOpen(true)}>
                    Create Project
                  </Button>
                </Stack>
              )}
            </SectionCard>

            {actionItems.length > 0 ? (
              <SectionCard
                title="Inbox"
                description="Sessions that need a decision or direct intervention stay visible here."
              >
                <Stack gap="xs">
                  {actionItems.map((item) => (
                    <Box key={item.key} className="inbox-item" data-tone={item.color}>
                      <Stack gap={6}>
                        <Text fw={700} size="sm">
                          {item.title}
                        </Text>
                        <Text size="sm" c="dimmed">
                          {item.message}
                        </Text>
                        <Group justify="flex-end">
                          <Button
                            variant="light"
                            size="xs"
                            onClick={() => {
                              setInspectorState({
                                kind: "session",
                                sessionId: item.sessionId
                              });
                            }}
                          >
                            {item.actionLabel}
                          </Button>
                        </Group>
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              </SectionCard>
            ) : null}

          </Stack>
        </Box>

        <Box className="orchestrator-main">
          <Stack gap="md">
            <Box className="workbench-header">
              <Group justify="space-between" align="flex-start">
                <Stack gap={6}>
                  <Text className="rail-kicker">Project board</Text>
                  <Title order={1} style={{ letterSpacing: "-0.05em" }}>
                    {selectedProject ? selectedProject.name : "Select a project"}
                  </Title>
                  <Text size="sm" c="dimmed" maw={820}>
                    {selectedProject
                      ? `${selectedRepository?.name ?? "Repository pending"} • ${selectedRepository?.target_branch ?? selectedProject.default_target_branch ?? "main"} • ${selectedRepository?.validation_profile.length ?? 0} validation command(s)`
                      : "Choose a project from the left rail to bring its drafts, tickets, and sessions into the board."}
                  </Text>
                </Stack>
                <Group gap="xs">
                  <ColorSchemeControl />
                  <Badge variant="light" color="green">
                    {healthQuery.data?.service ?? "backend"}
                  </Badge>
                  <Badge variant="outline">{activeSessionCount} running</Badge>
                  <Badge variant="outline">{reviewCount} in review</Badge>
                </Group>
              </Group>
            </Box>

            <Box className="workbench-toolbar">
              <Box className="toolbar-group">
                {boardColumns.map((column) => {
                  const count = column === "draft" ? visibleDrafts.length : groupedTickets[column].length;
                  const meta = boardColumnMeta[column];
                  return (
                    <Badge
                      key={column}
                      variant="light"
                      size="lg"
                      style={{
                        background: `${meta.accent}14`,
                        color: meta.accent,
                        border: `1px solid ${meta.accent}22`
                      }}
                    >
                      {meta.label} {count}
                    </Badge>
                  );
                })}
              </Box>
              <Box className="toolbar-group">
                <TextInput
                  className="board-search"
                  placeholder="Search tickets and drafts..."
                  value={boardSearch}
                  onChange={(event) => setBoardSearch(event.currentTarget.value)}
                />
                <Button
                  disabled={!selectedProject}
                  variant={inspectorState.kind === "new_draft" ? "filled" : "light"}
                  onClick={openNewDraft}
                >
                  New Draft
                </Button>
              </Box>
            </Box>

            {!selectedProject ? (
              <SectionCard
                title="Nothing selected"
                description="The board shell is ready. Pick a project from the left rail or create a new one to start using it."
              >
                <Text size="sm" c="dimmed">
                  Projects anchor repositories, drafts, tickets, and execution sessions. Once a
                  project is selected, the middle canvas becomes the working board and the right
                  panel becomes the live inspector.
                </Text>
              </SectionCard>
            ) : boardLoading ? (
              <SectionCard
                title="Loading board"
                description="Fetching drafts, tickets, and session summaries for the selected project."
              >
                <Loader size="sm" />
              </SectionCard>
            ) : boardError ? (
              <SectionCard
                title="Board unavailable"
                description="The selected project could not be loaded into the board."
              >
                <Text c="red" size="sm">
                  {boardError}
                </Text>
              </SectionCard>
            ) : (
              <Box className="board-scroller">
                <Box className="board-grid">
                  {boardColumns.map((column) => {
                    const meta = boardColumnMeta[column];
                    const columnCount =
                      column === "draft" ? visibleDrafts.length : groupedTickets[column].length;

                    return (
                      <Box key={column} className="board-column">
                        <Box className="board-column-header">
                          <Box className="board-column-title">
                            <Box
                              className="board-column-dot"
                              style={{ background: meta.accent }}
                            />
                            <Text fw={700}>{meta.label}</Text>
                          </Box>
                          <Group gap="xs">
                            <Badge variant="outline">{columnCount}</Badge>
                            {column === "draft" ? (
                              <Button
                                variant="subtle"
                                size="xs"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openNewDraft();
                                }}
                              >
                                New
                              </Button>
                            ) : null}
                          </Group>
                        </Box>

                        <Box className="board-column-stack" onClick={hideInspector}>
                          {column === "draft" ? (
                            visibleDrafts.length === 0 ? (
                              <Box className="board-empty">{meta.empty}</Box>
                            ) : (
                              visibleDrafts.map((draft) => {
                                const repository =
                                  repositories.find(
                                    (item) =>
                                      item.id === (draft.confirmed_repo_id ?? draft.proposed_repo_id)
                                  ) ?? selectedRepository;
                                const isSelected = draft.id === selectedDraftId;

                                return (
                                  <Box
                                    key={draft.id}
                                    className={`board-card board-card-clickable${isSelected ? " board-card-selected" : ""}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openDraft(draft.id);
                                    }}
                                  >
                                    <Stack gap="xs">
                                      <Group justify="space-between" align="flex-start">
                                        <Text fw={700} style={{ lineHeight: 1.35 }}>
                                          {draft.title_draft}
                                        </Text>
                                        <Badge variant="light" color="gray">
                                          {draft.wizard_status.replace(/_/g, " ")}
                                        </Badge>
                                      </Group>
                                      <Text size="sm" c="dimmed">
                                        {draft.description_draft}
                                      </Text>
                                      <Text className="board-card-meta">
                                        Repository: {repository?.name ?? "unassigned"}
                                      </Text>
                                      <Text className="board-card-meta">
                                        {draft.proposed_acceptance_criteria.length > 0
                                          ? `${draft.proposed_acceptance_criteria.length} acceptance criteria ready`
                                          : "Run refinement to generate acceptance criteria"}
                                      </Text>
                                    </Stack>
                                  </Box>
                                );
                              })
                            )
                          ) : groupedTickets[column].length === 0 ? (
                            <Box className="board-empty">{meta.empty}</Box>
                          ) : (
                            groupedTickets[column].map((ticket) => {
                              const ticketSession =
                                ticket.session_id !== null
                                  ? sessionById.get(ticket.session_id) ?? null
                                  : null;
                              const canStop =
                                ticket.status === "in_progress" &&
                                ticketSession !== null &&
                                isStoppableSessionStatus(ticketSession.status);
                              const isSelected =
                                ticket.session_id !== null && ticket.session_id === selectedSessionId;
                              const showDeleteError =
                                deleteTicketMutation.isError &&
                                deleteTicketMutation.variables?.ticketId === ticket.id;
                              const showStopError =
                                stopTicketMutation.isError &&
                                stopTicketMutation.variables?.ticketId === ticket.id;
                              const showMergeError =
                                mergeTicketMutation.isError &&
                                mergeTicketMutation.variables === ticket.id;
                              const showStartPlanError =
                                startTicketMutation.isError &&
                                startTicketMutation.variables?.ticketId === ticket.id &&
                                startTicketMutation.variables.planningEnabled;
                              const showStartNowError =
                                startTicketMutation.isError &&
                                startTicketMutation.variables?.ticketId === ticket.id &&
                                !startTicketMutation.variables.planningEnabled;

                                return (
                                  <Box
                                    key={ticket.id}
                                    className={`board-card${isSelected ? " board-card-selected" : ""}${ticket.session_id ? " board-card-clickable" : ""}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openTicketSession(ticket);
                                    }}
                                  >
                                    <Stack gap="xs">
                                      <Group justify="space-between" align="flex-start">
                                        <Stack gap={2}>
                                          <Text fw={700} style={{ lineHeight: 1.35 }}>
                                          #{ticket.id} {ticket.title}
                                        </Text>
                                        <Text className="board-card-meta">
                                            {ticket.ticket_type} • {ticket.target_branch}
                                          </Text>
                                        </Stack>
                                        <Group gap={6} align="center">
                                          <Badge variant="light" color={ticketStatusColor(ticket.status)}>
                                            {humanizeTicketStatus(ticket.status)}
                                          </Badge>
                                          {renderTicketMenu(ticket)}
                                        </Group>
                                      </Group>
                                    <Text size="sm" c="dimmed">
                                      {ticket.description}
                                    </Text>

                                    {showDeleteError ? (
                                      <Text size="sm" c="red">
                                        {deleteTicketMutation.error.message}
                                      </Text>
                                    ) : null}
                                    {showStopError ? (
                                      <Text size="sm" c="red">
                                        {stopTicketMutation.error?.message}
                                      </Text>
                                    ) : null}
                                    {showMergeError ? (
                                      <Text size="sm" c="red">
                                        {mergeTicketMutation.error.message}
                                      </Text>
                                    ) : null}
                                    {showStartPlanError || showStartNowError ? (
                                      <Text size="sm" c="red">
                                        {startTicketMutation.error.message}
                                      </Text>
                                    ) : null}

                                    {column === "ready" ? (
                                      <Group justify="flex-end" align="flex-end" gap="xs">
                                        <Group gap="xs">
                                          <Button
                                            variant="light"
                                            size="xs"
                                            loading={
                                              startTicketMutation.isPending &&
                                              startTicketMutation.variables?.ticketId === ticket.id &&
                                              startTicketMutation.variables.planningEnabled
                                            }
                                            onClick={() =>
                                              startTicketMutation.mutate({
                                                ticketId: ticket.id,
                                                planningEnabled: true
                                              })
                                            }
                                          >
                                            Start with Plan
                                          </Button>
                                          <Button
                                            size="xs"
                                            loading={
                                              startTicketMutation.isPending &&
                                              startTicketMutation.variables?.ticketId === ticket.id &&
                                              !startTicketMutation.variables.planningEnabled
                                            }
                                            onClick={() =>
                                              startTicketMutation.mutate({
                                                ticketId: ticket.id,
                                                planningEnabled: false
                                              })
                                            }
                                          >
                                            Start Now
                                          </Button>
                                        </Group>
                                      </Group>
                                    ) : column === "review" ? (
                                      <Group justify="flex-end" gap="xs">
                                        <Button
                                          size="xs"
                                          loading={
                                            mergeTicketMutation.isPending &&
                                            mergeTicketMutation.variables === ticket.id
                                          }
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            mergeTicketMutation.mutate(ticket.id);
                                          }}
                                        >
                                          Merge
                                        </Button>
                                      </Group>
                                    ) : ticket.session_id ? (
                                      <Group justify="flex-end" gap="xs">
                                        {canStop ? (
                                          <Button
                                            color="orange"
                                            variant="light"
                                            size="xs"
                                            loading={
                                              stopTicketMutation.isPending &&
                                              stopTicketMutation.variables?.ticketId === ticket.id
                                            }
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              stopTicketMutation.mutate({
                                                ticketId: ticket.id
                                              });
                                            }}
                                          >
                                            Stop
                                          </Button>
                                        ) : null}
                                      </Group>
                                    ) : (
                                      <></>
                                    )}
                                  </Stack>
                                </Box>
                              );
                            })
                          )}
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            )}
          </Stack>
        </Box>

        {inspectorVisible ? (
          <Box className="orchestrator-detail">
            <Stack gap="md">
              {inspectorState.kind === "new_draft" && selectedProject ? (
              <SectionCard
                title="New draft"
                description="Capture the next task quickly, then promote it straight from the draft column."
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
                    <Group justify="space-between" align="center">
                      <Text size="sm" c="dimmed">
                        Drafts stay on the board until they are refined and confirmed.
                      </Text>
                      <Button type="submit" loading={createDraftMutation.isPending}>
                        Save Draft
                      </Button>
                    </Group>
                  </Stack>
                </form>
              </SectionCard>
              ) : null}

              {inspectorState.kind === "draft" && selectedDraft ? (
              <SectionCard
                title="Draft inspector"
                description="Refine, promote, or delete the selected draft from the right-hand panel instead of from the board card."
              >
                <Stack gap="md">
                  <Group justify="space-between" align="flex-start">
                    <Stack gap={4}>
                      <Text className="rail-kicker">Draft</Text>
                      <Text fw={700}>{selectedDraft.title_draft}</Text>
                    </Stack>
                    <Badge variant="light" color="gray">
                      {selectedDraft.wizard_status.replace(/_/g, " ")}
                    </Badge>
                  </Group>

                  <Text size="sm" c="dimmed">
                    {selectedDraft.description_draft}
                  </Text>

                  <Box className="detail-meta-grid">
                    <Box className="detail-meta-card">
                      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                        Repository
                      </Text>
                      <Text fw={700}>{selectedDraftRepository?.name ?? "Unassigned"}</Text>
                    </Box>
                    <Box className="detail-meta-card">
                      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                        Acceptance criteria
                      </Text>
                      <Text fw={700}>{selectedDraft.proposed_acceptance_criteria.length}</Text>
                    </Box>
                  </Box>

                  {selectedDraft.proposed_acceptance_criteria.length > 0 ? (
                    <List size="sm" spacing={4}>
                      {selectedDraft.proposed_acceptance_criteria.map((criterion) => (
                        <List.Item key={criterion}>{criterion}</List.Item>
                      ))}
                    </List>
                  ) : (
                    <Text size="sm" c="dimmed">
                      Run refinement to generate acceptance criteria before promoting the draft.
                    </Text>
                  )}

                  {refineDraftMutation.isError &&
                  refineDraftMutation.variables === selectedDraft.id ? (
                    <Text size="sm" c="red">
                      {refineDraftMutation.error.message}
                    </Text>
                  ) : null}
                  {confirmDraftMutation.isError &&
                  confirmDraftMutation.variables?.draft.id === selectedDraft.id ? (
                    <Text size="sm" c="red">
                      {confirmDraftMutation.error.message}
                    </Text>
                  ) : null}
                  {deleteDraftMutation.isError &&
                  deleteDraftMutation.variables === selectedDraft.id ? (
                    <Text size="sm" c="red">
                      {deleteDraftMutation.error.message}
                    </Text>
                  ) : null}

                  <Group justify="space-between">
                    <Button
                      color="red"
                      variant="subtle"
                      loading={
                        deleteDraftMutation.isPending &&
                        deleteDraftMutation.variables === selectedDraft.id
                      }
                      onClick={() => deleteDraftMutation.mutate(selectedDraft.id)}
                    >
                      Delete Draft
                    </Button>
                    <Group gap="xs">
                      <Button
                        variant="light"
                        loading={
                          refineDraftMutation.isPending &&
                          refineDraftMutation.variables === selectedDraft.id
                        }
                        onClick={() => refineDraftMutation.mutate(selectedDraft.id)}
                      >
                        {selectedDraft.proposed_acceptance_criteria.length > 0
                          ? "Refine Again"
                          : "Run Refinement"}
                      </Button>
                      <Button
                        disabled={!selectedDraftRepository}
                        loading={
                          confirmDraftMutation.isPending &&
                          confirmDraftMutation.variables?.draft.id === selectedDraft.id
                        }
                        onClick={() =>
                          selectedDraftRepository &&
                          confirmDraftMutation.mutate({
                            draft: selectedDraft,
                            repository: selectedDraftRepository,
                            project: selectedProject!
                          })
                        }
                      >
                        Create Ready
                      </Button>
                    </Group>
                  </Group>
                </Stack>
              </SectionCard>
              ) : null}

              {inspectorState.kind === "session" ? (
              <SectionCard
                title="Session inspector"
                description="Execution detail, review actions, and manual terminal control all live here."
              >
                {selectedSessionId === null ? (
                  <Text size="sm" c="dimmed">
                    Session details are not available yet.
                  </Text>
                ) : sessionQuery.isPending || sessionLogsQuery.isPending ? (
                  <Loader size="sm" />
                ) : sessionQuery.isError ? (
                  <Text size="sm" c="red">
                    {sessionQuery.error.message}
                  </Text>
                ) : session ? (
                  <Stack gap="md">
                  <Group justify="space-between" align="flex-start">
                    <Stack gap={4}>
                      <Text className="rail-kicker">Execution</Text>
                      <Text fw={700}>
                        {selectedSessionTicket
                          ? `#${selectedSessionTicket.id} ${selectedSessionTicket.title}`
                          : `Ticket #${session.ticket_id}`}
                      </Text>
                    </Stack>
                    <Badge variant="light" color={sessionStatusColor(session.status)}>
                      {session.status}
                    </Badge>
                  </Group>

                  <Box className="detail-meta-grid">
                    <Box className="detail-meta-card">
                      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                        Session
                      </Text>
                      <Text fw={700}>{session.id}</Text>
                    </Box>
                    <Box className="detail-meta-card">
                      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                        Planning
                      </Text>
                      <Text fw={700}>{session.planning_enabled ? "Enabled" : "Disabled"}</Text>
                    </Box>
                    <Box className="detail-meta-card">
                      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                        Branch
                      </Text>
                      <Text fw={700}>{selectedSessionTicket?.working_branch ?? "Pending"}</Text>
                    </Box>
                    <Box className="detail-meta-card">
                      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                        Worktree
                      </Text>
                      <Text className="inline-code">{session.worktree_path ?? "Pending"}</Text>
                    </Box>
                  </Box>

                  {selectedSessionTicket ? (
                    <Group justify="space-between">
                      <Group gap="xs">
                        {selectedSessionTicket.status === "in_progress" &&
                        session.worktree_path &&
                        session.status !== "paused_user_control" ? (
                          <Button
                            variant="light"
                            size="xs"
                            loading={
                              terminalTakeoverMutation.isPending &&
                              terminalTakeoverMutation.variables === session.id
                            }
                            onClick={() => terminalTakeoverMutation.mutate(session.id)}
                          >
                            Take Over Terminal
                          </Button>
                        ) : null}
                        {selectedSessionTicket.status === "in_progress" &&
                        selectedSessionTicketSession &&
                        isStoppableSessionStatus(selectedSessionTicketSession.status) ? (
                          <Button
                            color="orange"
                            variant="light"
                            size="xs"
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
                        ) : null}
                      </Group>
                      <Button
                        color="red"
                        variant="subtle"
                        size="xs"
                        loading={
                          deleteTicketMutation.isPending &&
                          deleteTicketMutation.variables?.ticketId === selectedSessionTicket.id
                        }
                        onClick={() => deleteTicket(selectedSessionTicket)}
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
                  {terminalTakeoverMutation.isError ? (
                    <Text size="sm" c="red">
                      {terminalTakeoverMutation.error.message}
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
                      <Stack gap="sm">
                        <Text fw={700}>Review package</Text>
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

                  <SessionActivityFeed logs={sessionLogs} session={session} />

                  {session.worktree_path ? (
                    <SessionTerminalPanel
                      session={session}
                      logs={sessionLogs}
                      command={terminalCommand}
                      onCommandChange={setTerminalCommand}
                      onSendCommand={() => {
                        if (!selectedSessionId) {
                          return;
                        }

                        terminalInputMutation.mutate({
                          sessionId: selectedSessionId,
                          body: terminalCommand
                        });
                      }}
                      onRestoreAgent={() => terminalRestoreMutation.mutate(session.id)}
                      sendLoading={terminalInputMutation.isPending}
                      restoreLoading={terminalRestoreMutation.isPending}
                      error={
                        terminalInputMutation.isError
                          ? terminalInputMutation.error.message
                          : terminalRestoreMutation.isError
                            ? terminalRestoreMutation.error.message
                            : null
                      }
                    />
                  ) : null}

                  {selectedSessionTicket &&
                  ["awaiting_input", "failed", "interrupted", "paused_checkpoint"].includes(
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
                          <Button type="submit" loading={resumeTicketMutation.isPending}>
                            Resume Execution
                          </Button>
                        </Group>
                      </Stack>
                    </form>
                  ) : (
                    <Text size="sm" c="dimmed">
                      Use this panel when a session is waiting on you, or take over the project
                      terminal above when direct control inside the worktree is faster than more
                      prompting.
                    </Text>
                  )}
                </Stack>
                ) : (
                  <Text size="sm" c="dimmed">
                    Session details are not available yet.
                  </Text>
                )}
              </SectionCard>
              ) : null}
            </Stack>
          </Box>
        ) : null}
      </Box>

      <Modal
        opened={projectModalOpen}
        onClose={() => setProjectModalOpen(false)}
        title="Create project"
        centered
        size="lg"
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
            <Text size="sm" c="dimmed">
              One repository per project is still the intended MVP shape.
            </Text>
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
              label="Target branch"
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
                Slug: <Code>{slugify(projectName || "project-name")}</Code>
              </Text>
              <Button type="submit" loading={createProjectMutation.isPending}>
                Add Project
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Box>
  );
}
