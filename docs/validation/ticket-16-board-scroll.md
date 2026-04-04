# Ticket 16 Board Scroll Validation

Date: 2026-04-04

Scope:
Primary regression coverage now lives in
`apps/web/src/features/walleyboard/board-scroll.test.tsx`, which renders the
real board shell composition (`ProjectRail`, `BoardView`, and `InspectorPane`)
and asserts the production stylesheet in `apps/web/src/app-shell.css` keeps the
current shared-scroll contract intact after the compact-rail and inspector
layout follow-up work. Coverage now includes:

- compact project rail notification badge counts and unread/read attention
  states
- header rendering without the removed repository summary or status badges
- inspector-open desktop and narrow layouts where the shared board pane owns
  board scrolling
- rerender coverage that preserves board scroll position with uneven column
  heights

Environment:

- `node:test` with `jsdom`
- Fixture built from the current `apps/web/src/app-shell.css`

Current layout contract:

- `.walleyboard-shell`: fixed container in the tested board layouts
  (`overflow-y: hidden`)
- `.board-scroller`: shared vertical scroll owner for the board surface
  (`overflow-y: auto`)
- `.walleyboard-detail`: independent vertical scroll owner when the inspector is
  open (`overflow-y: auto`)
- `.board-column-stack`: no independent vertical scrolling in the production
  layout
- notification and header regressions from the compact-rail follow-up are
  covered in the same suite so the scroll behavior is exercised alongside the
  current shell chrome

Acceptance criteria:

- Criterion 1: Passed. The board surface now scrolls through the shared
  `.board-scroller` instead of exposing independent vertical scrolling on
  individual columns.
- Criterion 2: Passed. Inspector-open desktop and narrow layouts keep board
  scrolling on `.board-scroller` while the detail pane keeps its own scroll.
- Criterion 3: Passed. The compact rail and board header regressions introduced
  during the recent UI refactors remain covered in the same regression suite.
- Criterion 4: Passed. The shared board scroller keeps its scroll position
  across rerenders with uneven columns.
