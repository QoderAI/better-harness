# Preserve summary-facts Episode coverage in HTML

## Traceability

- Spec ID: 2026-07-30-html-summaryfacts-episode-coverage
- Status: Implemented
- Issue: None; focused renderer correctness repair found during final browser QA.

## Intent

Make the self-contained HTML Evidence section display the machine-owned Episode
coverage already embedded in a split findings plus summary-facts companion
render. The current renderer preserves those facts in report data but reads only
the legacy `atAGlance.coverage` projection for its visible cards, producing a
false zero when the canonical `evidenceBoundary.episodeCoverage` is present.

## Acceptance Scenarios

- AC-1: When `summary.evidenceBoundary.episodeCoverage` reports 14 total and 12
  edited Episodes, the visible HTML Evidence cards display 14 and 12.
- AC-2: Machine-owned `evidenceBoundary.episodeCoverage` takes precedence over
  stale or absent legacy `atAGlance.coverage` values.
- AC-3: A legacy report that has only `atAGlance.coverage` keeps its existing
  visible Episode counts.
- AC-4: No score, finding, schema, CSS, layout, CJK, interaction, or artifact
  ownership behavior changes.
- AC-5: Focused renderer tests, the full HTML suite, the complete serial package
  suite, package verification, whitespace checks, and final browser QA pass.

## Non-goals

- Changing evidence collection, Session population binding, Episode admission,
  report scores, findings, or summary-facts schemas.
- Adding fallback inference from usage counts or visible prose.
- Editing generated reports or installed plugin caches.
- Redesigning the Evidence section or adding new UI.

## Plan and Tasks

1. Add a focused renderer regression for canonical summary-facts precedence and
   legacy compatibility, and preserve its red result. (AC-1, AC-2, AC-3)
2. Read Episode coverage from the canonical machine-facts owner with the legacy
   projection as a compatibility fallback. (AC-1, AC-2, AC-3, AC-4)
3. Run the assigned verification and record the evidence before marking this
   spec Implemented. (AC-5)

## Test and Review Evidence

- The focused red run failed because the canonical 14/12 summary-facts values
  rendered as the conflicting legacy 1/1 values. The unchanged focused command
  passed after implementation:
  `node --test --test-name-pattern='HTML evidence episode coverage' test/harness-report-render-cli.test.mjs`.
- The complete HTML-focused renderer suite passed 7/7:
  `node --test --test-name-pattern='HTML' test/harness-report-render-cli.test.mjs`.
- The isolated serial package suite passed 895/895:
  `TMPDIR=/var/tmp/better-harness-t025.dES6tD npm test -- --test-concurrency=1`.
- Package verification passed with 324 npm entries and 348 runtime-zip entries:
  `TMPDIR=/var/tmp/better-harness-t025.dES6tD npm run pack:verify`.
- Final report rendering, three-width browser QA, scope, whitespace, and review
  evidence are recorded in the contribution receipt before commit.
