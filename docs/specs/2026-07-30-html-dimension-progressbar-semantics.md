# Give HTML dimension tracks progressbar semantics

## Traceability

- Spec ID: 2026-07-30-html-dimension-progressbar-semantics
- Status: Implemented
- Issue: None; focused accessibility-contract maintenance from a reviewed Better Harness finding.

## Intent

Make every fluency-dimension score track in the self-contained HTML report
expose the score that sighted readers already see to assistive technology. The
HTML validator must keep that semantic projection bound to the reviewed
dimension count and rounded score so incomplete or stale markup cannot pass
report validation.

## Acceptance Scenarios

- AC-1: Every rendered fluency-dimension card contains exactly one track with
  `role="progressbar"`, a non-empty accessible label derived from the displayed
  dimension label, `aria-valuemin="0"`, `aria-valuemax="100"`, and an
  `aria-valuenow` equal to the integer score displayed beside that track.
- AC-2: The HTML report validator passes the canonical rendered dimension
  tracks and rejects a missing or extra dimension progressbar, a progressbar
  with a missing or invalid role, label, minimum, maximum, or current value,
  and a current value that differs from the reviewed rounded score.
- AC-3: The renderer preserves existing CSS, layout, visible copy, dimension
  ordering, score clamping and rounding, visual fill width, artifact names,
  and generated report ownership.
- AC-4: The focused regression, full renderer CLI suite, documentation graph,
  doc-link suite, full package check, whitespace check, and allowed-file audit
  pass from the assigned repository state.

## Non-goals

- Redesigning the dimension cards, tracks, responsive layout, color, or CSS.
- Changing visible labels, summaries, localization, score computation,
  clamping, rounding, or report data schemas.
- Editing generated reports, templates, installed plugin caches, dependencies,
  custom SVG, or any report mode other than the canonical HTML renderer.
- Adding browser interaction, live-region announcements, or a new artifact.

## Plan and Tasks

1. Add one focused regression test that asserts the rendered per-dimension
   progressbar contract and mutation-based validator rejection for missing,
   invalid, count-mismatched, and score-mismatched semantics. Record the test
   failing against the current renderer before implementation. (AC-1, AC-2)
2. Reuse the renderer's existing display label and rounded score when emitting
   the complete progressbar attributes, without changing track CSS or fill
   width. (AC-1, AC-3)
3. Extend `evaluateHtmlReport` to bind exactly one valid progressbar to each
   reviewed dimension card and reject semantic count or score drift. (AC-2)
4. Update the public changelog, regenerate the Markdown routing graph required
   for the new spec, run every assigned verification command, and mark this
   spec Implemented only after the evidence passes. (AC-4)

## Test and Review Evidence

- The required red run failed for the intended contract reason: the current
  renderer produced zero semantic progressbars for five reviewed dimensions
  (`0 !== 5`). The same focused command passed after implementation:
  `node --test --test-name-pattern='dimension progressbar' test/harness-report-render-cli.test.mjs`.
- The full renderer suite passed 15/15:
  `node --test test/harness-report-render-cli.test.mjs`.
- Documentation graph generation and all six doc-link checks passed:
  `node scripts/doc-link-graph/cli.mjs skills/better-harness && node --test test/doc-link-graph.test.mjs`.
- The complete package gate passed from a clean temporary root under
  `/var/tmp` with 893 tests and successful npm/runtime-zip package verification:
  `TMPDIR=/var/tmp/better-harness-t016.lxCc80 npm run check`.
- Scope and whitespace:
  `git diff --check -- <allowed files>` plus an allowed-file-only status audit.
- Risk review: the focused test removes and duplicates a progressbar, mutates
  each semantic attribute class, and changes `aria-valuenow`; all mutations
  fail validation while canonical output passes. The CSS and existing visual
  fill-width expression are unchanged.
