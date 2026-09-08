# Reader-driven paging, keyboard travel, and no dead height in the Commit log

## Traceability

- Spec ID: `studio-commit-log-paging-and-keys`
- Status: implemented

## Intent

Three defects were reported against the Commits View and reproduced against a
local Studio (`better-harness`, 505 reachable commits, 15 of them authored today).

**1. Paging looks dead, because it already ran to exhaustion.**
`CommitTable` puts a 1px sentinel in the scroll container after the virtualized
rows and loads the next page whenever that sentinel intersects, with a 160px
bottom `rootMargin`. The rendered rows are `datedCommits` — the loaded history
narrowed by the sidebar date window — while a page is fetched from the unnarrowed
history. So when the window admits few commits the sentinel never leaves the
viewport, every appended page re-arms the observer, and the View drains the whole
history in a burst with no reader input.

Measured, entering Commits and switching the window to `Today`: **10 back-to-back
`/api/git/log` requests** (offsets 120…480), 505 commits loaded, 15 rendered. After
that `hasMore` is `false`, so scrolling can never load anything again — which is
exactly what "infinite loading does not work" looks like from the reader's side.
With the window on `All time` the list overflows, the sentinel sits below the fold,
and paging behaves correctly (1 request on entry, 1 per scroll to the end).

The trigger is therefore wrong in both directions: it fires when the reader has
not asked for more, and there is no affordance left when scrolling cannot ask.

**2. Arrow keys do nothing.**
Commit rows are `<button role="row">` with no `onKeyDown` and no roving
`tabIndex`. Measured: `ArrowDown` / `ArrowUp` move neither focus nor selection;
`Tab` walks row by row, so a 40-row page is 40 tab stops and a virtualized 500-row
history has no stable tab stop at all. The Sessions list
(`App.tsx` `moveSessionFocus`) and `ProjectSidebar` already establish the
convention this list is missing. `aria-selected` on `role="row"` is also only
valid inside a grid, and the container is `role="table"`.

**3. The log pane holds dead height above the details pane.**
The workbench's first grid row is a fixed `var(--git-log-height, 58%)`, so the log
pane reserves 58% of the frame whatever it has to put there. A window-narrowed
history of a dozen rows ends well short of the pane's bottom edge, and the reader
sees a band of empty workspace between the last commit and `Commit details`.

## Non-goals

- Pushing the date window into `/api/git/log`. Git range-limits on committer date
  (`--since` / `--until`) while the View filters and displays author date, so a
  server-side window would silently disagree with the column the reader sorts by.
  The window stays a client-side narrowing of loaded history.
- Selection following focus. Selecting a commit fetches
  `/api/git/commits/{sha}`; arrow keys must not fire a request per keystroke.
  Focus moves, `Enter` / `Space` selects.
- Redesigning the commit graph, the details pane, the refs tree, or the diff.
- Persisting pane sizes or the focused row across reloads.
- Reinstating the loaded-of-total footer line removed by
  `docs/specs/2026-09-08-studio-commit-view-chrome.md` AC-9.

## Acceptance criteria

- **AC-1:** Entering the Commits View issues exactly one `/api/git/log` request,
  and changing the date window issues exactly one. No page is fetched without
  reader input, at any window setting.
- **AC-2:** When the loaded rows extend more than 160px past the viewport,
  scrolling to within 160px of the end fetches the next page, and each such
  arrival fetches at most one page. Reaching the end again fetches the next.
- **AC-3:** When the loaded rows do not extend more than 160px past the viewport
  and more history exists, the list ends with a `Load older commits` control that
  fetches the next page. It is a tab stop, names the remaining count, and is the
  only paging affordance in that state.
- **AC-4:** The paging footer keeps its AC-9 contract: empty while idle and
  complete, a live status while a page loads, `Retry loading history` after a page
  fails. The `Load older commits` control is absent in all three of those states.
- **AC-5:** The commit list is one tab stop. Exactly one row carries `tabIndex=0`;
  every other row carries `-1`. Tabbing into the list lands on the focused row, or
  on the first rendered row when the focused row has been virtualized away.
- **AC-6:** `ArrowDown` / `ArrowUp` move focus by one row, `PageDown` / `PageUp`
  by ten, `Home` / `End` to the first / last loaded row. Focus does not wrap, the
  virtualizer scrolls the target row into view before it takes focus, and no
  `/api/git/commits` request is made.
- **AC-7:** `ArrowDown` on the last loaded row requests the next page instead of
  moving focus, so a keyboard reader can travel past the loaded window.
- **AC-8:** `Enter` or `Space` on the focused row selects that commit and loads
  its details, leaving exactly one row with `aria-selected="true"`.
- **AC-9:** The list container is `role="grid"`, data cells are `gridcell`, and
  header cells are `columnheader`, so `aria-selected` on `role="row"` is valid.
- **AC-10:** When the log content is shorter than the log pane's share of the
  frame, the pane shrinks to its content and the details pane takes the freed
  height; no empty band remains between the last commit row and the details pane
  header. When the content is taller, the pane stays at its sash size.
- **AC-11:** No console or page errors, and no change to the narrow (stacked)
  layout's pane switching, at 1600×1000 and 390×844.

## Plan

1. `GitHistoryView.tsx` — `CommitTable`:
   - Replace the sentinel and its `IntersectionObserver` with an `onScroll`
     prefetch that fires only while the scroll range exceeds `PREFETCH_MARGIN`,
     so one scroll to the end buys one page and a non-scrollable list buys none.
   - Track that scroll range with a `ResizeObserver` so the manual affordance and
     the auto path are decided by the same measurement.
   - Render a trailing `git-load-older` row when paging cannot be scrolled for.
   - Add `focusIndex` + roving `tabIndex`, an `onKeyDown` per row matching
     `moveSessionFocus`, `scrollToIndex` before focusing, and the last-row
     `ArrowDown` page request.
   - Move the container to `role="grid"`, cells to `gridcell`, header cells to
     `columnheader`.
2. `workbench.css`: first workbench row becomes
   `fit-content(var(--git-log-height, 58%))`; drop `.git-auto-load-sentinel`; add
   `.git-load-older`.
3. i18n (`en/git.ts`, `zh-CN/git.ts`): add `log.loadOlder` with the remaining
   count and `table.rowsAria`; drop nothing.
4. `test/browser/git-history.spec.mjs`: cover AC-1 through AC-10.

## Test and review evidence

- `npm run typecheck` and `npx vitest run` in `packages/harness-studio`: 80 files,
  598 tests passing.
- `npx playwright test test/browser/git-history.spec.mjs`: both tests passing,
  including the new AC-1…AC-10 walk.
- `npx playwright test` (whole browser suite): 90 passed, 2 failed —
  `project-shell.spec.mjs:193` and `shared-scope.spec.mjs:70`. Both reproduce
  identically in a clean `b11a001` worktree with this change absent, so they
  belong to other in-flight Sessions/Inspector work in this shared checkout, not
  to this change.
- A live probe against a local Studio on the `better-harness` checkout (505
  reachable commits): one `/api/git/log` on entry and none after a second of
  idling; one page per scroll to the end; `ArrowDown`/`ArrowUp`/`PageDown`/`Home`
  travelling by 1/1/10/first with a single `tabIndex=0` throughout and no
  `/api/git/commits` request; `Enter` selecting one row and filling the details
  pane; `Today` adding no request and offering
  `Load older commits · 426 left in history`, whose count steps to 386 after one
  click; and a 6px log-to-details gap where the content fills the pane.
- Pane geometry at a 3-row log (Playwright) and a 4-row log (live, 1600×1000):
  log pane under 40% of the frame, details pane over 50%, refs pane still full
  height and still scrolling.

## Risk

- **A dropped page for a reader who never scrolls.** AC-1 trades eager loading
  for reader-driven loading, so a window-narrowed history now shows only what the
  first page happened to contain until the reader asks for more. AC-3's control
  names the remaining count so the shortfall is visible rather than silent.
- **Deviating from the Sessions list's wrap-around focus.** Sessions wrap because
  the list is closed; the commit log is a paged timeline where wrapping from the
  oldest loaded commit to `HEAD` would misreport the history's shape. AC-6 and
  AC-7 clamp and page instead.
- **A sash whose value can be clamped by content.** Under AC-10 the log pane can
  be shorter than the sash's `aria-valuenow`, and dragging it taller has no effect
  while the content is short. The alternative is holding a void open, which
  `DESIGN.md` rejects; the sash still governs the pane whenever content fills it.
- **`fit-content()` and the spanning refs pane.** The refs pane spans all three
  rows, so an intrinsic first row could in principle be inflated by the refs tree.
  Measured against a 4-row log at 1600×1000: log pane 191px, details 641px, refs
  pane still the full 838px and still scrolling — the span does not inflate the
  track, so no containment hack is needed.
