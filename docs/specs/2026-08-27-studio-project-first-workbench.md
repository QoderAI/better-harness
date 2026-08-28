# Make projects the Studio workbench scope

## Traceability

- Spec ID: studio-project-first-workbench
- Status: Implemented
- Related decision: [Developer Experience System](../adrs/developer-experience-system.md)
- Design contract: [Harness Studio visual system](../../DESIGN.md)

## Intent

Make Harness Studio project-first: a persistent left sidebar selects the active
project, and one shared workbench shell hosts every project-scoped View. Project
selection must be fast and explicit without forcing Sessions, Inputs, Commits,
Artifacts, Debugger, Compare, or Customizations to duplicate project chrome or
adopt one shared domain model.

The UI term **Project** identifies a remembered local or imported project entry.
The server term **workspace** remains the materialized filesystem and execution
authority for the active Project. Configured Inspector, experiment, evidence,
and compatibility Artifact inputs remain independent **Sources** and must not be
presented as if they belong to the selected Project.

## Acceptance Scenarios

- **AC-1:** At wide layout, Studio shows a persistent Projects sidebar and one
  adjacent workbench. The active Project expands one shared View navigation for
  Overview, Customizations, Inputs, Sessions, Commits, Artifacts, Debugger, and
  Compare; inactive Projects remain compact rows and do not duplicate the View
  navigation.
- **AC-2:** Opening a local directory registers an opaque Project descriptor,
  activates its freshly discovered workspace snapshot, and exposes only the
  Project id, label, revision, availability, and bounded counts to the browser.
  Native absolute paths remain server-only.
- **AC-3:** Activating a remembered Project re-runs workspace discovery, replaces
  the active workspace atomically, increments a monotonic Project revision, and
  refreshes project-scoped configuration, Sessions, Inputs, Git, Artifacts,
  Customizations, Compare, and default Debugger context. A cancelled or failed
  activation leaves the previous active Project usable.
- **AC-4:** Project routes encode the opaque Project id and View. Reload,
  browser back, and browser forward restore the active Project and View when the
  Project is still registered. Selecting another Project preserves the current
  View when possible and otherwise renders that View's honest unavailable state.
- **AC-5:** The shared shell owns product identity, Project/View context, theme,
  source selection, Project opening, and Project removal. Feature Views may own
  one local toolbar and their internal panes, but they do not repeat the active
  Project title or workspace change/disconnect controls.
- **AC-6:** Compare distinguishes current-Project Session comparison from
  configured experiment and frozen evidence Sources. A fixed experiment
  checkpoint is labelled as read-only context and is not rendered as a fake
  Project selector.
- **AC-7:** A live run captures the active Project id and revision at request
  start. Switching the UI Project cannot silently retarget an already-started
  run; the visible run context continues to identify its bound Project.
- **AC-8:** At 1440x900, 1024x768, and 390x844, the primary Project and active
  View remain obvious, the sidebar becomes a keyboard-operable overlay when
  compact or narrow, focus is visible, document-level horizontal overflow is
  absent, and browser console/page errors are empty in populated states.
- **AC-9:** Existing feature behavior remains reachable: Session inspection and
  comparison, Input trace and Intent analysis, Git history and patches, Artifact
  browsing and preview, customization analysis, Debugger runs, ACP permissions,
  Compare Simple/Advanced paths, and frozen evidence rendering.

## Non-goals

- Loading every remembered Project's full Session, Git, Artifact, or Inspector
  model into memory simultaneously.
- Merging feature-specific evidence, run, Artifact, Git, or experiment models
  into a universal Project or View IR.
- Claiming that configured experiment, evidence, Inspector, or compatibility
  Artifact Sources belong to the active Project without explicit binding.
- Adding a remote project service, authentication, collaboration, cloud sync,
  host adapter, or repository mutation workflow.
- Persisting remembered Projects across Studio server restarts in this change;
  the Project catalog is process-local and can gain a server-private durable
  store under a separately reviewed contract.

## Plan and Tasks

1. Add browser-safe Project descriptor and snapshot contracts with opaque ids,
   monotonic revisions, and pure route/view models.
2. Replace the single open-workspace route flow with a process-local Project
   catalog that registers local/imported workspaces, activates one materialized
   workspace at a time, preserves the previous Project on failure, and retains
   compatibility aliases for current workspace clients.
3. Split the React application shell into Project sidebar, context bar, View
   viewport, shared states, and a pure View registry. Key project-scoped Views
   by Project id and revision rather than an unlabelled workspace counter.
4. Move Project opening/removal and Project identity out of Sessions and other
   feature components. Keep feature-specific filters, tabs, actions, and dense
   workbench panes local.
5. Make Compare scope explicit and replace its one-option Current Project
   select with a read-only checkpoint context.
6. Add model, server, and Playwright coverage for registration, A/B activation,
   failure preservation, path privacy, routes, keyboard behavior, responsive
   layout, stale UI state, and existing feature reachability.
7. Run package build/typecheck/tests, focused browser suites, preview health and
   module smoke, console/error inspection, three-width screenshots, document
   link validation, and a Review Readiness Check.

## Test and Review Evidence

- **AC-1/AC-4/AC-5/AC-8:** pure shell/route tests plus Playwright Project A to
  Project B switching at 1440x900, 1024x768, and 390x844; assert one visible View
  navigation, focus restoration, no document overflow, and screenshots.
- **AC-2/AC-3:** server tests for Project listing/opening/activation/removal,
  cancelled and failed discovery, revision increments, same-origin mutation,
  imported-directory lifetime, and responses that never serialize native paths.
- **AC-6:** Compare model/browser checks distinguish Sessions, Bench, and frozen
  results and assert the checkpoint context is not an interactive Project select.
- **AC-7:** server and browser checks record the Project binding used by a live
  default-workspace run and prove later Project selection does not change it.
- **AC-9:** existing Harness Studio package and browser suites remain green,
  with selector updates limited to the shared chrome contract.
- Required commands:
  - `npm run build -w @qoder-ai/harness-studio`
  - `npm run typecheck -w @qoder-ai/harness-studio`
  - `npm test -w @qoder-ai/harness-studio`
  - `npm run test:browser -w @qoder-ai/harness-studio`
  - `npx vitest run test/skills-docs/doc-link-graph.test.mjs`
  - `node scripts/doc-link-graph/cli.mjs skills/better-harness`
  - `npm run preview`, then smoke `/health` and `/canvas-module.js`
- Risk: Project switching can cross-contaminate in-flight client reads. Mitigate
  with Project id/revision keys, effect cancellation, atomic activation, and
  response binding checks.
- Risk: a live run could execute in a different directory than the visible
  Project. Mitigate by capturing Project id/revision/cwd once at run start and
  retaining that binding in the run projection.
- Risk: configured Sources can be mistaken for Project evidence. Mitigate with
  explicit scope labels and independent source selection.
- Risk: the additional sidebar can squeeze dense workbenches. Mitigate with the
  existing wide/compact/narrow boundaries, overlay navigation below 1080px, and
  locally scrolling panes.

## Review Evidence

- `npm run build -w @qoder-ai/harness-studio` passed.
- `npm run typecheck -w @qoder-ai/harness-studio` passed.
- `npm test -w @qoder-ai/harness-studio` passed: 61 files, 472 tests.
- `npm run test:browser -w @qoder-ai/harness-studio` passed: 50 Playwright
  scenarios, including Project A/B switching, browser back/forward restoration,
  live-run Project binding, keyboard traversal, clean browser errors, and
  screenshots at 1440x900, 1024x768, and 390x844.
- `npm run check` passed under the repository-supported Node 24 runtime: 104
  root test files (1545 passed, 2 skipped), generated language sources, 173
  Harness tests, 31 Harness UI tests, 472 Harness Studio tests, and npm/runtime
  package verification. The host's default Node 26 is outside the declared
  `>=22.20.0 <25.0.0` engine range and cannot run Langium generation.
- `npx vitest run test/skills-docs/doc-link-graph.test.mjs` passed: 8 tests.
- `node scripts/doc-link-graph/cli.mjs skills/better-harness` regenerated the
  graph with no resulting tracked diff.
- `npm run preview` failed fast before binding a port because this machine has
  no Canvas SDK runtime and neither `CANVAS_SDK_MEDIA_DIR` nor
  `CANVAS_SDK_ROOT` is configured. Consequently `/health` and
  `/canvas-module.js` could not be claimed as live Preview evidence.
