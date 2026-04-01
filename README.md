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
  - draft-to-ready ticket flow
  - starting a ready ticket into a persisted execution session with a prepared git worktree
  - real `codex exec` launches from the prepared worktree
  - session log streaming and automatic transition into `review`
  - local review diff artifact generation
- root tooling configuration for TypeScript, Biome, and Drizzle

## What It Does Not Do Yet

- manage Bubblewrap sandboxes
- execute validation commands
- render live terminal output
- resume real execution sessions after interruption
- support checkpoint or mid-run input handoff for running Codex exec sessions
- merge reviewed branches back into the target branch

Those remain the next implementation milestones.

## Quick Start

1. Install dependencies with `npm install`.
2. Start the backend with `npm run dev:backend`.
3. Start the frontend with `npm run dev:web`.
4. Generate database artifacts later with `npm run db:generate`.

## Next Steps

- Add sandbox orchestration around the live Codex runtime.
- Add validation execution before review handoff.
- Implement direct merge and cleanup once review is approved.
