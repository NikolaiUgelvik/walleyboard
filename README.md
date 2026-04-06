# WalleyBoard

[![CI](https://github.com/NikolaiUgelvik/walleyboard/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/NikolaiUgelvik/walleyboard/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/NikolaiUgelvik/walleyboard?label=license)](./LICENSE)

> [!WARNING]
> Run it at your own peril.

Pronounced `/ˈwɑːli bɔːrd/`.

WalleyBoard is a vibe-coded, local-first workbench for handing the fiddly stuff to a tireless little helper while you stay planted in your chair and run the show from the board. This repo contains the current MVP plus the starter product documentation in [ai_walleyboard_prd.md](./ai_walleyboard_prd.md).

Runtime state lives under `~/.walleyboard/`, with `walleyboard.sqlite` as the source of truth for drafts, tickets, sessions, and review metadata so the repo checkout stays focused on code instead of accumulating local app data.

## Screenshot

![WalleyBoard project board with inbox, project list, and ticket columns](./docs/assets/walleyboard-board.png)

## What It Does

WalleyBoard gives you a local board for moving work from draft to execution to
review while keeping the agent session, git worktree, and review context tied
to the same ticket.

Core workflows:

- create and refine Markdown ticket drafts
- start work in isolated git worktrees
- run Codex or Claude Code in Docker-backed sessions
- inspect diffs, terminal output, previews, and activity history
- review changes, open pull requests, and merge completed work

## Requirements

Install these before starting WalleyBoard:

- `node` 22 or newer, with the bundled `npm`
- `bash`
- `git`
- `docker`

WalleyBoard uses Docker for draft analysis and ticket execution. The backend
builds the runtime image from
[`apps/backend/docker/codex-runtime.Dockerfile`](./apps/backend/docker/codex-runtime.Dockerfile)
on first use and reuses your local agent auth/config from `~/.codex` or
`~/.claude`, depending on the adapter you choose.

## Quick Start

1. Install the required command line tools listed above.
2. Install dependencies with `npm install`.
3. Start the backend with `npm run dev:backend`.
4. Start the frontend with `npm run dev:web`.
5. Open the Vite URL shown in the frontend terminal, usually `http://127.0.0.1:5173`.

If you want one command to restart both local servers, use `./restart.sh`.

- `./restart.sh`: starts the backend and frontend in the default local dev mode
- `./restart.sh --no-hot-reload`: starts the backend normally, then builds the frontend and serves it with `vite preview` instead of Vite HMR
- `./restart.sh --help`: shows the available startup flags

Logs and pid files for this helper live under `~/.walleyboard/dev/`.

## CLI

WalleyBoard is also published to npm as `walleyboard`, backed by the CLI
workspace at [`packages/cli`](./packages/cli). You can launch it with:

```sh
npx walleyboard
```

Optional launcher flags:

- `npx walleyboard --host 0.0.0.0`
- `npx walleyboard --port 4310`
- `npx walleyboard --no-open`

## Releasing The CLI

The `walleyboard` npm package is released from GitHub Actions with npm trusted
publishing, so the publish job uses OIDC instead of a stored `NPM_TOKEN` and
npm attaches provenance automatically for public releases.

The committed workspace version stays at `0.0.0`. For each release, the
workflow temporarily sets `packages/cli/package.json` to match the pushed tag
before publishing to npm.

One-time setup on npm:

1. Open the `walleyboard` package settings on npm.
2. Add a trusted publisher for owner `NikolaiUgelvik`, repository
   `walleyboard`, and workflow file `publish.yml`.
3. Leave the environment name empty unless you later add a protected GitHub
   environment for releases.
4. Remove any old npm automation token after trusted publishing is confirmed to
   work.

After that, every stable release is tag-driven:

1. Make sure `main` is green in CI.
2. Create the next stable tag from the current `main` head, for example
   `git tag v0.1.3`.
3. Push the tag with `git push origin v0.1.3`.
4. The `publish.yml` workflow validates the tag, runs linting, typechecking,
   tests, and the CLI build, temporarily sets the CLI package version to
   `0.1.3`, publishes `walleyboard` to npm, and creates the matching GitHub
   Release.

If the release succeeds, the npm package page should show provenance details for
that version.

## Repository Layout

- `apps/backend`: Fastify backend, WebSocket transport, Docker runtime orchestration, and persistence
- `apps/web`: React + Mantine frontend for the board UI
- `packages/cli`: packaged launcher for running WalleyBoard outside the monorepo
- `packages/contracts`: shared Zod schemas and protocol contracts
- `packages/db`: Drizzle schema and SQLite migrations
- `docs`: PRD, implementation notes, and validation writeups

## Documentation

- Product direction: [ai_walleyboard_prd.md](./ai_walleyboard_prd.md)
- Current implementation details: [docs/implementation-starter-pack.md](./docs/implementation-starter-pack.md)
- Validation notes: [docs/validation](./docs/validation)

## Quality Gates

- `npm run sizecheck`: fails if any production source file under `apps/**/src` or `packages/**/src` exceeds 1500 lines
- `npm run lint`: runs `sizecheck` first, then workspace Biome checks
- `npm run typecheck`: runs TypeScript checks across all workspaces
- `npm run test`: runs the backend and web `node:test` suites from the repo root

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
