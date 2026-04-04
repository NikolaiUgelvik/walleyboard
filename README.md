# WalleyBoard

> [!WARNING]
> Run it at your own peril.

Pronounced `/ˈwɑːli bɔːrd/`.

WalleyBoard is a vibe-coded, local-first workbench for handing the fiddly stuff to a tireless little helper while you stay planted in your chair and run the show from the board. This repo contains the current MVP plus the starter product documentation in [ai_walleyboard_prd.md](./ai_walleyboard_prd.md).

Runtime state lives under `~/.walleyboard/`, with `walleyboard.sqlite` as the source of truth for drafts, tickets, sessions, and review metadata so the repo checkout stays focused on code instead of accumulating local app data.

## Screenshot

![WalleyBoard project board with inbox, project list, and ticket columns](./docs/assets/walleyboard-board.png)

## Workspace Layout

- `apps/backend`: local Fastify backend, WebSocket transport, route scaffolding, and execution service boundaries
- `apps/web`: React + Mantine frontend shell for the WalleyBoard UI
- `packages/contracts`: shared Zod schemas and protocol contracts used by backend and frontend
- `packages/db`: reference Drizzle schema for the local SQLite model; the runtime source of truth lives in `apps/backend/src/lib/sqlite-store`
- `docs`: implementation notes that turn the PRD into module-level build guidance

## Current Structure

- `apps/backend/src/lib/sqlite-store`: SQLite bootstrap helpers plus focused repositories and workflow services for projects, drafts, tickets, sessions, events, and review artifacts
- `apps/backend/src/lib/execution-runtime`: the `ExecutionRuntime` facade plus focused helpers for prompts, CLI args, validation, event publishing, and process/session coordination
- `apps/backend/src/routes/tickets`: ticket route registration split by concern so read/workspace, execution, lifecycle, and review flows stay isolated
- `apps/web/src/features/walleyboard`: single-screen UI composition, feature-scoped controllers, websocket cache syncing, and extracted board, inspector, and modal modules

## Current Status

Implemented now:

- local Fastify + React app with shared contracts, SQLite persistence, and websocket-driven board/session updates
- board workflow with `Draft`, `Ready`, `In progress`, `In review`, and `Done`
- compact project rail with per-project color tiles, neutral utility tiles, unread notification badges, and selected-project color accents across board actions
- project options for project color, agent CLI selection, Codex MCP server toggles, automatic agent review defaults, review defaults, preview commands, model overrides, and pre/post-worktree commands
- draft workflow with persisted Markdown drafts plus `Refine`, `Questions`, `Revert Refine`, and `Create Ready`
- artifact-backed Markdown image references for pasted screenshots, preserved by stable `artifact_scope_id` values across save, reload, refine, revert, and draft-to-ready promotion
- execution workflow that starts a `ready` ticket into a persisted session, prepares a git worktree, supports immediate execution or a planning-first start, launches the selected Codex or Claude Code CLI inside Docker-backed PTY sessions, and keeps follow-up attempts on the same logical session and worktree
- adapter-managed execution modes with planning-first runs using read-only behavior and implementation runs using workspace-write behavior
- review workflow that runs configured validation commands, generates a local review package and diff artifact, supports request changes and resume, can launch automatic or manual agent review loops, exposes card-level diff/terminal/preview/activity actions plus an inspector activity summary row, supports GitHub pull request creation and reconciliation, and merges directly from `review` into the target branch with cleanup
- ticket lifecycle controls for archive/restore plus interrupted-session restart from scratch
- conservative restart recovery that preserves active managed Docker containers for interrupted sessions and marks active sessions `interrupted` instead of auto-restoring live execution

Not yet implemented:

- automatic restoration of a live execution after an application restart
- richer validation configuration and review-time override handling beyond the current per-repository profiles
- remote branch cleanup and broader GitHub workflow automation beyond the current create/track/reconcile flow

## Current Workflow Terms

- Board columns and ticket states use `Draft`/`draft`, `Ready`/`ready`, `In progress`/`in_progress`, `In review`/`review`, and `Done`/`done`
- The draft-to-ready flow is `edit draft -> Refine or Questions -> optional Revert Refine -> Create Ready`
- Execution sessions use `queued`, `running`, `paused_checkpoint`, `paused_user_control`, `awaiting_input`, `interrupted`, `failed`, and `completed`
- The review flow is `ready -> in_progress -> review -> done`, with request changes or resume moving work back into `in_progress` on the same logical session and worktree
- Review tickets default to either `Direct merge` or `Create pull request` from the project setting; once a PR is linked, the review card switches into PR tracking instead of offering duplicate paths
- Projects can opt into automatic agent review reruns with a per-ticket run limit, and manual `Start agent review` remains available when review work needs another pass
- The inbox only lists work that currently needs a human action:
  drafts waiting for confirmation, review tickets that are ready for human review and not still under active AI review, and sessions that are paused or failed for real operator input while the agent is not actively controlling the worktree
- The inbox alert sound only plays when one of those human-actionable items becomes newly actionable after it was previously absent; initial load, refresh churn, and automatic relaunch transitions do not trigger the sound
- The compact left rail keeps inbox and create-project utility tiles gray by default; project tiles stay color-coded and the inbox tile only shifts into its attention color when unread actionable work exists
- Ticket cards expose a compact action group for `Diff`, `Terminal`, `Preview`, and `Activity`; the inspector keeps a single activity summary row that opens the same interpreted stream
- `Diff`, `Terminal`, and `Preview` require a prepared worktree, while `Activity` stays available whenever the ticket still has a session, even after worktree cleanup
- The `Terminal` action opens a plain xterm.js shell rooted at the ticket worktree without take-over or restore-agent controls on that surface, and it stays unavailable only while a live agent process still owns that worktree
- The `Preview` action starts the ticket dev server when needed, opens a browser tab, and switches to a stop control while that dev server is running
- Completed tickets can be archived out of the active board and restored later
- Interrupted in-progress work can either resume on the preserved worktree or restart from scratch after cleanup

## Required Command Line Tools

Install these before starting WalleyBoard:

- `node` 22 or newer, with the bundled `npm`
- `bash`
- `git`
- `docker`

WalleyBoard uses `git` to verify repositories, create worktrees, diff changes, and merge reviewed work. Ticket execution is Docker-only: the backend prepares an isolated checkout, builds the runtime image from [`apps/backend/docker/codex-runtime.Dockerfile`](./apps/backend/docker/codex-runtime.Dockerfile) on first use, and launches both draft analysis and ticket execution inside that container. The runtime image installs the Codex and Claude Code CLIs itself; on the host, WalleyBoard only requires the matching auth/config directory for the adapter you choose so the container can reuse your existing login state.

## Quick Start

1. Install the required command line tools listed above.
2. Install dependencies with `npm install`.
3. Start the backend with `npm run dev:backend`.
4. Start the frontend with `npm run dev:web`.
5. Open the Vite URL shown in the frontend terminal, usually `http://127.0.0.1:5173`.
6. Generate database artifacts later with `npm run db:generate`.

## Dev Startup Script

If you want one command to restart both local servers, use `./restart.sh`.

- `./restart.sh`: starts the backend and frontend in the default local dev mode
- `./restart.sh --no-hot-reload`: starts the backend normally, then builds the frontend and serves it with `vite preview` instead of Vite HMR
- `./restart.sh --help`: shows the available startup flags

Logs and pid files for this helper live under `~/.walleyboard/dev/`.

## Docker Requirement

Docker is a hard requirement for draft analysis and ticket execution. Host execution is no longer supported.

Minimum Docker setup:

1. Install Docker Desktop or Docker Engine.
2. Start the Docker daemon.
3. Confirm `docker version` succeeds in the same shell environment where you run `npm run dev:backend`.
4. Keep enough local Docker permissions to build and run the WalleyBoard runtime image.

On the first draft-analysis or ticket-execution run, WalleyBoard builds the runtime image from [`apps/backend/docker/codex-runtime.Dockerfile`](./apps/backend/docker/codex-runtime.Dockerfile). That image installs Node, Git, ripgrep, the Codex CLI, and the Claude Code CLI. WalleyBoard then mounts the prepared repository checkout at `/workspace` plus the matching host auth/config directory for the selected adapter.

Supported Docker-backed adapters:

1. `codex`: requires a usable host `~/.codex` directory so the container can reuse your existing Codex configuration.
2. `claude-code`: requires a usable host `~/.claude` directory so the container can reuse your existing Claude Code configuration.

## Quality Gates

- `npm run sizecheck`: fails if any production source file under `apps/**/src` or `packages/**/src` exceeds 1500 lines
- `npm run lint`: runs `sizecheck` first, then workspace Biome checks
- `npm run typecheck`: runs TypeScript checks across all workspaces
- `npm run test`: runs the backend and web `node:test` suites from the repo root

## Draft Markdown And Screenshots

- Draft descriptions and acceptance criteria are authored as Markdown, stored in SQLite text fields, and previewed before refinement or promotion
- Ready-ticket Markdown stays in SQLite-backed ticket records too; WalleyBoard does not create standalone ticket Markdown files on disk
- Pasting a screenshot into the draft description stores the image under the backend's walleyboard-managed artifact path and inserts an artifact-backed Markdown image reference into the draft
- The image reference stays attached to the same draft through save, reload, refine, revert, and promote-to-ready flows because drafts and ready tickets share a stable `artifact_scope_id`

## Next Milestones

- Add richer validation configuration and override handling
- Broaden GitHub automation beyond the current gh-backed create/track/reconcile flow
- Decide whether interrupted sessions should auto-resume or stay manual after restart

## License

The repository source code is available under the [MIT License](./LICENSE).

`apps/web/public/alert.mp3` is a third-party audio asset, sourced from Pixabay,
credited to `Universfield`, and excluded from the repository MIT license. See
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) and
`apps/web/public/alert.mp3.license.txt`.

`apps/web/public/agent-icons/codex.svg` and
`apps/web/public/agent-icons/claude-code.svg` are vendored third-party SVG
assets with their own upstream licensing and brand ownership notes. See
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
