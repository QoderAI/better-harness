# Collapse the Sessions workbench chrome and restore Session discovery in the desktop shell

## Traceability

- Spec ID: studio-sessions-workbench-chrome
- Status: Implemented

## Intent

The Sessions View in the desktop shell stacks three headers before any evidence
appears, and the evidence itself is empty. A reader opening Harness Studio on a
Project with a hundred retained Sessions sees `0 sessions`, three bands of
chrome that each restate "Harness Inspector", and two fixed-width columns that
cannot be resized.

Two separate defects produce that screen:

1. **Duplicated chrome.** The window toolbar already names the View
   (`Sessions`). Below it, `session-workbench-toolbar` opens a second bar with
   `Session evidence` / `Inspector-owned Project observations` and the
   Inspector / Catalog surface switcher. Inside the embedded Inspector, a third
   block names `Harness Inspector` over the Project name, and a fourth
   restates `Harness Inspector /` as a breadcrumb prefix. DESIGN.md already
   forbids this: *"Show a surface switcher once per viewport"*, *"Do not
   duplicate navigation or status merely to fill a header"*.
2. **No Sessions.** The desktop shell discovers Sessions through the bundled
   `dist/server/runtime/inspector-workspace-runtime.mjs`, produced by esbuild
   from `packages/harness-studio/scripts/inspector-workspace-provider.mjs`.
   `scripts/session-analysis/analyzer.mjs` loads each host adapter with
   `await import(entry.specifier)`, where `entry.specifier` is a *variable*.
   esbuild cannot follow a computed specifier, so it leaves the expression in
   the output; at runtime it resolves `./platforms/<host>.mjs` relative to the
   bundle, where no `platforms/` directory exists. Every one of the thirteen
   providers fails with `Cannot find module …`, the provider runner records
   `status: "error"`, and discovery returns zero Sessions.

The failure is silent to the reader: the per-provider error messages never reach
the UI, and the Sessions surface reports the generic
`Nothing in this window. Widen the date range in the sidebar.` — which blames
the date range for a module-resolution defect.

### Measured evidence

Both providers run against the same directory, on the same host:

| entry point | providers `ok` | `discovered` | report Sessions |
| --- | --- | --- | --- |
| `packages/harness-studio/scripts/inspector-workspace-provider.mjs` (source) | 5 | 118 | 100 |
| `packages/harness-studio/dist/server/runtime/inspector-workspace-runtime.mjs` (bundled) | 0 | 0 | 0 |

`report.days` is `5` in both runs, because Git history is collected through
statically-resolved imports. Only the dynamically-loaded host adapters break,
which is why the workbench renders a populated date navigator with no Sessions
behind it.

## Acceptance scenarios

- **AC-1** Given the bundled workspace runtime and a Project directory with
  retained local Sessions, when discovery runs, then it returns the same
  provider statuses and Session count as the repository-local provider module,
  and no provider reports a module-resolution error.
- **AC-2** Given the Sessions View with the Inspector workbench available, when
  it renders, then exactly one bar above the evidence names the View, and the
  Inspector / Catalog surface switcher lives in that bar.
- **AC-3** Given the embedded Inspector workbench, when it renders, then no
  region restates the product name `Harness Inspector`, and the scope picker
  carries no brand block above its mode tabs.
- **AC-4** Given the Sessions View at wide and compact widths, when the reader
  drags the divider between the scope picker and the workbench, then the picker
  resizes within its bounds, the size survives a re-render, `Home`/`End` and the
  arrow keys move it from the keyboard, and double-click restores the default.
- **AC-5** AC-4 also holds for the divider between the Session catalog pane and
  the Session detail pane on the Catalog surface.
- **AC-6** Given the narrow layout (390px), when the Sessions View renders, then
  the panes stack, the sashes are inert, and the document has no horizontal
  overflow.

## Non-goals

- Re-designing the Inspector workbench card lanes, metrics strip, or Session
  View overlay.
- Changing the standalone `harness-inspector` HTML report chrome. That report
  opens offline with no shell around it, so its own brand block and breadcrumb
  are the only thing naming it; `test/reporting/harness-inspector.test.mjs`
  pins that contract and stays unchanged.
- Adding a per-provider discovery diagnostics surface. The provider statuses are
  already carried in `StudioWorkspace.providers`; exposing them is separate work.
- Changing which hosts are supported, or how any single adapter parses evidence.

## Plan

1. **Host adapter loading.** Replace the computed `specifier` string in
   `scripts/session-analysis/analyzer.mjs` with a per-host `load()` thunk that
   contains a literal `import("./platforms/<host>.mjs")`. A bundler can follow a
   literal specifier inside a thunk, so the adapters are inlined into the
   workspace runtime while direct source consumers keep lazy loading.
2. **One bar.** Delete `session-workbench-toolbar` and the
   `session-workbench-stack` wrapper from `SessionsWorkspace`. Render the
   surface tablist through `ToolbarActions` into the window toolbar's action
   slot, the same route `GitHistoryView` already uses. Retire the now-unused
   `sessions.workbenchTitle` and `sessions.workbenchDetail` strings.
3. **Inspector chrome.** In `InspectorWorkbench`, drop the `.brand` block and
   move the picker collapse control onto the mode-tab row; drop the
   `Harness Inspector /` breadcrumb prefix, and omit the breadcrumb entirely
   when the shell's date range is in force and the picker is in Sessions mode,
   because the toolbar and sidebar already state that scope.
4. **Resizable panes.** Give the embedded Inspector a `PaneSash` between the
   scope picker and the workbench, and the Session catalog a `PaneSash` between
   the list and the detail pane. Bounds come from a measured `ResizeObserver`
   frame, as in `GitHistoryView`, so a dragged size cannot survive a window that
   no longer has room for it. The Inspector sash lives inside the shadow root,
   so its styles ship in the embedded stylesheet rather than in `shell.css`.

## Test and review evidence

- `packages/harness-studio/test/inspector-workspace-provider.test.mjs` — extended
  with a case that bundles the host-adapter registry the way the shipped runtime
  does and loads every supported adapter through it (AC-1). The regression is a
  resolution failure, so the test asserts on the loaded module, not on source
  text. Confirmed non-vacuous: the same bundle built from the pre-fix registry
  fails with `Cannot find module …/platforms/codex.mjs`.
- `npx vitest run` in `packages/harness-studio` — 78 files, 592 tests pass.
- `npx vitest run test/reporting/harness-inspector.test.mjs` — 39 tests pass,
  proving the standalone report's brand block and breadcrumb are unchanged.
- `npx vitest run test/sessions` — 25 files, 449 tests pass, covering the
  session-analysis registry and the commit-session correlation that reads it.
- `npx vitest run test/skills-docs/doc-link-graph.test.mjs` — 8 tests pass.
- Playwright against the built app served with `shell=desktop&controls=left`, on
  this repository as the open Project:

| observation | before | after |
| --- | --- | --- |
| bars above the evidence | 2 | 1 (`studio-context-bar`) |
| `.brand` blocks in the embedded Inspector | 1 | 0 |
| elements reading exactly `Harness Inspector` | 2 | 0 |
| Session rows / workbench cards | 0 / 0 | 100 / 100 |
| workbench header badge | `all · 0 sessions` | `4 providers` |
| status bar | `100 sessions` twice | once |
| picker sash `aria-valuenow` | absent | 270 → 390 (drag) → 374 (`ArrowLeft` ×2) → 270 (double-click) |
| catalog sash `aria-valuenow` | absent | 300 → 447 (drag) |
| picker sash height vs pane height | 54 049px vs 820px | 820px vs 820px |
| document horizontal overflow at 1440 / 1024 / 390 | — | none |
| sashes at 390px | — | `tabindex=-1`, `display:none` |
| browser console and page errors | — | none |

  Screenshots for each surface and width are in `.tmp/sessions-review/`
  (`wide-inspector.png`, `wide-inspector-resized.png`, `wide-catalog.png`,
  `compact-inspector.png`, `narrow-inspector.png`, `narrow-catalog.png`).

## Follow-ups found while verifying, not addressed here

- `restoreActiveProject` fails silently for a remembered Project whose id does
  not match `projectForId`'s `project_<32 hex>` pattern, and
  `restoreRememberedProjects` swallows the result. A launch then opens on the
  gate with no diagnostic. Reproduced only with a hand-seeded catalog, so it is
  not the reported defect, but the silent path is worth a look.
- Per-provider discovery statuses already reach `StudioWorkspace.providers` and
  are never surfaced. Had they been visible, the thirteen
  `Cannot find module …` errors behind this spec would have been legible in the
  UI instead of reading as an empty date window.
