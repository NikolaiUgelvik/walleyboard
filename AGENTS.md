# Repository Notes

- This application is not used by anyone yet. Favor the simplest forward-moving implementation over backward compatibility.
- Do not add compatibility shims, migration complexity, or legacy API preservation unless a concrete current need appears.
- If the line-count limit in `scripts/check-production-file-sizes.mjs` is hit, refactor the code into smaller units instead of trying to squeeze under the limit by removing whitespace or otherwise making the file harder to read.


## Testing approach

- Never create throwaway test scripts or ad hoc verification files
- If you need to test functionality, write a proper test in the test suite
- Tests should be runnable with the rest of the suite
- Even for quick verification, write it as a real test that provides ongoing value
- Run focused tests that cover the behavior you changed
- Do not use --runInBand