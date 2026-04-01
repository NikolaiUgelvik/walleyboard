# Implementation Starter Pack

This document turns the PRD into the first concrete module boundaries for the MVP.

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

## First Implementation Milestones

1. Implement the Codex adapter boundary.
2. Implement worktree lifecycle and sandbox lifecycle services.
3. Replace the waiting-state execution placeholder with a real PTY-backed agent runtime.
4. Add validation execution and real review-package generation.
5. Add direct merge flow and cleanup.

## Starter Endpoints

- `GET /health`
- `GET /projects`
- `GET /projects/:projectId`
- `GET /projects/:projectId/repositories`
- `GET /projects/:projectId/tickets`
- `GET /projects/:projectId/drafts`
- `GET /tickets/:ticketId`
- `GET /tickets/:ticketId/review-package`
- `GET /tickets/:ticketId/events`
- `GET /sessions/:sessionId`
- `GET /sessions/:sessionId/attempts`
- `GET /sessions/:sessionId/logs`
- `POST /projects`
- `POST /drafts`
- `POST /drafts/:draftId/refine`
- `POST /drafts/:draftId/confirm`
- `POST /tickets/:ticketId/start`
- `POST /tickets/:ticketId/resume`
- `POST /tickets/:ticketId/request-changes`
- `POST /tickets/:ticketId/create-pr`
- `POST /tickets/:ticketId/merge`
- `POST /tickets/:ticketId/reconcile`
- `POST /sessions/:sessionId/terminal/takeover`
- `POST /sessions/:sessionId/terminal/restore-agent`
- `POST /sessions/:sessionId/checkpoint-response`
- `POST /sessions/:sessionId/input`
- `GET /ws`

## Starter Event Families

- `draft.updated`
- `draft.ready`
- `ticket.updated`
- `session.updated`
- `session.output`
- `session.checkpoint_requested`
- `session.input_requested`
- `review_package.generated`
- `structured_event.created`
- `command.rejected`

## Current Implementation Status

- Project setup is real and persisted in SQLite.
- Draft creation, refinement, and promotion to `ready` tickets are real and persisted.
- Starting a `ready` ticket now creates:
  - a persisted execution session
  - a first execution attempt record
  - waiting-state session logs
  - an `in_progress` ticket transition on the board
- Session input is recorded and appended to session logs.
- The execution session is still a waiting-state placeholder:
  - no worktree is created yet
  - no Codex process is launched yet
  - no terminal stream is attached yet
