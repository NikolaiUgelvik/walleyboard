# Implementation Starter Pack

This document turns the PRD into the current module boundaries, workflow terms, and implementation status for the local-first MVP.

## Backend Boundaries

- `routes`
  - HTTP and WebSocket transport only
  - validate inputs with shared contract schemas
  - delegate all state changes to focused services
- `routes/tickets`
  - split by concern into read/workspace, execution, lifecycle, and review registration modules
- `lib/event-hub`
  - fan-out of backend events to WebSocket subscribers
- `lib/docker-runtime`
  - Docker health checks, managed session-container lifecycle, and runtime image bootstrapping for Docker-backed projects
- `lib/sqlite-store`
  - shared SQLite bootstrap, schema setup, transaction helpers, and record mappers
  - focused repositories for projects, drafts, tickets, sessions, structured events, and review artifacts
  - preserves draft and ticket Markdown inside SQLite records instead of creating standalone ticket files
  - workflow services for draft confirmation/refinement, ticket execution lifecycle, queue claiming, and project deletion
- `lib/execution-runtime`
  - thin runtime facade over prompt building, Codex CLI argument assembly, validation runs, event publishing, and process/session wait helpers

## Shared Package Boundaries

- `packages/contracts`
  - source of truth for API payloads and event envelopes
  - Zod first, inferred types second
- `packages/db`
  - reference SQLite schema only
  - runtime persistence currently lives in the backend sqlite-store
  - no business logic

## High-Level Status

Implemented now:

- local Fastify + React app with shared contracts, SQLite persistence, and websocket-driven board/session updates
- board workflow with `Draft`, `Ready`, `In progress`, `In review`, and `Done`
- project options for host or Docker-backed execution, model overrides, and pre/post-worktree commands
- draft workflow with persisted Markdown drafts plus `Refine`, `Questions`, `Revert Refine`, and `Create Ready`
- artifact-backed Markdown image references for pasted screenshots, preserved by stable `artifact_scope_id` values across save, reload, refine, revert, and draft-to-ready promotion
- execution workflow that starts a `ready` ticket into a persisted session, prepares a git worktree, supports immediate execution or a planning-first start, runs real `codex exec`, and keeps follow-up attempts on the same logical session/worktree
- Codex-managed execution modes through `codex exec`, with planning-first runs using read-only behavior and implementation runs using workspace-write behavior
- review workflow that runs configured validation commands, generates a local review package and diff artifact, supports request-changes and resume, exposes card-level diff/terminal/preview/activity actions plus an inspector activity summary row, and merges directly from `review` into the target branch with cleanup
- ticket lifecycle controls for archive/restore plus interrupted-session restart from scratch
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
- Tickets with prepared worktrees expose card-level `Diff`, `Terminal`, `Preview`, and `Activity` actions. The inspector keeps a single clickable activity summary row instead of workspace tabs.
- The ticket-card `Terminal` action opens a plain xterm.js shell at the worktree root, without take-over or restore-agent controls on that modal surface.
- The `Preview` action starts the ticket dev server when needed, opens a browser tab, and flips to a stop control while that dev server stays running.
- Completed tickets can be archived out of the active board and restored later.
- Interrupted in-progress work can either resume on the preserved worktree or restart from scratch after cleanup.

## Next Milestones

- Add GitHub pull request creation and reconciliation when direct merge is not the right review path.
- Add richer validation configuration and override handling.
- Decide whether interrupted sessions should auto-resume or stay manual after restart.

## Quality Gates

- `npm run sizecheck`
  - enforces a 1500-line cap on non-test production source files in `apps/**/src` and `packages/**/src`
- `npm run lint`
  - runs the size gate first and then workspace Biome checks
- `npm run typecheck`
  - runs TypeScript checks across all workspaces
- `npm run test`
  - runs the backend and web `node:test` suites from the repo root

## Starter Endpoints

Representative current route surface. `create-pr` and `reconcile` are scaffolded review actions.

- `GET /health`
- `GET /projects`
- `GET /projects/:projectId`
- `GET /projects/:projectId/archived-tickets`
- `GET /projects/:projectId/repository-branches`
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
- `GET /tickets/:ticketId/workspace/terminal` (WebSocket)
- `GET /sessions/:sessionId`
- `GET /sessions/:sessionId/attempts`
- `GET /sessions/:sessionId/logs`
- `POST /projects`
- `PATCH /projects/:projectId`
- `POST /projects/:projectId/update`
- `POST /projects/:projectId/delete`
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
- `POST /tickets/:ticketId/restart`
- `POST /tickets/:ticketId/archive`
- `POST /tickets/:ticketId/restore`
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
- Projects can choose a host or Docker execution backend, plus project-level pre/post-worktree commands and model overrides.
- Draft and ticket Markdown are persisted in SQLite-backed records, while filesystem writes are reserved for artifacts, logs, summaries, and worktrees.
- Production source files are kept under a hard 1500-line cap through `scripts/check-production-file-sizes.mjs`, and the root lint workflow runs that gate before Biome.
- Board-visible work now uses the `Draft`, `Ready`, `In progress`, `In review`, and `Done` flow, with websocket updates keeping drafts, tickets, sessions, and review packages current in the UI.
- The draft workflow is real and persisted: edit Markdown drafts, run `Refine` or `Questions`, optionally `Revert Refine`, then `Create Ready` to promote the draft into a `ready` ticket.
- Pasted screenshots become artifact-backed Markdown image references stored under a stable `artifact_scope_id`, so they survive save, reload, refine, revert, and ready-ticket promotion.
- Starting a `ready` ticket creates a persisted session and first attempt, prepares a git worktree and working branch, and launches either immediate execution or a planning-first run.
- Planning-first execution pauses in `paused_checkpoint` / awaiting-feedback mode, and approval or requested plan changes resume the same logical session on the prepared worktree.
- Execution runs through real `codex exec` with PTY-backed logs, live session input forwarding, explicit stop/resume, requested-changes retries, and a separate plain xterm.js worktree terminal surfaced from the ticket card actions.
- Successful execution runs validation before review handoff, generates a local review package and persisted diff artifact, surfaces review-ready and waiting action cards, and moves the ticket to `review`.
- The session workspace UI now uses ticket-card action icons for diff, terminal, preview, and full activity. The inspector keeps only a single activity summary row that opens the same interpreted stream in a modal.
- From `review`, local direct merge to the target branch is implemented, including worktree and local-branch cleanup plus automatic merge-conflict fallback that moves work back to `in_progress` when recovery cannot finish the merge safely.
- Completed tickets can be archived and later restored into the active board, and interrupted sessions can be restarted from scratch after tearing down the preserved workspace.
- Ticket deletion stops active work when needed, removes persisted ticket/session metadata, and deletes walleyboard-owned local artifacts such as worktrees, local branches, summaries, and validation directories.
- Backend startup marks active sessions and attempts `interrupted`, preserves the existing worktree and branch, and leaves resume manual instead of auto-restoring live execution.
- GitHub PR creation and external reconciliation are scaffolded only and are not implemented yet.
