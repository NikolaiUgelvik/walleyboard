# Implementation Starter Pack

This document turns the PRD into the current module boundaries, workflow terms, and implementation status for the local-first MVP.

## Backend Boundaries

- `routes`
  - HTTP and WebSocket transport only
  - validate inputs with shared contract schemas
  - delegate all state changes to services or stores
- `lib/event-hub`
  - fan-out of backend events to WebSocket subscribers
- `lib/sqlite-store`
  - current local persistence layer for projects, repositories, drafts, tickets, sessions, attempts, logs, and ticket/session events
  - should later be split into narrower repository/service modules as execution complexity grows

## Shared Package Boundaries

- `packages/contracts`
  - source of truth for API payloads and event envelopes
  - Zod first, inferred types second
- `packages/db`
  - SQLite schema only
  - no business logic

## High-Level Status

Implemented now:

- local Fastify + React app with shared contracts, SQLite persistence, and websocket-driven board/session updates
- board workflow with `Draft`, `Ready`, `In progress`, `In review`, and `Done`
- draft workflow with persisted Markdown drafts plus `Refine`, `Questions`, `Revert Refine`, and `Create Ready`
- artifact-backed Markdown image references for pasted screenshots, preserved by stable `artifact_scope_id` values across save, reload, refine, revert, and draft-to-ready promotion
- execution workflow that starts a `ready` ticket into a persisted session, prepares a git worktree, supports immediate execution or a planning-first start, runs real `codex exec`, and keeps follow-up attempts on the same logical session/worktree
- Codex-managed execution modes through `codex exec`, with planning-first runs using read-only behavior and implementation runs using workspace-write behavior
- review workflow that runs configured validation commands, generates a local review package and diff artifact, supports request-changes and resume, allows manual terminal takeover with restore-agent handoff, and merges directly from `review` into the target branch with cleanup
- conservative restart recovery that marks active sessions `interrupted` instead of auto-restoring live execution

Not yet implemented:

- automatic restoration of a live execution after an application restart
- GitHub pull request creation or external review reconciliation from the `review` stage
- richer validation configuration and review-time override handling beyond the current project-setup defaults

## Current Workflow Terms

- Board columns and ticket states use `Draft`/`draft`, `Ready`/`ready`, `In progress`/`in_progress`, `In review`/`review`, and `Done`/`done`.
- The draft-to-ready flow is "edit draft -> `Refine` or `Questions` -> optional `Revert Refine` -> `Create Ready`".
- Execution sessions use `queued`, `running`, `paused_checkpoint`, `paused_user_control`, `awaiting_input`, `interrupted`, `failed`, and `completed`.
- The review flow is `ready -> in_progress -> review -> done`, with request changes or resume moving work back into `in_progress` on the same logical session/worktree. `create-pr` and `reconcile` remain scaffolded only.

## Next Milestones

- Add GitHub pull request creation and reconciliation when direct merge is not the right review path.
- Add richer validation configuration and override handling.
- Decide whether interrupted sessions should auto-resume or stay manual after restart.

## Starter Endpoints

Representative current route surface. `create-pr` and `reconcile` are scaffolded review actions; see `apps/backend/src/routes` for the full route set.

- `GET /health`
- `GET /projects`
- `GET /projects/:projectId`
- `GET /projects/:projectId/archived-tickets`
- `GET /projects/:projectId/repositories`
- `GET /projects/:projectId/tickets`
- `GET /projects/:projectId/drafts`
- `GET /projects/:projectId/draft-artifacts/:artifactScopeId/:filename`
- `GET /drafts/:draftId/events`
- `GET /tickets/:ticketId`
- `GET /tickets/:ticketId/review-package`
- `GET /tickets/:ticketId/events`
- `GET /tickets/:ticketId/workspace/diff`
- `GET /tickets/:ticketId/workspace/preview`
- `GET /sessions/:sessionId`
- `GET /sessions/:sessionId/attempts`
- `GET /sessions/:sessionId/logs`
- `POST /projects`
- `PATCH /projects/:projectId`
- `POST /drafts`
- `POST /projects/:projectId/draft-artifacts`
- `PATCH /drafts/:draftId`
- `POST /drafts/:draftId/delete`
- `POST /drafts/:draftId/refine`
- `POST /drafts/:draftId/refine/revert`
- `POST /drafts/:draftId/questions`
- `POST /drafts/:draftId/confirm`
- `POST /tickets/:ticketId/start`
- `POST /tickets/:ticketId/stop`
- `POST /tickets/:ticketId/resume`
- `POST /tickets/:ticketId/delete`
- `POST /tickets/:ticketId/request-changes`
- `POST /tickets/:ticketId/create-pr`
- `POST /tickets/:ticketId/merge`
- `POST /tickets/:ticketId/reconcile`
- `POST /tickets/:ticketId/workspace/preview`
- `POST /sessions/:sessionId/terminal/takeover`
- `POST /sessions/:sessionId/terminal/restore-agent`
- `POST /sessions/:sessionId/checkpoint-response`
- `POST /sessions/:sessionId/input`
- `GET /ws`

## Starter Event Families

- `draft.updated`
- `draft.deleted`
- `draft.ready`
- `ticket.updated`
- `ticket.workspace.updated`
- `ticket.archived`
- `ticket.deleted`
- `session.updated`
- `session.output`
- `session.checkpoint_requested`
- `session.input_requested`
- `session.summary_generated`
- `review_package.generated`
- `validation.updated`
- `pull_request.updated`
- `structured_event.created`
- `command.rejected`

## Current Implementation Notes

- Project setup is real and persisted in SQLite, and repository validation commands can be configured during project setup.
- Board-visible work now uses the `Draft`, `Ready`, `In progress`, `In review`, and `Done` flow, with websocket updates keeping drafts, tickets, sessions, and review packages current in the UI.
- The draft workflow is real and persisted: edit Markdown drafts, run `Refine` or `Questions`, optionally `Revert Refine`, then `Create Ready` to promote the draft into a `ready` ticket.
- Pasted screenshots become artifact-backed Markdown image references stored under a stable `artifact_scope_id`, so they survive save, reload, refine, revert, and ready-ticket promotion.
- Starting a `ready` ticket creates a persisted session and first attempt, prepares a git worktree and working branch, and launches either immediate execution or a planning-first run.
- Planning-first execution pauses in `paused_checkpoint` / awaiting-feedback mode, and approval or requested plan changes resume the same logical session on the prepared worktree.
- Execution runs through real `codex exec` with PTY-backed logs, live session input forwarding, explicit stop/resume, requested-changes retries, and manual terminal takeover with restore-agent handoff.
- Successful execution runs validation before review handoff, generates a local review package and persisted diff artifact, surfaces review-ready and waiting action cards, and moves the ticket to `review`.
- The session workspace view combines diff, preview, interpreted activity, and a raw project terminal transcript for the prepared worktree.
- From `review`, local direct merge to the target branch is implemented, including worktree and local-branch cleanup plus automatic merge-conflict fallback that moves work back to `in_progress` when recovery cannot finish the merge safely.
- Ticket deletion stops active work when needed, removes persisted ticket/session metadata, and deletes orchestrator-owned local artifacts such as worktrees, local branches, summaries, and validation directories.
- Backend startup marks active sessions and attempts `interrupted`, preserves the existing worktree and branch, and leaves resume manual instead of auto-restoring live execution.
- GitHub PR creation and external reconciliation are scaffolded only and are not implemented yet.
