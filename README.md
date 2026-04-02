# Orchestrator

This repository contains the current local-first orchestrator MVP implementation and the starter documentation for the product described in [ai_orchestrator_prd.md](./ai_orchestrator_prd.md).

## Workspace Layout

- `apps/backend`: local Fastify backend, WebSocket transport, route scaffolding, and orchestration service boundaries
- `apps/web`: React + Mantine frontend shell for the local orchestration UI
- `packages/contracts`: shared Zod schemas and protocol contracts used by both backend and frontend
- `packages/db`: initial Drizzle + SQLite schema matching the PRD data model
- `docs`: implementation notes that turn the PRD into module-level build guidance

## Current Status

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

## Quick Start

1. Install dependencies with `npm install`.
2. Start the backend with `npm run dev:backend`.
3. Start the frontend with `npm run dev:web`.
4. Generate database artifacts later with `npm run db:generate`.

## Draft Markdown And Screenshots

- Draft descriptions and acceptance criteria are authored and stored as Markdown, and the draft drawer previews that Markdown before refinement or promotion.
- Pasting a screenshot into the draft description stores the image under the backend's orchestrator-managed artifact path and inserts an artifact-backed Markdown image reference into the draft.
- The image reference stays attached to the same draft through save, reload, refine, revert, and promote-to-ready flows because drafts and ready tickets share a stable `artifact_scope_id`.

## Next Milestones

- Add GitHub pull request creation and reconciliation when direct merge is not the right review path.
- Add richer validation configuration and override handling.
- Decide whether interrupted sessions should auto-resume or stay manual after restart.
