# Ticket 16 Board Scroll Validation

Date: 2026-04-03

Scope:
Primary regression coverage now lives in
`apps/web/src/features/walleyboard/board-scroll.test.tsx`, which renders the
real board shell composition (`ProjectRail`, `BoardView`, and `InspectorPane`)
and asserts the production stylesheet in `apps/web/src/app-shell.css` keeps
vertical scroll ownership at `.walleyboard-shell` while stretching empty
columns. The browser measurements below remain a supporting spot-check from the
original ticket validation.

Environment:

- Chromium 136.0.7103.25
- Viewport `1440x900`
- Fixture built from the current `apps/web/src/app-shell.css`

Observed measurements:

- `.walleyboard-shell`: `overflow-y: auto`, `clientHeight: 900`,
  `scrollHeight: 1438`, `scrollTop` accepted `400`
- `.board-scroller`: `scrollTop` stayed `0`,
  `clientHeight === scrollHeight === 1406`
- Each `.board-column-stack`: `scrollTop` stayed `0`,
  `clientHeight === scrollHeight === 1352`
- Empty column heights: `1398, 1398, 1398, 1398`
- Tallest column height: `1398`
- Column top deltas after scrolling the shell by `400`: `-400, -400, -400,
  -400, -400`

Acceptance criteria:

- Criterion 1: Passed. The fixture only scrolled through `.walleyboard-shell`;
  the board scroller and column stacks did not accept vertical scrolling.
- Criterion 2: Passed. Every empty column matched the tallest column at
  `1398px`.
- Criterion 3: Passed. Scrolling the shell moved every column by the same
  `-400px` delta.
- Criterion 4: Passed. Individual columns and column stacks did not expose
  independent vertical scrolling in the default board layout.
