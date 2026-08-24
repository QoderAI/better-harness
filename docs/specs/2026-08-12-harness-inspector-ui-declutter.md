# Harness Inspector workbench declutter

## Traceability

- Spec ID: harness-inspector-ui-declutter
- Status: Draft

## Intent

The Date view of the Harness Inspector report renders one workbench card per
session, and a screenshot review against real workspace evidence showed most of
the rendered area is redundant: every card repeats the same "Activity on
<date>" title, empty lanes are stretched to a fixed 320px height, per-card lane
resizers behave independently, mid-width viewports clip the third lane, and the
prompt-lane counter prints three numbers that are almost always equal. This
spec removes that redundancy so a reader can scan a day of sessions without
scrolling through empty panels or clipped content, while keeping the existing
report model, privacy boundaries, and picker behavior unchanged.

## Acceptance Scenarios

- AC-1: A lane whose only content is an empty state (no retained prompts, no
  session link, zero normalized calls, or no linked commits) renders as a
  compact single-line hint instead of a 320px-tall dashed panel, and a card
  whose lanes are all empty stays visually short. A session with zero
  normalized calls does not render an "Expand 0 normalized actions" control.
- AC-2: In Date scope, a card with a linked session uses a session-derived
  title (first retained prompt text, falling back to the session locator)
  instead of repeating "Activity on <date>", and the card kicker no longer
  repeats "Date scope" on every card. The commits-only row keeps a descriptive
  title. Feature/story scope titles are unchanged.
- AC-3: The workspace scroll container allows horizontal scrolling at any
  viewport width, and the workbench grid minimum width matches the sum of its
  lane minimums, so no lane or card edge is clipped at desktop widths.
- AC-4: Dragging or keyboard-adjusting any lane resizer updates a shared lane
  width applied to all workbench cards in the list, and the shared width
  survives re-rendering the scope.
- AC-5: When retained, normalized, and observed prompt counts are equal the
  prompt lane shows a single "N user turns" count; the three-part breakdown
  only appears when the counts differ.
- AC-6: Feature Tree rows suppress the evidence badge for the default
  `declared` evidence; non-default evidence such as `candidate` keeps its
  visible badge so the picker-footer distinctness promise still holds.

## Non-goals

- No changes to `report-model.mjs`, `feature-tree.mjs`, `cli.mjs`, or the
  privacy/redaction pipeline.
- No changes to the Feature Tree picker semantics beyond hiding the default
  `declared` badge (AC-6); checkboxes, node counts, and non-default evidence
  badges are unchanged, as is the session detail view.
- No visual redesign beyond removing the redundancy listed above.

## Plan and Tasks

All changes live in `scripts/harness-inspector/ui/`:

1. `workbench.js`
   - `promptLane` / `activityLane` / `deliveryLane`: mark empty lanes with a
     `lane-empty` class; skip the `activity-details` disclosure when
     `totalCalls` is 0; skip the delivery Hide/Show toggle when no commit is
     linked (AC-1).
   - `workbench`: for date-scope items derive the title from the first
     retained prompt or the session locator, and replace the repeated
     "Date scope" kicker with a session/commits kicker (AC-2).
   - Resizer pointer and keyboard handlers: write `--prompt-width` /
     `--delivery-width` onto the persistent `#workbench-list` element instead
     of the per-card `.workbench` element (AC-4).
   - `promptLane` counts: collapse equal shown/normalized/observation counts
     into one "N user turns" label (AC-5).
2. `workbench.css`
   - Drop the fixed `.lane` `min-height:320px`; style `.lane-empty` and its
     `.empty-state` as a compact hint row (AC-1).
   - Reduce `.workbench-grid` `min-width` to the lane minimum sum (730px) and
     make `.workspace-scroll { overflow-x:auto }` unconditional (AC-3).
   - Clamp `.workbench-head h3` to two lines so prompt-derived titles cannot
     blow up the card header (AC-2).
3. `render-html.mjs` `featurePicker`: emit the tree-row evidence badge only
   when the node evidence differs from the default `declared` (AC-6).
4. `test/harness-inspector.test.mjs`: extend the existing HTML rendering
   assertions to cover the new markup (lane-empty markers, session-derived
   date titles, shared-width resize script, merged turn count, suppressed
   declared badge).

## Test and Review Evidence

- `node --test test/harness-inspector.test.mjs` — AC-1..AC-6 markup and script
  assertions plus existing AC-2/AC-3/AC-5/AC-6/AC-7 regressions.
- Manual: `node scripts/harness-inspector/cli.mjs render --out
  .qoder/inspector-preview.html`, serve locally, screenshot Date view at
  ~880px viewport and verify no clipped lane, no repeated "Activity on"
  titles, compact empty lanes, and synchronized resizers.
- Risk: the report HTML is self-contained and read-only; the change is
  contained to UI assets, so the main risk is breaking existing HTML
  assertions, covered by the test suite.
