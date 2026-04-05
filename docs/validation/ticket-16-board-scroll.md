# Ticket 16 Board Scroll Validation

Date: 2026-04-05

Scope:
Primary regression coverage now lives in
`apps/web/src/features/walleyboard/board-scroll.test.tsx`, which renders the
real board shell composition (`ProjectRail`, `BoardView`, and `InspectorPane`)
and asserts the production stylesheet in `apps/web/src/app-shell.css` keeps the
current shared-scroll contract intact after the compact-rail, pull-request
badge, workspace-action, and activity-surface follow-up work. Coverage now
includes:

- compact project rail notification badge counts and unread/read attention
  states
- header rendering without the removed repository summary or status badges
- linked pull request badge rendering on cards and in the inspector without
  regressing the shared board shell layout
- review-card action states that keep `Create pull request` and `Direct merge`
  disabled while AI review is active
- inspector-open desktop and narrow layouts where the shared board pane owns
  board scrolling
- narrow selected-project headers that compact workspace action labels instead
  of overflowing the toolbar
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
- notification, header, PR badge, and workspace-action regressions from the
  recent UI follow-up work are covered in the same suite so the scroll behavior
  is exercised alongside the current shell chrome

Acceptance criteria:

- Criterion 1: Passed. The board surface now scrolls through the shared
  `.board-scroller` instead of exposing independent vertical scrolling on
  individual columns.
- Criterion 2: Passed. Inspector-open desktop and narrow layouts keep board
  scrolling on `.board-scroller` while the detail pane keeps its own scroll.
- Criterion 3: Passed. Compact-rail badge states, header chrome, linked PR
  badges, and narrow-screen workspace actions remain covered in the same
  regression suite.
- Criterion 4: Passed. Review-card action states remain covered, including the
  disabled `Create pull request` and `Direct merge` controls while AI review is
  active.
- Criterion 5: Passed. The shared board scroller keeps its scroll position
  across rerenders with uneven columns.
