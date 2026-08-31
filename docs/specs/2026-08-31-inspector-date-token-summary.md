# Inspector Date Token Summary

## Traceability

- Spec ID: `inspector-date-token-summary`
- Status: Implemented

## Intent

Move the retained Context-token evidence needed for daily triage onto the Date
workbench. Reviewers should see each Session's latest Context and historical
compaction snapshots without opening the Usage report, plus one honest summary
for the selected UTC day.

## Acceptance scenarios

- AC-1: Every Date-mode Session row and matching workbench header show the
  latest observed Context token value when it exists. Explicit compaction
  snapshots are summarized with their observed token amount and count.
- AC-2: The selected-date panel shows an aggregate of observed Context
  snapshots across that day's Sessions, the number of Sessions contributing
  token evidence, and the provider-observed compaction count.
- AC-3: Daily and per-Session summaries distinguish current Context from
  compaction snapshots. They never label snapshot sums as provider usage,
  billing, Session processed tokens, or cost.
- AC-4: Missing current or compaction-token evidence stays unavailable rather
  than becoming zero. A provider compaction count may remain visible even when
  its boundary token snapshot was not retained.
- AC-5: Standalone Inspector and native Studio render the same information
  hierarchy. Long values remain bounded at wide, compact, and narrow layouts,
  with keyboard focus and the existing Date navigation preserved.

## Non-goals

- Deriving billing, cache savings, or provider total usage from Context
  snapshots.
- Adding token numbers inside every calendar day cell.
- Replacing the detailed Usage report or its per-boundary timestamps.

## Plan

1. Add one shared presentation rule for current Context, compaction snapshots,
   and selected-day aggregation.
2. Render the compact Session token summary in Date navigation rows and
   workbench headers in standalone Inspector and Studio.
3. Extend the selected-date summary with observed snapshot totals, coverage,
   and compaction count.
4. Add behavioral and browser assertions, then verify responsive layouts and
   the real retained Session data.

## Test and review evidence

- Replayed the 2026-08-31 Date scope with 18 Sessions: the selected-day summary
  rendered `4M snapshot-token sum`, `12/18 Sessions observed`, and
  `9 compactions`. Session rows and matching workbench headers exposed the same
  current/compaction token evidence.
- Standalone browser checks at 2048x1100, 1024x768, and 390x844 reported zero
  document overflow and zero console/page errors. The daily summary remained
  inside the Date picker at narrow width; 12 matching row/header summaries were
  visible at every layout.
- Native Studio build and typecheck passed. Its focused browser scenario passed
  the new daily, Session-row, and workbench-header token assertions before an
  unrelated existing combined-process assertion expected `Read · Edit · Bash`
  while the current dirty-worktree fixture rendered only `Read`.
- Focused source/report suites passed 89 tests. Final `npm run check` passed
  1,604 root tests with 2 skipped, Harness/Harness UI/Studio at 173/31/512
  tests, and package verification at 627 npm and 897 runtime entries.
