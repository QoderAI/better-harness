# Browse workspace artifacts by date and file

## Traceability

- Spec ID: studio-artifact-workspace-browser
- Status: Ready for Review

## Intent

Make Artifacts a first-class view of the currently open project workspace. A
reviewer should not have to select one Session before learning which outputs
local coding agents changed or delivered. Studio should aggregate the existing,
workspace-confined files named by retained `change` and `deliver` observations,
let the reviewer navigate that set by Date or Files, show the matching Artifact
set in an adjacent pane, and render the selected current revision through the
existing Artifact View/Canvas boundary.

The open project remains the single workspace authority. Date is observation
context, not retained file history: the Artifact renderer continues to show the
current exact bytes and revision digest from the workspace.

## Acceptance Scenarios

- **AC-1:** Opening or replacing a project workspace derives one Artifact set
  from existing files referenced by retained Session `change` or `deliver`
  events. The set is available without selecting a Session, is confined to the
  canonical workspace root, and rejects symlinks, hard links, directories,
  missing files, path traversal, and absolute paths outside that root.
- **AC-2:** `/api/artifacts` continues to satisfy the public
  `HarnessStudioArtifactCatalogV2` contract and, for a workspace-owned set,
  adds a Studio-owned navigation projection mapping Artifact ids to bounded
  Session/date observations. Revision-scoped content, snapshot, build, and
  hosted-view routes resolve only through the same confined set. A CLI-provided
  Artifact directory remains a compatibility authority when no project
  workspace is open.
- **AC-3:** Artifacts opens directly into a docked three-pane workbench on wide
  screens: scope navigator on the left, matching Artifact rows in the middle,
  and the existing Artifact View host on the right. The newest available scope
  and its first Artifact are selected by default; there is no `Select a Session
  first` gate.
- **AC-4:** Date mode groups observations by day and lists the Sessions that
  produced existing Artifacts. Files mode presents the same Artifact set as a
  hierarchical path tree. Selecting a day, Session, directory, or file updates
  only the adjacent scope; selecting an Artifact updates the renderer. Search
  filters the middle Artifact list without changing catalog authority.
- **AC-5:** The UI labels the preview as the current workspace revision and
  exposes the observed Session/provider/time separately. It does not claim that
  prior file bytes, cross-Session Artifact identity, or a revision chain were
  retained.
- **AC-6:** The title bar owns one project-wide **Change workspace** action.
  Replacing or disconnecting the workspace clears the previous Artifact
  authority and navigation selection. Sessions does not duplicate the change
  action in its local footer.
- **AC-7:** At 1440x900, 1024x768, and 390x844, the primary Artifact question
  and selected preview remain reachable, document-level horizontal overflow is
  absent, keyboard focus is visible, list/tree controls have accessible names,
  and browser console/page errors are empty in meaningful populated states.
- **AC-8:** Observing a source file does not make it executable. Ordinary
  `.tsx` and `.jsx` files use the read-only Source surface and have no build
  reference. Only the explicit `*.canvas.tsx` format enters Studio's React
  Preview or a provider-hosted Canvas lane. Studio-owned Mermaid Preview keeps
  its renderer dependency closure separate from workspace package imports and
  works when the open workspace itself contains `node_modules`.
- **AC-9:** Recognized text source is syntax-highlighted and padded inside the
  editor boundary. Unrecognized extensions are sniffed from a bounded byte
  sample: valid text receives the plain Source surface while binary bytes stay
  unavailable. A compile or runtime failure automatically exposes the exact
  highlighted Source revision without hiding the failure status or Retry.

## Non-goals

- Scanning every file in the project and calling it an Artifact.
- Retaining historical Artifact bytes, reconstructing old Session outputs, or
  adding cross-Session Artifact Thread identity.
- Editing, writing back, annotating, or resuming a Session from Artifact View.
- Changing adapter, renderer, Provider, Canvas, sandbox, or content-security
  selection policy beyond restricting executable TSX to the explicit Canvas
  format and completing the built-in Mermaid renderer dependency closure.
- Adding a second directory chooser or an Artifact-specific workspace.

## Plan and Tasks

1. Derive normalized Artifact observations from workspace Session projections,
   bind them to the canonical workspace root, and retain only server-private
   paths plus privacy-safe Session metadata.
2. Allow the Artifact catalog indexer and revision routes to resolve an explicit
   bounded list of nested workspace-relative files while preserving the legacy
   single-directory behavior.
3. Add a Studio-owned navigation projection to the workspace catalog and expose
   the workspace Artifact count through configuration/navigation status.
4. Replace the two-pane Explorer with Date/Files scope navigation, a matching
   Artifact list, and the existing Artifact renderer pane. Make selection and
   responsive pane switching keyboard-operable.
5. Move **Change workspace** to the application title bar and remove the
   Sessions-local duplicate.
6. Add focused server/model/component/browser coverage, then run package gates,
   local preview smoke checks, multi-viewport visual review, and Review
   Readiness Check.
7. Keep ordinary TSX/JSX on the native Source surface, reserve compilation for
   `*.canvas.tsx`, and verify the Studio-owned Mermaid renderer against a real
   repository root whose `node_modules` is inside the Artifact authority.
8. Make Source the useful failure surface, retain diagnostics in the status
   boundary, sniff unknown text without decoding binary artifacts, and verify
   source highlighting and editor padding on representative large files.

## Test and Review Evidence

- AC-1/AC-2: focused catalog and server tests with nested paths, duplicate
  observations, missing files, absolute/outside paths, links, and stale
  revision requests.
- AC-3/AC-4/AC-5/AC-6: Studio model and browser flows against a workspace
  provider fixture with multiple days, Sessions, directories, and renderer
  formats.
- AC-7: Playwright/browser screenshots at 1440x900, 1024x768, and 390x844;
  keyboard traversal, focus, horizontal overflow, console, and page-error
  assertions.
- AC-8: registry/catalog assertions for ordinary TSX versus Canvas TSX, a
  browser Source-only flow, and a real-repository Mermaid compile check that
  exercises `beautiful-mermaid`, `entities`, `elkjs`, React DOM, and Scheduler.
- AC-9: bounded unknown-text/binary catalog tests plus browser checks for
  highlighted source, failed-preview fallback, padding, and selection reset.
- Package gates: `npm run typecheck`, focused Vitest, full
  `packages/harness-studio` tests, preview `/health` and `/canvas-module.js`,
  `git diff --check`, and the Markdown doc-link graph after regenerating it.

### Current receipts

- `packages/harness-studio`: `npm test` — 40 files, 247 tests passed.
- Playwright: full Harness Studio browser suite — 39 tests passed, including
  Artifact Host native fallbacks, provider-hosted renderers, and all Artifact
  Workspace wide/compact/narrow cases.
- Live browser: the 159 KB `workbench.css` reached highlighted state with
  padded source layout; the repository Mermaid graph with YAML front matter
  rendered successfully; no document-level overflow was observed at the three
  acceptance viewports.
- Preview smoke: existing `127.0.0.1:58575` process returned `ok` from
  `/health` and JavaScript from `/canvas-module.js`.
- Documentation routing: regenerated `docs/better-harness-doc-links.mmd`; all
  8 doc-link graph tests passed.

### Risks

- **Evidence paths are advisory:** retained Session resources may be stale or
  malformed. Re-resolve every candidate against the canonical workspace and
  index only its current regular-file bytes.
- **Date can be misread as history:** keep observed time on the navigation row
  and current revision in the preview header; do not present a revision
  timeline without retained bytes.
- **Large workspaces:** deduplicate observations before hashing, keep the
  existing Session bound, and index only changed/delivered paths rather than
  recursively walking the project.
- **Concurrent dirty worktree:** the pre-existing Commit-view files and their
  overlapping stylesheet edits are outside this scope. Preserve those changes
  and edit only the Artifact-owned CSS region.
- **Executable-source confusion:** file extension is not evidence that code is
  intended to run. Require the explicit Canvas suffix before attaching a build
  route; keep built-in renderer dependencies on a separate trusted closure.
