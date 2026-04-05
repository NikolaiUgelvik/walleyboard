import type {
  DraftTicketState,
  ExecutionAttempt,
  ExecutionSession,
  Project,
  ProtocolEvent,
  ReasoningEffort,
  RepositoryConfig,
  ReviewPackage,
  ReviewRun,
  StructuredEvent,
  TicketFrontmatter,
  TicketReference,
  TicketWorkspaceDiff,
  TicketWorkspacePreview,
  UploadDraftArtifactResponse,
} from "../../../../../packages/contracts/src/index.js";

export const projectModelPresetValues = [
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-haiku-4-5",
] as const;

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

export type TicketReferencesResponse = {
  ticket_references: TicketReference[];
};

export type DraftEventsResponse = {
  events: StructuredEvent[];
  active_run: boolean;
};

export type SessionResponse = {
  session: ExecutionSession;
  agent_controls_worktree: boolean;
};

export type SessionAttemptsResponse = {
  attempts: ExecutionAttempt[];
};

export type SessionLogsResponse = {
  session_id: string;
  logs: string[];
};

export type TicketEventsResponse = {
  events: StructuredEvent[];
};

export type TicketWorkspaceDiffResponse = {
  workspace_diff: TicketWorkspaceDiff;
};

export type TicketWorkspacePreviewResponse = {
  preview: TicketWorkspacePreview;
};

export type RepositoryWorkspacePreview = {
  repository_id: string;
  state: TicketWorkspacePreview["state"];
  preview_url: string | null;
  backend_url: string | null;
  started_at: string | null;
  error: string | null;
};

export type RepositoryWorkspacePreviewResponse = {
  preview: RepositoryWorkspacePreview;
};

export type ReviewPackageResponse = {
  review_package: ReviewPackage;
};

export type ReviewRunResponse = {
  review_run: ReviewRun | null;
};

export type ReviewRunsResponse = {
  review_runs: ReviewRun[];
};

export type NewDraftAction = "save" | "refine" | "questions" | "confirm";
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
export type WorkspaceTerminalTab = {
  id: string;
  label: string;
  socketPath: string;
  worktreePath: string | null;
};
export type WorkspaceTerminalContext =
  | ({
      kind: "single";
      surfaceLabel: "ticket" | "repository";
    } & WorkspaceTerminalTab)
  | {
      kind: "repository_tabs";
      repositories: WorkspaceTerminalTab[];
      surfaceLabel: "repository";
    };
export type ReviewCardActionKind = "merge" | "create_pr";
export type ReviewCardAction = {
  kind: ReviewCardActionKind;
  label: string;
};

export type InspectorState =
  | { kind: "hidden" }
  | { kind: "new_draft" }
  | { kind: "draft"; draftId: string }
  | { kind: "session"; sessionId: string };

export type WalleyBoardProtocolEvent = ProtocolEvent;
export type DraftArtifactUploadResponse = UploadDraftArtifactResponse;
