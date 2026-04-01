# Orchestrator

This repository contains the implementation starter pack for the AI orchestrator MVP described in [ai_orchestrator_prd.md](./ai_orchestrator_prd.md).

## Workspace Layout

- `apps/backend`: local Fastify backend, WebSocket transport, route scaffolding, and orchestration service boundaries
- `apps/web`: React + Mantine frontend shell for the local orchestration UI
- `packages/contracts`: shared Zod schemas and protocol contracts used by both backend and frontend
- `packages/db`: initial Drizzle + SQLite schema matching the PRD data model
- `docs`: implementation notes that turn the PRD into module-level build guidance

## What This Starter Pack Includes

- npm workspaces for app and package separation
- shared contract package for models, commands, and events
- initial SQLite schema matching the PRD
- backend skeleton with route modules, SQLite-backed local persistence, and a WebSocket event hub
- frontend shell that talks to the backend and supports:
  - project setup
  - optional repository validation commands during project setup
  - draft-to-ready ticket flow
  - starting a ready ticket into a persisted execution session with a prepared git worktree
  - real `codex exec` launches from the prepared worktree
  - validation commands that run before review handoff
  - session log streaming and automatic transition into `review`
  - local review diff artifact generation
  - request-changes and resume flows that create new attempts on the same session/worktree
  - direct merge from `review` into the target branch with local worktree and branch cleanup
- root tooling configuration for TypeScript, Biome, and Drizzle

## What It Does Not Do Yet

- manage Bubblewrap sandboxes
- render live terminal output
- restore live execution after an application restart
- support checkpoint or mid-run input handoff for running Codex exec sessions

Those remain the next implementation milestones.

## Quick Start

1. Install dependencies with `npm install`.
2. Start the backend with `npm run dev:backend`.
3. Start the frontend with `npm run dev:web`.
4. Generate database artifacts later with `npm run db:generate`.

## Next Steps

- Add sandbox orchestration around the live Codex runtime.
- Replace the log-only session view with PTY-backed terminal control.
- Add in-app notifications for sessions that need user input or approval.
