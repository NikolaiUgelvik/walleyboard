# walleyboard

`walleyboard` is the packaged CLI launcher for WalleyBoard, a vibe-coded board
for brains with too many tabs open. Each ticket gets its own worktree and
Dockerized agent, so you can keep the overview and turn fuzzy ideas into
better tickets. It is about handing the fiddly stuff to a tireless little
helper while you stay planted in your chair and run the show from the board.

## Usage

Run it directly with `npx`:

```sh
npx walleyboard
```

By default, the CLI starts the local server and opens WalleyBoard in your
default browser. This also works from WSL by opening the native Windows
browser when available.

Optional flags:

- `npx walleyboard --host 0.0.0.0`
- `npx walleyboard --port 4310`
- `npx walleyboard --no-open`

## Highlights

- each ticket gets its own git worktree and Dockerized agent session
- ticket cards include direct actions for preview, activity, diff, and terminal
- the board inbox surfaces refined drafts, review-ready work, and sessions that
  need operator input
- review flows cover AI review, pull request creation, PR tracking, and merges

## Requirements

- Node.js 22 or newer
- Git
- Docker

WalleyBoard uses Docker for draft analysis and ticket execution.

## Project

- Repository: https://github.com/NikolaiUgelvik/walleyboard
- Issues: https://github.com/NikolaiUgelvik/walleyboard/issues

## License

MIT
