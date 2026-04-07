import type {
  AgentAdapter,
  CommandAck,
  ReasoningEffort,
  ReviewAction,
  UploadDraftArtifactResponse,
} from "../../../../../packages/contracts/src/index.js";

import { apiBaseUrl } from "../../lib/api-base-url.js";

const lastOpenProjectStorageKey = "walleyboard:last-open-project-id";
export const diffLayoutStorageKey = "walleyboard.ticket-workspace.diff-layout";
const inboxReadStateStorageKey = "walleyboard:inbox-read-state";

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

export function readInboxReadState(): Record<string, string> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const storedValue = window.localStorage.getItem(inboxReadStateStorageKey);
    if (storedValue === null) {
      return {};
    }

    const parsedValue = JSON.parse(storedValue) as unknown;
    if (
      parsedValue === null ||
      typeof parsedValue !== "object" ||
      Array.isArray(parsedValue)
    ) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsedValue).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

export function writeInboxReadState(value: Record<string, string>): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      inboxReadStateStorageKey,
      JSON.stringify(value),
    );
  } catch {
    // Ignore storage failures and keep the in-memory inbox state working.
  }
}

async function requestJson<T>(
  path: string,
  init?: RequestInit,
  allowNotFound = false,
): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, init);
  } catch {
    throw new Error("Backend unavailable. Restart the backend and try again.");
  }

  if (allowNotFound && response.status === 404) {
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

export async function fetchJson<T>(path: string): Promise<T> {
  return (await requestJson<T>(path)) as T;
}

export async function fetchOptionalJson<T>(path: string): Promise<T | null> {
  return await requestJson<T>(path, undefined, true);
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  return (await requestJson<T>(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })) as T;
}

export async function patchJson<T>(path: string, body: unknown): Promise<T> {
  return (await requestJson<T>(path, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })) as T;
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
    color: string;
    draft_analysis_agent_adapter: AgentAdapter;
    ticket_work_agent_adapter: AgentAdapter;
    disabled_mcp_servers: string[];
    automatic_agent_review: boolean;
    automatic_agent_review_run_limit: number;
    default_review_action: ReviewAction;
    preview_start_command: string | null;
    worktree_init_command: string | null;
    worktree_teardown_command: string | null;
    worktree_init_run_sequential: boolean;
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
