# Connect Studio retained sessions and source switching

## Traceability

- Spec ID: studio-retained-sources
- Status: Implemented

## Intent

Make the Studio MVP usable without restarting for common local evidence changes. The Debugger must be able to project retained, real saved runs through the Evidence Cursor instead of only the hard-coded recorded sample, and Studio must expose a bounded source catalog so users can switch configured Inspector, Evidence, and Experiment inputs from inside the app.

## Acceptance Scenarios

- AC-1: A saved Debugger run is a retained-session record: `GET /api/runs/<id>/session` returns a `DebuggerSession` projection with prompt, message, tool-call, validation, evidence-link, and raw-event facts derived from the saved run JSON, not from `SAMPLE_DEBUGGER_SESSION`.
- AC-2: Selecting a saved run in Debugger opens the recorded Evidence Cursor view with step controls, execution tree, notebook, inspector, and minimap backed by that retained session. Live runs still show live observation until a saved record is selected.
- AC-3: Studio exposes `GET /api/sources` with a bounded catalog of configured or catalog-declared sources and the current active source per kind. The response never exposes arbitrary browser filesystem access and only lists server-side allowed paths as labels or opaque ids.
- AC-4: `POST /api/sources/select` switches the active Inspector report, Evidence directory, or Experiment manifest to one of the catalog candidates using same-origin JSON. `/api/config` and the relevant data endpoints reflect the active selection immediately, without restarting Studio.
- AC-5: CLI accepts an optional source-catalog file for multiple switchable local inputs while preserving the existing direct flags. Direct flags remain valid single-source candidates; explicit `--inspector`, `--evidence`, and `--experiment` values are initially active.
- AC-6: Unit and browser coverage prove retained-session projection, source catalog listing/switching, config refresh, and saved-run Evidence Cursor selection. Existing live-run, Inspector, Compare, and browser layout flows continue to pass.

## Non-goals

- Adding an arbitrary in-browser file picker or accepting user-supplied paths from the browser.
- Restoring/forking a workspace or claiming runtime pause/gate semantics for retained runs.
- Replacing the Inspector report format, experiment manifest contract, or compare evidence contract.
- Switching the loaded harness runtime or executor from inside Studio; live execution remains startup-scoped.
- Importing external host histories beyond the saved-run retained-session projection in this change.

## Plan and Tasks

1. Add a retained-session projector in `session-debugger-model.ts` that converts a saved run record/timeline into a `DebuggerSession`; keep the sample fixture only as a fallback/demo export.
2. Update `RunView.tsx` so saved-run selection fetches the retained-session endpoint, sets the current session, and routes the existing Evidence Cursor controls/components through that session instead of `SAMPLE_DEBUGGER_SESSION`.
3. Add source catalog types and parsing in the server/CLI: direct flags become catalog candidates, an optional `--source-catalog <file>` may add more allowed Inspector/Evidence/Experiment inputs, and server state owns active paths.
4. Add `/api/sources` and `/api/sources/select` in `server.ts`; route Inspector, Evidence, Experiment, and `/api/config` through active source state. Enforce same-origin and opaque ids; reject unknown kinds, ids, and path escape attempts from browser input.
5. Add a compact source switcher in the Studio context bar that lists only available candidates, posts selections, refreshes config, and remounts affected workspaces so data reloads without restart.
6. Update model/server/browser tests and mark this spec Implemented only after local validation evidence is available.

## Test and Review Evidence

- AC-1/AC-2: `session-debugger-model.test.ts` covers saved-run-to-session projection; `server.test.ts` covers `GET /api/runs/<id>/session`; `npm run harness-studio:test:browser` reopens a finished live run from Saved runs and verifies the visible Evidence Cursor controls, retained Bash event, and failed event status at 390px.
- AC-3/AC-4/AC-5: `server.test.ts` covers source-catalog parsing, `/api/sources`, same-origin rejection, active Inspector switching, `/api/config` after switching, and endpoint data changing without restart. The browser test switches the Inspector from the startup report to a catalog-declared alternate report through the Studio source switcher.
- AC-6: `npm run harness-studio:test` passed 15 files and 88 tests. `npm run harness-studio:test:browser` passed 9 Playwright tests.
- Risk: a source switcher can imply arbitrary filesystem access. Mitigation: only server-declared candidates are selectable; browser posts opaque ids, not paths.
- Risk: retained-session projection can overstate semantic intent. Mitigation: generated events label Exact facts from saved run fields and Correlated/Inferred UI grouping explicitly.
- Risk: switching active data while a comparison/live run is in progress can confuse state. Mitigation: source switch only changes read endpoints and active config; live harness execution remains scoped to the startup harness.
