# WalleyBoard

[![CI](https://github.com/NikolaiUgelvik/walleyboard/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/NikolaiUgelvik/walleyboard/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/NikolaiUgelvik/walleyboard?label=license)](./LICENSE)

> [!WARNING]
> Run it at your own peril.

Pronounced `/ˈwɑːli bɔːrd/`.

WalleyBoard is a vibe-coded board for brains with too many tabs open. Each
ticket gets its own worktree and Dockerized agent, so you can keep the
overview and turn fuzzy ideas into better tickets. It is about handing
the fiddly stuff to a tireless little helper while you stay planted in your
chair and run the show from the board. This repo contains the current MVP plus
the starter product documentation in
[ai_walleyboard_prd.md](./ai_walleyboard_prd.md).

Runtime state lives under `~/.walleyboard/`, with `walleyboard.sqlite` as the source of truth for drafts, tickets, sessions, and review metadata so the repo checkout stays focused on code instead of accumulating local app data.

## Screenshot

![WalleyBoard project board with inbox, project list, and ticket columns](./docs/assets/walleyboard-board.png)

## What It Does

WalleyBoard gives you a local board for moving work from draft to execution to
review while keeping the agent session, git worktree, and review context tied
to the same ticket.

Core workflows:

- draft and refine tickets with Markdown, acceptance criteria, and AI-assisted
  cleanup before work starts
- turn each ticket into its own isolated git worktree and Dockerized Codex or
  Claude Code session
- use the action group on every ticket card to jump straight into preview,
  activity, diff, or terminal without leaving the board
- keep a readable overview with an inbox for refined drafts, review-ready
  tickets, and sessions waiting on operator input
- run previews for tickets and repositories directly from the board to check a
  branch without extra terminal juggling
- review completed work, launch AI review, open pull requests, track linked PRs,
  and merge from the same flow

Some especially handy bits:

- project settings for preview commands plus optional pre-worktree and
  post-worktree commands
- review actions that adapt between direct merge and pull-request workflows
- live activity history and worktree summaries attached to the ticket that
  produced them

## Why WalleyBoard

WalleyBoard is for when the work is messy, the context keeps moving, and you
need the board to help you keep the plot.

- it helps turn vague ideas into clearer tickets before they hit execution
- it keeps agent runs, worktrees, previews, and review state attached to the
  ticket that produced them
- it gives you a board and inbox that are easier to scan when your brain is
  already juggling too much

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

## Documentation

- Product direction: [ai_walleyboard_prd.md](./ai_walleyboard_prd.md)
- Current implementation details: [docs/implementation-starter-pack.md](./docs/implementation-starter-pack.md)
- Validation notes: [docs/validation](./docs/validation)

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
