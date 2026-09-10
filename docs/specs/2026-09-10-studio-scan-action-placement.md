# Scan project placement: toolbar action plus first-scan empty-state CTA

## Traceability

- Spec ID: `2026-09-10-studio-scan-action-placement`
- Status: Implemented
- Request: decide where the Studio "Scan project" control belongs, and move it
- AI involvement: analysis, implementation, and local validation by an AI agent

## Intent

`Scan project` is currently a permanent full-width control in the sidebar scope
region, wedged between the Project switcher and the date range. That region has
one stated job: the Project says *where* to look and the date range says *when*.
Scan is neither. It is the data-ingest action, and its placement misreads its
frequency in both directions.

Two facts from the current code set the frequency:

- `scanRequired` is set to `true` in exactly one place, `restoreActiveProject`,
  which runs once at boot. Switching Projects goes through `activateProject` and
  scans for real. So "first scan" is a once-per-launch blocking state.
- Live updates cover **artifacts only** — a recursive `watchDirectory` plus the
  `/api/artifacts/events` SSE stream. Sessions, Git history, Skills, MCP, hooks,
  and plugins have no watcher. Every one of them refreshes only when the reader
  presses Scan.

Studio exists to observe Coding Agent Sessions. The reader's loop is: the Agent
finishes a turn, the reader wants the new Sessions and commits, and Rescan is the
only way to get them. That makes Rescan one of the highest-frequency shell-level
actions in the product, not a rare maintenance action.

Two frequencies, so two hosts:

- Steady-state Rescan is frequent and crosses every View, so it belongs in the
  window toolbar, where it stays reachable at every breakpoint.
- First scan is a once-per-launch blocking state, so its call to action belongs
  in the main-area empty state the reader is already looking at.

The sidebar scope region keeps only *where* and *when*.

## Acceptance Scenarios

- **AC-1** Given a scannable local Project, when the shell renders at wide,
  compact, or narrow width, then a Scan control is present in the toolbar and no
  Scan control is rendered in the sidebar.
- **AC-2** Given a restored Project that has not been scanned, when a Project
  View is shown, then the main-area empty state offers a Scan button that starts
  the scan, and the empty-state copy does not direct the reader to the sidebar.
- **AC-3** Given a scan in flight, when the reader inspects the toolbar control,
  then it is disabled, reports `aria-busy`, and exposes its progress through a
  status region while showing a spinner in place of its icon.
- **AC-4** Given a completed scan, when the toolbar control is read, then its
  accessible name is the Rescan wording and it is enabled again.
- **AC-5** Given a narrow layout, when the reader reaches the toolbar Scan
  control, then it is reachable without first opening the sidebar overlay.
- **AC-6** Given the active View publishes its own toolbar action, when both are
  present, then the View action and the shell Scan control are both visible and
  right-aligned, and the Scan control stays right-aligned when the View slot is
  empty.

## Non-goals

- Adding a watcher or SSE stream for Session discovery. That is the real fix for
  manual refresh pressure, and it is tracked separately; this change only places
  the control that exists today.
- Auto-scanning on boot. The restore path deliberately does not scan, so that a
  stale catalog cannot stop Studio from starting.
- Changing what a scan collects, or the `POST /api/projects/:id/scan` contract.
- Touching the Project switcher menu, which stays a Project-selection menu.
- Changing the date range control or the sidebar View list.

## Plan and Tasks

1. `ProjectSidebar.tsx`: drop the `studio-project-scan` block and the
   `canScanProject` / `scanRequired` / `scanning` / `onScanProject` props. Remove
   the now-unused `ArrowClockwise` import.
2. `App.tsx`: add a `ProjectScanAction` shell control rendered in the context bar
   after the View action slot, and pass the scan action into the scan-pending
   `EmptyWorkspace` so the blocking state carries its own CTA.
3. `shell.css`: add `.studio-shell-actions`, keep it right-aligned when the View
   slot is empty via `.studio-context-actions:empty + .studio-shell-actions`, and
   delete the `.studio-project-scan` rules.
4. i18n `en` / `zh-CN`: rewrite `scanPendingDetail` so it describes the scan
   instead of pointing at the sidebar.
5. `test/browser/project-scan.spec.mjs`: drop the nav-toggle prelude, assert the
   toolbar control at every layout, and assert the empty-state CTA starts a scan.

## Test and Review Evidence

- `npm run harness-studio:build`
- `npx vitest run --config vitest.config.mjs packages/harness-studio/test`
- `npx playwright test test/browser/project-scan.spec.mjs` from
  `packages/harness-studio` — 6 layout/theme combinations, screenshots retained
- Console and page errors asserted empty in the browser spec
