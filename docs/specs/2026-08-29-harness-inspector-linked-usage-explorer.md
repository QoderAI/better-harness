# Linked Usage Explorer

## Traceability

- Spec ID: `harness-inspector-linked-usage-explorer`
- Status: Implemented

## Intent

Turn Context progression into a compact, chart-led investigation workspace.
Reviewers should be able to move from the full Session pattern to a bounded
response window, inspect any response without covering the stepped series, and
lock one response into a local detail pane without spending viewport height on
a second tabular rendering of the same points.

## Acceptance Scenarios

- AC-1: The report shows the complete retained context progression as a compact
  overview and a bounded focus window. The Overview brush exposes independently
  draggable left and right handles so reviewers can widen or narrow either edge
  while preserving a minimum useful range. Moving either edge updates the focus
  chart and docked Inspect values together while preserving response order and
  honest missing evidence.
- AC-2: Selecting a response from the focus chart updates one local Response
  details pane and the chart crosshair.
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
- AC-4: The focus chart exposes one hover target per visible response. Hover
  draws a point and guide, then updates one compact docked Inspect strip below
  the chart with response index, timestamp, context, net context delta, input
  reuse, output, and processed tokens when observed. The strip never covers the
  stepped series, returns to the locked response when hover leaves, and does not
  update the locked Response details pane until click or keyboard selection.
  The redundant response table is not rendered.
- AC-5: Window and selection controls are keyboard reachable. Arrow keys move
  and select the active response, while Escape clears the local selection.
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
   per-response hover targets, a docked Inspect strip, and response details from
   the same projected points.
3. Bind double-ended Overview brush, range, pointer, and keyboard actions to the
   shared local state; replace passive Overview Turn lines with one interactive
   prompt event rug, retain a compact `Tn` only for the selected Turn, and keep
   the Focus chart free of duplicate prompt markers.
4. Add behavior coverage for window clamping, hover-only strip updates, linked
   selection, keyboard movement, conditional processed values, and the absence
   of the redundant table.
5. Run focused report/Studio tests, generate a real Inspector report, and run
   the responsive visual contract with screenshots and error inspection.

## Test and Review Evidence

- AC-1–AC-5: The focused Studio Playwright scenario passed 1 test and covers
  one hover target per response, hover-only Inspect updates, locked Response
  details, click and keyboard selection, Escape clearing, and absence of the
  redundant response table. The standalone visual contract repeats hover,
  restore, click-lock, prompt, and keyboard checks against a regenerated real
  report.
- AC-6: Studio `npm run typecheck` and `npm run build` passed. The regenerated
  standalone report and Studio Session Detail use the same docked Inspect
  fields, selection contract, and chart-led hierarchy. `npm run preview` found
  the existing preview healthy: `/health` returned `ok` and
  `/canvas-module.js` returned JavaScript with HTTP 200.
- AC-7: `node scripts/harness-inspector/visual-contract-check.mjs --report
  .qoder/better-harness-runs/harness-inspector/inspector.html` passed all 21
  real-report surfaces at 1440x900, 1024x768, and 390x844 with zero document
  overflow, clipped nodes, sub-12px meaningful text, console errors, or page
  errors. Manual in-app browser inspection also confirmed the strip remains a
  single row at wide and compact widths, becomes two columns at narrow width,
  and reports zero console errors.
- Regression: `npx vitest run test/reporting/harness-inspector.test.mjs
  test/reporting/harness-inspector-demo.test.mjs` passed 41 tests, and `npx
  vitest run test/skills-docs/doc-link-graph.test.mjs` passed 8 tests.
- Risk: hundreds of progression points can make the DOM heavy. The overview may
  draw the retained series, but per-response hover targets stay bounded to the
  active focus window.
