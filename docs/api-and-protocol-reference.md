# API and Socket Protocol Reference (Current API Contract)

This document is the canonical communication contract between `apps/web` and `apps/backend`.
There is no versioned API path; all clients should treat this as the **single active protocol**.

## 1) Transport and conventions

- **Protocol:** HTTP/REST and Socket.IO over WebSocket.
- **Base URL (frontend):** `apiBaseUrl` in `apps/web/src/lib/api-base-url.ts`
  - `import.meta.env.VITE_API_URL` (trim trailing `/`) when set
  - fallback to `window.location.origin` when running in browser
  - final fallback: `http://127.0.0.1:4000`
- **Frontend headers:** `content-type: application/json` is sent by `postJson`/`patchJson` for JSON commands.
- **Backend JSON enforcement:** most command handlers parse the body against Zod contracts via `parseBody` in `apps/backend/src/lib/http.ts`.
- **Response content type:** JSON for contract responses; preview artifact serving is binary for image MIME responses.

### CORS and preflight

`apps/backend/src/app.ts` adds response headers for all requests:

- `access-control-allow-origin: *`
- `access-control-allow-methods: GET,POST,PATCH,OPTIONS`
- `access-control-allow-headers: content-type`

`OPTIONS` requests are answered as `204` with an empty body.

### Error conventions

- **Validation errors:** `apps/backend/src/lib/http.ts#parseBody` returns `400` and:

```json
{ "error": "Invalid request body", "issues": <zod-error-flatten> }
```

- **Error payload conventions:** most failures return `400`, `404`, or `409` with `{ error: "..." }`; body validation returns `issues`; command-style responses use `CommandAck` with `accepted` and `message`.

### Rate limiting

Configured in `apps/backend/src/lib/rate-limit.ts`:

- Global: `RATE_LIMIT_MAX`, default `6000` requests per `RATE_LIMIT_TIME_WINDOW` (default `1 minute`)
- File route class: `FILE_ROUTE_RATE_LIMIT_MAX`, default `600`/min
- Repository route class: `REPOSITORY_ROUTE_RATE_LIMIT_MAX`, default `300`/min
- Command route class: `COMMAND_ROUTE_RATE_LIMIT_MAX`, default `60`/min

## 2) REST API

Routes are grouped by route domain.

Read routes return JSON on success. Command routes return `CommandAck` on success. Unless a row says otherwise, read routes use `200`, command routes use `200`, and common failure statuses are `400`, `404`, and `409`.

### Health

| Method | Path | Purpose | Request shape | Response schema refs | Notes |
|---|---|---|---|---|---|
| `GET` | `/health` | Runtime health snapshot | N/A | `HealthResponse` | Contract JSON; typical internal transport errors only. |

### Projects

Read routes return project, repository, draft, and ticket JSON. The repository-branches route uses the repository rate-limit class.

| Method | Path | Purpose | Request shape | Response schema refs | Notes |
|---|---|---|---|---|---|
| `GET` | `/projects` | list projects | N/A | `ProjectsResponse` | Inherits the global rate limit. |
| `GET` | `/projects/:projectId` | get one project | params: `projectId` | `ProjectResponse` | `—` |
| `GET` | `/projects/:projectId/repositories` | list repositories for project | params: `projectId` | `RepositoriesResponse` | `—` |
| `GET` | `/projects/:projectId/repositories/:repositoryId/workspace/preview` | read repository preview state | params: `projectId`, `repositoryId` | inline `{ preview: { repository_id, state, preview_url, backend_url, started_at, error } }` | `—` |
| `POST` | `/projects/:projectId/repositories/:repositoryId/workspace/preview` | start/ensure repository preview | body: `{}` | inline `{ preview: { repository_id, state, preview_url, backend_url, started_at, error } }` | `409` on preview start failure. |
| `POST` | `/projects/:projectId/repositories/:repositoryId/workspace/preview/stop` | stop repository preview | body: `{}` | inline `{ preview: { repository_id, state, preview_url, backend_url, started_at, error } }` | `—` |
| `GET` | `/projects/:projectId/repository-branches` | resolve per-repository branches view | query none | `RepositoryBranchesResponse` | `404` when the project is missing; route rate limit class `repository`. |
| `GET` | `/projects/:projectId/archived-tickets` | list archived tickets | params: `projectId` | `TicketsResponse` | `—` |
| `GET` | `/projects/:projectId/tickets` | list active tickets in project | params: `projectId` | `TicketsResponse` | `—` |
| `GET` | `/projects/:projectId/ticket-references` | list searchable ticket references | params: `projectId`, query: `limit`, `query` | inline `{ ticket_references: TicketReference[] }` | `—` |
| `GET` | `/projects/:projectId/drafts` | list drafts in project | params: `projectId` | `DraftsResponse` | `—` |
| `POST` | `/projects` | create project (and initial repository metadata) | `CreateProjectInput` | `CommandAck` | `201` on success; `409` on duplicate/conflict. |
| `PATCH` | `/projects/:projectId` | patch project config | `UpdateProjectInput` | `CommandAck` | `—` |
| `POST` | `/projects/:projectId/update` | compatibility alias for project update | `UpdateProjectInput` | `CommandAck` | Alias for the `PATCH` route above. |
| `POST` | `/projects/:projectId/delete` | delete project and cleanup local artifacts | body: `{}` | `CommandAck` | `—` |

### Drafts

| Method | Path | Purpose | Request shape | Response schema refs | Notes |
|---|---|---|---|---|---|
| `POST` | `/drafts` | create draft | `CreateDraftInput` | `CommandAck` | `201` on success. |
| `GET` | `/drafts/:draftId/events` | list draft events + active-run flag | params: `draftId` | `DraftEventsResponse` | `—` |
| `PATCH` | `/drafts/:draftId` | update draft fields | `UpdateDraftInput` | `CommandAck` | `—` |
| `POST` | `/drafts/:draftId/delete` | delete draft + artifacts | body: `{}` | `CommandAck` | `—` |
| `POST` | `/drafts/:draftId/refine` | trigger AI refinement | `RefineDraftInput` | `CommandAck` | `—` |
| `POST` | `/drafts/:draftId/refine/revert` | revert latest completed refinement | body: `{}` | `CommandAck` | `—` |
| `POST` | `/drafts/:draftId/questions` | trigger feasibility/questions pass | `RefineDraftInput` | `CommandAck` | `—` |
| `POST` | `/drafts/:draftId/confirm` | confirm draft into ready ticket | `ConfirmDraftInput` | `CommandAck` | `400` for invalid reference. |

Artifact APIs:

| Method | Path | Purpose | Request shape | Response schema refs | Notes |
|---|---|---|---|---|---|
| `POST` | `/projects/:projectId/draft-artifacts` | upload pasted image artifact | `UploadDraftArtifactInput` | `UploadDraftArtifactResponse` | `201` on success; `400` for unsupported MIME/type or invalid scope; `500` on write failure. |
| `GET` | `/projects/:projectId/draft-artifacts/:artifactScopeId/:filename` | fetch draft artifact bytes | path params | file binary; `content-type` derived | `—` |

### Tickets

Read and workspace state:

| Method | Path | Purpose | Request shape | Response schema refs | Notes |
|---|---|---|---|---|---|
| `GET` | `/tickets/:ticketId` | read ticket | params: `ticketId` int | `TicketResponse` | `—` |
| `GET` | `/tickets/:ticketId/review-package` | get current review package | params: `ticketId` int | `ReviewPackageResponse` | `—` |
| `GET` | `/tickets/:ticketId/review-run` | get latest review run (or `null`) | params: `ticketId` int | `ReviewRunResponse` | `—` |
| `GET` | `/tickets/:ticketId/review-runs` | list ticket review runs | params: `ticketId` int | `ReviewRunsResponse` | `—` |
| `GET` | `/tickets/:ticketId/events` | list ticket structured events | params: `ticketId` int | `TicketEventsResponse` | `—` |
| `GET` | `/tickets/:ticketId/workspace/summary` | get workspace summary from active worktree or persisted review artifact | params: `ticketId` int | `TicketWorkspaceSummaryResponse` | `409` when the summary cannot be resolved. |
| `GET` | `/tickets/:ticketId/workspace/diff` | get patch diff from active worktree or persisted review artifact | params: `ticketId` int | `TicketWorkspaceDiffResponse` | `409` when the diff cannot be resolved. |
| `GET` | `/tickets/:ticketId/workspace/preview` | read ticket preview state | params: `ticketId` int | `TicketWorkspacePreviewResponse` | `—` |
| `POST` | `/tickets/:ticketId/workspace/preview` | start/refresh ticket preview | body: `{}` | `TicketWorkspacePreviewResponse` | `409` when preview cannot start. |
| `POST` | `/tickets/:ticketId/workspace/preview/stop` | stop ticket preview | body: `{}` | `TicketWorkspacePreviewResponse` | `—` |

Execution lifecycle:

| Method | Path | Purpose | Request shape | Response schema refs | Notes |
|---|---|---|---|---|---|
| `POST` | `/tickets/:ticketId/start` | prepare worktree and begin execution | `StartTicketInput` (`planning_enabled?`) | `CommandAck` | `—` |
| `POST` | `/tickets/:ticketId/stop` | stop running execution | `StopTicketInput` | `CommandAck` | `—` |
| `POST` | `/tickets/:ticketId/resume` | resume execution | `ResumeTicketInput` | `CommandAck` | `—` |
| `POST` | `/tickets/:ticketId/restart` | restart from scratch after interruption | `RestartTicketInput` | `CommandAck` | `—` |

Lifecycle endpoints:

| Method | Path | Purpose | Request shape | Response schema refs | Notes |
|---|---|---|---|---|---|
| `POST` | `/tickets/:ticketId/edit` | reopen `ready` ticket as draft | body: `{}` | `CommandAck` | `—` |
| `POST` | `/tickets/:ticketId/archive` | archive ticket | body: `{}` | `CommandAck` | `—` |
| `POST` | `/tickets/:ticketId/restore` | restore archived ticket | body: `{}` | `CommandAck` | `—` |
| `POST` | `/tickets/:ticketId/delete` | delete ticket + cleanup worktree artifacts | body: `{}` | `CommandAck` | `—` |

Review operations:

| Method | Path | Purpose | Request shape | Response schema refs | Notes |
|---|---|---|---|---|---|
| `POST` | `/tickets/:ticketId/request-changes` | attach operator changes request and restart execution | `RequestChangesInput` | `CommandAck` | `—` |
| `POST` | `/tickets/:ticketId/start-agent-review` | start AI review loop | body: `{}` | `CommandAck` | `—` |
| `POST` | `/tickets/:ticketId/stop-agent-review` | stop AI review loop | body: `{}` | `CommandAck` | `—` |
| `POST` | `/tickets/:ticketId/create-pr` | create PR from review state | body: `{}` | `CommandAck` | `—` |
| `POST` | `/tickets/:ticketId/merge` | merge reviewed branch into target | body: `{}` | `CommandAck` | `—` |
| `POST` | `/tickets/:ticketId/reconcile` | reconcile linked PR state | body: `{}` | `CommandAck` | `—` |

### Sessions

| Method | Path | Purpose | Request shape | Response schema refs | Notes |
|---|---|---|---|---|---|
| `GET` | `/sessions/:sessionId` | read session + current controls flag | params: `sessionId` | `SessionResponse` | `—` |
| `GET` | `/sessions/:sessionId/attempts` | list execution attempts | params: `sessionId` | `SessionAttemptsResponse` | `—` |
| `GET` | `/sessions/:sessionId/logs` | fetch session logs | params: `sessionId` | `SessionLogsResponse` | `—` |
| `POST` | `/sessions/:sessionId/terminal/takeover` | move manual control to project terminal | body: `{}` | `CommandAck` | `—` |
| `POST` | `/sessions/:sessionId/terminal/restore-agent` | restore agent control from manual mode | body: `{}` | `CommandAck` | `—` |
| `POST` | `/sessions/:sessionId/checkpoint-response` | send checkpoint / approval message | `CheckpointResponseInput` | `CommandAck` | `400` for invalid payload; `404` when missing. |
| `POST` | `/sessions/:sessionId/input` | append user session input | `SessionInput` | `CommandAck` | `400` for invalid payload; `404` when missing. |

## 3) Socket.IO contracts

### `/events`

Runtime: `apps/backend/src/lib/socket-server.ts`

- Namespace: `/events`
- Client connects with Socket.IO standard connect options.
- Server emits protocol envelopes on event name `protocol.event`.
- One event payload per incoming event from backend publisher: `ProtocolEvent` (see below).

#### `protocol.event` payload

`ProtocolEvent` from `packages/contracts/src/protocol.ts`:

```text
{
  event_id: string,
  event_type: EventType,
  occurred_at: string (ISO 8601),
  entity_type: "ticket" | "session" | "attempt" | "draft" | "review_package" | "review_run" | "pull_request" | "worktree" | "git" | "system",
  entity_id: string,
  payload: Record<string, unknown>
}
```

### `/terminals`

- Namespace: `/terminals`
- Handshake auth: server requires a path target and accepts:
  - `auth.socketPath`
  - or query `socketPath`

`auth.socketPath` is checked first; if missing, query `socketPath` is used.

- **Path contract (must match exactly):**
  - `/tickets/:ticketId/workspace/terminal`
  - `/projects/:projectId/repositories/:repositoryId/workspace/terminal`

If no value is supplied or value is malformed, server emits:

```json
{ "type": "terminal.error", "message": "Terminal socket target is required" }
```

or

```json
{ "type": "terminal.error", "message": "Unknown terminal socket target" }
```

followed by disconnect.

### Client → server terminal messages (`terminal.message`)

Messages are JSON strings on event name `terminal.message`.

- `terminal.input`

```json
{ "type": "terminal.input", "data": "ls -la\n" }
```

- `terminal.resize`

```json
{ "type": "terminal.resize", "cols": 120, "rows": 32 }
```

Parse constraints:

- Message must be valid JSON.
- `terminal.resize` requires positive numbers for `cols` and `rows`.
- `terminal.input.data` must be a string.
- Valid `terminal.message` payloads use event names:
  - `terminal.input`
  - `terminal.resize`
- Unrecognized valid payloads are ignored after parsing.
- Parse/type violations result in server response:

```json
{ "type": "terminal.error", "message": "Unable to parse terminal message" }
```

### Server → client terminal messages (`terminal.message`)

- `terminal.started`

```json
{ "type": "terminal.started", "worktree_path": "/path/to/worktree" }
```

- `terminal.output`

```json
{ "type": "terminal.output", "data": "hello\r\n" }
```

- `terminal.exit`

```json
{ "type": "terminal.exit", "exit_code": 0 }
```

- `terminal.error`

```json
{ "type": "terminal.error", "message": "Session initialization failed" }
```

On terminal initialization failures, on invalid ticket/worktree state, and on unknown parse errors, the server uses `terminal.error` and closes the socket.

`terminal.exit` includes a `signal` field only when `node-pty` reports one; otherwise the field is omitted from the JSON payload.

## 4) Shared event/command contract (`packages/contracts/src/protocol.ts`)

### `CommandAck`

```text
{
  accepted: boolean,
  command_id: string,
  issued_at: string (ISO 8601),
  resource_refs: {
    project_id?: string,
    repo_id?: string,
    ticket_id?: number,
    session_id?: string,
    draft_id?: string,
  },
  message: string | null
}
```

Generated by `makeCommandAck` in `apps/backend/src/lib/command-ack.ts`.

### Event matrix

`StructuredEvent.event_type` is free-form. The matrix below keeps the current `ProtocolEvent` catalog, the REST-surfaced structured event families, and the frontend consumer notes in one place.

| Event type(s) | Surface | Current use |
|---|---|---|
| `ticket.updated` | `ProtocolEvent` on `/events` | updates ticket caches and invalidates attached session state |
| `ticket.workspace.updated` | `ProtocolEvent` on `/events` | refreshes workspace diff, preview, and summary caches |
| `ticket.archived` | `ProtocolEvent` on `/events` | moves the ticket to archived cache and hides the selected session when needed |
| `ticket.deleted` | `ProtocolEvent` on `/events` | removes ticket and related workspace/session caches |
| `draft.updated` | `ProtocolEvent` on `/events` | upserts the draft cache |
| `draft.deleted` | `ProtocolEvent` on `/events` | removes the draft cache and clears the inspector when selected |
| `draft.ready` | `ProtocolEvent` on `/events` | removes the draft from the project drafts cache |
| `review_run.updated` | `ProtocolEvent` on `/events` | updates the current review-run cache |
| `session.updated` | `ProtocolEvent` on `/events` | updates session state and invalidates attempts |
| `session.output` | `ProtocolEvent` on `/events` | appends session log chunks |
| `session.checkpoint_requested` | `ProtocolEvent` on `/events` | not currently handled specially by the frontend |
| `session.input_requested` | `ProtocolEvent` on `/events` | not currently handled specially by the frontend |
| `session.summary_generated` | `ProtocolEvent` on `/events` | not currently handled specially by the frontend |
| `review_package.generated` | `ProtocolEvent` on `/events` | updates review package state and invalidates review-run lists |
| `validation.updated` | `ProtocolEvent` on `/events` | not currently handled specially by the frontend |
| `pull_request.updated` | `ProtocolEvent` on `/events` | not currently handled specially by the frontend |
| `structured_event.created` | `ProtocolEvent` on `/events` carrying `payload.structured_event` | syncs structured draft and ticket event lists |
| `command.rejected` | `ProtocolEvent` on `/events` | not currently handled specially by the frontend |
| `draft.refine.started`, `draft.refine.failed`, `draft.refine.completed`, `draft.refine.reverted`, `draft.questions.completed` | `StructuredEvent` via `/drafts/:draftId/events` | draft history only |
| `ticket.created`, `ticket.started`, `ticket.stopped`, `ticket.changes_requested`, `ticket.merge_failed`, `ticket.restarted`, `ticket.interrupted`, `ticket.archived`, `ticket.restored`, `ticket.merged`, `pull_request.created`, `pull_request.merged` | `StructuredEvent` via `/tickets/:ticketId/events` | ticket history only |
| `session.started`, `session.input_recorded`, `session.interrupted`, `session.relaunched`, `session.resumed`, `session.restarted`, `review_run.started`, `review_run.completed`, `review_run.failed` | `StructuredEvent` persisted for workflow history and reconciliation | not surfaced through REST today |

## 5) Frontend integration map

- **Socket setup:**
  - `apps/web/src/lib/socket-io.ts` (`connectWalleyboardSocket`) builds Socket.IO URLs from `apiBaseUrl`.
  - Protocol stream subscription: `apps/web/src/features/walleyboard/use-protocol-event-sync.ts`.
  - Terminal stream (PTY) usage: `apps/web/src/components/TicketWorkspaceTerminal.tsx`.
- **REST client behavior:**
  - `apps/web/src/features/walleyboard/shared-api.ts` owns fetch helpers (`fetchJson`, `postJson`, `patchJson`, `fetchOptionalJson`) and fallback behavior for `VITE_API_URL`.
  - Error extraction expects `{ error }`/`{ message }` fallback and always throws a message string for consumers.
- **Endpoint callers by domain**
  - **Health/projects:** `apps/web/src/features/walleyboard/use-walleyboard-server-state.ts`
  - **Drafts:** `apps/web/src/features/walleyboard/draft-queries.ts`, `apps/web/src/features/walleyboard/use-walleyboard-mutations.ts`
  - **Tickets:** `apps/web/src/features/walleyboard/use-ticket-review-queries.ts`, `apps/web/src/features/walleyboard/use-ticket-workspace-preview.ts`, `apps/web/src/features/walleyboard/use-ticket-diff-line-summary.ts`, `apps/web/src/features/walleyboard/use-walleyboard-controller.tsx`, `apps/web/src/features/walleyboard/use-walleyboard-mutations.ts`, `apps/web/src/features/walleyboard/use-selected-repository-workspace.ts`
  - **Sessions:** `apps/web/src/features/walleyboard/use-walleyboard-server-state.ts`, `apps/web/src/features/walleyboard/use-ticket-ai-review-status.ts`, `apps/web/src/features/walleyboard/use-walleyboard-controller.tsx`, `apps/web/src/features/walleyboard/use-walleyboard-mutations.ts`
  - **Project workspace terminals and previews:** `apps/web/src/features/walleyboard/use-selected-repository-workspace.ts`, `apps/web/src/features/walleyboard/use-ticket-workspace-preview.ts`, `apps/web/src/components/TicketWorkspaceTerminal.tsx`

## 6) Source of truth mapping

- REST endpoint definitions: `apps/backend/src/routes/*.ts` and `apps/backend/src/routes/tickets/*.ts`
  - health: `apps/backend/src/routes/health.ts`
  - projects: `apps/backend/src/routes/projects.ts`
  - drafts: `apps/backend/src/routes/drafts.ts`
  - tickets: `apps/backend/src/routes/tickets/{read-workspace-routes.ts,execution-routes.ts,lifecycle-routes.ts,review-routes.ts}`
  - sessions: `apps/backend/src/routes/sessions.ts`
- Shared payload types and envelopes: `packages/contracts/src/{protocol.ts,models.ts,ticket-references.ts}`
- Structured event writers and publishers: `apps/backend/src/lib/{execution-runtime/draft-analysis.ts,ticket-workspace-service.ts,sqlite-store/{draft-workflow.ts,ticket-execution-workflow.ts,review-repository.ts,session-repository.ts}}`
- Runtime socket behavior:
  - protocol/events namespace and terminal namespace: `apps/backend/src/lib/socket-server.ts`
  - terminal message validation/serialization: `apps/backend/src/routes/workspace-terminal-socket.ts`

## 7) Maintenance checklist for PRs

When changing frontend/backend public communication:

1. Keep endpoint list in this file aligned with route registration in backend files.
2. Add/adjust the event matrix for any new `makeProtocolEvent` usages in `packages/contracts/src/protocol.ts`.
3. Update this doc in lockstep whenever new `protocol.event` payload shapes are emitted.
4. Update any new socket path constraints in `/terminals` section and include parse/validation examples.
5. Ensure frontend socket and endpoint integration points remain linked from this map.
