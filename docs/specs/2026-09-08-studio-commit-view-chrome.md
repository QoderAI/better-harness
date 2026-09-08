# One title, one ref, and resizable panes in the Commit view

## Traceability

- Spec ID: `studio-commit-view-chrome`
- Status: in progress

## Intent

The Commit workbench opens with two stacked titles and a filter bar under them:

- The shell toolbar already names the View (`Commits`), and the workbench then
  repeats it as `Commit history` with the subtitle `Repository evidence`. Neither
  line carries a decision, and together they cost 44px of the evidence surface.
- Below them a third row (`git-log-toolbar`) holds the filter, `Clear refs`, and
  the commit count. So the reader crosses three bands of chrome before the first
  commit row, and `Refresh` sits in one band while the filter sits in another.
- The refs tree is multi-select. Selecting several refs asks Git for the union of
  what they reach, which is a shape the reader cannot see: the pane reports
  `2 selected` and the log silently mixes two histories. The trailing label
  cannot even name which refs those are.
- The three panes are fixed. Refs takes 220px (190px in compact) and the log
  takes 58% of the height whatever the reader is reading, so a long branch name
  is permanently truncated and a wide patch is permanently short.
- The log's footer reports `40 of 459 · More loads automatically`. Paging is
  already automatic, so the line narrates a mechanism instead of answering a
  question, and it holds a 34px band open under every history.
- The commit's message is a full-width band across the top of the details pane,
  so the patch — the thing the reader opened the commit for — starts below a
  region of metadata and keeps only what is left of the height.

## Non-goals

- Changing the Git read routes. `/api/git/log` keeps accepting repeated `ref`
  parameters; the View simply sends at most one.
- Persisting pane sizes across reloads. `DESIGN.md` allows persistence only after
  the layout is stable across all three modes, so sizes stay per-mount.
- Redesigning the commit table, the graph, the detail pane, or the diff.
- Making the refs tree a `radiogroup`. The rows stay toggle buttons, because
  clicking the selected ref must still return the log to every ref.

## Acceptance criteria

- **AC-1:** The Commit workbench renders exactly one title. `Commits` in the
  shell toolbar is the only View name, and `Commit history` /
  `Repository evidence` no longer appears as a band inside the workbench.
- **AC-2:** The current-branch chip, the commit filter, and `Refresh` render in
  the shell toolbar through the existing toolbar action slot. The filter and
  `Refresh` keep their accessible names and stay operable at wide, compact, and
  narrow widths without overflowing the toolbar.
- **AC-3:** The commit count moves to the log pane's own header, so refs, log,
  and details each have one aligned pane header and no fourth band exists.
- **AC-4:** Refs are single-select. Selecting a ref replaces any previous
  selection, leaving exactly one pressed row; the log then shows only what that
  ref reaches, and the request carries exactly one `ref` parameter.
- **AC-5:** Clicking the selected ref again, or the refs pane header's clear
  control, returns the log to every ref and the header trailing text to `All`.
  While a ref is selected the header names it.
- **AC-6:** A vertical sash sits between the refs pane and the log, and a
  horizontal sash between the log and the commit details. Both are
  `role="separator"` with an accessible name, report `aria-valuenow` /
  `aria-valuemin` / `aria-valuemax`, drag with the pointer, respond to arrow keys
  (`Shift` for a coarse step), `Home`, and `End`, and reset to the layout default
  on double-click.
- **AC-7:** Sash bounds keep both neighbours usable: the refs pane never goes
  below 160px nor leaves the log under 360px, and the log never goes below 180px
  nor leaves the details pane under 200px. Narrowing the window borrows space
  without discarding the reader's chosen size, which returns when space does.
- **AC-8:** In the narrow (stacked) layout both sashes leave the layout and the
  tab strip keeps owning pane switching. Neither sash is a tab stop there.
- **AC-9:** The log footer no longer reports a loaded-of-total count. It stays
  empty while idle and complete, shows a live status only while a page is
  loading, and shows `Retry loading history` only after a page fails.
- **AC-10:** The commit message renders above the changed-file list, inside that
  same column, with a compact default height and its own scroll. It is no longer
  a band across the details pane, and the patch region spans the full height of
  that pane.
- **AC-11:** A horizontal sash between the message and the changed-file list
  carries the same separator contract as AC-6, keeps the message at or above 64px
  and the file list at or above 140px, and leaves the layout when the panes stack.
- **AC-12:** No console or page errors and no document-level horizontal overflow
  at 1440×960, 900×760, and 390×844.

## Plan

1. Add `src/app/shell/PaneSash.tsx`: one separator that resizes the pane before
   it, in either orientation, with pointer capture, keyboard steps, and a
   double-click reset. Style it as `.studio-pane-sash` in `shell.css` next to the
   sidebar sash.
2. `GitHistoryView.tsx`:
   - delete the `git-history-titlebar` header and the `git-log-toolbar` row;
     render the branch chip, filter, and `Refresh` through `ToolbarActions`;
   - give the log pane a `PaneHeader` carrying the commit count, and let
     `PaneHeader` take an optional action node for the refs clear control;
   - replace `selectedRefs: string[]` with `selectedRef?: string` and `toggleRef`
     with `selectRef`, and send one `ref` parameter;
   - name the selected ref in the refs pane header through `refDisplayName`;
   - measure the workbench with `ResizeObserver`, derive fitted pane sizes into
     `--git-refs-width` / `--git-log-height`, and place both sashes;
   - drop the `log.progress` line from the paging footer, leaving the live status
     and the retry button;
   - rebuild `CommitDetail` around a `git-commit-message` block over
     `git-changed-files`, with its own `ResizeObserver`, `--git-message-height`,
     and a third sash.
3. `workbench.css`: rebuild the workbench grid as
   `refs | sash | (log / sash / details)`, move the filter styles to
   `.git-log-filter` under the toolbar, align the three pane headers, replace
   `.git-commit-detail-header` with `.git-commit-message` in the details column,
   give `.git-file-diff` the full pane height, and update the compact and narrow
   overrides.
4. i18n (`en/git.ts`, `zh-CN/git.ts`): add `log.title`, `refs.clearTitle`,
   `refs.clearAria`, `panes.resizeRefs`, `panes.resizeDetail`,
   `panes.resizeMessage`; drop `titlebar.evidence`, `refs.selected`,
   `log.clearRefs`, and `log.progress`; reword the ref-scoped limit and empty copy
   from plural refs to one ref.
5. `test/browser/git-history.spec.mjs`: assert the single title and the toolbar
   filter/Refresh placement, single-select and clear behavior, the absent paging
   count, the message's position and the patch's full height, and all three
   sashes' keyboard, bounds, reset, and stacked-layout behavior.

## Test and review evidence

- `npm run typecheck` and `npm run build` in `packages/harness-studio`.
- `npx vitest run` in `packages/harness-studio`.
- `npx playwright test test/browser/git-history.spec.mjs`.
- A local probe over wide (1440×960), compact (900×760), and narrow (390×844):
  toolbar geometry inside its bounds, detail pane heights inside their declared
  bounds, an empty paging footer, zero document overflow, no console or page
  errors, and screenshots for layout review.
- Neighbouring browser specs (`project-shell`, `language`, `date-range-controls`,
  `tool-call`) run against a `HEAD` + this-change worktree, to separate this
  change from unrelated in-flight work in the shared checkout.

## Risk

- **Toolbar crowding.** The filter, the branch chip, and `Refresh` now share the
  52px shell toolbar with the View title and, in some Projects, the source
  switcher. The filter is a `clamp()` width and the branch chip hides in the
  narrow layout, and AC-2 and AC-9 measure the result rather than assuming it.
- **Superseded acceptance criterion.** `docs/specs/2026-08-22-studio-commit-view.md`
  AC-2 promises that "selecting any combination" of refs filters the log. AC-4
  here narrows that deliberately to one ref; the server contract is unchanged, so
  a future multi-ref surface remains possible without a route change.
- **Pane sizes versus responsive modes.** A dragged size that outlives a window
  resize can strand a pane. Sizes are clamped on every render from the observed
  frame instead of being written back, so the reader's choice returns when the
  space does, and nothing is persisted across reloads.
- **A third sash implementation.** The shell already has `SidebarSash` and the
  debugger has its own. `PaneSash` is written as the shared workbench divider so
  those can converge on it later rather than a fourth one appearing.
- **Losing the paging count.** The count was the only visible signal that more
  history exists. Removing it is safe only because paging is automatic and both
  bounded-history warnings (`log.searchLimited`, `log.historyLimited`) stay; the
  failure and retry states keep their own visible affordance.
- **A narrower column for commit metadata.** The full SHA and the author email
  used to sit in a wide band. In a ~300px column they wrap instead of being
  ellipsized, so no evidence is hidden, and the pane scrolls when the body is
  long.
