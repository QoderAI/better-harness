# Let the Inspector chrome name each thing exactly once

## Traceability

- Spec ID: inspector-chrome-naming
- Status: Implemented
- Refines the workspace header and picker copy introduced by
  [harness-inspector](2026-08-12-harness-inspector.md) and continued by
  [harness-inspector-ui-declutter](2026-08-12-harness-inspector-ui-declutter.md).

## Intent

The Inspector chrome said the same things twice and named one thing wrongly. The
workspace name appeared in the sidebar subtitle and again as the first breadcrumb
segment, so the breadcrumb spent its first slot on a constant. The subtitle also
carried a `real local evidence` tagline, which reads as a claim about the report
rather than context a reader needs: every locally rendered report is local
evidence, and the report already labels the strength of each link. Finally the
picker tab said `Delivery Tree` while the panel below it, its DOM class, and every
node badge said capability.

This slice makes the sidebar the single owner of workspace identity, gives the
breadcrumb back to navigation, and settles on one word for the tree.

## Acceptance Scenarios

- AC-1: The sidebar identity block names the tool once and the workspace once,
  with no product eyebrow and no tagline, and the workbench breadcrumb starts at
  `Harness Inspector` followed by the selected scope.
- AC-2: A context label is opt-in. When a caller supplies one, it renders after
  the workspace name; the default local render has none. The published sample
  keeps its `English sample data · no live workspace access` label, which is what
  distinguishes it from a reader's own repository.
- AC-3: The capability picker tab reads `Capability` beside `Date`, matching the
  panel heading, the `capability-tree` container, and the per-node `capability`
  meta. The picker collapse control and the tree's accessible name use the same
  word.
- AC-4: Mode identifiers are untouched: the tab is still `mode-feature`, the mode
  value is still `feature`, and `?mode=feature` deep links still resolve.
- AC-5: The Session View breadcrumb keeps the workspace name, because that overlay
  covers the sidebar that would otherwise carry it.

## Non-goals

- Renaming the `feature` mode value, URL parameter, DOM ids, or CSS classes.
- Renaming the Feature Tree source artifact (`.better-harness/feature-tree.md`).
- Changing the report model, evidence vocabulary, or what the picker selects.
- Re-titling the historical specs that used the older `Delivery Tree` wording.

## Design Decisions

**One owner per fact.** Workspace identity belongs to the sidebar brand block;
the breadcrumb exists to show where the reader is. Repeating the workspace name
in both cost a breadcrumb slot and taught the reader nothing.

**No product eyebrow above the tool name.** The sidebar previously stacked
`Better Harness`, `Harness Inspector`, and the workspace name. Two of those three
lines named the same product, and in a repository whose own name is the product
name the panel read as the same words twice. The tool title stays; product
provenance stays in the document title and the site that publishes the report.

**A label, not a slogan.** `contextLabel` now defaults to none and the subtitle is
composed as one string, so the separator cannot render without a label. The
option survives for reports whose provenance is not the reader's workspace, which
is the demo's actual requirement.

**Capability over Delivery.** The tree is a capability and Story hierarchy, and
every neighbouring surface already said capability. `Delivery` remains where it
describes the workbench lane grouping, not the tree.

**Copy changes stop at copy.** Only visible text and accessible names changed. The
`feature` mode value stays, so saved deep links and existing tests that assert
mode behaviour keep working.

## Test and Review Evidence

- AC-1/AC-3: `workspace identity lives in the sidebar and the breadcrumb starts at
  the selected scope` extracts the brand block, breadcrumb, and tablist from the
  rendered HTML and asserts their visible segments.
- AC-2: `a context label is only appended for reports that are not the reader's
  workspace`, plus the existing
  `public Inspector demo declares sample and indexing boundaries (AC-4)` which
  still requires the sample label and the absence of the old tagline.
- AC-4/AC-5: existing Inspector and cross-provider suites pass unchanged,
  including mode selection and Session View rendering.
- Browser: a real local render served over HTTP shows
  `Harness Inspector / 2026-08-14`, a `better-harness` subtitle, and
  `Capability | Date` tabs; selecting a leaf updates the breadcrumb to the node
  title, with no console errors or warnings.
- Docs: the Inspector landing page and its Simplified Chinese messages use the
  new wording.

## Risks

- Recognition: readers used to `Delivery Tree` see `Capability`. The panel heading
  and node badges already used that word, so the tab now matches what it opens.
- Translations: the two Simplified Chinese strings were updated with the English
  source; no other locale references the old wording.
- Provenance: dropping the default tagline does not weaken the sample boundary,
  which is carried by the demo's own label, `data-report-context="sample"`, and
  the robots meta.
