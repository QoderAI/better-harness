# Make the published Studio first run actionable

## Traceability

- Spec ID: studio-published-first-run
- Status: Implemented
- Design contract: [Harness Studio visual system](../../DESIGN.md)
- Related Project shell: [Make projects the Studio workbench scope](2026-08-27-studio-project-first-workbench.md)

## Intent

Make the installed `@qoder-ai/harness-studio` CLI behave like the Project-first
Studio shown by the repository launcher. A user starting the published package
must be able to open a local Project, analyze supported Host customizations, and
recover from ordinary input, port, and browser-loading failures without reading
source code. Unavailable capabilities must remain honest and actionable.

## Acceptance Scenarios

- **AC-1:** The packed npm artifact contains a bundled workspace Session
  provider. Starting `harness-studio` without repository-only scripts reports
  Project discovery as enabled, and the Projects add command can discover a
  selected local directory without exposing its native path to the browser.
- **AC-2:** The packed ESM CLI loads the bundled customization runtime under a
  supported Node release. An Analyze request returns independent Host results
  instead of failing because a CommonJS dependency attempted a dynamic
  `require` from ESM.
- **AC-3:** A Host collection failure retains a bounded, privacy-safe reason and
  the Customizations View keeps an enabled retry action. Native paths,
  environment values, commands, arguments, and authorization data never cross
  the browser boundary.
- **AC-4:** `--version` succeeds. Unknown options preserve the first offending
  token; value options reject a missing value without consuming the following
  known flag; missing input files and occupied ports produce concise recovery
  guidance, including `--port <n>` for address conflicts.
- **AC-5:** A Studio configuration-load failure presents a keyboard-operable
  Retry command that re-runs the coherent config/source/Project fetch without a
  full page refresh.
- **AC-6:** Empty Views offer a relevant shell-owned action when one exists,
  unavailable status is rendered as status rather than button-like chrome, and
  launchers without a prerequisite state the actual missing capability.
- **AC-7:** Before a live run starts, Debugger uses ordinary state language such
  as Ready and Waiting. Advanced retained-history terminology appears only on
  recorded evidence surfaces; the live inspector explanation follows actual
  running, finished, error, or permission state.
- **AC-8:** At 390x844, the active View title remains readable, Source controls
  collapse to an icon/count affordance, toolbars do not consume the primary
  vertical decision area, document overflow stays zero, and focus remains
  visible.
- **AC-9:** The package README starts with an actionable Project-first command
  and accurately distinguishes packaged CLI behavior from repository
  development launchers.
- **AC-10:** A comparison whose checkpoint source is unavailable is blocked by
  one shared readiness predicate in Setup, Simple Compare, Advanced Workbench,
  and the server execution route. No surface calls it Ready, enables entry or
  Run, or claims that fresh runs share a valid checkpoint.
- **AC-11:** A Qoder experiment never receives or renders an ACP Agent
  selection. Simple and Advanced surfaces identify Qoder execution from the
  manifest runtime, while ACP manifests retain their registered Agent chooser
  and server-side selection validation.
- **AC-12:** Session comparison exposes explicit Metric, Left, and Right column
  headers. At 390x844 both values remain visible and associated with their lane
  without document-level or table-level horizontal scrolling.
- **AC-13:** Every Session comparison checkbox has a unique accessible name
  containing the Session identity, and Up/Down/Home/End move one roving row
  focus through the Session catalog.
- **AC-14:** An exact zero Artifact count is unavailable evidence rather than a
  ready catalog. Overview does not recommend the empty View, and Project-backed
  evidence empty states offer the shell-owned command for opening another
  Project when discovery is available.
- **AC-15:** The Compare destination status follows the active Compare surface,
  so an open Bench is labelled Harness Bench even when Session comparison is
  also available.

## Non-goals

- Persisting the process-local Project catalog across server restarts.
- Adding a new Coding Agent host, remote Project service, authentication layer,
  or browser-exposed native path picker.
- Replacing the Debugger evidence model or removing precise retained-history
  terms from the recorded Session surface.
- Publishing the package or changing its version, release notes, or changelog.

## Plan and Tasks

1. Bundle the existing Inspector workspace provider and its repository-owned
   dependencies into `dist/server/runtime`, and load it lazily from the CLI.
2. Give Node-targeted ESM runtimes a `createRequire(import.meta.url)` bridge so
   bundled CommonJS dependencies work on supported Node releases.
3. Preserve safe collector failure reasons through the customization contract
   and keep Analyze retryable.
4. Refactor CLI value parsing around explicit option contracts, add version and
   friendly filesystem/listen diagnostics, and cover the actual compiled CLI.
5. Add a retryable Studio bootstrap function and action-aware empty states;
   simplify live Debugger status copy and narrow layout priorities.
6. Update the package README and verify the tarball contents, installed CLI,
   HTTP config, Project open flow, customization analysis, and browser layouts.
7. Reuse the checkpoint readiness contract across all experiment surfaces and
   reject direct execution when the server observes an unavailable source.
8. Project runtime identity from the manifest host and expose ACP Agent catalogs
   only for ACP-hosted experiments.
9. Add semantic Session comparison headers, narrow columns, unique checkbox
   names, and roving Session-row focus.
10. Derive navigation and Overview actions from usable evidence counts and the
    active Compare surface rather than only source presence.

## Test and Review Evidence

- **AC-1/AC-2:** build and pack the workspace, install or execute the tarball in
  an isolated temporary directory, start the compiled CLI, inspect `/api/config`,
  open a fixture Project through the server seam, and call customization Analyze.
- **AC-3/AC-4:** focused Vitest behavior tests for redacted failure reasons,
  first-error parsing, missing values, version, missing files, and `EADDRINUSE`.
- **AC-5/AC-6/AC-8:** Playwright scenarios for failed-then-successful bootstrap,
  actionable empty states, semantic status, keyboard focus, 390x844 layout,
  zero document overflow, and empty console/page errors.
- **AC-7:** component/model and browser assertions for Ready, Running,
  Permission required, Finished, and Failed labels without claiming a pause.
- **AC-9:** inspect the packed README and `npm pack --dry-run` file list.
- **AC-10/AC-11:** focused contract and server tests plus Playwright against one
  unavailable Qoder manifest and one ready ACP manifest. Assert disabled actions,
  a 409 direct-run boundary, truthful Qoder labels, and an ACP-only catalog.
- **AC-12/AC-13:** Playwright at 390x844 with explicit column-header assertions,
  bounded cell rectangles, unique checkbox names, and arrow-key row focus.
- **AC-14/AC-15:** pure shell-model tests for zero evidence, Overview actions,
  Project recovery actions, and active Bench status.
- Required commands:
  - `npm run build -w @qoder-ai/harness-studio`
  - `npm run typecheck -w @qoder-ai/harness-studio`
  - `npm test -w @qoder-ai/harness-studio`
  - `npm run test:browser -w @qoder-ai/harness-studio`
  - `npm pack -w @qoder-ai/harness-studio --dry-run`
  - `npx vitest run test/skills-docs/doc-link-graph.test.mjs`
- Risk: bundling repository discovery can capture unsupported files or native
  paths. Keep it in one Node-only runtime entry and verify the tarball plus the
  browser-safe Project contract.
- Risk: reporting collector exceptions can leak secrets. Normalize to a small
  allowlist of reason categories and never serialize raw messages, stacks, or
  filesystem paths.
- Risk: denser narrow-screen changes can hide commands. Retain accessible names,
  one primary action, visible focus, and desktop labels while collapsing only
  secondary copy.
- Risk: UI-only experiment gating can be bypassed by a direct request. Apply the
  same readiness contract at the server route before allocating a run.
- Risk: runtime identity can drift if it is inferred from an installed catalog.
  Use the loaded manifest host as authority and treat Agent selection as an
  ACP-only refinement.

### Implementation receipt

- **AC-1/AC-2:** The extracted `0.1.1` tarball reported
  `workspaceDiscoveryEnabled: true`, opened a non-Git temporary Project through
  the bundled Session provider, and analyzed all three customization Hosts.
  The real bundled runtime returned 288 definitions with no Host failure.
- **AC-3/AC-4:** Focused server and collector coverage passed as part of 76
  targeted tests. The extracted CLI returned `0.1.1`, preserved
  `Unknown option '--evidenc'.`, and the server test exercised missing values,
  missing Harness files, and occupied-port recovery.
- **AC-5/AC-6/AC-7/AC-8:** The Project shell browser suite exercised bootstrap
  Retry, action-owned empty states, Ready/Running live states, a Project switch
  during a live run, compact Source controls, focus, zero document overflow,
  and 1440x900, 1024x768, and 390x844 screenshots. The complete browser suite
  passed 51 scenarios without console or page errors in the changed surfaces.
- **AC-9:** `npm pack --dry-run --ignore-scripts` included the package README,
  both bundled runtimes, and the Inspector runtime's HTML, CSS, and JavaScript
  assets. The package contained 1,142 files (6.9 MB compressed).
- **AC-10/AC-11:** One shared checkpoint predicate now controls Setup, Simple,
  Advanced, `/api/config`, and the run route. Focused server and browser checks
  proved that an unavailable Qoder experiment reports Blocked, returns 409
  without calling its runner, omits the ACP catalog and selector, and continues
  to identify ready ACP manifests through their registered Agent selection.
- **AC-12/AC-13:** Session comparison now exposes semantic Metric, Left, and
  Right headers. Playwright verified bounded 390x844 cells, unique comparison
  checkbox names, and Up/Down roving row focus; wide, compact, and narrow
  screenshots were visually reviewed.
- **AC-14/AC-15:** Shell-model coverage proved that zero Artifacts are partial
  evidence and are not recommended by Overview, Project recovery actions retain
  their shell-owned labels, and Compare status follows Sessions, Bench, or
  frozen Results. The configured Overview also reports a blocked checkpoint as
  needing attention rather than ready.
- `npm run typecheck -w @qoder-ai/harness-studio` passed.
- `npm test -w @qoder-ai/harness-studio` passed 61 files / 487 tests.
- `npm run test:browser -w @qoder-ai/harness-studio` passed 52 tests.
- `npx vitest run test/skills-docs/doc-link-graph.test.mjs` passed 8 tests after
  regenerating the routing graph.
- The required repository Canvas preview remains independently blocked before
  binding a port because no Canvas SDK runtime is configured; `/health` and
  `/canvas-module.js` therefore could not be smoked in this checkout.
