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
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
  useMantineColorScheme,
} from "@mantine/core";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { type ClipboardEvent, useEffect, useState } from "react";
import type {
  CommandAck,
  DraftTicketState,
  ExecutionSession,
  Project,
  ProtocolEvent,
  ReasoningEffort,
  RepositoryConfig,
  ReviewPackage,
  StructuredEvent,
  TicketFrontmatter,
  UploadDraftArtifactResponse,
} from "../../../packages/contracts/src/index.js";

import "./app-shell.css";
import { MarkdownContent } from "./components/MarkdownContent.js";
import { SectionCard } from "./components/SectionCard.js";
import { SessionActivityFeed } from "./components/SessionActivityFeed.js";
import { SessionTerminalPanel } from "./components/SessionTerminalPanel.js";
import {
  type PendingDraftEditorSync,
  emptyDraftEditorFields,
  resolveDraftEditorSync,
} from "./lib/draft-editor-sync.js";
import { getBoardTicketDescriptionPreview } from "./lib/ticket-description-preview.js";

const apiBaseUrl = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:4000";
const websocketUrl = `${apiBaseUrl.replace(/^http/, "ws")}/ws`;
const boardColumns = [
  "draft",
  "ready",
  "in_progress",
  "review",
  "done",
] satisfies TicketFrontmatter["status"][];
const stoppableSessionStatuses = [
  "queued",
  "running",
  "paused_checkpoint",
  "paused_user_control",
  "awaiting_input",
] satisfies ExecutionSession["status"][];
const boardColumnMeta: Record<
  (typeof boardColumns)[number],
  { label: string; accent: string; empty: string }
> = {
  draft: {
    label: "Draft",
    accent: "#6b7280",
    empty: "No draft tickets yet. Use New Draft to capture the next task.",
  },
  ready: {
    label: "Ready",
    accent: "#2563eb",
    empty: "No ready tickets waiting to start.",
  },
  in_progress: {
    label: "In progress",
    accent: "#d97706",
    empty: "No tickets are currently in progress.",
  },
  review: {
    label: "In review",
    accent: "#7c3aed",
    empty: "Nothing is waiting for review right now.",
  },
  done: {
    label: "Done",
    accent: "#16a34a",
    empty: "Nothing has been merged yet.",
  },
};

const projectModelPresetValues = [
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
] as const;
const projectModelPresetOptions = [
  { value: "default", label: "Default" },
  ...projectModelPresetValues.map((value) => ({ value, label: value })),
  { value: "custom", label: "Custom" },
];
const reasoningEffortOptions = [
  { value: "default", label: "Default" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
];

type ProjectModelPreset =
  | "default"
  | (typeof projectModelPresetValues)[number]
  | "custom";
type ProjectReasoningEffortSelection = "default" | ReasoningEffort;

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

type DraftEventsResponse = {
  events: StructuredEvent[];
  active_run: boolean;
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

type NewDraftAction = "save" | "refine" | "questions" | "confirm";
type DraftEventOperation = "refine" | "questions";
type DraftEventStatus = "started" | "completed" | "failed" | "reverted";
type DraftQuestionsResult = {
  verdict: string;
  summary: string;
  assumptions: string[];
  open_questions: string[];
  risks: string[];
  suggested_draft_edits: string[];
};

type InspectorState =
  | { kind: "hidden" }
  | { kind: "new_draft" }
  | { kind: "draft"; draftId: string }
  | { kind: "session"; sessionId: string };

function isStoppableSessionStatus(
  status: ExecutionSession["status"],
): status is (typeof stoppableSessionStatuses)[number] {
  return stoppableSessionStatuses.includes(
    status as (typeof stoppableSessionStatuses)[number],
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
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`);
  } catch {
    throw new Error("Backend unavailable. Restart the backend and try again.");
  }

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;

    try {
      const body = (await response.json()) as {
        error?: string;
        message?: string;
      };
      if (body.message || body.error) {
        message = body.message ?? body.error ?? message;
      }
    } catch {
      // Keep the default message when the response is not JSON.
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Backend unavailable. Restart the backend and try again.");
  }

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;

    try {
      const payload = (await response.json()) as {
        error?: string;
        message?: string;
      };
      message = payload.message ?? payload.error ?? message;
    } catch {
      // Keep the default message when the response is not JSON.
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Backend unavailable. Restart the backend and try again.");
  }

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;

    try {
      const payload = (await response.json()) as {
        error?: string;
        message?: string;
      };
      message = payload.message ?? payload.error ?? message;
    } catch {
      // Keep the default message when the response is not JSON.
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

async function blobToBase64(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Unable to read pasted image"));
        return;
      }

      const [, base64 = ""] = reader.result.split(",", 2);
      resolve(base64);
    };
    reader.onerror = () => {
      reject(new Error("Unable to read pasted image"));
    };

    reader.readAsDataURL(blob);
  });
}

function insertTextAtSelection(
  value: string,
  insertion: string,
  selectionStart: number,
  selectionEnd: number,
): string {
  return value.slice(0, selectionStart) + insertion + value.slice(selectionEnd);
}

function buildMarkdownImageInsertion(
  value: string,
  markdownImage: string,
  selectionStart: number,
  selectionEnd: number,
): { cursorOffset: number; value: string } {
  const prefix =
    selectionStart > 0 && !value.slice(0, selectionStart).endsWith("\n")
      ? "\n\n"
      : "";
  const suffix =
    selectionEnd < value.length && !value.slice(selectionEnd).startsWith("\n")
      ? "\n\n"
      : "";

  const insertion = `${prefix}${markdownImage}${suffix}`;

  return {
    cursorOffset: selectionStart + insertion.length,
    value: insertTextAtSelection(
      value,
      insertion,
      selectionStart,
      selectionEnd,
    ),
  };
}

async function uploadDraftArtifactRequest(input: {
  projectId: string;
  artifactScopeId: string | null;
  mimeType: string;
  dataBase64: string;
}): Promise<UploadDraftArtifactResponse> {
  return await postJson<UploadDraftArtifactResponse>(
    `/projects/${input.projectId}/draft-artifacts`,
    {
      artifact_scope_id: input.artifactScopeId ?? undefined,
      mime_type: input.mimeType,
      data_base64: input.dataBase64,
    },
  );
}

function isRouteNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message === "Not Found" ||
    error.message.includes("Route POST:") ||
    error.message.includes("Route PATCH:")
  );
}

async function saveProjectOptionsRequest(
  projectId: string,
  body: {
    pre_worktree_command: string | null;
    post_worktree_command: string | null;
    draft_analysis_model: string | null;
    draft_analysis_reasoning_effort: ReasoningEffort | null;
    ticket_work_model: string | null;
    ticket_work_reasoning_effort: ReasoningEffort | null;
  },
): Promise<CommandAck> {
  try {
    return await postJson<CommandAck>(`/projects/${projectId}/update`, body);
  } catch (error) {
    if (!isRouteNotFoundError(error)) {
      throw error;
    }
  }

  try {
    return await patchJson<CommandAck>(`/projects/${projectId}`, body);
  } catch (error) {
    if (isRouteNotFoundError(error)) {
      throw new Error(
        "Project options save endpoint is unavailable. Restart the backend and try again.",
      );
    }

    throw error;
  }
}

function humanizeTicketStatus(status: TicketFrontmatter["status"]): string {
  switch (status) {
    case "in_progress":
      return "In Progress";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

function upsertById<T extends { id: string | number }>(
  items: T[],
  nextItem: T,
): T[] {
  const existingIndex = items.findIndex((item) => item.id === nextItem.id);
  if (existingIndex === -1) {
    return [nextItem, ...items];
  }

  return items.map((item, index) =>
    index === existingIndex ? nextItem : item,
  );
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

function humanizeSessionStatus(status: ExecutionSession["status"]): string {
  switch (status) {
    case "paused_checkpoint":
      return "Awaiting plan feedback";
    case "paused_user_control":
      return "Manual control";
    case "awaiting_input":
      return "Preparing";
    default: {
      const normalized = status.replace(/_/g, " ");
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }
  }
}

function humanizePlanStatus(status: ExecutionSession["plan_status"]): string {
  const normalized = status.replace(/_/g, " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function resolveProjectModelPreset(
  model: Project["draft_analysis_model"],
): ProjectModelPreset {
  if (model === null) {
    return "default";
  }

  return projectModelPresetValues.includes(
    model as (typeof projectModelPresetValues)[number],
  )
    ? (model as (typeof projectModelPresetValues)[number])
    : "custom";
}

function resolveProjectCustomModelValue(
  model: Project["draft_analysis_model"],
): string {
  return resolveProjectModelPreset(model) === "custom" ? (model ?? "") : "";
}

function resolveProjectModelValue(
  preset: ProjectModelPreset,
  customValue: string,
): string | null {
  if (preset === "default") {
    return null;
  }

  if (preset === "custom") {
    const trimmed = customValue.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return preset;
}

function resolveProjectReasoningEffortSelection(
  effort: Project["draft_analysis_reasoning_effort"],
): ProjectReasoningEffortSelection {
  return effort ?? "default";
}

function resolveProjectReasoningEffortValue(
  selection: ProjectReasoningEffortSelection,
): ReasoningEffort | null {
  return selection === "default" ? null : selection;
}

function resolveOptionalProjectCommandValue(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function parseDraftEventRunId(event: StructuredEvent): string | null {
  return typeof event.payload.run_id === "string" ? event.payload.run_id : null;
}

function parseDraftEventRevertedRunId(event: StructuredEvent): string | null {
  return typeof event.payload.reverted_run_id === "string"
    ? event.payload.reverted_run_id
    : null;
}

function findLatestRevertableRefineEvent(
  events: StructuredEvent[],
): StructuredEvent | null {
  const latestCompletedRefine =
    events.find((event) => event.event_type === "draft.refine.completed") ??
    null;
  if (!latestCompletedRefine) {
    return null;
  }

  const runId = parseDraftEventRunId(latestCompletedRefine);
  if (!runId || !isRecord(latestCompletedRefine.payload.before_draft)) {
    return null;
  }

  const alreadyReverted = events.some(
    (event) =>
      event.event_type === "draft.refine.reverted" &&
      parseDraftEventRevertedRunId(event) === runId,
  );
  return alreadyReverted ? null : latestCompletedRefine;
}

function parseDraftEventMeta(event: StructuredEvent): {
  operation: DraftEventOperation;
  status: DraftEventStatus;
  summary: string;
  error: string | null;
  result: Record<string, unknown> | null;
} | null {
  const [entity, operation, status] = event.event_type.split(".");
  if (
    entity !== "draft" ||
    (operation !== "refine" && operation !== "questions") ||
    (status !== "started" &&
      status !== "completed" &&
      status !== "failed" &&
      status !== "reverted")
  ) {
    return null;
  }

  const result = isRecord(event.payload.result) ? event.payload.result : null;
  return {
    operation,
    status,
    summary:
      typeof event.payload.summary === "string"
        ? event.payload.summary
        : status === "started"
          ? "Codex run started."
          : status === "failed"
            ? "Codex run failed."
            : status === "reverted"
              ? "Codex run reverted."
              : "Codex run completed.",
    error: typeof event.payload.error === "string" ? event.payload.error : null,
    result,
  };
}

function parseDraftQuestionsResult(
  value: unknown,
): DraftQuestionsResult | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.verdict !== "string" || typeof value.summary !== "string") {
    return null;
  }

  return {
    verdict: value.verdict,
    summary: value.summary,
    assumptions: parseStringList(value.assumptions),
    open_questions: parseStringList(value.open_questions),
    risks: parseStringList(value.risks),
    suggested_draft_edits: parseStringList(value.suggested_draft_edits),
  };
}

function parseDraftRefinementResult(value: unknown): {
  title_draft: string;
  description_draft: string;
  proposed_ticket_type: DraftTicketState["proposed_ticket_type"];
  proposed_acceptance_criteria: string[];
  split_proposal_summary: string | null;
} | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.title_draft !== "string" ||
    typeof value.description_draft !== "string"
  ) {
    return null;
  }

  return {
    title_draft: value.title_draft,
    description_draft: value.description_draft,
    proposed_ticket_type:
      value.proposed_ticket_type === "feature" ||
      value.proposed_ticket_type === "bugfix" ||
      value.proposed_ticket_type === "chore" ||
      value.proposed_ticket_type === "research"
        ? value.proposed_ticket_type
        : null,
    proposed_acceptance_criteria: parseStringList(
      value.proposed_acceptance_criteria,
    ),
    split_proposal_summary:
      typeof value.split_proposal_summary === "string"
        ? value.split_proposal_summary
        : value.split_proposal_summary === null
          ? null
          : null,
  };
}

function MarkdownListItems({ items }: { items: string[] }) {
  return (
    <List size="sm" spacing={4}>
      {items.map((item, index) => (
        <List.Item key={`${index}-${item.slice(0, 32)}`}>
          <MarkdownContent content={item} />
        </List.Item>
      ))}
    </List>
  );
}

function DraftQuestionsResultView({
  result,
}: {
  result: DraftQuestionsResult;
}) {
  return (
    <Stack gap="xs">
      <Group justify="space-between" align="center">
        <Text fw={700}>Feasibility</Text>
        <Badge variant="light" color="blue">
          {result.verdict}
        </Badge>
      </Group>
      <MarkdownContent
        className="markdown-muted markdown-small"
        content={result.summary}
      />
      {result.assumptions.length > 0 ? (
        <MarkdownListItems items={result.assumptions} />
      ) : null}
      {result.open_questions.length > 0 ? (
        <MarkdownListItems items={result.open_questions} />
      ) : null}
      {result.risks.length > 0 ? (
        <MarkdownListItems items={result.risks} />
      ) : null}
      {result.suggested_draft_edits.length > 0 ? (
        <MarkdownListItems items={result.suggested_draft_edits} />
      ) : null}
    </Stack>
  );
}

function DraftEventResultView({
  result,
}: {
  result: Record<string, unknown>;
}) {
  const questionsResult = parseDraftQuestionsResult(result);
  if (questionsResult) {
    return <DraftQuestionsResultView result={questionsResult} />;
  }

  const refinementResult = parseDraftRefinementResult(result);
  if (refinementResult) {
    return (
      <Stack gap="xs">
        <Stack gap={2}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
            Title
          </Text>
          <MarkdownContent content={refinementResult.title_draft} inline />
        </Stack>
        <Stack gap={2}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
            Description
          </Text>
          <MarkdownContent
            className="markdown-muted markdown-small"
            content={refinementResult.description_draft}
          />
        </Stack>
        {refinementResult.split_proposal_summary ? (
          <Stack gap={2}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Split Proposal
            </Text>
            <MarkdownContent
              className="markdown-muted markdown-small"
              content={refinementResult.split_proposal_summary}
            />
          </Stack>
        ) : null}
        {refinementResult.proposed_acceptance_criteria.length > 0 ? (
          <Stack gap={2}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Acceptance Criteria
            </Text>
            <MarkdownListItems
              items={refinementResult.proposed_acceptance_criteria}
            />
          </Stack>
        ) : null}
      </Stack>
    );
  }

  return (
    <Box
      component="pre"
      className="detail-placeholder"
      style={{
        margin: 0,
        whiteSpace: "pre-wrap",
      }}
    >
      {JSON.stringify(result, null, 2)}
    </Box>
  );
}

function draftMatchesSearch(draft: DraftTicketState, needle: string): boolean {
  if (needle.length === 0) {
    return true;
  }

  return [
    draft.title_draft,
    draft.description_draft,
    draft.proposed_ticket_type ?? "",
    ...draft.proposed_acceptance_criteria,
  ]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function ticketMatchesSearch(
  ticket: TicketFrontmatter,
  needle: string,
): boolean {
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
    ...ticket.acceptance_criteria,
  ]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function focusElementById(id: string): void {
  const element = document.getElementById(id) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null;
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
        { label: "Dark", value: "dark" },
      ]}
    />
  );
}

export function App() {
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [inspectorState, setInspectorState] = useState<InspectorState>({
    kind: "hidden",
  });
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectOptionsProjectId, setProjectOptionsProjectId] = useState<
    string | null
  >(null);
  const [projectOptionsDraftModelPreset, setProjectOptionsDraftModelPreset] =
    useState<ProjectModelPreset>("default");
  const [projectOptionsDraftModelCustom, setProjectOptionsDraftModelCustom] =
    useState("");
  const [
    projectOptionsDraftReasoningEffort,
    setProjectOptionsDraftReasoningEffort,
  ] = useState<ProjectReasoningEffortSelection>("default");
  const [projectOptionsTicketModelPreset, setProjectOptionsTicketModelPreset] =
    useState<ProjectModelPreset>("default");
  const [projectOptionsTicketModelCustom, setProjectOptionsTicketModelCustom] =
    useState("");
  const [
    projectOptionsTicketReasoningEffort,
    setProjectOptionsTicketReasoningEffort,
  ] = useState<ProjectReasoningEffortSelection>("default");
  const [
    projectOptionsPreWorktreeCommand,
    setProjectOptionsPreWorktreeCommand,
  ] = useState("");
  const [
    projectOptionsPostWorktreeCommand,
    setProjectOptionsPostWorktreeCommand,
  ] = useState("");
  const [projectOptionsFormError, setProjectOptionsFormError] = useState<
    string | null
  >(null);
  const [projectDeleteConfirmText, setProjectDeleteConfirmText] = useState("");
  const [projectName, setProjectName] = useState("");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [validationCommandsText, setValidationCommandsText] = useState("");
  const [draftEditorProjectId, setDraftEditorProjectId] = useState<
    string | null
  >(null);
  const [draftEditorSourceId, setDraftEditorSourceId] = useState<string | null>(
    null,
  );
  const [draftEditorArtifactScopeId, setDraftEditorArtifactScopeId] = useState<
    string | null
  >(null);
  const [draftEditorTitle, setDraftEditorTitle] = useState("");
  const [draftEditorDescription, setDraftEditorDescription] = useState("");
  const [draftEditorTicketType, setDraftEditorTicketType] =
    useState<DraftTicketState["proposed_ticket_type"]>(null);
  const [draftEditorAcceptanceCriteria, setDraftEditorAcceptanceCriteria] =
    useState("");
  const [draftEditorUploadError, setDraftEditorUploadError] = useState<
    string | null
  >(null);
  const [pendingDraftEditorSync, setPendingDraftEditorSync] =
    useState<PendingDraftEditorSync | null>(null);
  const [pendingNewDraftAction, setPendingNewDraftAction] =
    useState<NewDraftAction | null>(null);
  const [requestedChangesBody, setRequestedChangesBody] = useState("");
  const [planFeedbackBody, setPlanFeedbackBody] = useState("");
  const [resumeReason, setResumeReason] = useState("");
  const [terminalCommand, setTerminalCommand] = useState("");
  const [boardSearch, setBoardSearch] = useState("");
  const selectedDraftId =
    inspectorState.kind === "draft" ? inspectorState.draftId : null;
  const selectedSessionId =
    inspectorState.kind === "session" ? inspectorState.sessionId : null;
  const inspectorVisible = inspectorState.kind !== "hidden";

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

  const repositoriesQuery = useQuery({
    queryKey: ["projects", selectedProjectId, "repositories"],
    queryFn: () =>
      fetchJson<RepositoriesResponse>(
        `/projects/${selectedProjectId}/repositories`,
      ),
    enabled: selectedProjectId !== null,
  });

  const draftEditorRepositoriesQuery = useQuery({
    queryKey: [
      "projects",
      draftEditorProjectId,
      "repositories",
      "draft-editor",
    ],
    queryFn: () =>
      fetchJson<RepositoriesResponse>(
        `/projects/${draftEditorProjectId}/repositories`,
      ),
    enabled:
      draftEditorProjectId !== null &&
      draftEditorProjectId !== selectedProjectId,
  });

  const draftsQuery = useQuery({
    queryKey: ["projects", selectedProjectId, "drafts"],
    queryFn: () =>
      fetchJson<DraftsResponse>(`/projects/${selectedProjectId}/drafts`),
    enabled: selectedProjectId !== null,
    refetchInterval: selectedProjectId === null ? false : 2_000,
  });

  const ticketsQuery = useQuery({
    queryKey: ["projects", selectedProjectId, "tickets"],
    queryFn: () =>
      fetchJson<TicketsResponse>(`/projects/${selectedProjectId}/tickets`),
    enabled: selectedProjectId !== null,
    refetchInterval: selectedProjectId === null ? false : 2_000,
  });

  const draftEventsQuery = useQuery({
    queryKey: ["drafts", selectedDraftId, "events"],
    queryFn: () =>
      fetchJson<DraftEventsResponse>(`/drafts/${selectedDraftId}/events`),
    enabled: selectedDraftId !== null,
    refetchInterval: selectedDraftId === null ? false : 2_000,
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

  useEffect(() => {
    const firstProjectId = projectsQuery.data?.projects[0]?.id ?? null;
    if (selectedProjectId === null) {
      setSelectedProjectId(firstProjectId);
      return;
    }

    const stillExists = projectsQuery.data?.projects.some(
      (project) => project.id === selectedProjectId,
    );
    if (!stillExists) {
      setSelectedProjectId(firstProjectId);
    }
  }, [projectsQuery.data?.projects, selectedProjectId]);

  useEffect(() => {
    if (projectOptionsProjectId === null) {
      return;
    }

    const stillExists =
      projectsQuery.data?.projects.some(
        (project) => project.id === projectOptionsProjectId,
      ) ?? false;
    if (!stillExists) {
      setProjectOptionsProjectId(null);
      setProjectOptionsFormError(null);
      setProjectDeleteConfirmText("");
    }
  }, [projectOptionsProjectId, projectsQuery.data?.projects]);

  useEffect(() => {
    if (inspectorState.kind === "draft") {
      const stillExists =
        draftsQuery.data?.drafts.some(
          (draft) => draft.id === inspectorState.draftId,
        ) ?? false;
      if (!stillExists) {
        setInspectorState({ kind: "hidden" });
      }
      return;
    }

    if (inspectorState.kind === "session") {
      const stillExists =
        ticketsQuery.data?.tickets.some(
          (ticket) => ticket.session_id === inspectorState.sessionId,
        ) ?? false;
      if (!stillExists) {
        setInspectorState({ kind: "hidden" });
      }
      return;
    }

    if (inspectorState.kind === "new_draft" && selectedProjectId === null) {
      setInspectorState({ kind: "hidden" });
    }
  }, [
    draftsQuery.data?.drafts,
    inspectorState,
    selectedProjectId,
    ticketsQuery.data?.tickets,
  ]);

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
            drafts: upsertById(previous?.drafts ?? [], draft),
          }),
        );
        return;
      }

      if (event.event_type === "draft.ready") {
        const draftId = event.payload.draft_id as string | undefined;
        if (!draftId || selectedProjectId === null) {
          return;
        }

        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "drafts"],
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
        if (ticket.session_id) {
          queryClient.invalidateQueries({
            queryKey: ["sessions", ticket.session_id],
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
        return;
      }

      if (event.event_type === "ticket.archived") {
        const ticketId = event.payload.ticket_id as number | undefined;
        const projectId = event.payload.project_id as string | undefined;
        const archivedSessionId = event.payload.session_id as
          | string
          | undefined;

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

        if (archivedSessionId && selectedSessionId === archivedSessionId) {
          setInspectorState({ kind: "hidden" });
        }
        return;
      }

      if (event.event_type === "session.updated") {
        const session = event.payload.session as ExecutionSession | undefined;
        if (!session) {
          return;
        }

        queryClient.setQueryData<SessionResponse>(["sessions", session.id], {
          session,
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
        if (!structuredEvent || structuredEvent.entity_type !== "draft") {
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
    refetchInterval: selectedSessionId === null ? false : 2_000,
  });

  const sessionLogsQuery = useQuery({
    queryKey: ["sessions", selectedSessionId, "logs"],
    queryFn: () =>
      fetchJson<SessionLogsResponse>(`/sessions/${selectedSessionId}/logs`),
    enabled: selectedSessionId !== null,
    refetchInterval: selectedSessionId === null ? false : 2_000,
  });

  const selectedSessionTicketId =
    ticketsQuery.data?.tickets.find(
      (ticket) => ticket.session_id === selectedSessionId,
    )?.id ?? null;
  const selectedSessionTicketStatus =
    ticketsQuery.data?.tickets.find(
      (ticket) => ticket.session_id === selectedSessionId,
    )?.status ?? null;
  const projectOptionsProject =
    projectsQuery.data?.projects.find(
      (project) => project.id === projectOptionsProjectId,
    ) ?? null;

  const reviewPackageQuery = useQuery({
    queryKey: ["tickets", selectedSessionTicketId, "review-package"],
    queryFn: () =>
      fetchJson<ReviewPackageResponse>(
        `/tickets/${selectedSessionTicketId}/review-package`,
      ),
    enabled:
      selectedSessionTicketId !== null &&
      selectedSessionTicketStatus === "review",
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
          validation_commands: input.validationCommands,
        },
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
    },
  });

  const updateProjectMutation = useMutation({
    mutationFn: (input: {
      projectId: string;
      preWorktreeCommand: string | null;
      postWorktreeCommand: string | null;
      draftAnalysisModel: string | null;
      draftAnalysisReasoningEffort: ReasoningEffort | null;
      ticketWorkModel: string | null;
      ticketWorkReasoningEffort: ReasoningEffort | null;
    }) =>
      saveProjectOptionsRequest(input.projectId, {
        pre_worktree_command: input.preWorktreeCommand,
        post_worktree_command: input.postWorktreeCommand,
        draft_analysis_model: input.draftAnalysisModel,
        draft_analysis_reasoning_effort: input.draftAnalysisReasoningEffort,
        ticket_work_model: input.ticketWorkModel,
        ticket_work_reasoning_effort: input.ticketWorkReasoningEffort,
      }),
    onSuccess: async () => {
      setProjectOptionsFormError(null);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: (projectId: string) =>
      postJson<CommandAck>(`/projects/${projectId}/delete`, {}),
    onSuccess: async (_, projectId) => {
      const remainingProjects =
        queryClient
          .getQueryData<ProjectsResponse>(["projects"])
          ?.projects.filter((project) => project.id !== projectId) ?? [];

      queryClient.setQueryData<ProjectsResponse>(["projects"], {
        projects: remainingProjects,
      });
      queryClient.removeQueries({
        queryKey: ["projects", projectId, "repositories"],
      });
      queryClient.removeQueries({
        queryKey: ["projects", projectId, "drafts"],
      });
      queryClient.removeQueries({
        queryKey: ["projects", projectId, "tickets"],
      });

      setProjectOptionsProjectId(null);
      setProjectOptionsFormError(null);
      setProjectDeleteConfirmText("");

      if (selectedProjectId === projectId) {
        setSelectedProjectId(remainingProjects[0]?.id ?? null);
        setInspectorState({ kind: "hidden" });
      }

      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const createDraftMutation = useMutation({
    mutationFn: (input: {
      projectId: string;
      artifactScopeId: string | null;
      title: string;
      description: string;
      proposedTicketType: string | null;
      proposedAcceptanceCriteria: string[];
    }) =>
      postJson<CommandAck>("/drafts", {
        project_id: input.projectId,
        artifact_scope_id: input.artifactScopeId ?? undefined,
        title: input.title,
        description: input.description,
        proposed_ticket_type: input.proposedTicketType,
        proposed_acceptance_criteria: input.proposedAcceptanceCriteria,
      }),
    onSuccess: async (ack, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ["projects", variables.projectId, "drafts"],
      });

      const draftId = ack.resource_refs.draft_id;
      if (draftId) {
        setInspectorState({ kind: "draft", draftId });
      }
    },
  });

  const uploadDraftArtifactMutation = useMutation({
    mutationFn: uploadDraftArtifactRequest,
  });

  const saveDraftMutation = useMutation({
    mutationFn: (input: {
      draftId: string;
      titleDraft: string;
      descriptionDraft: string;
      proposedTicketType: string | null;
      proposedAcceptanceCriteria: string[];
    }) =>
      patchJson<CommandAck>(`/drafts/${input.draftId}`, {
        title_draft: input.titleDraft,
        description_draft: input.descriptionDraft,
        proposed_ticket_type: input.proposedTicketType,
        proposed_acceptance_criteria: input.proposedAcceptanceCriteria,
      }),
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "drafts"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["drafts", variables.draftId, "events"],
        }),
      ]);
    },
  });

  const refineDraftMutation = useMutation({
    mutationFn: (draftId: string) =>
      postJson<CommandAck>(`/drafts/${draftId}/refine`, {}),
    onError: (_, draftId) => {
      if (pendingDraftEditorSync?.draftId === draftId) {
        setPendingDraftEditorSync(null);
      }
    },
    onSuccess: async (_, draftId) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "drafts"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["drafts", draftId, "events"],
        }),
      ]);
    },
  });

  const revertDraftRefineMutation = useMutation({
    mutationFn: (draftId: string) =>
      postJson<CommandAck>(`/drafts/${draftId}/refine/revert`, {}),
    onError: (_, draftId) => {
      if (pendingDraftEditorSync?.draftId === draftId) {
        setPendingDraftEditorSync(null);
      }
    },
    onSuccess: async (_, draftId) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "drafts"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["drafts", draftId, "events"],
        }),
      ]);
    },
  });

  const questionDraftMutation = useMutation({
    mutationFn: (draftId: string) =>
      postJson<CommandAck>(`/drafts/${draftId}/questions`, {}),
    onSuccess: async (_, draftId) => {
      await queryClient.invalidateQueries({
        queryKey: ["drafts", draftId, "events"],
      });
    },
  });

  const confirmDraftMutation = useMutation({
    mutationFn: (input: {
      draftId: string;
      title: string;
      description: string;
      ticketType: string | null;
      acceptanceCriteria: string[];
      repository: RepositoryConfig;
      project: Project;
    }) =>
      postJson<CommandAck>(`/drafts/${input.draftId}/confirm`, {
        title: input.title,
        description: input.description,
        repo_id: input.repository.id,
        ticket_type: input.ticketType ?? "feature",
        acceptance_criteria:
          input.acceptanceCriteria.length > 0
            ? input.acceptanceCriteria
            : [`Implement ${input.title}.`],
        target_branch:
          input.repository.target_branch ??
          input.project.default_target_branch ??
          "main",
      }),
    onSuccess: async () => {
      if (!selectedProjectId) {
        return;
      }

      setInspectorState({ kind: "hidden" });

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "drafts"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"],
        }),
      ]);
    },
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
          queryKey: ["projects", selectedProjectId, "drafts"],
        });
      }
    },
  });

  const startTicketMutation = useMutation({
    mutationFn: (input: { ticketId: number; planningEnabled: boolean }) =>
      postJson<CommandAck>(`/tickets/${input.ticketId}/start`, {
        planning_enabled: input.planningEnabled,
      }),
    onSuccess: async (ack) => {
      if (!selectedProjectId) {
        return;
      }

      if (ack.resource_refs.session_id) {
        setInspectorState({
          kind: "session",
          sessionId: ack.resource_refs.session_id,
        });
      } else {
        setInspectorState({ kind: "hidden" });
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "drafts"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", ack.resource_refs.session_id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", ack.resource_refs.session_id, "logs"],
        }),
      ]);
    },
  });

  const stopTicketMutation = useMutation({
    mutationFn: (input: { ticketId: number; reason?: string }) =>
      postJson<CommandAck>(`/tickets/${input.ticketId}/stop`, {
        reason:
          input.reason && input.reason.trim().length > 0
            ? input.reason
            : undefined,
      }),
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["tickets", variables.ticketId, "review-package"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId, "logs"],
        }),
      ]);
    },
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
          queryKey: ["projects", selectedProjectId, "tickets"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "drafts"],
        }),
      ]);
    },
  });

  const archiveTicketMutation = useMutation({
    mutationFn: (input: { ticketId: number; sessionId?: string | null }) =>
      postJson<CommandAck>(`/tickets/${input.ticketId}/archive`, {}),
    onSuccess: async (_, variables) => {
      if (variables.sessionId && selectedSessionId === variables.sessionId) {
        setInspectorState({ kind: "hidden" });
      }

      queryClient.setQueryData<TicketsResponse>(
        ["projects", selectedProjectId, "tickets"],
        (previous) => ({
          tickets: (previous?.tickets ?? []).filter(
            (ticket) => ticket.id !== variables.ticketId,
          ),
        }),
      );

      await queryClient.invalidateQueries({
        queryKey: ["projects", selectedProjectId, "tickets"],
      });
    },
  });

  const sessionInputMutation = useMutation({
    mutationFn: (input: { sessionId: string; body: string }) =>
      postJson<CommandAck>(`/sessions/${input.sessionId}/input`, {
        body: input.body,
      }),
    onSuccess: async (_, variables) => {
      setResumeReason("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["sessions", variables.sessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", variables.sessionId, "logs"],
        }),
      ]);
    },
  });

  const terminalInputMutation = useMutation({
    mutationFn: (input: { sessionId: string; body: string }) =>
      postJson<CommandAck>(`/sessions/${input.sessionId}/input`, {
        body: input.body,
      }),
    onSuccess: async (_, variables) => {
      setTerminalCommand("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["sessions", variables.sessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", variables.sessionId, "logs"],
        }),
      ]);
    },
  });

  const terminalTakeoverMutation = useMutation({
    mutationFn: (sessionId: string) =>
      postJson<CommandAck>(`/sessions/${sessionId}/terminal/takeover`, {}),
    onSuccess: async (_, sessionId) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["sessions", sessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", sessionId, "logs"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"],
        }),
      ]);
    },
  });

  const terminalRestoreMutation = useMutation({
    mutationFn: (sessionId: string) =>
      postJson<CommandAck>(`/sessions/${sessionId}/terminal/restore-agent`, {}),
    onSuccess: async (_, sessionId) => {
      setTerminalCommand("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["sessions", sessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", sessionId, "logs"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"],
        }),
      ]);
    },
  });

  const mergeTicketMutation = useMutation({
    mutationFn: (ticketId: number) =>
      postJson<CommandAck>(`/tickets/${ticketId}/merge`, {}),
    onSuccess: async (_, ticketId) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId, "logs"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["tickets", ticketId, "review-package"],
        }),
      ]);
    },
  });

  const requestChangesMutation = useMutation({
    mutationFn: (input: { ticketId: number; body: string }) =>
      postJson<CommandAck>(`/tickets/${input.ticketId}/request-changes`, {
        body: input.body,
      }),
    onSuccess: async (_, variables) => {
      setRequestedChangesBody("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId, "logs"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["tickets", variables.ticketId, "review-package"],
        }),
      ]);
    },
  });

  const planFeedbackMutation = useMutation({
    mutationFn: (input: {
      sessionId: string;
      approved: boolean;
      body: string;
    }) =>
      postJson<CommandAck>(`/sessions/${input.sessionId}/checkpoint-response`, {
        approved: input.approved,
        body: input.body,
      }),
    onSuccess: async () => {
      setPlanFeedbackBody("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId, "logs"],
        }),
      ]);
    },
  });

  const resumeTicketMutation = useMutation({
    mutationFn: (input: { ticketId: number; reason?: string }) =>
      postJson<CommandAck>(`/tickets/${input.ticketId}/resume`, {
        reason:
          input.reason && input.reason.trim().length > 0
            ? input.reason
            : undefined,
      }),
    onSuccess: async () => {
      setResumeReason("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["projects", selectedProjectId, "tickets"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sessions", selectedSessionId, "logs"],
        }),
      ]);
    },
  });

  const selectedProject =
    projectsQuery.data?.projects.find(
      (project) => project.id === selectedProjectId,
    ) ?? null;
  const draftEditorProject =
    projectsQuery.data?.projects.find(
      (project) => project.id === draftEditorProjectId,
    ) ?? null;
  const projectOptionsDraftModelValue = resolveProjectModelValue(
    projectOptionsDraftModelPreset,
    projectOptionsDraftModelCustom,
  );
  const projectOptionsDraftReasoningEffortValue =
    resolveProjectReasoningEffortValue(projectOptionsDraftReasoningEffort);
  const projectOptionsTicketModelValue = resolveProjectModelValue(
    projectOptionsTicketModelPreset,
    projectOptionsTicketModelCustom,
  );
  const projectOptionsTicketReasoningEffortValue =
    resolveProjectReasoningEffortValue(projectOptionsTicketReasoningEffort);
  const projectOptionsPreWorktreeCommandValue =
    resolveOptionalProjectCommandValue(projectOptionsPreWorktreeCommand);
  const projectOptionsPostWorktreeCommandValue =
    resolveOptionalProjectCommandValue(projectOptionsPostWorktreeCommand);
  const projectOptionsDirty =
    projectOptionsProject !== null &&
    (projectOptionsPreWorktreeCommandValue !==
      projectOptionsProject.pre_worktree_command ||
      projectOptionsPostWorktreeCommandValue !==
        projectOptionsProject.post_worktree_command ||
      projectOptionsDraftModelValue !==
        projectOptionsProject.draft_analysis_model ||
      projectOptionsDraftReasoningEffortValue !==
        projectOptionsProject.draft_analysis_reasoning_effort ||
      projectOptionsTicketModelValue !==
        projectOptionsProject.ticket_work_model ||
      projectOptionsTicketReasoningEffortValue !==
        projectOptionsProject.ticket_work_reasoning_effort);
  const canDeleteProject =
    projectOptionsProject !== null &&
    projectDeleteConfirmText.trim() === projectOptionsProject.slug;
  const repositories = repositoriesQuery.data?.repositories ?? [];
  const selectedRepository = repositories[0] ?? null;
  const draftEditorRepositories =
    draftEditorProjectId !== null && draftEditorProjectId === selectedProjectId
      ? repositories
      : (draftEditorRepositoriesQuery.data?.repositories ?? []);
  const draftEditorRepository = draftEditorRepositories[0] ?? null;
  const drafts = draftsQuery.data?.drafts ?? [];
  const selectedDraft =
    drafts.find((draft) => draft.id === selectedDraftId) ?? null;
  const selectedDraftRepository =
    selectedDraft === null
      ? null
      : (repositories.find(
          (item) =>
            item.id ===
            (selectedDraft.confirmed_repo_id ?? selectedDraft.proposed_repo_id),
        ) ?? selectedRepository);
  const draftEditorAcceptanceCriteriaLines = draftEditorAcceptanceCriteria
    .split("\n")
    .filter((line) => line.trim().length > 0);
  const draftEditorCanPersist =
    draftEditorTitle.trim().length > 0 &&
    draftEditorDescription.trim().length > 0;
  const draftFormDirty =
    selectedDraft !== null &&
    (draftEditorTitle !== selectedDraft.title_draft ||
      draftEditorDescription !== selectedDraft.description_draft ||
      draftEditorTicketType !== selectedDraft.proposed_ticket_type ||
      !arraysEqual(
        draftEditorAcceptanceCriteriaLines,
        selectedDraft.proposed_acceptance_criteria,
      ));
  const draftEvents = draftEventsQuery.data?.events ?? [];
  const latestDraftEvent = draftEvents.at(0);
  const latestDraftEventMeta = latestDraftEvent
    ? parseDraftEventMeta(latestDraftEvent)
    : null;
  const latestRevertableRefineEvent =
    findLatestRevertableRefineEvent(draftEvents);
  const draftAnalysisActive = draftEventsQuery.data?.active_run ?? false;
  const latestQuestionsEvent = draftEvents.find(
    (event) => event.event_type === "draft.questions.completed",
  );
  const latestQuestionsResult = latestQuestionsEvent
    ? parseDraftQuestionsResult(latestQuestionsEvent.payload.result)
    : null;
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
      .map((item) => [item.id, item]),
  );

  const searchNeedle = normalizeText(boardSearch);
  const visibleDrafts = drafts.filter((draft) =>
    draftMatchesSearch(draft, searchNeedle),
  );
  const visibleTickets = tickets.filter((ticket) =>
    ticketMatchesSearch(ticket, searchNeedle),
  );

  const groupedTickets = {
    draft: [] as TicketFrontmatter[],
    ready: [] as TicketFrontmatter[],
    in_progress: [] as TicketFrontmatter[],
    review: [] as TicketFrontmatter[],
    done: [] as TicketFrontmatter[],
  };

  for (const ticket of visibleTickets) {
    groupedTickets[ticket.status].push(ticket);
  }

  const actionItems: ActionItem[] = tickets.flatMap((ticket): ActionItem[] => {
    const sessionForTicket =
      ticket.session_id !== null
        ? (sessionById.get(ticket.session_id) ?? null)
        : null;

    if (ticket.status === "review" && ticket.session_id) {
      return [
        {
          key: `review-${ticket.id}`,
          color: "blue",
          title: `Review ready for ticket #${ticket.id}`,
          message: `${ticket.title} is ready for review and can be merged or sent back for changes.`,
          sessionId: ticket.session_id,
          actionLabel: "Open Review",
        },
      ];
    }

    if (
      sessionForTicket &&
      [
        "awaiting_input",
        "failed",
        "interrupted",
        "paused_checkpoint",
        "paused_user_control",
      ].includes(sessionForTicket.status)
    ) {
      const label =
        sessionForTicket.plan_status === "awaiting_feedback"
          ? `Plan feedback needed for ticket #${ticket.id}`
          : sessionForTicket.status === "failed"
            ? `Execution failed for ticket #${ticket.id}`
            : sessionForTicket.status === "paused_user_control"
              ? `Manual terminal active for ticket #${ticket.id}`
              : `Input needed for ticket #${ticket.id}`;
      const message =
        (sessionForTicket.plan_status === "awaiting_feedback"
          ? sessionForTicket.plan_summary
          : null) ??
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
          actionLabel: "Open Session",
        },
      ];
    }

    return [];
  });

  const selectedSessionTicketSession = selectedSessionTicket?.session_id
    ? (sessionById.get(selectedSessionTicket.session_id) ?? session)
    : session;

  const boardLoading =
    (selectedProjectId !== null && draftsQuery.isPending) ||
    (selectedProjectId !== null && ticketsQuery.isPending);
  const boardError = draftsQuery.isError
    ? draftsQuery.error.message
    : ticketsQuery.isError
      ? ticketsQuery.error.message
      : null;

  const runningSessionCount = Array.from(sessionById.values()).filter(
    (activeSession) => activeSession.status === "running",
  ).length;
  const queuedSessionCount = Array.from(sessionById.values()).filter(
    (activeSession) => activeSession.status === "queued",
  ).length;
  const reviewCount = tickets.filter(
    (ticket) => ticket.status === "review",
  ).length;

  const capturePendingDraftEditorSync = (input: {
    draftId: string;
    sourceUpdatedAt: string | null;
  }): PendingDraftEditorSync => ({
    draftId: input.draftId,
    sourceUpdatedAt: input.sourceUpdatedAt,
    title: draftEditorTitle,
    description: draftEditorDescription,
    ticketType: draftEditorTicketType,
    acceptanceCriteria: draftEditorAcceptanceCriteria,
  });

  const initializeNewDraftEditor = (projectId: string | null): void => {
    setDraftEditorProjectId(projectId);
    setDraftEditorSourceId(emptyDraftEditorFields.sourceId);
    setDraftEditorArtifactScopeId(null);
    setDraftEditorTitle(emptyDraftEditorFields.title);
    setDraftEditorDescription(emptyDraftEditorFields.description);
    setDraftEditorTicketType(emptyDraftEditorFields.ticketType);
    setDraftEditorAcceptanceCriteria(emptyDraftEditorFields.acceptanceCriteria);
    setDraftEditorUploadError(null);
    setPendingDraftEditorSync(null);
    setPendingNewDraftAction(null);
  };

  const persistNewDraftFromEditor = async (
    action: NewDraftAction,
  ): Promise<string | null> => {
    if (!draftEditorProjectId) {
      return null;
    }

    setPendingNewDraftAction(action);

    try {
      const ack = await createDraftMutation.mutateAsync({
        projectId: draftEditorProjectId,
        artifactScopeId: draftEditorArtifactScopeId,
        title: draftEditorTitle,
        description: draftEditorDescription,
        proposedTicketType: draftEditorTicketType,
        proposedAcceptanceCriteria: draftEditorAcceptanceCriteriaLines,
      });

      const draftId = ack.resource_refs.draft_id ?? null;
      if (action === "refine" && draftId) {
        const createdDraft = queryClient
          .getQueryData<DraftsResponse>([
            "projects",
            draftEditorProjectId,
            "drafts",
          ])
          ?.drafts.find((draft) => draft.id === draftId);
        setPendingDraftEditorSync(
          capturePendingDraftEditorSync({
            draftId,
            sourceUpdatedAt: createdDraft?.updated_at ?? null,
          }),
        );
      }

      return draftId;
    } catch {
      return null;
    } finally {
      setPendingNewDraftAction(null);
    }
  };

  const handleDraftDescriptionPaste = async (
    file: File,
    selection: { start: number; end: number },
  ): Promise<{ cursorOffset: number; value: string } | null> => {
    if (!draftEditorProjectId) {
      return null;
    }
    setDraftEditorUploadError(null);

    try {
      const response = await uploadDraftArtifactMutation.mutateAsync({
        projectId: draftEditorProjectId,
        artifactScopeId: draftEditorArtifactScopeId,
        mimeType: file.type,
        dataBase64: await blobToBase64(file),
      });
      const insertion = buildMarkdownImageInsertion(
        draftEditorDescription,
        response.markdown_image,
        selection.start,
        selection.end,
      );

      setDraftEditorArtifactScopeId(response.artifact_scope_id);
      return insertion;
    } catch (error) {
      setDraftEditorUploadError(
        error instanceof Error ? error.message : "Unable to paste screenshot",
      );
      return null;
    }
  };

  const handleDraftDescriptionTextareaPaste = (
    event: ClipboardEvent<HTMLTextAreaElement>,
  ): void => {
    const imageItem = Array.from(event.clipboardData.items).find((item) =>
      item.type.startsWith("image/"),
    );
    if (!imageItem) {
      return;
    }

    const file = imageItem.getAsFile();
    if (!file) {
      return;
    }

    event.preventDefault();
    const target = event.currentTarget;
    void (async () => {
      const result = await handleDraftDescriptionPaste(file, {
        start: target.selectionStart,
        end: target.selectionEnd,
      });
      if (!result) {
        return;
      }

      setDraftEditorDescription(result.value);
      window.requestAnimationFrame(() => {
        target.selectionStart = result.cursorOffset;
        target.selectionEnd = result.cursorOffset;
        target.focus();
      });
    })();
  };

  useEffect(() => {
    if (inspectorState.kind === "new_draft") {
      return;
    }

    if (!selectedDraft) {
      const syncResult = resolveDraftEditorSync({
        draftFormDirty,
        editor: {
          sourceId: draftEditorSourceId,
          title: draftEditorTitle,
          description: draftEditorDescription,
          ticketType: draftEditorTicketType,
          acceptanceCriteria: draftEditorAcceptanceCriteria,
        },
        pendingSync: pendingDraftEditorSync,
        selectedDraft: null,
      });
      if (syncResult.nextEditor) {
        setDraftEditorSourceId(syncResult.nextEditor.sourceId);
        setDraftEditorTitle(syncResult.nextEditor.title);
        setDraftEditorDescription(syncResult.nextEditor.description);
        setDraftEditorTicketType(syncResult.nextEditor.ticketType);
        setDraftEditorAcceptanceCriteria(
          syncResult.nextEditor.acceptanceCriteria,
        );
      }
      if (syncResult.nextPendingSync !== undefined) {
        setPendingDraftEditorSync(syncResult.nextPendingSync);
      }
      return;
    }

    const syncResult = resolveDraftEditorSync({
      draftFormDirty,
      editor: {
        sourceId: draftEditorSourceId,
        title: draftEditorTitle,
        description: draftEditorDescription,
        ticketType: draftEditorTicketType,
        acceptanceCriteria: draftEditorAcceptanceCriteria,
      },
      pendingSync: pendingDraftEditorSync,
      selectedDraft,
    });

    if (syncResult.nextEditor) {
      setDraftEditorSourceId(syncResult.nextEditor.sourceId);
      setDraftEditorTitle(syncResult.nextEditor.title);
      setDraftEditorDescription(syncResult.nextEditor.description);
      setDraftEditorTicketType(syncResult.nextEditor.ticketType);
      setDraftEditorAcceptanceCriteria(
        syncResult.nextEditor.acceptanceCriteria,
      );
    }

    if (syncResult.nextPendingSync !== undefined) {
      setPendingDraftEditorSync(syncResult.nextPendingSync);
    }
  }, [
    draftEditorAcceptanceCriteria,
    draftEditorDescription,
    draftEditorSourceId,
    draftEditorTicketType,
    draftEditorTitle,
    draftFormDirty,
    inspectorState.kind,
    pendingDraftEditorSync,
    selectedDraft,
  ]);

  useEffect(() => {
    if (inspectorState.kind === "new_draft") {
      return;
    }

    if (inspectorState.kind === "draft") {
      if (selectedDraft) {
        setDraftEditorProjectId(selectedDraft.project_id);
        setDraftEditorArtifactScopeId(selectedDraft.artifact_scope_id);
        setDraftEditorUploadError(null);
      }
      return;
    }

    setDraftEditorProjectId(null);
    setDraftEditorArtifactScopeId(null);
    setDraftEditorUploadError(null);
  }, [inspectorState.kind, selectedDraft]);

  const closeProjectOptionsModal = (): void => {
    setProjectOptionsProjectId(null);
    setProjectOptionsFormError(null);
    setProjectDeleteConfirmText("");
    updateProjectMutation.reset();
    deleteProjectMutation.reset();
  };

  const openProjectOptions = (project: Project): void => {
    setProjectOptionsProjectId(project.id);
    setProjectOptionsDraftModelPreset(
      resolveProjectModelPreset(project.draft_analysis_model),
    );
    setProjectOptionsDraftModelCustom(
      resolveProjectCustomModelValue(project.draft_analysis_model),
    );
    setProjectOptionsDraftReasoningEffort(
      resolveProjectReasoningEffortSelection(
        project.draft_analysis_reasoning_effort,
      ),
    );
    setProjectOptionsTicketModelPreset(
      resolveProjectModelPreset(project.ticket_work_model),
    );
    setProjectOptionsTicketModelCustom(
      resolveProjectCustomModelValue(project.ticket_work_model),
    );
    setProjectOptionsTicketReasoningEffort(
      resolveProjectReasoningEffortSelection(
        project.ticket_work_reasoning_effort,
      ),
    );
    setProjectOptionsPreWorktreeCommand(project.pre_worktree_command ?? "");
    setProjectOptionsPostWorktreeCommand(project.post_worktree_command ?? "");
    setProjectOptionsFormError(null);
    setProjectDeleteConfirmText("");
    updateProjectMutation.reset();
    deleteProjectMutation.reset();
  };

  const saveProjectOptions = (): void => {
    if (!projectOptionsProject) {
      return;
    }

    if (
      projectOptionsDraftModelPreset === "custom" &&
      projectOptionsDraftModelValue === null
    ) {
      setProjectOptionsFormError(
        "Enter a model ID for the custom draft analysis model.",
      );
      return;
    }

    if (
      projectOptionsTicketModelPreset === "custom" &&
      projectOptionsTicketModelValue === null
    ) {
      setProjectOptionsFormError(
        "Enter a model ID for the custom ticket work model.",
      );
      return;
    }

    setProjectOptionsFormError(null);
    updateProjectMutation.mutate({
      projectId: projectOptionsProject.id,
      preWorktreeCommand: projectOptionsPreWorktreeCommandValue,
      postWorktreeCommand: projectOptionsPostWorktreeCommandValue,
      draftAnalysisModel: projectOptionsDraftModelValue,
      draftAnalysisReasoningEffort: projectOptionsDraftReasoningEffortValue,
      ticketWorkModel: projectOptionsTicketModelValue,
      ticketWorkReasoningEffort: projectOptionsTicketReasoningEffortValue,
    });
  };

  const deleteTicket = (ticket: TicketFrontmatter): void => {
    const confirmed = window.confirm(
      `Delete ticket #${ticket.id}? This removes local ticket metadata and will try to clean up its worktree and branch.`,
    );
    if (!confirmed) {
      return;
    }

    deleteTicketMutation.mutate({
      ticketId: ticket.id,
      sessionId: ticket.session_id,
    });
  };

  const archiveTicket = (ticket: TicketFrontmatter): void => {
    archiveTicketMutation.mutate({
      ticketId: ticket.id,
      sessionId: ticket.session_id,
    });
  };

  const openNewDraft = (): void => {
    initializeNewDraftEditor(selectedProjectId);
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

  const handleSaveNewDraft = (): void => {
    void persistNewDraftFromEditor("save");
  };

  const handleRefineNewDraft = (): void => {
    void (async () => {
      const draftId = await persistNewDraftFromEditor("refine");
      if (!draftId) {
        return;
      }

      refineDraftMutation.mutate(draftId);
    })();
  };

  const handleQuestionNewDraft = (): void => {
    void (async () => {
      const draftId = await persistNewDraftFromEditor("questions");
      if (!draftId) {
        return;
      }

      questionDraftMutation.mutate(draftId);
    })();
  };

  const handleConfirmNewDraft = (): void => {
    if (!draftEditorProject || !draftEditorRepository) {
      return;
    }

    void (async () => {
      const draftId = await persistNewDraftFromEditor("confirm");
      if (!draftId) {
        return;
      }

      confirmDraftMutation.mutate({
        draftId,
        title: draftEditorTitle,
        description: draftEditorDescription,
        ticketType: draftEditorTicketType,
        acceptanceCriteria: draftEditorAcceptanceCriteriaLines,
        repository: draftEditorRepository,
        project: draftEditorProject,
      });
    })();
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
        {ticket.status === "done" ? (
          <Menu.Item
            onClick={(event) => {
              event.stopPropagation();
              archiveTicket(ticket);
            }}
          >
            Archive
          </Menu.Item>
        ) : null}
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

  const draftEditorFields = (
    <>
      <TextInput
        id="draft-title"
        name="draftTitle"
        label="Title"
        placeholder="Add saved preset layouts"
        value={draftEditorTitle}
        onChange={(event) => setDraftEditorTitle(event.currentTarget.value)}
        required
      />
      <Textarea
        id="draft-description"
        label="Description"
        description="Markdown is stored literally. Paste a screenshot from the clipboard to insert a hosted image reference."
        placeholder="Users should be able to save and reuse receipt layout presets."
        value={draftEditorDescription}
        onChange={(event) =>
          setDraftEditorDescription(event.currentTarget.value)
        }
        onPaste={handleDraftDescriptionTextareaPaste}
        autosize
        minRows={10}
        required
      />
      {uploadDraftArtifactMutation.isPending ? (
        <Text size="sm" c="dimmed">
          Uploading pasted screenshot...
        </Text>
      ) : null}
      {draftEditorUploadError ? (
        <Text size="sm" c="red">
          {draftEditorUploadError}
        </Text>
      ) : null}
      <Select
        label="Ticket type"
        data={[
          { value: "feature", label: "Feature" },
          { value: "bugfix", label: "Bugfix" },
          { value: "chore", label: "Chore" },
          { value: "research", label: "Research" },
        ]}
        clearable
        value={draftEditorTicketType}
        onChange={(value) => {
          if (
            value === null ||
            value === "feature" ||
            value === "bugfix" ||
            value === "chore" ||
            value === "research"
          ) {
            setDraftEditorTicketType(value);
          }
        }}
      />
      <Textarea
        id="draft-acceptance-criteria"
        label="Acceptance criteria"
        description="One Markdown acceptance criterion per line."
        value={draftEditorAcceptanceCriteria}
        onChange={(event) =>
          setDraftEditorAcceptanceCriteria(event.currentTarget.value)
        }
        autosize
        minRows={10}
      />
    </>
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
            <SectionCard title="Projects">
              {projectsQuery.isPending ? (
                <Loader size="sm" />
              ) : projectsQuery.isError ? (
                <Text c="red" size="sm">
                  {projectsQuery.error.message}
                </Text>
              ) : projectsQuery.data.projects.length === 0 ? (
                <Stack gap="sm">
                  <Text size="sm" c="dimmed">
                    No projects yet. Create the first one below.
                  </Text>
                  <Button
                    variant="light"
                    onClick={() => setProjectModalOpen(true)}
                  >
                    Create Project
                  </Button>
                </Stack>
              ) : (
                <Stack gap="xs">
                  {projectsQuery.data.projects.map((project) => (
                    <Group key={project.id} gap="xs" wrap="nowrap">
                      <Button
                        className="project-nav-button"
                        data-selected={
                          selectedProjectId === project.id ? "true" : "false"
                        }
                        variant={
                          selectedProjectId === project.id ? "filled" : "subtle"
                        }
                        justify="space-between"
                        style={{ flex: 1 }}
                        onClick={() => setSelectedProjectId(project.id)}
                      >
                        <span>{project.name}</span>
                      </Button>
                      <ActionIcon
                        aria-label={`Project options for ${project.name}`}
                        color="gray"
                        variant="subtle"
                        onClick={(event) => {
                          event.stopPropagation();
                          openProjectOptions(project);
                        }}
                      >
                        ...
                      </ActionIcon>
                    </Group>
                  ))}
                  <Button
                    variant="light"
                    onClick={() => setProjectModalOpen(true)}
                  >
                    Create Project
                  </Button>
                </Stack>
              )}
            </SectionCard>

            {actionItems.length > 0 ? (
              <SectionCard title="Inbox">
                <Stack gap="xs">
                  {actionItems.map((item) => (
                    <Box
                      key={item.key}
                      className="inbox-item"
                      data-tone={item.color}
                    >
                      <Stack gap={6}>
                        <Text fw={700} size="sm">
                          {item.title}
                        </Text>
                        <MarkdownContent
                          className="markdown-muted markdown-small"
                          content={item.message}
                        />
                        <Group justify="flex-end">
                          <Button
                            variant="light"
                            size="xs"
                            onClick={() => {
                              setInspectorState({
                                kind: "session",
                                sessionId: item.sessionId,
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
                    {selectedProject
                      ? selectedProject.name
                      : "Select a project"}
                  </Title>
                  <Text size="sm" c="dimmed" maw={820}>
                    {selectedProject
                      ? `${selectedRepository?.name ?? "Repository pending"} • ${selectedRepository?.validation_profile.length ?? 0} validation command(s)`
                      : "Choose a project from the left rail to bring its drafts, tickets, and sessions into the board."}
                  </Text>
                </Stack>
                <Group gap="xs">
                  <ColorSchemeControl />
                  <Badge variant="light" color="green">
                    {healthQuery.data?.service ?? "backend"}
                  </Badge>
                  <Badge variant="outline">{runningSessionCount} running</Badge>
                  <Badge variant="outline">{queuedSessionCount} queued</Badge>
                  <Badge variant="outline">{reviewCount} in review</Badge>
                </Group>
              </Group>
            </Box>

            <Box className="workbench-toolbar">
              <Box className="toolbar-group">
                {boardColumns.map((column) => {
                  const count =
                    column === "draft"
                      ? visibleDrafts.length
                      : groupedTickets[column].length;
                  const meta = boardColumnMeta[column];
                  return (
                    <Badge
                      key={column}
                      variant="light"
                      size="lg"
                      style={{
                        background: `${meta.accent}14`,
                        color: meta.accent,
                        border: `1px solid ${meta.accent}22`,
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
                  onChange={(event) =>
                    setBoardSearch(event.currentTarget.value)
                  }
                />
                <Button
                  disabled={!selectedProject}
                  variant={
                    inspectorState.kind === "new_draft" ? "filled" : "light"
                  }
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
                  Projects anchor repositories, drafts, tickets, and execution
                  sessions. Once a project is selected, the middle canvas
                  becomes the working board and the right panel becomes the live
                  inspector.
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
                      column === "draft"
                        ? visibleDrafts.length
                        : groupedTickets[column].length;

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

                        <Box
                          className="board-column-stack"
                          onClick={hideInspector}
                        >
                          {column === "draft" ? (
                            visibleDrafts.length === 0 ? (
                              <Box className="board-empty">{meta.empty}</Box>
                            ) : (
                              visibleDrafts.map((draft) => {
                                const repository =
                                  repositories.find(
                                    (item) =>
                                      item.id ===
                                      (draft.confirmed_repo_id ??
                                        draft.proposed_repo_id),
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
                                      <Group
                                        justify="space-between"
                                        align="flex-start"
                                      >
                                        <Box
                                          style={{
                                            fontWeight: 700,
                                            lineHeight: 1.35,
                                          }}
                                        >
                                          <MarkdownContent
                                            content={draft.title_draft}
                                            inline
                                          />
                                        </Box>
                                        <Badge variant="light" color="gray">
                                          {draft.wizard_status.replace(
                                            /_/g,
                                            " ",
                                          )}
                                        </Badge>
                                      </Group>
                                      <MarkdownContent
                                        className="markdown-muted markdown-small"
                                        content={draft.description_draft}
                                      />
                                      <Text className="board-card-meta">
                                        Repository:{" "}
                                        {repository?.name ?? "unassigned"}
                                      </Text>
                                      <Text className="board-card-meta">
                                        {draft.proposed_acceptance_criteria
                                          .length > 0
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
                                  ? (sessionById.get(ticket.session_id) ?? null)
                                  : null;
                              const canStop =
                                ticket.status === "in_progress" &&
                                ticketSession !== null &&
                                isStoppableSessionStatus(ticketSession.status);
                              const isSelected =
                                ticket.session_id !== null &&
                                ticket.session_id === selectedSessionId;
                              const showDeleteError =
                                deleteTicketMutation.isError &&
                                deleteTicketMutation.variables?.ticketId ===
                                  ticket.id;
                              const showArchiveError =
                                archiveTicketMutation.isError &&
                                archiveTicketMutation.variables?.ticketId ===
                                  ticket.id;
                              const showStopError =
                                stopTicketMutation.isError &&
                                stopTicketMutation.variables?.ticketId ===
                                  ticket.id;
                              const showMergeError =
                                mergeTicketMutation.isError &&
                                mergeTicketMutation.variables === ticket.id;
                              const showStartPlanError =
                                startTicketMutation.isError &&
                                startTicketMutation.variables?.ticketId ===
                                  ticket.id &&
                                startTicketMutation.variables.planningEnabled;
                              const showStartNowError =
                                startTicketMutation.isError &&
                                startTicketMutation.variables?.ticketId ===
                                  ticket.id &&
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
                                    <Group
                                      justify="space-between"
                                      align="flex-start"
                                    >
                                      <Stack gap={2}>
                                        <Box
                                          style={{
                                            fontWeight: 700,
                                            lineHeight: 1.35,
                                          }}
                                        >
                                          <Text component="span" inherit>
                                            #{ticket.id}{" "}
                                          </Text>
                                          <MarkdownContent
                                            content={ticket.title}
                                            inline
                                          />
                                        </Box>
                                        <Text className="board-card-meta">
                                          {ticket.ticket_type} •{" "}
                                          {ticket.target_branch}
                                        </Text>
                                      </Stack>
                                      <Group gap={6} align="center">
                                        <Badge
                                          variant="light"
                                          color={ticketStatusColor(
                                            ticket.status,
                                          )}
                                        >
                                          {humanizeTicketStatus(ticket.status)}
                                        </Badge>
                                        {renderTicketMenu(ticket)}
                                      </Group>
                                    </Group>
                                    <MarkdownContent
                                      className="markdown-muted markdown-small"
                                      content={getBoardTicketDescriptionPreview(
                                        ticket.description,
                                      )}
                                    />
                                    {ticketSession ? (
                                      <Group gap={8}>
                                        <Badge
                                          variant="outline"
                                          color={sessionStatusColor(
                                            ticketSession.status,
                                          )}
                                        >
                                          {humanizeSessionStatus(
                                            ticketSession.status,
                                          )}
                                        </Badge>
                                        {ticketSession.status === "queued" ? (
                                          <Text size="xs" c="dimmed">
                                            Waiting for a running slot
                                          </Text>
                                        ) : null}
                                      </Group>
                                    ) : null}

                                    {showDeleteError ? (
                                      <Text size="sm" c="red">
                                        {deleteTicketMutation.error.message}
                                      </Text>
                                    ) : null}
                                    {showArchiveError ? (
                                      <Text size="sm" c="red">
                                        {archiveTicketMutation.error.message}
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
                                      <Group
                                        justify="flex-end"
                                        align="flex-end"
                                        gap="xs"
                                      >
                                        <Group gap="xs">
                                          <Button
                                            variant="light"
                                            size="xs"
                                            loading={
                                              startTicketMutation.isPending &&
                                              startTicketMutation.variables
                                                ?.ticketId === ticket.id &&
                                              startTicketMutation.variables
                                                .planningEnabled
                                            }
                                            onClick={() =>
                                              startTicketMutation.mutate({
                                                ticketId: ticket.id,
                                                planningEnabled: true,
                                              })
                                            }
                                          >
                                            Start with Plan
                                          </Button>
                                          <Button
                                            size="xs"
                                            loading={
                                              startTicketMutation.isPending &&
                                              startTicketMutation.variables
                                                ?.ticketId === ticket.id &&
                                              !startTicketMutation.variables
                                                .planningEnabled
                                            }
                                            onClick={() =>
                                              startTicketMutation.mutate({
                                                ticketId: ticket.id,
                                                planningEnabled: false,
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
                                            mergeTicketMutation.variables ===
                                              ticket.id
                                          }
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            mergeTicketMutation.mutate(
                                              ticket.id,
                                            );
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
                                              stopTicketMutation.variables
                                                ?.ticketId === ticket.id
                                            }
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              stopTicketMutation.mutate({
                                                ticketId: ticket.id,
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
              {inspectorState.kind === "new_draft" && draftEditorProject ? (
                <SectionCard
                  title="New draft"
                  description="Work in the composer first. Save the draft directly, or let Codex create it automatically when you refine, ask questions, or create a ready ticket."
                >
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      handleSaveNewDraft();
                    }}
                  >
                    <Stack gap="md">
                      <Group justify="space-between" align="flex-start">
                        <Stack gap={4}>
                          <Text className="rail-kicker">Draft</Text>
                          <Box style={{ fontWeight: 700 }}>
                            <MarkdownContent
                              content={
                                draftEditorTitle.trim().length > 0
                                  ? draftEditorTitle
                                  : "Unsaved draft"
                              }
                              inline
                            />
                          </Box>
                        </Stack>
                        <Badge variant="light" color="gray">
                          unsaved
                        </Badge>
                      </Group>

                      <Box className="detail-meta-grid">
                        <Box className="detail-meta-card">
                          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                            Repository
                          </Text>
                          <Text fw={700}>
                            {draftEditorRepository?.name ?? "Unassigned"}
                          </Text>
                        </Box>
                        <Box className="detail-meta-card">
                          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                            Acceptance criteria
                          </Text>
                          <Text fw={700}>
                            {draftEditorAcceptanceCriteriaLines.length}
                          </Text>
                        </Box>
                      </Box>

                      {draftEditorFields}

                      <Text size="sm" c="dimmed">
                        Refine, Questions, and Create Ready will save the draft
                        automatically before they continue.
                      </Text>

                      {createDraftMutation.isError ? (
                        <Text size="sm" c="red">
                          {createDraftMutation.error.message}
                        </Text>
                      ) : null}

                      <Group justify="space-between" align="flex-start">
                        <Button
                          type="button"
                          color="red"
                          variant="subtle"
                          onClick={hideInspector}
                        >
                          Discard Draft
                        </Button>
                        <Group gap="xs" justify="flex-end">
                          <Button
                            type="submit"
                            variant="light"
                            disabled={
                              !draftEditorCanPersist ||
                              createDraftMutation.isPending
                            }
                            loading={
                              createDraftMutation.isPending &&
                              pendingNewDraftAction === "save"
                            }
                          >
                            Save Draft
                          </Button>
                          <Button
                            type="button"
                            variant="light"
                            disabled={
                              !draftEditorCanPersist ||
                              createDraftMutation.isPending ||
                              !draftEditorRepository
                            }
                            loading={
                              createDraftMutation.isPending &&
                              pendingNewDraftAction === "refine"
                            }
                            onClick={handleRefineNewDraft}
                          >
                            Refine
                          </Button>
                          <Button type="button" variant="light" disabled>
                            Revert Refine
                          </Button>
                          <Button
                            type="button"
                            variant="light"
                            disabled={
                              !draftEditorCanPersist ||
                              createDraftMutation.isPending ||
                              !draftEditorRepository
                            }
                            loading={
                              createDraftMutation.isPending &&
                              pendingNewDraftAction === "questions"
                            }
                            onClick={handleQuestionNewDraft}
                          >
                            Questions?
                          </Button>
                          <Button
                            type="button"
                            disabled={
                              !draftEditorCanPersist ||
                              !draftEditorProject ||
                              !draftEditorRepository ||
                              createDraftMutation.isPending
                            }
                            loading={
                              createDraftMutation.isPending &&
                              pendingNewDraftAction === "confirm"
                            }
                            onClick={handleConfirmNewDraft}
                          >
                            Create Ready
                          </Button>
                        </Group>
                      </Group>

                      <Stack gap="xs">
                        <Text fw={700}>History</Text>
                        <Text size="sm" c="dimmed">
                          No refinement or feasibility runs yet.
                        </Text>
                      </Stack>
                    </Stack>
                  </form>
                </SectionCard>
              ) : null}

              {inspectorState.kind === "draft" && selectedDraft ? (
                <SectionCard
                  title="Draft inspector"
                  description="Edit the draft directly, then use Codex to refine it or check feasibility."
                >
                  <Stack gap="md">
                    <Group justify="space-between" align="flex-start">
                      <Stack gap={4}>
                        <Text className="rail-kicker">Draft</Text>
                        <Box style={{ fontWeight: 700 }}>
                          <MarkdownContent
                            content={selectedDraft.title_draft}
                            inline
                          />
                        </Box>
                      </Stack>
                      <Group gap="xs">
                        {draftAnalysisActive ? (
                          <Badge variant="light" color="blue">
                            Codex running
                          </Badge>
                        ) : null}
                        <Badge variant="light" color="gray">
                          {selectedDraft.wizard_status.replace(/_/g, " ")}
                        </Badge>
                      </Group>
                    </Group>

                    <Box className="detail-meta-grid">
                      <Box className="detail-meta-card">
                        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                          Repository
                        </Text>
                        <Text fw={700}>
                          {selectedDraftRepository?.name ?? "Unassigned"}
                        </Text>
                      </Box>
                      <Box className="detail-meta-card">
                        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                          Acceptance criteria
                        </Text>
                        <Text fw={700}>
                          {selectedDraft.proposed_acceptance_criteria.length}
                        </Text>
                      </Box>
                    </Box>

                    {draftEditorFields}

                    {draftFormDirty ? (
                      <Text size="sm" c="dimmed">
                        Save changes before refining, asking questions, or
                        creating a ready ticket.
                      </Text>
                    ) : null}

                    {saveDraftMutation.isError &&
                    saveDraftMutation.variables?.draftId ===
                      selectedDraft.id ? (
                      <Text size="sm" c="red">
                        {saveDraftMutation.error.message}
                      </Text>
                    ) : null}
                    {refineDraftMutation.isError &&
                    refineDraftMutation.variables === selectedDraft.id ? (
                      <Text size="sm" c="red">
                        {refineDraftMutation.error.message}
                      </Text>
                    ) : null}
                    {revertDraftRefineMutation.isError &&
                    revertDraftRefineMutation.variables === selectedDraft.id ? (
                      <Text size="sm" c="red">
                        {revertDraftRefineMutation.error.message}
                      </Text>
                    ) : null}
                    {questionDraftMutation.isError &&
                    questionDraftMutation.variables === selectedDraft.id ? (
                      <Text size="sm" c="red">
                        {questionDraftMutation.error.message}
                      </Text>
                    ) : null}
                    {confirmDraftMutation.isError &&
                    confirmDraftMutation.variables?.draftId ===
                      selectedDraft.id ? (
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

                    <Group justify="space-between" align="flex-start">
                      <Button
                        color="red"
                        variant="subtle"
                        loading={
                          deleteDraftMutation.isPending &&
                          deleteDraftMutation.variables === selectedDraft.id
                        }
                        onClick={() =>
                          deleteDraftMutation.mutate(selectedDraft.id)
                        }
                      >
                        Delete Draft
                      </Button>
                      <Group gap="xs" justify="flex-end">
                        <Button
                          variant="light"
                          disabled={!draftFormDirty || draftAnalysisActive}
                          loading={
                            saveDraftMutation.isPending &&
                            saveDraftMutation.variables?.draftId ===
                              selectedDraft.id
                          }
                          onClick={() =>
                            saveDraftMutation.mutate({
                              draftId: selectedDraft.id,
                              titleDraft: draftEditorTitle,
                              descriptionDraft: draftEditorDescription,
                              proposedTicketType: draftEditorTicketType,
                              proposedAcceptanceCriteria:
                                draftEditorAcceptanceCriteriaLines,
                            })
                          }
                        >
                          Save Changes
                        </Button>
                        <Button
                          variant="light"
                          disabled={
                            draftFormDirty ||
                            draftAnalysisActive ||
                            !selectedDraftRepository
                          }
                          loading={
                            refineDraftMutation.isPending &&
                            refineDraftMutation.variables === selectedDraft.id
                          }
                          onClick={() => {
                            setPendingDraftEditorSync(
                              capturePendingDraftEditorSync({
                                draftId: selectedDraft.id,
                                sourceUpdatedAt: selectedDraft.updated_at,
                              }),
                            );
                            refineDraftMutation.mutate(selectedDraft.id);
                          }}
                        >
                          Refine
                        </Button>
                        <Button
                          variant="light"
                          disabled={
                            draftFormDirty ||
                            draftAnalysisActive ||
                            !latestRevertableRefineEvent
                          }
                          loading={
                            revertDraftRefineMutation.isPending &&
                            revertDraftRefineMutation.variables ===
                              selectedDraft.id
                          }
                          onClick={() => {
                            setPendingDraftEditorSync(
                              capturePendingDraftEditorSync({
                                draftId: selectedDraft.id,
                                sourceUpdatedAt: selectedDraft.updated_at,
                              }),
                            );
                            revertDraftRefineMutation.mutate(selectedDraft.id);
                          }}
                        >
                          Revert Refine
                        </Button>
                        <Button
                          variant="light"
                          disabled={
                            draftFormDirty ||
                            draftAnalysisActive ||
                            !selectedDraftRepository
                          }
                          loading={
                            questionDraftMutation.isPending &&
                            questionDraftMutation.variables === selectedDraft.id
                          }
                          onClick={() =>
                            questionDraftMutation.mutate(selectedDraft.id)
                          }
                        >
                          Questions?
                        </Button>
                        <Button
                          disabled={
                            !selectedDraftRepository ||
                            !selectedProject ||
                            draftFormDirty ||
                            saveDraftMutation.isPending
                          }
                          loading={
                            confirmDraftMutation.isPending &&
                            confirmDraftMutation.variables?.draftId ===
                              selectedDraft.id
                          }
                          onClick={() =>
                            selectedDraftRepository &&
                            selectedProject &&
                            confirmDraftMutation.mutate({
                              draftId: selectedDraft.id,
                              title: draftEditorTitle,
                              description: draftEditorDescription,
                              ticketType: draftEditorTicketType,
                              acceptanceCriteria:
                                draftEditorAcceptanceCriteriaLines,
                              repository: selectedDraftRepository,
                              project: selectedProject,
                            })
                          }
                        >
                          Create Ready
                        </Button>
                      </Group>
                    </Group>

                    {latestQuestionsResult ? (
                      <Box className="detail-placeholder">
                        <DraftQuestionsResultView
                          result={latestQuestionsResult}
                        />
                      </Box>
                    ) : null}

                    <Stack gap="xs">
                      <Text fw={700}>History</Text>
                      {draftEventsQuery.isPending ? (
                        <Loader size="sm" />
                      ) : draftEventsQuery.isError ? (
                        <Text size="sm" c="red">
                          {draftEventsQuery.error.message}
                        </Text>
                      ) : draftEvents.length === 0 ? (
                        <Text size="sm" c="dimmed">
                          No refinement or feasibility runs yet.
                        </Text>
                      ) : (
                        draftEvents.map((event) => {
                          const meta = parseDraftEventMeta(event);
                          if (!meta) {
                            return null;
                          }

                          return (
                            <Box key={event.id} className="detail-meta-card">
                              <details>
                                <summary>
                                  {meta.operation === "refine"
                                    ? "Refine"
                                    : "Questions"}{" "}
                                  • {meta.status} •{" "}
                                  {formatTimestamp(event.occurred_at)} •{" "}
                                  <MarkdownContent
                                    content={meta.summary}
                                    inline
                                  />
                                </summary>
                                <Stack gap="xs" mt="sm">
                                  {meta.error ? (
                                    <Box c="red">
                                      <MarkdownContent
                                        className="markdown-small"
                                        content={meta.error}
                                      />
                                    </Box>
                                  ) : null}
                                  {meta.result ? (
                                    <DraftEventResultView
                                      result={meta.result}
                                    />
                                  ) : null}
                                </Stack>
                              </details>
                            </Box>
                          );
                        })
                      )}
                    </Stack>
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
                          <Box style={{ fontWeight: 700 }}>
                            {selectedSessionTicket ? (
                              <>
                                <Text component="span" inherit>
                                  #{selectedSessionTicket.id}{" "}
                                </Text>
                                <MarkdownContent
                                  content={selectedSessionTicket.title}
                                  inline
                                />
                              </>
                            ) : (
                              `Ticket #${session.ticket_id}`
                            )}
                          </Box>
                        </Stack>
                        <Badge
                          variant="light"
                          color={sessionStatusColor(session.status)}
                        >
                          {humanizeSessionStatus(session.status)}
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
                          <Text fw={700}>
                            {session.planning_enabled ? "Enabled" : "Disabled"}
                          </Text>
                        </Box>
                        <Box className="detail-meta-card">
                          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                            Plan stage
                          </Text>
                          <Text fw={700}>
                            {humanizePlanStatus(session.plan_status)}
                          </Text>
                        </Box>
                        <Box className="detail-meta-card">
                          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                            Branch
                          </Text>
                          <Text fw={700}>
                            {selectedSessionTicket?.working_branch ?? "Pending"}
                          </Text>
                        </Box>
                        <Box className="detail-meta-card">
                          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                            Worktree
                          </Text>
                          <Text className="inline-code">
                            {session.worktree_path ?? "Pending"}
                          </Text>
                        </Box>
                      </Box>

                      {selectedSessionTicket ? (
                        <Stack gap="xs">
                          <Text fw={700}>Ticket details</Text>
                          <MarkdownContent
                            className="markdown-muted markdown-small"
                            content={selectedSessionTicket.description}
                          />
                          {selectedSessionTicket.acceptance_criteria.length >
                          0 ? (
                            <Stack gap={2}>
                              <Text
                                size="xs"
                                c="dimmed"
                                tt="uppercase"
                                fw={700}
                              >
                                Acceptance Criteria
                              </Text>
                              <MarkdownListItems
                                items={
                                  selectedSessionTicket.acceptance_criteria
                                }
                              />
                            </Stack>
                          ) : null}
                        </Stack>
                      ) : null}

                      {session.status === "queued" ? (
                        <Text size="sm" c="dimmed">
                          This ticket is in progress and waiting for one of the
                          project's running slots to open.
                        </Text>
                      ) : null}

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
                                  terminalTakeoverMutation.variables ===
                                    session.id
                                }
                                onClick={() =>
                                  terminalTakeoverMutation.mutate(session.id)
                                }
                              >
                                Take Over Terminal
                              </Button>
                            ) : null}
                            {selectedSessionTicket.status === "in_progress" &&
                            selectedSessionTicketSession &&
                            isStoppableSessionStatus(
                              selectedSessionTicketSession.status,
                            ) ? (
                              <Button
                                color="orange"
                                variant="light"
                                size="xs"
                                loading={
                                  stopTicketMutation.isPending &&
                                  stopTicketMutation.variables?.ticketId ===
                                    selectedSessionTicket.id
                                }
                                onClick={() =>
                                  stopTicketMutation.mutate({
                                    ticketId: selectedSessionTicket.id,
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
                              deleteTicketMutation.variables?.ticketId ===
                                selectedSessionTicket.id
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
                      {planFeedbackMutation.isError ? (
                        <Text size="sm" c="red">
                          {planFeedbackMutation.error.message}
                        </Text>
                      ) : null}

                      {session.plan_summary ? (
                        <Stack gap={4}>
                          <Text fw={700}>
                            {session.plan_status === "awaiting_feedback"
                              ? "Plan awaiting feedback"
                              : "Latest plan"}
                          </Text>
                          <MarkdownContent
                            className="markdown-muted markdown-small"
                            content={session.plan_summary}
                          />
                        </Stack>
                      ) : null}

                      {selectedSessionTicket?.status === "review" ? (
                        reviewPackageQuery.isPending ? (
                          <Loader size="sm" />
                        ) : reviewPackage ? (
                          <Stack gap="sm">
                            <Text fw={700}>Review package</Text>
                            <Text size="sm" c="dimmed">
                              Diff artifact:{" "}
                              <Code>{reviewPackage.diff_ref}</Code>
                            </Text>
                            <MarkdownContent
                              className="markdown-muted markdown-small"
                              content={reviewPackage.change_summary}
                            />
                            <Text size="sm" c="dimmed">
                              Validation results:{" "}
                              {reviewPackage.validation_results.length}
                            </Text>
                            {reviewPackage.validation_results.length > 0 ? (
                              <List size="sm" spacing={4}>
                                {reviewPackage.validation_results.map(
                                  (result) => (
                                    <List.Item key={result.command_id}>
                                      {result.label}: {result.status}
                                    </List.Item>
                                  ),
                                )}
                              </List>
                            ) : null}
                            {reviewPackage.remaining_risks.length > 0 ? (
                              <Stack gap={2}>
                                <Text
                                  size="xs"
                                  c="dimmed"
                                  tt="uppercase"
                                  fw={700}
                                >
                                  Remaining Risks
                                </Text>
                                <MarkdownListItems
                                  items={reviewPackage.remaining_risks}
                                />
                              </Stack>
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
                              onChange={(event) =>
                                setRequestedChangesBody(
                                  event.currentTarget.value,
                                )
                              }
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
                                disabled={
                                  requestedChangesBody.trim().length === 0
                                }
                                onClick={() =>
                                  requestChangesMutation.mutate({
                                    ticketId: selectedSessionTicket.id,
                                    body: requestedChangesBody,
                                  })
                                }
                              >
                                Request Changes
                              </Button>
                              <Button
                                loading={
                                  mergeTicketMutation.isPending &&
                                  mergeTicketMutation.variables ===
                                    selectedSessionTicket.id
                                }
                                onClick={() =>
                                  mergeTicketMutation.mutate(
                                    selectedSessionTicket.id,
                                  )
                                }
                              >
                                Merge to {selectedSessionTicket.target_branch}
                              </Button>
                            </Group>
                          </Stack>
                        ) : null
                      ) : null}

                      <SessionActivityFeed
                        logs={sessionLogs}
                        session={session}
                      />

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
                              body: terminalCommand,
                            });
                          }}
                          onRestoreAgent={() =>
                            terminalRestoreMutation.mutate(session.id)
                          }
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
                      session.plan_status === "awaiting_feedback" ? (
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (!selectedSessionId) {
                              return;
                            }

                            planFeedbackMutation.mutate({
                              sessionId: selectedSessionId,
                              approved: true,
                              body:
                                planFeedbackBody.trim().length > 0
                                  ? planFeedbackBody
                                  : "Plan approved. Continue with implementation.",
                            });
                          }}
                        >
                          <Stack gap="sm">
                            <Textarea
                              id="plan-feedback"
                              name="planFeedback"
                              label="Plan feedback"
                              placeholder="Add optional implementation guidance, or describe what should change in the plan."
                              value={planFeedbackBody}
                              onChange={(event) =>
                                setPlanFeedbackBody(event.currentTarget.value)
                              }
                              minRows={3}
                            />
                            <Group justify="space-between">
                              <Button
                                variant="light"
                                type="button"
                                disabled={planFeedbackBody.trim().length === 0}
                                loading={
                                  planFeedbackMutation.isPending &&
                                  planFeedbackMutation.variables?.approved ===
                                    false
                                }
                                onClick={() => {
                                  if (!selectedSessionId) {
                                    return;
                                  }

                                  planFeedbackMutation.mutate({
                                    sessionId: selectedSessionId,
                                    approved: false,
                                    body: planFeedbackBody,
                                  });
                                }}
                              >
                                Request Plan Changes
                              </Button>
                              <Button
                                type="submit"
                                loading={
                                  planFeedbackMutation.isPending &&
                                  planFeedbackMutation.variables?.approved ===
                                    true
                                }
                              >
                                Confirm Plan and Start
                              </Button>
                            </Group>
                          </Stack>
                        </form>
                      ) : selectedSessionTicket &&
                        [
                          "awaiting_input",
                          "failed",
                          "interrupted",
                          "paused_checkpoint",
                        ].includes(session.status) ? (
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            resumeTicketMutation.mutate({
                              ticketId: selectedSessionTicket.id,
                              reason: resumeReason,
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
                              onChange={(event) =>
                                setResumeReason(event.currentTarget.value)
                              }
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
                                    body:
                                      resumeReason ||
                                      "Resume requested from the session view.",
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
                          Use this panel when a session is waiting on you, or
                          take over the project terminal above when direct
                          control inside the worktree is faster than more
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
        opened={projectOptionsProject !== null}
        onClose={closeProjectOptionsModal}
        title={
          projectOptionsProject
            ? `Project options • ${projectOptionsProject.name}`
            : "Project options"
        }
        centered
        size="lg"
      >
        {projectOptionsProject ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              saveProjectOptions();
            }}
          >
            <Stack gap="md">
              <Text size="sm" c="dimmed">
                Model overrides are optional. Default leaves Codex on its normal
                model selection path for this project.
              </Text>

              <Stack gap="sm">
                <Textarea
                  label="Pre-worktree command"
                  description="Runs inside each new worktree without blocking Codex startup."
                  placeholder="npm install"
                  value={projectOptionsPreWorktreeCommand}
                  onChange={(event) => {
                    setProjectOptionsFormError(null);
                    updateProjectMutation.reset();
                    setProjectOptionsPreWorktreeCommand(
                      event.currentTarget.value,
                    );
                  }}
                  minRows={2}
                />
                <Textarea
                  label="Post-worktree command"
                  description="Runs inside the worktree before background teardown removes it."
                  placeholder="npm run cleanup"
                  value={projectOptionsPostWorktreeCommand}
                  onChange={(event) => {
                    setProjectOptionsFormError(null);
                    updateProjectMutation.reset();
                    setProjectOptionsPostWorktreeCommand(
                      event.currentTarget.value,
                    );
                  }}
                  minRows={2}
                />
              </Stack>

              <Stack gap="sm">
                <Select
                  label="Draft refining model"
                  description="Used for both Refine and Questions? draft analysis runs."
                  data={projectModelPresetOptions}
                  value={projectOptionsDraftModelPreset}
                  onChange={(value) => {
                    if (!value) {
                      return;
                    }

                    setProjectOptionsFormError(null);
                    updateProjectMutation.reset();
                    setProjectOptionsDraftModelPreset(
                      value as ProjectModelPreset,
                    );
                  }}
                />
                {projectOptionsDraftModelPreset === "custom" ? (
                  <TextInput
                    label="Custom draft model ID"
                    placeholder="gpt-5.3-spark"
                    value={projectOptionsDraftModelCustom}
                    onChange={(event) => {
                      setProjectOptionsFormError(null);
                      updateProjectMutation.reset();
                      setProjectOptionsDraftModelCustom(
                        event.currentTarget.value,
                      );
                    }}
                  />
                ) : null}
                <Select
                  label="Draft refining reasoning effort"
                  data={reasoningEffortOptions}
                  value={projectOptionsDraftReasoningEffort}
                  onChange={(value) => {
                    if (!value) {
                      return;
                    }

                    setProjectOptionsFormError(null);
                    updateProjectMutation.reset();
                    setProjectOptionsDraftReasoningEffort(
                      value as ProjectReasoningEffortSelection,
                    );
                  }}
                />
              </Stack>

              <Stack gap="sm">
                <Select
                  label="General ticket work model"
                  description="Used when Codex starts or resumes ticket implementation work."
                  data={projectModelPresetOptions}
                  value={projectOptionsTicketModelPreset}
                  onChange={(value) => {
                    if (!value) {
                      return;
                    }

                    setProjectOptionsFormError(null);
                    updateProjectMutation.reset();
                    setProjectOptionsTicketModelPreset(
                      value as ProjectModelPreset,
                    );
                  }}
                />
                {projectOptionsTicketModelPreset === "custom" ? (
                  <TextInput
                    label="Custom ticket work model ID"
                    placeholder="gpt-5.3-spark"
                    value={projectOptionsTicketModelCustom}
                    onChange={(event) => {
                      setProjectOptionsFormError(null);
                      updateProjectMutation.reset();
                      setProjectOptionsTicketModelCustom(
                        event.currentTarget.value,
                      );
                    }}
                  />
                ) : null}
                <Select
                  label="General ticket work reasoning effort"
                  data={reasoningEffortOptions}
                  value={projectOptionsTicketReasoningEffort}
                  onChange={(value) => {
                    if (!value) {
                      return;
                    }

                    setProjectOptionsFormError(null);
                    updateProjectMutation.reset();
                    setProjectOptionsTicketReasoningEffort(
                      value as ProjectReasoningEffortSelection,
                    );
                  }}
                />
              </Stack>

              {projectOptionsFormError ? (
                <Text size="sm" c="red">
                  {projectOptionsFormError}
                </Text>
              ) : null}
              {updateProjectMutation.isError ? (
                <Text size="sm" c="red">
                  {updateProjectMutation.error.message}
                </Text>
              ) : null}

              <Group justify="flex-end">
                <Button
                  type="submit"
                  loading={updateProjectMutation.isPending}
                  disabled={!projectOptionsDirty}
                >
                  Save Options
                </Button>
              </Group>

              <Box className="project-options-danger-zone">
                <Stack gap="sm">
                  <Text
                    size="xs"
                    tt="uppercase"
                    fw={700}
                    className="project-options-danger-kicker"
                  >
                    Danger zone
                  </Text>
                  <Text size="sm" className="project-options-danger-copy">
                    Delete this project to remove its drafts, tickets, sessions,
                    and orchestrator-managed local artifacts. The source
                    repository directory stays on disk.
                  </Text>
                  <TextInput
                    label={`Type ${projectOptionsProject.slug} to confirm`}
                    value={projectDeleteConfirmText}
                    onChange={(event) => {
                      deleteProjectMutation.reset();
                      setProjectDeleteConfirmText(event.currentTarget.value);
                    }}
                  />
                  {deleteProjectMutation.isError ? (
                    <Text size="sm" c="red">
                      {deleteProjectMutation.error.message}
                    </Text>
                  ) : null}
                  <Group justify="flex-end">
                    <Button
                      type="button"
                      color="red"
                      variant="light"
                      loading={deleteProjectMutation.isPending}
                      disabled={!canDeleteProject}
                      onClick={() =>
                        deleteProjectMutation.mutate(projectOptionsProject.id)
                      }
                    >
                      Delete Project
                    </Button>
                  </Group>
                </Stack>
              </Box>
            </Stack>
          </form>
        ) : null}
      </Modal>

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
                .filter(Boolean),
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
              onChange={(event) =>
                setValidationCommandsText(event.currentTarget.value)
              }
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
