# Studio entry and shared date scope

## Traceability
- Spec ID: studio-entry-and-date-scope
- Status: Implemented (source and browser validation)
- Source: Maintainer request in this task; no linked Story supplied.

## Intent
Open Studio as a usable workbench instead of a blocking project-choice dialog.
Remove implementation maturity labels from navigation and make the sidebar the
single time-range owner for Sessions and Artifacts.

## Acceptance Scenarios
- AC-1: With no project, show an inline welcome screen with an Open Project action;
  navigation and settings remain available. Welcome selects no project view;
  entering an actual view selects that destination. Connected projects open directly.
  Cancelling project selection leaves the welcome screen usable.
- AC-2: View navigation and shell status do not display foundation/partial maturity
  tags or their decorative dots. Actual errors and data coverage remain visible.
- AC-3: Sessions uses the sidebar range in both Inspector and catalog views;
  no second calendar is offered. Changing the range loads fresh evidence and
  recomputes visible sessions and counts, clearing out-of-range detail/selection.
- AC-4: Artifacts has one file navigator and uses the sidebar range for observed
  artifacts in every pane. Changes reload and recompute; out-of-range previews
  cannot survive an empty result. Undated configured artifacts remain available.
- AC-5: Pending requests expose accessible loading feedback, failures have a retry
  action, and superseded responses cannot replace the current range.
- AC-6: Wide, compact and narrow layouts have bounded overflow, visible keyboard
  focus, no browser errors, and reviewed screenshots in light and dark themes.

## Non-goals
No host/provider expansion, publication, install, maturity-contract changes, or
standalone Inspector report redesign. Use the existing design tokens.

## Plan and Tasks
1. Replace the modal gate with a welcome region within the existing shell.
2. Remove shell maturity presentation without changing collector evidence semantics.
3. Bind Inspector, session catalog and artifact catalog to the shared range;
   retain request cleanup and make loading/error/empty states explicit.
4. Add behavioral browser coverage and run build, focused tests, visual review,
   documentation link integrity and Canvas preview smoke checks.

## Test and Review Evidence
- AC-1/2: Shared-scope browser scenarios cover welcome navigation, no modal,
  cancellation, project opening/reload, keyboard focus and absence of maturity UI.
- AC-3/4/5: Browser scenarios exercise actual server fixture catalogs and Inspector
  reports, range changes in both Session surfaces, loading with a held request,
  superseded artifact responses, empty previews, and retry after catalog/report
  failure. Inspector retry also verifies reattachment of its shadow-root surface.
- AC-6: Screenshots captured and reviewed at 1440x900, 1024x768 and 390x844 in
  light/dark appearances. Finite transitions finish before screenshots. Browser
  console/page errors and horizontal document overflow are asserted. Local
  screenshots are under `outputs/studio-entry-date-scope/` (ignored artifacts).
- `npm run build --prefix packages/harness-studio`: passed.
- Focused Playwright run across shared scope, project shell, artifact workspace,
  Inspector project opening, ACP and single-Agent comparison: 33 passed.
- Final `npx playwright test test/browser/shared-scope.spec.mjs`: 8 passed,
  including the artifact race/empty-preview scenario beyond that grep selection.
- Five focused Vitest files (date range, shell model, design tokens, i18n resources
  and components): 45 passed.
- Documentation routing graph regenerated with no diff; doc-link graph: 8 passed.
- `npm run preview` found the existing listener on port 58575; its `/health` and
  `/canvas-module.js` returned 200. No existing process was replaced.
- Review Readiness Check: local diff matches AC-1 through AC-6; no Story id was
  supplied or inferred, no staged changes, no release/version/generated-source
  changes. AI implementation and review: Codex in this task.

The range reloads retained server snapshots and recomputes their visible evidence;
it does not rescan provider directories. Untimestamped configured artifacts remain
visible. The standalone report retains its own date picker; only the Studio
embedding consumes the shell's range. No desktop package was rebuilt or installed,
and no Windows/Linux CI receipt is claimed.

A separate Live compare composer spec and compare translation edits appeared in
the shared working tree after validation. Those concurrent changes are outside
this task and its validation receipt; they were left intact.

Follow-up: corrected the welcome navigation state after the maintainer noticed
Sessions was still highlighted. Welcome now passes no current view to the sidebar;
the roving keyboard entry remains available, and actual Artifacts/Sessions
navigation restores the correct selection. Three focused browser tests passed
across light/dark and wide/compact/narrow layouts; welcome screenshots refreshed.
The app bundle built successfully without cleaning the running dev server's output.
Full typechecking during this follow-up encountered concurrent GitHistoryView edits
with unresolved ref identifiers/types; those unrelated edits were left intact.

## Date control presentation follow-up

- AC-7: The preset reads as one full-width control, with its calendar and disclosure
  icons inside the boundary. Selected custom mode is named Custom range. Its From
  and To fields share one flat group, retain native date entry and accessible
  labels, and do not repeat their values in a third summary line. Preset and date
  entry focus use one clear accent edge without a detached double frame. Invalid
  ranges retain the inline error and field association. Native dropdown, pointer,
  keyboard and range filtering behavior stay intact.
- Plan: adjust DateRangeFilter markup, narrowly scoped shell styles and the two
  locale labels; verify pointer/keyboard focus, unchanged control bounds, valid
  and inverted ranges, and screenshots across themes and sidebar widths.
- AC-7 validation: application bundle built successfully; 15 browser scenarios
  passed (date controls, shared range and artifacts), plus 29 focused unit tests.
  Keyboard Tab reaches From after the preset, focus does not change bounds, and
  controls stay inside the sidebar across all three widths. Invalid dates expose
  associated errors and recover after correction. Light/dark selected and focused
  screenshots were reviewed and retained in `outputs/studio-date-control-review/`.
  Full typechecking still reports the concurrent GitHistoryView ref and sash-state
  errors, outside these date-control changes. No desktop package was installed.
