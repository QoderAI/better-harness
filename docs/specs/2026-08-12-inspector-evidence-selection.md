# Explain relationships in the Inspector

## Traceability

- Spec ID: inspector-evidence-selection
- Status: Implemented

## Intent

Turn the Harness Inspector from three adjacent information lanes into one
read-only evidence workspace. A reviewer should be able to select a Story,
Session, Turn, Tool Call, File, or Commit and immediately see which visible
objects are directly related, why the relationship exists, how strong the
evidence is, and what the evidence does not prove.

The first slice keeps the existing Delivery Tree, Date view, three-lane
workbench, and chronological Session View. It adds interaction and explanation
on top of those structures instead of introducing another graph or report.

## Acceptance Scenarios

- AC-1: Story, Session, Turn, Tool Call, File, and Commit objects share one
  Inspector selection state. Selecting an object gives it a persistent selected
  treatment and updates every visible lane from the same state.
- AC-2: Directly related visible objects receive a related treatment, contextual
  objects remain visible with reduced emphasis, and unrelated objects are
  de-emphasized rather than removed. File selection relates calls that name the
  path and commits that change it; Tool Call selection relates its Turn, files,
  Session, and commits reached through exact shared paths.
- AC-3: A read-only Evidence Drawer shows the selected object, an explainable
  relationship path, evidence kind and strength, source facts, related objects,
  and explicit limitations. Candidate or contextual relationships must not use
  the same wording or strength as declared or directly observed relationships.
- AC-4: The active mode, scope, and object selection are encoded in the report
  URL and restored on reload. Copying the evidence link produces a reviewable
  deep link without exposing raw prompts, commands, absolute home paths, or tool
  payloads.
- AC-5: Opening Session View from a selection scrolls to the matching Turn,
  Tool Call, or Commit when retained. A Session with no retained dialogue still
  renders its observed Tool Calls, attributed files, and correlated commits in
  an `Unplaced evidence` section instead of showing an empty timeline.
- AC-6: Picker modes expose tab semantics, selectable objects are keyboard
  operable, the Drawer announces updates without trapping focus, and closing
  Session View restores focus to the control that opened it. The report remains
  self-contained and read-only.
- AC-7: When the Feature Tree has no Story with retained Session or Commit
  evidence, the report opens in the latest Date scope instead of presenting an
  empty Story workbench. A Tree with inspectable evidence keeps Feature mode as
  its default.

## Non-goals

- Accepting, rejecting, or editing candidate mappings.
- Writing Feature Tree, Git, checkpoint, or native-session state.
- Recovery, replay, resume, rollback, or worktree mutation.
- AI-authored relationship summaries as the primary evidence.
- A node-link graph canvas, compare view, search, or virtualization.
- Claiming that temporal proximity or a shared path proves commit authorship.

## Comparison Extension Boundary

The shared Inspector selection is a single focus state, not a comparison
bucket. A future Compare capability should own a separate `CompareSet` and a
top-level `Inspect | Compare` workspace mode. Compare replaces the central
workbench with a full-width semantic comparison; it must not render another
three-lane workbench inside the Evidence Drawer or add a fourth permanent lane.

Candidate sessions, commits, or files may later be pinned into that separate
set without changing the meaning of focus selection, cross-highlighting, or the
current evidence deep link. This slice intentionally adds no inactive Compare
button or dead-end selection tray.

## Plan and Tasks

1. Extend `scripts/harness-inspector/report-model.mjs` with bounded evidence
   facts on Story/Session and Session/Commit edges, retaining the current
   privacy-safe projections and existing evidence categories.
2. Add the Drawer shell to `scripts/harness-inspector/ui/workbench.html` and
   selection, related-object, responsive Drawer, and accessibility styles to
   `scripts/harness-inspector/ui/workbench.css`.
3. Refactor `scripts/harness-inspector/ui/workbench.js` so rendered objects have
   stable selection descriptors, one selection owner, URL serialization and
   restoration, cross-highlighting, relationship-path construction, and Drawer
   actions.
4. Preserve evidence for sessions without dialogue by rendering an `Unplaced
   evidence` timeline section and making retained session events addressable by
   the workbench selection.
5. Add focused model and final-HTML regression coverage, then validate a real
   multi-provider report in the browser at desktop and narrow viewports.

Decision rationale: relationship paths are derived deterministically from the
bounded report projection. The UI does not infer new authorship or product
ownership; it explains only declared, directly observed, candidate, contextual,
and unmapped relationships already represented by the report. Focus selection
remains independent from any future comparison set so the Drawer can stay a
single-object explanation surface while Compare can use the full workspace.

## Test and Review Evidence

- AC-1..AC-7: `node --test test/harness-inspector.test.mjs`
- AC-1/AC-3/AC-4: final-HTML assertions for selectable object descriptors,
  one selection owner, Drawer regions, evidence limitations, and URL state.
- AC-3: model assertions that explicit, observed same-path, candidate, and
  contextual links retain distinct facts and limitations.
- AC-5: final-HTML assertions retain the `Unplaced evidence` construction and
  jump targets; a real zero-dialogue Qoder Session was opened in the browser
  with its Tool Calls, files, and commits still addressable.
- AC-6: final-HTML assertions for tab roles, keyboard-operable controls, live
  Drawer status, and focus restoration code.
- Regression: `npm test`, `npm run pack:verify`, and `git diff --check`.
- Visual review: render a real local report, inspect selection from Tool Call,
  File, and Commit at a desktop viewport, inspect the Drawer as a bottom sheet
  at a narrow viewport, and check browser console/page errors.
- Result: the focused Inspector suite passed 14/14, the repository suite passed
  1362/1362, package verification passed for 502 npm entries and 524 runtime
  zip entries, and browser diagnostics reported no page or console errors.
- Privacy risk: Drawer text and URL state contain only stable ids and bounded
  sanitized facts already present in `HarnessInspectorReportV1`.
- Correlation risk: every path carries its evidence kind, strength, facts, and
  limitations; shared paths and time proximity never become authorship claims.
- Scale risk: selection changes CSS emphasis and one bounded Drawer payload; it
  does not duplicate the entire report or remove the existing lane scrolling.
