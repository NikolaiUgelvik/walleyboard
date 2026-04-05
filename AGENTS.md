# Repository Notes

- If the line-count limit in `scripts/check-production-file-sizes.mjs` is hit, refactor the code into smaller units instead of trying to squeeze under the limit by removing whitespace or otherwise making the file harder to read.
- Never leak host absolute paths into Docker-backed agent prompts, commands, or artifacts. If a Docker run needs a file path, translate it to the mounted in-container path such as `/workspace/...` or `/walleyboard-home/...` before passing it along.


## Testing approach

- Never create throwaway test scripts or ad hoc verification files
- If you need to test functionality, write a proper test in the test suite
- Tests should be runnable with the rest of the suite
- Even for quick verification, write it as a real test that provides ongoing value
- Run focused tests that cover the behavior you changed
- Do not use --runInBand
