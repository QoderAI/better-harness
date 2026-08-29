# Linked Usage Explorer

## Traceability

- Spec ID: `harness-inspector-linked-usage-explorer`
- Status: Implemented

## Intent

Turn Context progression from a tall overview followed by loosely related,
multi-line response rows into a compact investigation workspace. Reviewers
should be able to move from the full Session pattern to a bounded response
window, select one response from either the chart or table, and read the same
selection in a local detail pane without losing the Session evidence boundary.

## Acceptance Scenarios

- AC-1: The report shows the complete retained context progression as a compact
  overview and a bounded focus window. The Overview brush exposes independently
  draggable left and right handles so reviewers can widen or narrow either edge
  while preserving a minimum useful range. Moving either edge updates the focus
  chart and response rows together while preserving response order and honest
  missing evidence.
- AC-2: Selecting a response from a focus-chart marker or response row updates
  one local Response details pane, the chart crosshair, and the selected row.
  The detail pane includes the already-retained, privacy-filtered User prompt
  linked by Turn, including continued responses whose progression point does
  not repeat the prompt. The selection does not create a global evidence state.
- AC-3: The focus chart uses a stepped line for discrete response snapshots and
  keeps context shrink/reset and model-boundary events on aligned, labelled
  rails. The Overview is the sole User Turn event rug: retained User Turns are
  aligned to their first linked response, while only the selected Turn retains
  a compact `Tn` label. Hover or keyboard focus exposes the retained prompt
  preview, and click or Enter recenters the focus window and selects that
  response. The Focus chart does not repeat the same prompt markers. Reset and
  model-boundary symbols remain visually distinct, and only decision-relevant
  controls enter the tab order.
- AC-4: Response rows are single-line dense data rows in a bounded local scroll
  surface, matching the Tool-call list pattern instead of extending the report
  page. Time, reuse, boundary, and right-aligned numeric columns remain
  scannable; the redundant Turn column is omitted because the selected linked
  prompt is shown in Response details. A Processed column is omitted when the
  visible window contains no observed values. Linked selection scrolls the
  active row into the local viewport without moving the surrounding report.
- AC-5: Window and selection controls are keyboard reachable. Arrow keys move
  the active response, Enter selects it, and Escape clears the local selection.
  Focus remains visible and selection is conveyed with text/ARIA state as well
  as color.
- AC-6: Standalone Harness Inspector and Studio Session Detail use the same
  terminology, default window, selection behavior, and responsive hierarchy.
  Wide layouts may dock Response details; compact and narrow layouts place it
  below the primary chart without document-level horizontal overflow.
- AC-7: The linked explorer passes behavior tests and visual review at
  1440x900, 1024x768, and 390x844 with no clipped meaningful text, sub-12px
  meaningful text, browser console error, or page error.

## Non-goals

- Adding billing, cost, savings, or provider-efficiency claims.
- Reconstructing missing responses, timestamps, Turns, prompts, or context
  windows. A User prompt appears only when retained Session evidence links it.
- Permanently drawing full prompt text inside the chart or making hover the only
  way to discover prompt evidence.
- Adding a permanent global Evidence drawer or Session-resumption behavior.
- Adding the optional cross-compaction-cycle comparison mode in this change.
- Persisting window or response selection beyond the current Session view.

## Plan and Tasks

1. Introduce a bounded usage-window model and one local selected-response state
   in both Inspector renderers.
2. Render a compact full overview, stepped focus chart, aligned event rails,
   response details, and dense response table from the same projected points.
3. Bind double-ended Overview brush, range, pointer, and keyboard actions to the
   shared local state; replace passive Overview Turn lines with one interactive
   prompt event rug, retain a compact `Tn` only for the selected Turn, and keep
   the Focus chart free of duplicate prompt markers.
4. Add behavior coverage for window clamping, linked selection, keyboard
   movement, and conditional Processed-column visibility.
5. Run focused report/Studio tests, generate a real Inspector report, and run
   the responsive visual contract with screenshots and error inspection.

## Test and Review Evidence

- AC-1–AC-5: `npx vitest run
  test/reporting/harness-inspector-usage-explorer.test.mjs
  test/reporting/harness-inspector.test.mjs` passed 39 tests. The focused
  standalone test covers both independently draggable Overview handles, the
  minimum window, linked selection, keyboard movement, conditional Processed
  visibility, 15 interactive Overview prompt markers, one selected compact `Tn`
  label, prompt preview text, separate prompt/brush-handle hit zones, and
  keyboard recentering from the last marker to its linked response. It also
  verifies that the Focus chart contains no duplicate prompt markers.
- AC-6: Studio `npm run typecheck` and `npm run build` passed. The focused Studio
  Playwright comparison passed 1 test and covers the Overview `T1` label,
  retained prompt preview, composite keyboard interaction, absence of duplicate
  Focus markers, and linked Response details selection.
  The regenerated report for Session
  `01a04647-16fa-7123-87d6-b216f77cdf1e` retained 899 responses and 17 observed
  prompt boundaries across 18 User Turns; prompt text is shown only for the 8
  Turns whose privacy-filtered prompt evidence was retained.
- AC-7: `node scripts/harness-inspector/visual-contract-check.mjs --report
  .qoder/better-harness-runs/harness-inspector/inspector.html` passed all 15
  real-report surfaces at 1440x900, 1024x768, and 390x844 with zero document
  overflow, clipped nodes, sub-12px meaningful text, console errors, or page
  errors. The gate also asserts the sole Overview prompt rug, retained prompt
  previews, composite keyboard interaction, absence of duplicate markers, and
  keyboard-linked detail selection.
- Regression: `npx vitest run test/reporting/harness-inspector.test.mjs` passed
  its 38 tests, and `npx vitest run
  test/skills-docs/doc-link-graph.test.mjs` passed 8 tests. `npm run preview`
  served both `/health` and `/canvas-module.js` successfully.
- Risk: hundreds of progression points can make the DOM heavy. The overview may
  draw the retained series, but response rows and focus markers stay bounded to
  the active window.
