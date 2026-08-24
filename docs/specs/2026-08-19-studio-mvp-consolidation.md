# Consolidate Studio into a usable Inspector, Debugger, and Compare MVP

## Traceability

- Spec ID: studio-mvp-consolidation
- Status: Implemented

## Intent

Turn Harness Studio from a control-plane demonstration into a genuinely usable MVP built around three real workbenches: Inspector (retained delivery evidence), Debugger (live harness runs plus saved run replay), and Compare (experiment bench plus frozen evidence results). Remove the Harnesses, Task Suites, and Registry foundation pages from navigation, add a durable run catalog so live runs survive as replayable evidence, and auto-discover the conventional local Inspector report so starting Studio in a repository needs fewer flags.

## Acceptance Scenarios

- AC-1: Studio navigation offers exactly Overview, Inspector, Debugger, and Compare. Debugger is ready when a harness is loaded; Compare is ready when an experiment manifest or compare evidence is loaded; unavailable areas show a short empty state naming the missing input.
- AC-2: Compare hosts two surfaces — Bench (the existing experiment workbench) and Evidence results (the frozen verdict view) — switched by the existing surface navigation without changing their internal behavior.
- AC-3: A finished or failed live Debugger run is saved automatically to a run catalog on the server (same-origin JSON, bounded body size, no arbitrary paths). `GET /api/runs` lists saved run metadata newest-first and `GET /api/runs/<id>` returns one full record; both 404 when no harness is loaded.
- AC-4: The Debugger offers a saved-runs list; selecting a saved run renders its retained prompt, timeline, warnings, and result read-only through the same components as the live view, labeled as a saved run. Saved records persist as JSON files under a bounded runs directory (default `.harness-studio-runs` under the executor cwd, overridable with `--runs <dir>`).
- AC-5: When `--inspector` is omitted, the CLI auto-discovers `.qoder/better-harness-runs/harness-inspector/inspector.html` under the working directory and serves it when present; an explicit `--inspector` still wins, and auto-discovery alone satisfies the "at least one surface" startup check.
- AC-6: Unit tests cover the new navigation model, run-catalog endpoints (save, list, read, origin rejection, missing-harness 404), and inspector auto-discovery. Browser coverage exercises the four-area navigation, Debugger live run, Compare bench/results, and empty states with no console or page errors.

## Non-goals

- Rebuilding the recorded step-debugger (Evidence Cursor, step controls) on real data; the demo fixture stays unexported dead code until a retained-session contract exists.
- A general file picker or arbitrary-path data loading from the browser; inputs remain server-configured or discovered from a fixed conventional path.
- Harness source editing, task-suite datasets, or registry/promotion features.
- Changing Inspector, ExperimentView, or CompareView internals beyond mounting.

## Plan and Tasks

1. Rewrite `studio-shell-model.ts`: areas become `overview | inspector | debugger | compare`; add `compareSurfaces` (`bench`, `results`); derive honest availability; drop the removed areas.
2. Rework `App.tsx`: new area copy/icons, DebuggerWorkspace (RunView or empty state), CompareWorkspace (Bench/Results tabs), Overview quick actions for the three areas; delete FoundationWorkspace and the three placeholder workspaces.
3. Add `src/server/run-log.ts` (save/list/read JSON records under one bounded directory) and mount `/api/runs` routes in `server.ts`, gated on a loaded harness with same-origin checks and a larger body cap for snapshots.
4. Extend `cli.ts` with `--runs <dir>` and Inspector report auto-discovery under cwd; pass the runs directory to the server.
5. Extend `RunView.tsx`: auto-save one snapshot per finished/failed run (prompt, status, ids, warnings, result, timeline items) and add a saved-runs panel that replays a selected record read-only via the live components.
6. Update unit tests (`studio-shell-model.test.ts`, `server.test.ts`, CLI discovery) and the browser spec for the new navigation and flows; build, run package and browser gates, then verify the MVP flow against the running preview.

## Test and Review Evidence

- AC-1/AC-2: `npm run harness-studio:test` passed 86 tests including the rewritten `studio-shell-model.test.ts` (four destinations, compare surfaces, honest availability). `npm run harness-studio:test:browser` passed 9 tests covering four-area navigation, Compare Bench/Results switching, and empty states at wide/compact/narrow layouts.
- AC-3/AC-4: `server.test.ts` covers run save/list/read, cross-origin 403, invalid snapshot 400, unknown-run 404, and missing-harness 404. The 390px browser test runs a live harness, reopens it from Saved runs, and asserts the read-only saved-run banner and retained failed Tool Call.
- AC-5: the CLI discovery unit test resolves the conventional report path from a temp cwd; a live start with only `--harness` and `--evidence` printed `Inspector report: … (auto-discovered)` and enabled the Inspector area.
- AC-6: in-browser MVP walkthrough on the 3311 preview confirmed the four-area navigation, native Inspector, Debugger Saved runs control, and Compare decision summary with no console or page errors.
