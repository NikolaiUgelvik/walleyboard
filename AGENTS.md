# Repository Notes

- This application is not used by anyone yet. Favor the simplest forward-moving implementation over backward compatibility.
- Do not add compatibility shims, migration complexity, or legacy API preservation unless a concrete current need appears.
- If the line-count limit in `scripts/check-production-file-sizes.mjs` is hit, refactor the code into smaller units instead of trying to squeeze under the limit by removing whitespace or otherwise making the file harder to read.
