# walleyboard

`walleyboard` is the packaged CLI launcher for WalleyBoard, a local-first board
for managing AI-assisted software work across drafts, execution sessions, git
worktrees, and review.

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
