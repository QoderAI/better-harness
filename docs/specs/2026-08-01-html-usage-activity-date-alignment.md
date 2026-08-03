# Align HTML usage activity dates with their cells

## Traceability

- Spec ID: 2026-08-01-html-usage-activity-date-alignment
- Status: Implemented
- Issue: None; focused report-layout maintenance from visual review of the
  generated AI coding workflow evidence report.

## Intent

Make the self-contained HTML report project-usage activity chart preserve the
one-to-one relationship between each UTC date and its activity cell. Dates must
read from left to right, use the same grid columns as the cells they describe,
and keep any overflow inside the chart instead of expanding the page.

## Acceptance Scenarios

- HUA-AC-1: The HTML renderer emits exactly one activity cell per retained UTC
  date in source order, with strictly increasing horizontal grid columns and
  the existing heat level, tooltip, and accessible label derived from that
  date's value.
- HUA-AC-2: The activity axis shares the chart's `--heat-days`, column width,
  and gap. Ranges of four days or fewer label every date in its matching
  column. Longer ranges label the first and last dates plus every seventh date,
  excluding periodic ticks within the last three days to avoid a duplicate
  end cluster.
- HUA-AC-3: At 1180 px, 800 px, and 320 px viewport widths, the activity panel
  remains vertically centered, the page has no horizontal overflow, and long
  date ranges scroll only inside the chart container.
- HUA-AC-4: Empty activity data, English and Chinese output, tooltip and
  `aria-label` content, self-contained HTML behavior, artifact names, and the
  `summary.usageActivity` schema, UTC ordering, values, scoring, findings,
  Markdown, and Canvas behavior remain unchanged.
- HUA-AC-5: The existing findings in
  `.codex/better-harness/2026-08-01-ai-coding-workflow-evidence` re-render to
  the same canonical artifact set, and renderer plus HTML validation pass.
- HUA-AC-6: Focused renderer tests, the documentation graph and link checks,
  the full package test suite, package verification, preview health and Canvas
  runtime smoke checks, browser console/page-error inspection, and whitespace
  validation are executed and recorded. Feature-related checks pass; unavailable
  external runtime or platform privileges remain explicit exceptions.

## Non-goals

- Changing activity collection, date normalization, truncation, aggregation,
  heat calculation, scoring, finding eligibility, or report conclusions.
- Adding report fields, JavaScript, external resources, or generated artifacts.
- Changing the Markdown or Canvas renderer, the activity schema, or the
  generated report's evidence source.
- Hand-editing the generated `report.html` or changing unrelated root CLI,
  test, spec, documentation-graph, or diagnostic-output worktree changes.

## Plan and Tasks

1. Add renderer-level fixtures for four-day, thirty-day, empty, and localized
   activity output, with explicit date-to-column assertions. (HUA-AC-1,
   HUA-AC-2, HUA-AC-4)
2. Replace the seven-row column flow with one shared horizontal cell-and-axis
   grid, deterministic tick selection, and chart-local overflow. (HUA-AC-1,
   HUA-AC-2, HUA-AC-3)
3. Document the portable HTML activity-axis contract without changing report
   data ownership or runtime boundaries. (HUA-AC-2, HUA-AC-4)
4. Re-render the current report from its existing `findings.json`, then run
   automated, visual, preview, packaging, and traceability checks before
   changing this spec to Implemented. (HUA-AC-3, HUA-AC-5, HUA-AC-6)

## Test and Review Evidence

- The focused activity-chart regressions passed 3/3:
  `node --test --test-name-pattern="HTML activity chart" test/harness-report-render-cli.test.mjs`.
  They cover four-day column binding, thirty-day tick selection, empty data,
  Chinese output, tooltip/`aria-label` parity, and self-contained HTML.
- Re-rendering the current report from its existing `findings.json` passed all
  four canonical checks (`output-location`, `run-directory-artifacts`,
  `findings-json`, and `html-report`). The pre-existing fix-result sidecar was
  moved outside the run directory only for validation and restored unchanged.
  SHA-256 checks confirmed `findings.json`, `report.md`, and the sidecar were
  unchanged; only `report.html` changed.
- Playwright geometry checks at 1180 px, 800 px, and 320 px found four strictly
  increasing cells, matching source-date/grid-column pairs, zero pixel
  cell-to-label center deltas, and zero page-level horizontal overflow. A
  thirty-day browser sequence at 320 px produced 256 px of chart-local
  overflow with `overflow-x:auto`; the page still had zero horizontal overflow.
  The final browser console check reported zero errors and zero warnings.
- Documentation routing regenerated to 35 files and 51 links, and the doc-link
  suite passed 6/6:
  `node scripts/doc-link-graph/cli.mjs skills/better-harness` and
  `node --test test/doc-link-graph.test.mjs`.
- Package verification passed with 369 npm entries and 392 runtime-zip entries:
  `npm run pack:verify`.
- The full suite completed with 1044 passes, 6 platform skips, and 4 failures:
  `npm test`. Every failure was an existing Windows fixture that could not
  create a symbolic link because the current process lacks symlink authority
  (`EPERM`); no HTML or activity-chart assertion failed. The direct renderer
  suite likewise passed 29/30 with only its symlink fixture blocked.
- `npm run preview` was executed but intentionally failed fast because this
  machine has no Canvas SDK runtime and neither `CANVAS_SDK_MEDIA_DIR` nor
  `CANVAS_SDK_ROOT` is configured. Consequently `/health` and
  `/canvas-module.js` could not be smoke-tested in this environment; no fake
  runtime was substituted for that missing external prerequisite.
