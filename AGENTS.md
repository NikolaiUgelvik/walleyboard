# Repository Notes

- If the line-count limit in `scripts/check-production-file-sizes.mjs` is hit, refactor the code into smaller units instead of trying to squeeze under the limit by removing whitespace or otherwise making the file harder to read.
- Never leak host absolute paths into Docker-backed agent prompts, commands, or artifacts. If a Docker run needs a file path, translate it to the mounted in-container path such as `/workspace/...` or `/walleyboard-home/...` before passing it along.
- Use Conventional Commits for commit messages, for example `feat: ...`, `fix: ...`, or `chore: ...`.

## Code style
- Do not add code comments.

## Backend changes

- Be very careful when modifying backend code. Never introduce blocking calls, long-running synchronous operations, or unbounded loops that can block the API or the main event loop.
- Prefer non-blocking, asynchronous patterns for I/O, network requests, and any potentially slow operations.
- If a new feature requires heavy computation or waiting, offload it so it does not starve other requests.

## Testing approach

- Never create throwaway test scripts or ad hoc verification files
- If you need to test functionality, write a proper test in the test suite
- Tests should be runnable with the rest of the suite
- Even for quick verification, write it as a real test that provides ongoing value
- Run focused tests that cover the behavior you changed
- Do not use --runInBand
