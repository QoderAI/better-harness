# Show complete months in the Inspector calendar

## Traceability

- Spec ID: inspector-month-calendar
- Status: Implemented

## Intent

Make the Inspector's Date picker behave like the month calendar its heading
already describes. Reviewers should see one complete UTC month at a time,
starting with the month that contains the latest observed date, without losing
access to evidence from another month in the bounded report window.

## Acceptance Scenarios

- AC-1: When timestamped evidence exists, Date mode initially renders the full
  UTC month containing the latest observed date and pads the grid to complete
  Monday-through-Sunday weeks. Dates without evidence and dates outside the
  displayed month are visible, non-interactive placeholders.
- AC-2: When the report window contains evidence in more than one UTC month,
  previous and next controls navigate only among those months. Controls at the
  first and last available month are disabled, and changing month does not
  change the selected evidence scope until the reviewer selects an active date.
- AC-3: The self-contained Inspector report and the React Studio Inspector use
  the same latest-month default, month labels, UTC boundaries, selectable-date
  behavior, and bounded month navigation.
- AC-4: The complete month remains readable without page-level horizontal
  overflow at wide, compact, and narrow layouts. Keyboard focus and accessible
  names identify the month navigation and active dates.

## Non-goals

- Expanding the report's time, session, or commit evidence window.
- Selecting dates that have no retained session or commit evidence.
- Adding an unbounded year picker, arbitrary month jump, locale preference, or
  non-UTC calendar mode.
- Changing Feature mode, evidence correlation, or date-scope semantics.

## Plan and Tasks

1. Derive the ordered set of UTC evidence months and render each as a complete
   month grid padded to Monday-through-Sunday weeks.
2. Add bounded previous/next month controls to the self-contained report and
   wire their state in the existing reader script.
3. Mirror the month state and navigation in the React Studio Date picker.
4. Add behavior-level tests for a one-week evidence sample, cross-month
   evidence, complete month cells, and navigation boundaries.
5. Run focused Inspector tests, Studio build/tests, repository checks, visual
   contract checks, and narrow-layout browser review.

## Test and Review Evidence

- AC-1/AC-2: `npx vitest run test/reporting/harness-inspector.test.mjs`
- AC-3: `npm --workspace @qoder-ai/harness-studio test`
- AC-4: `node scripts/harness-inspector/visual-contract-check.mjs`
- Regression: `npm run check` and `git diff --check`
- Visual review: inspect the Date picker at wide, compact, and narrow
  viewports; verify focus, disabled navigation states, overflow, and browser
  console/page errors.
- Risk: UTC month arithmetic can produce off-by-one cells at month and year
  boundaries. Tests must cover a month beginning on Sunday and evidence that
  spans December into January.

Implementation evidence on 2026-08-29:

- AC-1/AC-2: focused Inspector tests passed 38/38, including a six-week August
  grid and December-to-January month boundaries.
- AC-3: Studio type checking and build passed; its Inspector browser flow
  reached and passed the complete-month and disabled-boundary assertions. The
  wider scenario later timed out in an unrelated Usage Explorer chart click.
- AC-4: the visual contract check passed all 15 surfaces across 1440x900,
  1024x768, and 390x844 with zero document overflow, clipped text, sub-12px
  meaningful text, console errors, or page errors. The narrow Date screenshot
  shows the full six-week month grid without scrolling.
- Regression: `npm run check` passed at the completed calendar snapshot: root
  1597 passed with 2 skipped, Harness 173 passed, Harness UI 31 passed, Studio
  494 passed, and package verification retained 613 npm entries and 883 runtime
  zip entries.
