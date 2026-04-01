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

1. Implement sandbox lifecycle services around the prepared Codex runtime.
2. Replace the log-only execution view with a real PTY-backed terminal runtime.
3. Add richer validation configuration and override handling.
4. Restore interrupted sessions conservatively after backend restart.
5. Layer Bubblewrap policy onto the live runtime and validation commands.

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
- Repository validation commands can be configured during project setup.
- Draft creation, refinement, and promotion to `ready` tickets are real and persisted.
- Starting a `ready` ticket now creates:
  - a persisted execution session
  - a first execution attempt record
  - a prepared git worktree and working branch
  - a real `codex exec` run with persisted logs
  - an `in_progress` ticket transition on the board
- Successful execution now creates:
  - validation results captured before review handoff
  - a local review package record
  - a persisted diff artifact on disk
  - a transition from `in_progress` to `review`
- Review approval now supports:
  - direct fast-forward merge into the target branch
  - local worktree cleanup
  - local working branch deletion
  - a transition from `review` to `done`
- Review feedback and failed runs now support:
  - attaching a requested-changes note to the same logical session
  - creating a new execution attempt on the same worktree and branch
  - relaunching Codex with persisted review feedback or resume guidance
- The frontend now surfaces in-app action cards for:
  - review-ready tickets
  - failed sessions
  - sessions waiting for user input or approval
- Session input is still only stored for future use:
  - live checkpoint handoff is not implemented yet
  - no PTY-backed terminal stream is attached yet
