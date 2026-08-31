# Clarify Inspector usage snapshot freshness

## Traceability

- Spec ID: inspector-usage-snapshot-freshness
- Status: Implemented

## Intent

Prevent reviewers from reading a self-contained Inspector report as a live
usage feed. The Session outline and detailed Usage report must describe the
latest retained context as an observed snapshot and state when that snapshot
was current.

## Acceptance Scenarios

- AC-1: Standalone Inspector and Harness Studio label context occupancy as the
  latest observed context rather than the current live context, and identify
  the surface as a static snapshot.
- AC-2: Snapshot freshness prefers the timestamp of the latest retained Usage
  progression point. When that timestamp is unavailable, the report-level
  `generatedAt` timestamp is used and labelled as generation time. When neither
  timestamp is valid, freshness remains explicitly unavailable.
- AC-3: The compact Session outline and detailed Usage report expose the same
  snapshot semantics in English and Simplified Chinese without changing token,
  cache-reuse, context-progression, compaction, or provider accounting values.
- AC-4: The changed Studio and standalone Usage surfaces remain keyboard
  reachable, avoid document and outline overflow at wide, compact, and narrow
  layouts, and produce no browser console or page errors.

## Non-goals

- Auto-refreshing an open Inspector report or mutating native Session state.
- Changing provider adapters, usage arithmetic, context-window inference, or
  compaction detection.
- Collapsing edited, retried, or zero-response user Turns.

## Plan and Tasks

1. Derive one bounded optional Session `usageSnapshot` in the report model:
   latest retained Usage timestamp, then report generation time, then
   unavailable. Older reports retain the same renderer-side fallback.
2. Pass report generation time into Studio Session Detail and render the same
   bounded freshness note in the outline and detailed Usage report.
3. Rename context labels and add English and Simplified Chinese copy without
   changing provider accounting or context evidence fields.
4. Add focused behavior assertions and run Inspector, Studio, and visual
   validation before review.

## Test and Review Evidence

- AC-1/AC-2: `npx vitest run test/reporting/harness-inspector.test.mjs`
  passed 39 tests; the deterministic demo tests also passed 2 tests.
- Full repository regression: `npm test` passed 1,598 tests with 2 skipped.
- AC-1/AC-2/AC-3: `npm run harness-studio:test` passed 512 tests;
  `npx playwright test test/browser/artifact-host.spec.mjs` passed all 27
  browser tests, including the Inspector Session and Usage flow.
- AC-4: `npm run inspector:visual-check -- --out <receipt-dir>` passed all 15
  standalone surfaces across wide, compact, and narrow layouts with zero
  document/outline overflow, clipped text, below-floor type, or browser errors.
- Documentation routing: `node scripts/doc-link-graph/cli.mjs
  skills/better-harness` followed by `npx vitest run
  test/skills-docs/doc-link-graph.test.mjs` passed 8 tests.
- Local evidence: a real Codex report generated on 2026-08-31 retained two
  Sessions and 94 calls. Its active Session projected 71,160 latest observed
  context tokens and `usageSnapshot.timestamp` of
  `2026-08-31T01:13:26.856Z`; the rendered Session outline displayed the same
  value and observed-through timestamp.
- Risk reviewed: the localized freshness string wraps in its own 12-pixel
  metadata row, and all three documented layouts passed the visual contract.
