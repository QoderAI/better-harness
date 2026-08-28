# Native Session Artifact Opening

## Traceability

- Spec ID: native-session-artifact-opening
- Status: Implemented

## Intent

Treat files retained by a coding Session as the source of truth for Viewer
surfaces. A user should be able to select, press Enter on, or double-click a
Session file such as `review.diff` and inspect its exact current revision in the
right-hand Artifact View. The model must not call a Viewer-specific tool merely
to make an existing file visible.

## Acceptance Scenarios

- AC-1: Studio correlates only the Session's already-confined Artifact catalog
  entries; it does not infer a browser-readable path from raw tool arguments.
- AC-2: A Session with an observed `.diff` or `.patch` file shows that file as a
  native row. Selecting it, pressing Enter, or double-clicking it opens the
  exact catalog revision in the adjacent right-hand Artifact View.
- AC-3: Opening a Session file performs no mutation and emits no model or MCP
  tool call. Diff and Patch files use the activated Provider or native fallback
  selected by the existing Artifact registry.
- AC-4: A missing, stale, unsafe, unsupported, or unobserved path is absent from
  the Session file list rather than being opened directly from the browser.
- AC-5: Wide, compact, and narrow Studio layouts remain bounded, keyboard
  reachable, and free of page or console errors.

## Non-goals

- Applying a Patch from Studio; the current public Provider contract has no
  reviewed mutation and approval transport.
- Reconstructing a historical file revision when only the current workspace
  file is retained.
- Turning terminal sessions into files or allowing a Viewer to create a PTY.
- Adding a new host adapter or weakening Provider activation, revision, or
  opaque-origin policies.

## Plan and Tasks

1. Reuse `/api/artifacts` and its Session observations as the only browser
   catalog for Session files.
2. Load the selected Session detail and its correlated Artifact descriptors,
   then render a docked file list and right-hand `ArtifactView` without adding a
   second format switch.
3. Keep single-click selection, Enter opening, and double-click acceleration on
   one command path.
4. Add focused contract/browser coverage for a Session-created `.diff` file and
   verify responsive behavior.

## Test and Review Evidence

- AC-1/AC-4: focused workspace Artifact observation and server route tests.
- AC-2/AC-3: browser test that opens an observed `.diff`, asserts the Diff
  surface, and asserts no Viewer tool request is made.
- AC-5: Playwright screenshots and horizontal-overflow checks at 1440x900,
  1024x768, and 390x844, plus console/page error collection.
- Review risk: the worktree already contains unrelated staged Compare UX
  changes. This implementation must not stage, rewrite, or claim them.

Implemented evidence: Harness Studio typecheck/build and 47 files/293 Vitest
tests passed; the focused workspace browser scenario passed with `review.diff`
opened through the Session file row into the right-hand Diff surface at all
three widths, with no horizontal overflow or captured console/page error.
