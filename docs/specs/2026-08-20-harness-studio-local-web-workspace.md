# Browse and compare local sessions in Harness Studio

## Traceability

- Spec ID: harness-studio-local-web-workspace
- Status: Implemented

## Intent

Harness Studio is a local Web application, not a collection of views enabled by
startup flags. Launching the server should open an empty workbench. The user
then chooses a project working directory in the Web UI. Studio passes that
absolute local workspace identity to the same in-process discovery capability
used by Harness Inspector, which finds workspace-matching sessions in each
supported host's evidence store. The user does not need to know where a host
stores transcripts or select a Session directory manually.

The product hierarchy is `Workspace -> Sessions -> Session detail / Compare ->
Session artifacts`. CLI arguments may preload data for compatibility and
automation, but they do not own the interactive workflow or determine whether a
surface exists.

## Decisions

- **D-1: the project workspace is the root aggregate.** A selected local working
  directory creates one replaceable workspace scope. Session, compare, and
  artifact routes resolve through the sessions discovered for that scope.
- **D-2: a local server owns directory selection.** A normal browser directory
  input cannot reveal a portable absolute path, so it cannot establish the same
  workspace identity as Inspector. A same-origin POST asks the loopback server
  to open the operating system's directory chooser. No project files are
  uploaded or copied into Studio.
- **D-3: reuse Inspector discovery code in process.** Studio calls the existing
  multi-provider session-analysis capability with the selected workspace. It
  does not invoke an Inspector or session-analysis CLI subprocess and does not
  duplicate host path/slug rules in React.
- **D-4: Session Compare is observational.** Comparing two selected sessions
  shows retained status, duration boundary, tool calls, messages, and semantic
  phase differences. It does not emit a winner or reuse the frozen
  `harness-compare` verdict contract without evaluation evidence.
- **D-5: artifacts are session-scoped.** Artifact View is reached from the
  current session and resolves only that session's artifact set. A loose
  artifact directory is a compatibility preload, not the primary information
  architecture.
- **D-6: `better-harness web` is a launcher only.** The future public command
  locates and starts the packaged Studio application. Selecting or switching a
  workspace remains entirely inside the Web UI.
- **D-7: slow discovery reports real stages, not fake percentages.** While an
  open request is pending, Studio exposes only the coarse server-owned stage:
  waiting for the native directory chooser or discovering workspace-matched
  Sessions. The Web UI polls that privacy-safe state and renders an indeterminate
  progress indicator with reduced-motion support.
- **D-8: local Web owns a real default Debugger harness.** When workspace
  Session discovery is available and no explicit harness was configured, the
  server resolves a built-in single-session Qoder harness. Explicit harness
  configuration still wins. After workspace selection, live runs use that
  server-only directory as `cwd` and the default capability source root; no
  absolute path is returned to the browser and no scripted demo executor is
  substituted in production.
- **D-9: Sessions reuses the Inspector workbench instead of only its
  discovery.** The workspace provider returns the same privacy-filtered
  `HarnessInspectorReportV1` projection consumed by
  `scripts/harness-inspector/ui/workbench.html`. Studio rewrites that complete
  workbench interaction in React: Capability/Date navigation, scope metrics,
  evidence workbench cards, and the retained Session drawer are React-owned
  state and components. The original Inspector stylesheet/class contract stays
  the visual source, while `workbench.js` remains only the standalone HTML
  renderer and is never executed by Studio. The compact catalog remains an
  explicit secondary view for two-Session selection and comparison.

## Acceptance Scenarios

- **AC-1:** Studio starts with no data arguments and presents an enabled
  **Open workspace** action on Overview and Sessions.
- **AC-2:** Choosing a directory is allowed only from a same-origin loopback
  request, returns no absolute path to the browser, and does not upload or copy
  the project's files. Cancelling leaves the active workspace unchanged.
- **AC-3:** Selecting a project directory runs the Inspector-owned provider
  discovery against that workspace and produces a newest-first Session list
  with provider, prompt, observed time, and tool-call count. One unavailable or
  failed provider does not hide sessions from other providers.
- **AC-4:** Selecting a Session opens its real retained Session Debugger
  projection. No sample session is substituted when the workspace has data.
- **AC-5:** The user can select exactly two sessions from the current workspace
  and open Compare without supplying an experiment manifest or evidence path.
- **AC-6:** Session Compare names both sessions and shows observed differences
  for status, retained event count, tool-call count, message count, and tool
  sequence. It labels missing evidence and makes no winner claim.
- **AC-7:** Replacing or disconnecting the workspace clears the prior Session,
  Compare, and Artifact selection. Discovery is read-only and never writes into
  the workspace or native host session stores.
- **AC-8:** Empty-state UI copy does not instruct the user to restart with
  `--inspector`, `--evidence`, `--harness`, or `--artifacts` for browsing and
  comparing retained sessions.
- **AC-9:** Workspace and Session navigation remain keyboard usable with no
  document-level horizontal overflow at 1440x900, 1024x768, and 390x844.
- **AC-10:** The root CLI contract can later expose `better-harness web` as a
  workflow command that starts the same empty Studio server; it does not add
  directory-selection flags to the primary Web workflow.
- **AC-11:** During a slow workspace open, the button is disabled, an animated
  live status first reports directory selection and then Session discovery, and
  completion automatically replaces the intake with the discovered Session
  list. No made-up percentage or absolute path is shown.
- **AC-12:** The local Web Debugger is enabled without `--harness`, identifies
  itself as the workspace default, opens the existing live-run composer, and
  executes through the real built-in Qoder adapter in the selected workspace.
  A caller-supplied harness/runtime remains authoritative, and a Studio server
  without workspace discovery does not silently acquire a runnable endpoint.
- **AC-13:** After selecting a project workspace, Sessions defaults to the
  native Harness Inspector workbench backed by the workspace's structured
  report. Capability/date navigation, scope metrics, workbench rows, and the
  retained Session drawer execute as React components matching the complete
  `workbench.html` design; Studio does not load or execute `workbench.js`. A visible,
  keyboard-usable view switch exposes Catalog & Compare without losing the
  active workspace or requiring a restart/CLI argument. When a provider cannot
  supply structured Inspector data, Studio falls back to the catalog with an
  actionable status rather than an empty workbench.

## Non-goals

- Treating observational Session Compare as an experiment verdict.
- Uploading an entire repository or agent home to the loopback server.
- Reimplementing host transcript discovery inside the Studio package or UI.
- Maintaining an independent visual language for the React Inspector; the
  standalone `workbench.html` and its stylesheet remain the design contract.
- Editing, replaying, or writing back into imported sessions.
- Shipping the public `better-harness web` package boundary in this first UI
  migration; the server and packaged-app ownership must be resolved first.
- Faking an out-of-box run with a production scripted executor or bypassing the
  selected host's normal authentication and permission boundaries.

## Plan and Tasks

### 1. Introduce the workspace session contract

Add same-origin open/disconnect routes around a cross-platform native directory
picker. Keep the absolute path server-side and make the discovered workspace
scope the dynamic owner for Session routes.

### 2. Make Sessions the primary observed-data surface

Replace startup-flag-driven empty states with an Open workspace action, invoke
the Inspector-owned multi-provider collector in process, render its Session
catalog, and open real retained Session evidence from the selected row.

### 3. Add observational Session Compare

Allow two Session selections, derive a compact comparison model from retained
records, and render a docked two-session comparison without a winner verdict.
Keep frozen harness-compare evidence as a separate surface.

### 4. Scope Artifact View below Session

Resolve artifacts from a Session discovered for the selected project workspace
when the adapter exposes them. Until then, show an honest session-scoped empty
state rather than a loose global artifact picker.

### 5. Prepare the launcher boundary

Keep Studio's server start independent of data arguments. In a follow-up,
package the built Studio runtime so the root command registry can dispatch
`better-harness web` without repository-only paths.

### 6. Provide the local default Debugger harness

Resolve a compiler-valid built-in Qoder harness only for the local
workspace-discovery host. Keep explicit harness configuration authoritative,
bind execution to the selected workspace on the server, label the active
default in the UI, and exercise the same AG-UI/live-run path as configured
harnesses.

### 7. Mount Inspector as the primary Sessions workbench

Build a bounded `HarnessInspectorReportV1` from the same normalized provider
sessions during workspace discovery, retain it only in the server-side active
workspace, and expose it through a workspace-scoped structured endpoint. Rewrite
the complete Inspector workbench UI as React components using the standalone
HTML/CSS contract, with no `workbench.js` execution, plus an accessible
Inspector/Catalog & Compare switch and a catalog fallback.

## Test and Review Evidence

- AC-1/AC-8: empty-start model and Playwright assertions for UI copy and actions.
- AC-2/AC-3/AC-7: HTTP tests with an injected picker/provider for same-origin
  access, cancellation, atomic replacement, disconnect, provider diagnostics,
  path redaction, and read-only discovery.
- AC-4: browser test that selects a retained session and verifies its prompt and
  real tool-call projection.
- AC-5/AC-6: model and browser tests selecting two sessions and rendering an
  observational comparison with no winner language.
- AC-9: Playwright screenshots, keyboard focus, horizontal overflow, browser
  console, and page-error checks at all three required widths.
- AC-10: CLI inventory/dispatch tests belong to the packaging follow-up.
- AC-11: HTTP tests pause the injected chooser and provider to verify the two
  status stages; Playwright verifies the live discovery message, progress
  indicator, disabled action, and automatic transition to the Session list.
- AC-12: server tests resolve and execute the default harness with an injected
  deterministic executor while asserting the selected workspace `cwd` and
  source root; Playwright opens Debugger after workspace discovery and completes
  a live run through the default AG-UI path.
- AC-13: provider and server tests assert a privacy-filtered structured
  workspace report, Git/Session correlation, and no absolute-path disclosure.
  Playwright verifies the React-owned Inspector workbench is the default
  Sessions surface, opens a retained Session through its Date navigator,
  switches to Catalog & Compare, repeats wide/compact/narrow overflow plus
  console/page-error checks, and asserts that Studio never requests the legacy
  `workbench.js` runtime.

Implementation evidence (2026-08-20):

- `npm test` in `packages/harness-studio`: 18 files, 121 tests passed,
  including controlled chooser/discovery stages and default-harness execution
  rooted at the selected workspace.
- `npm run test:browser` in `packages/harness-studio`: 16 Playwright tests
  passed, including the workspace intake, discovered Session detail, Compare,
  the default live Debugger flow, animated discovery status,
  wide/compact/narrow screenshots, keyboard focus, overflow, console, and page
  error checks. The Sessions flow also exercises the React Inspector drawer and
  asserts that no legacy Inspector script is loaded.
- `npm test` at the repository root: 99 files, 1412 tests passed.
- A live in-process discovery smoke against this repository returned the bounded
  React Inspector report with 100 Sessions and 50 commits: Qoder 79, Codex 16,
  and Claude 5.

### Risks

- Browser directory inputs expose relative paths and bytes, not a portable
  absolute path. The loopback server therefore owns the native picker and must
  never expose the selected absolute path back to the page.
- Session records may contain sensitive prompts or tool output. Imports remain
  loopback-only, temporary, bounded, and never leave the local server.
- Host transcript formats differ substantially. Studio must reuse the bounded
  provider discovery and privacy-safe projection already owned by Inspector.
- Native directory chooser availability differs across Windows, macOS, and
  Linux. Platform implementations must use fixed commands without a shell and
  return an actionable unavailable state when no chooser exists.
- Large histories can exhaust memory. Discovery retains Inspector's global
  Session bound and hydrates only selected recent candidates.
- The Inspector workbench is a substantial retained-evidence renderer. Studio
  must reuse its assets lazily and keep the compact catalog available if the
  structured report or client runtime cannot be mounted.
