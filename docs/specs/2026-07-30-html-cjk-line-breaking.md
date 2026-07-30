# Keep Chinese phrases together in HTML reports

## Traceability

- Spec ID: 2026-07-30-html-cjk-line-breaking
- Status: Implemented
- Issue: None; focused follow-up to the reviewed HTML progressbar visual QA.

## Intent

Keep ordinary Chinese word-like phrases together when the self-contained HTML
report wraps headings and card copy. Segment visible `zh-CN` text with the
standards-based `Intl.Segmenter` API and emit bounded, nonvisual keep-together
spans so the result is deterministic across supported browsers. The generic
renderer must improve reviewed Chinese content without hardcoded phrases,
report-data mutation, runtime measurement, or a visual redesign.

## Acceptance Scenarios

- AC-1: A `zh-CN` HTML report uses `Intl.Segmenter` word segmentation for
  visible text and wraps each ordinary all-Han word-like segment of at most
  eight code points in `<span class="cjk-phrase">`. Representative phrases
  including `口径`, `入口`, `结论`, and `命令` receive that deterministic markup.
- AC-2: Phrase markup remains scoped to visible Chinese report text. English
  reports retain their current markup, wrapping behavior, and visible copy;
  attributes, accessibility labels, copied prompts, and embedded report JSON
  remain plain escaped text without phrase spans or invisible joiners.
- AC-3: Chinese headings, card titles, summaries, reasons, and ordinary
  paragraphs continue to wrap between marked segments. Each keep-together span
  is bounded to eight Han code points. Long tokens, paths, URLs, mixed Latin
  text, and unrecognized segments remain escaped readable text and cannot gain
  an unbounded no-wrap container.
- AC-4: The existing dimension progressbar role, label, range, rounded value,
  count validation, CSS, score computation, report data, and artifact set remain
  unchanged.
- AC-5: Focused HTML tests, the full package check, whitespace validation, and
  the allowed-file audit pass. Before review completion, an environment with a
  browser runtime inspects the same report at all three target widths.

## Compatibility Boundary

`Intl.Segmenter` is used only while generating the self-contained report. The
renderer accepts only `isWordLike` segments that consist entirely of Han code
points and are between two and eight code points long. All other segments use
the existing HTML escaping path. If `Intl.Segmenter` is absent or throws, the
entire value falls back to the same escaped readable text. CSS applies
`white-space: nowrap` only to the bounded phrase spans, leaving normal wrapping
available between spans and around Latin tokens, punctuation, paths, and URLs.

## Non-goals

- Hardcoding known report phrases or inserting word-joiner characters into
  report data, visible copy, accessibility text, or copied prompts.
- Preventing ordinary Chinese paragraphs from wrapping or forcing a complete
  sentence, heading, or card onto one line.
- Adding overflow, clipping, ellipsis, hidden content, fixed widths, custom
  fonts, browser-specific JavaScript, dependencies, or generated artifacts.
- Changing English layout, scores, findings, dimensions, report schemas,
  progressbar semantics, interactions, or artifact names.

## Plan and Tasks

1. Add a focused renderer regression for deterministic markup, escaping,
   bounded long-token handling, mixed Latin/path/URL preservation, English
   preservation, unavailable-segmenter fallback, and the four reviewed phrases.
   Record the missing-markup failure before renderer implementation. (AC-1..AC-4)
2. Add one visible-text renderer using `Intl.Segmenter` and a bounded
   `.cjk-phrase` keep-together rule. Route visible report copy through it while
   leaving attributes, copied prompts, and serialized data unchanged. Remove
   the insufficient browser-dependent `auto-phrase` contract. (AC-1..AC-4)
3. Update the public changelog and verify the exact reviewed Chinese report at
   375, 768, and 1280 pixels, including wrapping, overflow, clipping, console,
   and preserved progressbar semantics. (AC-3..AC-5)

## Test and Review Evidence

- The initial focused test failed for the intended reason: the reviewed Chinese
  phrases had no deterministic keep-together markup. It passed after the
  standards-based segment renderer and bounded phrase span were added.
- Browser QA then exposed descendant-selector leakage: nested phrase spans in
  the score orbit, metrics, and evidence grid inherited block, width, and label
  typography rules. A focused regression failed on the missing direct-child
  selector contract before those existing rules were scoped to their direct
  label and value children; nested phrase spans now remain inline.
- The combined CJK and preserved progressbar suite passed 2/2:
  `node --test --test-name-pattern='HTML CJK phrase|HTML dimension progressbar' test/harness-report-render-cli.test.mjs`.
- The target-owned HTML suite passed 6/6:
  `node --test --test-name-pattern='HTML' test/harness-report-render-cli.test.mjs`.
- The coordinating PM ran the complete test suite serially with an isolated
  temporary root: all 894 tests passed, followed by successful npm and runtime
  zip package verification. This resolved the parallel temporary-ancestor
  interference observed in two earlier Worker runs.
- The exact reviewed Chinese report retains its source scores, finding count,
  progressbar count, embedded report data, and artifact set. Post-fix browser
  review at 375, 768, and 1280 pixels remains the final visual gate.
