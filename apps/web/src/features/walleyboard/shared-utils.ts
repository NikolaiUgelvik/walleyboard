import type {
  DraftTicketState,
  ExecutionSession,
  Project,
  PullRequestRef,
  RepositoryConfig,
  ReviewAction,
  StructuredEvent,
  TicketFrontmatter,
} from "../../../../../packages/contracts/src/index.js";

import {
  type DraftQuestionsResult,
  type ProjectModelPreset,
  type ProjectReasoningEffortSelection,
  projectModelPresetValues,
  type ReviewCardAction,
} from "./shared-types.js";

const stoppableSessionStatuses = [
  "queued",
  "running",
  "paused_checkpoint",
  "paused_user_control",
  "awaiting_input",
] satisfies ExecutionSession["status"][];
export const defaultProjectColor = "#2563EB";

type DraftEventOperation = "refine" | "questions";
type DraftEventStatus = "started" | "completed" | "failed" | "reverted";

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

export function normalizeProjectColor(
  value: string | null | undefined,
): string {
  if (typeof value !== "string") {
    return defaultProjectColor;
  }

  const trimmed = value.trim();
  return /^#[0-9A-Fa-f]{6}$/.test(trimmed)
    ? trimmed.toUpperCase()
    : defaultProjectColor;
}

export function deriveProjectInitials(name: string): string {
  const words = name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);

  if (words.length === 0) {
    return "PR";
  }

  if (words.length === 1) {
    return (words[0] ?? "PR").slice(0, 2).toUpperCase();
  }

  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
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

export function hasRepositoryTargetBranchChanges(input: {
  project: Project | null;
  repositories: RepositoryConfig[];
  repositoryTargetBranches: Record<string, string>;
}): boolean {
  if (input.project === null) {
    return false;
  }

  return input.repositories.some((repository) => {
    const currentTargetBranch =
      repository.target_branch ?? input.project?.default_target_branch ?? "";
    const selectedTargetBranch =
      input.repositoryTargetBranches[repository.id] ?? currentTargetBranch;
    return selectedTargetBranch !== currentTargetBranch;
  });
}

export function collectRepositoryTargetBranchUpdates(input: {
  project: Project;
  repositories: RepositoryConfig[];
  repositoryTargetBranches: Record<string, string>;
}): Array<{ repositoryId: string; targetBranch: string }> {
  return input.repositories.flatMap((repository) => {
    const currentTargetBranch =
      repository.target_branch ?? input.project.default_target_branch ?? "";
    const selectedTargetBranch =
      input.repositoryTargetBranches[repository.id] ?? currentTargetBranch;

    if (
      selectedTargetBranch.trim().length === 0 ||
      selectedTargetBranch === currentTargetBranch
    ) {
      return [];
    }

    return [
      {
        repositoryId: repository.id,
        targetBranch: selectedTargetBranch,
      },
    ];
  });
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
): Project["draft_analysis_reasoning_effort"] | null {
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

export function parseDraftRefinementResult(value: unknown): {
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

export function resolveVisibleBoardItems(input: {
  boardSearch: string;
  drafts: DraftTicketState[];
  tickets: TicketFrontmatter[];
}): {
  doneColumnTickets: TicketFrontmatter[];
  groupedTickets: Record<
    "draft" | "ready" | "in_progress" | "review" | "done",
    TicketFrontmatter[]
  >;
  visibleDrafts: DraftTicketState[];
  visibleTickets: TicketFrontmatter[];
} {
  const searchNeedle = normalizeText(input.boardSearch);
  const visibleDrafts = input.drafts.filter((draft) =>
    draftMatchesSearch(draft, searchNeedle),
  );
  const visibleTickets = input.tickets.filter((ticket) =>
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

  return {
    doneColumnTickets: groupedTickets.done,
    groupedTickets,
    visibleDrafts,
    visibleTickets,
  };
}

export function focusElementById(id: string): void {
  const element = document.getElementById(id);
  if (!element) {
    return;
  }

  element.scrollIntoView({ behavior: "smooth", block: "center" });
  if (element instanceof HTMLElement) {
    element.focus();
  }
}
