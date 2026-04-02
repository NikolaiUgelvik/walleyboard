import {
  Badge,
  Box,
  Group,
  List,
  SegmentedControl,
  Stack,
  Text,
  useMantineColorScheme,
} from "@mantine/core";
import type {
  AgentAdapter,
  CommandAck,
  DraftTicketState,
  ExecutionBackend,
  ExecutionSession,
  Project,
  ProtocolEvent,
  PullRequestRef,
  ReasoningEffort,
  RepositoryConfig,
  ReviewAction,
  ReviewPackage,
  ReviewRun,
  StructuredEvent,
  TicketFrontmatter,
  TicketWorkspaceDiff,
  TicketWorkspacePreview,
  UploadDraftArtifactResponse,
} from "../../../../../packages/contracts/src/index.js";

import { MarkdownContent } from "../../components/MarkdownContent.js";
import { apiBaseUrl } from "../../lib/api-base-url.js";

export const websocketUrl = `${apiBaseUrl.replace(/^http/, "ws")}/ws`;
export const boardColumns = [
  "draft",
  "ready",
  "in_progress",
  "review",
  "done",
] satisfies TicketFrontmatter["status"][];

const lastOpenProjectStorageKey = "walleyboard:last-open-project-id";
const stoppableSessionStatuses = [
  "queued",
  "running",
  "paused_checkpoint",
  "paused_user_control",
  "awaiting_input",
] satisfies ExecutionSession["status"][];

export const boardColumnMeta: Record<
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

export const projectModelPresetValues = [
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
] as const;
export const projectModelPresetOptions = [
  { value: "default", label: "Default" },
  ...projectModelPresetValues.map((value) => ({ value, label: value })),
  { value: "custom", label: "Custom" },
];
export const reasoningEffortOptions = [
  { value: "default", label: "Default" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
];
export const executionBackendOptions = [
  { label: "Host", value: "host" },
  { label: "Docker", value: "docker" },
] satisfies Array<{ label: string; value: ExecutionBackend }>;
export const reviewActionOptions = [
  { label: "Direct merge", value: "direct_merge" },
  { label: "Create pull request", value: "pull_request" },
] satisfies Array<{ label: string; value: ReviewAction }>;
export const agentAdapterOptions = [
  { label: "Codex", value: "codex" },
  { label: "Claude Code", value: "claude-code" },
] satisfies Array<{ label: string; value: AgentAdapter }>;

export function readLastOpenProjectId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const projectId = window.localStorage.getItem(lastOpenProjectStorageKey);
    return projectId && projectId.length > 0 ? projectId : null;
  } catch {
    return null;
  }
}

export function writeLastOpenProjectId(projectId: string | null): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (projectId === null) {
      window.localStorage.removeItem(lastOpenProjectStorageKey);
      return;
    }

    window.localStorage.setItem(lastOpenProjectStorageKey, projectId);
  } catch {
    // Ignore storage failures and keep the in-memory selection working.
  }
}

export type ProjectModelPreset =
  | "default"
  | (typeof projectModelPresetValues)[number]
  | "custom";
export type ProjectReasoningEffortSelection = "default" | ReasoningEffort;

export type ProjectsResponse = {
  projects: Project[];
};

export type RepositoriesResponse = {
  repositories: RepositoryConfig[];
};

export type DraftsResponse = {
  drafts: DraftTicketState[];
};

export type TicketsResponse = {
  tickets: TicketFrontmatter[];
};

export type DraftEventsResponse = {
  events: StructuredEvent[];
  active_run: boolean;
};

export type SessionResponse = {
  session: ExecutionSession;
  agent_controls_worktree: boolean;
};

export type SessionLogsResponse = {
  session_id: string;
  logs: string[];
};

export type TicketWorkspaceDiffResponse = {
  workspace_diff: TicketWorkspaceDiff;
};

export type TicketWorkspacePreviewResponse = {
  preview: TicketWorkspacePreview;
};

export type ReviewPackageResponse = {
  review_package: ReviewPackage;
};

export type ReviewRunResponse = {
  review_run: ReviewRun;
};

export type NewDraftAction = "save" | "refine" | "questions" | "confirm";
type DraftEventOperation = "refine" | "questions";
type DraftEventStatus = "started" | "completed" | "failed" | "reverted";

export type DraftQuestionsResult = {
  verdict: string;
  summary: string;
  assumptions: string[];
  open_questions: string[];
  risks: string[];
  suggested_draft_edits: string[];
};

export type ArchiveActionFeedback = {
  tone: "green" | "red";
  message: string;
};

export type DiffLayout = "split" | "stacked";
export type WorkspaceModalKind = "diff" | "terminal" | "activity";
export type ReviewCardActionKind = "merge" | "create_pr" | "open_pr";
export type ReviewCardAction = {
  kind: ReviewCardActionKind;
  label: string;
};

export type InspectorState =
  | { kind: "hidden" }
  | { kind: "new_draft" }
  | { kind: "draft"; draftId: string }
  | { kind: "session"; sessionId: string };

export function isStoppableSessionStatus(
  status: ExecutionSession["status"],
): status is (typeof stoppableSessionStatuses)[number] {
  return stoppableSessionStatuses.includes(
    status as (typeof stoppableSessionStatuses)[number],
  );
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function deriveRepositoryName(path: string, fallback: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? (slugify(fallback) || "repo");
}

export function resolveRepositoryTargetBranch(
  repository: RepositoryConfig,
  defaultTargetBranch: string | null,
): string {
  return repository.target_branch ?? defaultTargetBranch ?? "";
}

export function mapRepositoryTargetBranches(
  repositories: RepositoryConfig[],
  defaultTargetBranch: string | null,
): Record<string, string> {
  const next: Record<string, string> = {};

  for (const repository of repositories) {
    const targetBranch = resolveRepositoryTargetBranch(
      repository,
      defaultTargetBranch,
    );
    if (targetBranch.length > 0) {
      next[repository.id] = targetBranch;
    }
  }

  return next;
}

export function mergeRepositoryTargetBranches(
  current: Record<string, string>,
  repositories: RepositoryConfig[],
  defaultTargetBranch: string | null,
): Record<string, string> {
  const next = mapRepositoryTargetBranches(repositories, defaultTargetBranch);

  for (const repository of repositories) {
    const currentValue = current[repository.id];
    if (typeof currentValue === "string" && currentValue.length > 0) {
      next[repository.id] = currentValue;
    }
  }

  return next;
}

export function repositoryTargetBranchesEqual(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => left[key] === right[key]);
}

export function buildRepositoryBranchOptions(
  branches: string[],
  currentTargetBranch: string | null,
): { value: string; label: string }[] {
  const optionValues = currentTargetBranch
    ? [currentTargetBranch, ...branches]
    : branches;
  return [...new Set(optionValues)]
    .filter((value) => value.length > 0)
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({
      value,
      label: value,
    }));
}

export const diffLayoutStorageKey = "walleyboard.ticket-workspace.diff-layout";

export function readDiffLayoutPreference(): DiffLayout {
  if (typeof window === "undefined") {
    return "split";
  }

  const storedValue = window.localStorage.getItem(diffLayoutStorageKey);
  return storedValue === "stacked" ? "stacked" : "split";
}

export async function fetchJson<T>(path: string): Promise<T> {
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

export async function fetchOptionalJson<T>(path: string): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`);
  } catch {
    throw new Error("Backend unavailable. Restart the backend and try again.");
  }

  if (response.status === 404) {
    return null;
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

export async function postJson<T>(path: string, body: unknown): Promise<T> {
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

export async function patchJson<T>(path: string, body: unknown): Promise<T> {
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

export async function blobToBase64(blob: Blob): Promise<string> {
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

export function buildMarkdownImageInsertion(
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

export async function uploadDraftArtifactRequest(input: {
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

export async function saveProjectOptionsRequest(
  projectId: string,
  body: {
    agent_adapter: AgentAdapter;
    execution_backend: ExecutionBackend;
    automatic_agent_review: boolean;
    default_review_action: ReviewAction;
    pre_worktree_command: string | null;
    post_worktree_command: string | null;
    draft_analysis_model: string | null;
    draft_analysis_reasoning_effort: ReasoningEffort | null;
    ticket_work_model: string | null;
    ticket_work_reasoning_effort: ReasoningEffort | null;
    repository_target_branches?: Array<{
      repository_id: string;
      target_branch: string;
    }>;
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

export function humanizeTicketStatus(
  status: TicketFrontmatter["status"],
): string {
  switch (status) {
    case "in_progress":
      return "In Progress";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

export function upsertById<T extends { id: string | number }>(
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

export function ticketStatusColor(status: TicketFrontmatter["status"]): string {
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

export function sessionStatusColor(status: ExecutionSession["status"]): string {
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

export function humanizeSessionStatus(
  status: ExecutionSession["status"],
): string {
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

export function humanizeReviewAction(action: ReviewAction): string {
  return action === "pull_request" ? "Create pull request" : "Direct merge";
}

export function hasActiveLinkedPullRequest(
  linkedPr: TicketFrontmatter["linked_pr"],
): linkedPr is PullRequestRef {
  return (
    linkedPr !== null &&
    linkedPr.state !== "closed" &&
    linkedPr.state !== "merged"
  );
}

export function describePullRequestStatus(linkedPr: PullRequestRef): string {
  if (linkedPr.state === "merged") {
    return "Merged";
  }

  if (linkedPr.state === "closed") {
    return "Closed";
  }

  switch (linkedPr.review_status) {
    case "approved":
      return "Approved";
    case "changes_requested":
      return "Changes requested";
    case "pending":
      return "Awaiting review";
    default:
      return "Open";
  }
}

export function resolveReviewCardActions(
  project: Project | null | undefined,
  ticket: TicketFrontmatter,
): {
  primary: ReviewCardAction | null;
  secondary: ReviewCardAction | null;
} {
  if (ticket.status !== "review") {
    return {
      primary: null,
      secondary: null,
    };
  }

  if (hasActiveLinkedPullRequest(ticket.linked_pr)) {
    return {
      primary: {
        kind: "open_pr",
        label: `Open PR #${ticket.linked_pr.number}`,
      },
      secondary: null,
    };
  }

  if (project?.default_review_action === "pull_request") {
    return {
      primary: {
        kind: "create_pr",
        label: "Create pull request",
      },
      secondary: {
        kind: "merge",
        label: "Merge",
      },
    };
  }

  return {
    primary: {
      kind: "merge",
      label: "Merge",
    },
    secondary: {
      kind: "create_pr",
      label: "Create pull request",
    },
  };
}

export function humanizePlanStatus(
  status: ExecutionSession["plan_status"],
): string {
  const normalized = status.replace(/_/g, " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

export function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

export function resolveProjectModelPreset(
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

export function resolveProjectCustomModelValue(
  model: Project["draft_analysis_model"],
): string {
  return resolveProjectModelPreset(model) === "custom" ? (model ?? "") : "";
}

export function resolveProjectModelValue(
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

export function resolveProjectReasoningEffortSelection(
  effort: Project["draft_analysis_reasoning_effort"],
): ProjectReasoningEffortSelection {
  return effort ?? "default";
}

export function resolveProjectReasoningEffortValue(
  selection: ProjectReasoningEffortSelection,
): ReasoningEffort | null {
  return selection === "default" ? null : selection;
}

export function resolveOptionalProjectCommandValue(
  value: string,
): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function formatTimestamp(value: string): string {
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

export function findLatestRevertableRefineEvent(
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

export function parseDraftEventMeta(event: StructuredEvent): {
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
          ? "Agent run started."
          : status === "failed"
            ? "Agent run failed."
            : status === "reverted"
              ? "Agent run reverted."
              : "Agent run completed.",
    error: typeof event.payload.error === "string" ? event.payload.error : null,
    result,
  };
}

export function parseDraftQuestionsResult(
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

export function MarkdownListItems({ items }: { items: string[] }) {
  const seenItems = new Map<string, number>();
  const keyedItems = items.map((item) => {
    const occurrence = seenItems.get(item) ?? 0;
    seenItems.set(item, occurrence + 1);

    return {
      item,
      key: `markdown-list-item-${item}-${occurrence}`,
    };
  });

  return (
    <List size="sm" spacing={4}>
      {keyedItems.map(({ item, key }) => (
        <List.Item key={key}>
          <MarkdownContent content={item} />
        </List.Item>
      ))}
    </List>
  );
}

export function DraftQuestionsResultView({
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

export function DraftEventResultView({
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

export function draftMatchesSearch(
  draft: DraftTicketState,
  needle: string,
): boolean {
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

export function ticketMatchesSearch(
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
    ticket.linked_pr?.url ?? "",
    ...ticket.acceptance_criteria,
  ]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

export function focusElementById(id: string): void {
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

export function ColorSchemeControl() {
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

export type WalleyBoardProtocolEvent = ProtocolEvent;
