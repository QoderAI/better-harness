# Traceable long-session tool calls

## Traceability

- Spec ID: long-session-tool-call-traces
- Status: Implemented
- Source evidence: Hyperdrive commits `5696044564b28461f36f69e7b7488d62489ee1a7`, `71e4fbb0e0175052406fc2d477b696ee1b001ca2`, `cba186974aae61927ce4b0a853c6f14801a2d3af`, and `5e616f656ad5c7979b5ed31cc9789997c55242f8` from 2026-08-10

## Intent

Make bounded long-session review samples traceable without exposing raw tool
inputs or outputs. Reviewers should be able to expand a session sample, inspect
the ordered tool-call lanes, distinguish observed latency from missing timing,
and retain enough privacy-safe session metadata to locate the supporting
evidence.

## Acceptance Scenarios

- AC-1: Session-efficiency candidates include a deterministic, bounded tool-call
  trace with stable step ids, privacy-safe tool labels, observed/failed status,
  at most eight tool lanes, and explicit truncation metadata.
- AC-2: Matched transcript request/result and lifecycle pre/post pairs expose a
  bounded observed duration and timing source; unmatched, invalid, negative, or
  over-24-hour durations remain explicitly unobserved rather than inferred.
- AC-3: The report projection retains only allowlisted trace and session-locator
  fields, validates both the previous v1 trace and the new v2 timing contract,
  and rejects raw or malformed timing data.
- AC-4: The Better Harness Canvas renders each long-session trace in a
  collapsible section, groups calls into bounded lanes, visualizes only observed
  latency through a repository-owned SVG component that works without the newer
  Canvas SDK chart export, explains incomplete timing coverage, and wraps long
  metadata without overflowing its cards.
- AC-5: Focused session-analysis, report-source, report-contract, and Canvas
  validation tests pass without changing the existing review-trigger work in
  the local worktree.

## Non-goals

- Persisting raw tool arguments, results, prompts, transcript bodies, or
  unredacted session identifiers in the report.
- Estimating duration when the source does not provide a trustworthy matching
  lifecycle pair.
- Changing long-session thresholds, candidate ranking, report scoring, package
  versions, changelogs, or host support declarations.
- Copying Hyperdrive's legacy Qoder-only paths or Canvas filenames into the
  current Better Harness architecture.

## Plan and Tasks

1. Reimplement the tool-call trace builder under the current
   `scripts/session-analysis/` owner and attach it only to selected
   session-efficiency candidates.
2. Extend current lifecycle deduplication and the Qoder platform adapter so
   trustworthy source durations survive normalization.
3. Sanitize and project the trace through `task-loop-source`, then validate the
   versioned contract in `task-loop-report`.
4. Adapt the trace UI to the canonical Better Harness Canvas template and its
   validator, preserving current renderer ownership and embedding the smallest
   compatible subset of `../canvas-sdk`'s swimlane bubble layout locally.
5. Port behavior-focused fixtures and tests, then run focused and full
   validation appropriate to the touched owners.

## Test and Review Evidence

- AC-1/AC-2: `node --test test/session-analysis.test.mjs
  test/task-loop-source.test.mjs` passed as part of 74 focused tests.
- AC-3/AC-4: `node --test test/harness-canvas-validation.test.mjs
  test/task-loop-report.test.mjs` passed as part of 98 focused tests.
- AC-4: A 640 px Playwright preview rendered the local SVG with 12 calls,
  horizontal overflow containment, no console/page errors, and successful
  `/health` and `/canvas-module.js` responses.
- AC-5: `node --test test/doc-link-graph.test.mjs` passed 6/6; `npm test`
  passed 1297/1297; `npm run pack:verify` passed with 469 npm entries and 491
  runtime zip entries.
- Review risk: lifecycle pairing can misattribute latency when invocation ids are
  missing or duplicated; tests must cover unmatched and ambiguous sequences.
- Privacy risk: report and Canvas projection must remain an allowlist and must
  reject tool arguments, outputs, raw evidence references, and uncontrolled
  labels.
- Compatibility risk: existing v1 trace packets must remain valid while new
  packets use v2.
