# Inspect session usage and context evidence

## Traceability

- Spec ID: harness-inspector-usage-context
- Status: Implemented

## Intent

Make Harness Inspector report the token and context evidence that supported
coding-agent sessions without confusing provider-specific accounting or
embedding sensitive system/developer instructions in its portable HTML. The
Inspector should expose what was actually observed, where it came from, and
which fields remain unavailable for Codex, Claude, and Cursor.

This change also closes two correctness gaps found during the evidence audit:
Codex developer messages must not be projected as assistant dialogue, and
Cursor transcripts without native event timestamps must not silently disappear
from the default Inspector window.

## Acceptance Scenarios

- AC-1: Codex `response_item.message` records retain distinct user, assistant,
  developer, and system roles. Only user and assistant content may enter the
  Inspector dialogue projection; developer/system content contributes bounded
  context-manifest counts without retaining text.
- AC-2: Codex `event_msg.token_count` records produce session usage from the
  cumulative `total_token_usage` snapshots. Repeated snapshots are not summed,
  and a decreasing cumulative total starts a new monotonic segment. The result
  keeps input, output, cached-input, cache-write, reasoning-output, and explicit
  total tokens without counting cached input twice.
- AC-3: The shared Inspector usage projection keeps optional cache-creation,
  reasoning-output, explicit-total, source, basis, and coverage fields. Claude
  cache-creation tokens survive adapter, session summary, report, and UI
  projection. Providers without an explicit total continue to show a breakdown
  without inventing a billing total.
- AC-4: Codex model, effort, model provider, CLI version, context-window usage,
  compaction count, and context-layer counts are projected as bounded metadata.
  Cursor Context Usage Canvas evidence may contribute window/category counts
  only when its composer id matches the Session. Every context projection states
  that raw text was omitted.
- AC-5: A Cursor transcript without native timestamps remains discoverable. Its
  file modification time may supply a low-authority source timestamp only when
  labelled `source-file-mtime`; it must not be presented as a native event time.
- AC-6: Standalone Inspector and native Studio Session Detail expose one docked,
  progressively disclosed `Usage and context` facts section. It shows token
  breakdown, context-window occupancy, provenance/coverage, runtime metadata,
  and unavailability honestly at wide, compact, and narrow widths.
- AC-7: The self-contained report contains no raw base instructions,
  developer/system message content, context item text, absolute home paths,
  rate-limit/credit data, encrypted reasoning, or raw tool payloads.
- AC-8: Every retained model-inference event in a Turn exposes its own observed
  token usage. When that same event includes a context-window observation, the
  row also shows used tokens, window size, and percent full. Session totals,
  hard-coded model limits, and later snapshots must never be substituted for
  missing per-inference evidence.
- AC-9: Standalone Inspector and Studio render per-inference usage as compact,
  ordered process-trace rows at wide, compact, and narrow widths. Claude or
  Cursor rows without an observed context window say that it is unavailable;
  Cursor Context Usage Canvas remains a session-current snapshot rather than
  being repeated across historical responses.
- AC-10: Without an explicit time window, Cursor coverage treats every matched
  workspace transcript as relevant, including terminal-only and unreadable
  transcripts whose native event time is unobserved. A partial in-window subset
  must not silently reduce the coverage denominator.

## Non-goals

- Treating local Codex, Claude, or Cursor files as stable public host APIs.
- Showing or exporting raw system prompts, developer messages, `AGENTS.md`,
  `CLAUDE.md`, rules, skills, tool schemas, or conversation/context item text.
- Adding billing claims, account balances, rate limits, or estimated cost.
- Making Cursor transcript modification time authoritative Session chronology.
- Reconstructing historical per-response context occupancy from a current
  Cursor Context Usage Canvas snapshot or a model-name lookup table.
- Unifying provider transcript/event IRs beyond the bounded shared usage and
  context-evidence projection consumed by Inspector.

## Plan and Tasks

1. Correct Codex role normalization and add bounded usage/runtime/context
   metadata events for current rollout records.
2. Extend session summarization with a provider-neutral usage evidence shape,
   monotonic cumulative-snapshot aggregation, context manifest counts, and
   explicit timestamp authority.
3. Preserve Claude cache-creation usage and attach a matching Cursor Context
   Usage Canvas projection while keeping raw context text out of the report.
4. Extend `HarnessInspectorReportV1`, the standalone report, and native Studio
   Session Detail with the same progressively disclosed facts.
5. Add behavioral fixtures for role privacy, cumulative usage resets, Claude
   cache creation, Cursor timestamp fallback/context matching, report escaping,
   and UI projection.
6. Preserve per-inference usage/context snapshots in Turn order, render them as
   compact process evidence in both Inspector hosts, and keep missing provider
   fields explicitly unavailable.
7. Keep Cursor coverage denominators independent of timestamp observability
   when no time filter was requested, and retain the cross-platform fixture as
   the behavioral guard.

## Test and Review Evidence

- AC-1/AC-2/AC-4: focused Codex adapter tests in
  `test/sessions/session-analysis.test.mjs` and session-summary tests in
  `test/sessions/commit-session-link.test.mjs`.
- AC-3/AC-5: provider fixtures in
  `test/sessions/session-analysis-providers.test.mjs` plus Inspector report
  projection coverage in `test/reporting/harness-inspector.test.mjs`.
- AC-6/AC-7: generated-report assertions, Studio component tests, Playwright at
  1440x900, 1024x768, and 390x844, console/page-error inspection, and saved
  screenshots.
- AC-8/AC-9: Turn-folding tests for Codex invocation usage and Claude response
  usage, report-projection privacy assertions, and the same three-width
  Playwright/standalone visual contract with multiple usage rows expanded.
- AC-10: `Cursor facts distinguish absent, terminal-only, and unreadable
  transcripts` must pass on Windows as well as POSIX hosts; the Windows PR job
  is the authoritative receipt for filesystem behavior.
- Cross-platform evidence: focused tests must use `node:path` and temporary
  directories, then the full Node 22/24 macOS, Windows, and Ubuntu PR jobs remain
  authoritative for target-platform acceptance.
- Privacy risk: local host schemas may contain prompts, instructions, account
  data, and raw tool payloads. Tests assert on normalized shapes and forbidden
  secrets; portable output receives only enumerated metadata fields.
- Accounting risk: providers disagree on whether cached tokens are a subset of
  input. The UI uses an explicit provider total when present and never adds
  cached input to input as a generic fallback.
- Timestamp risk: Cursor source-file mtime is labelled as low-authority evidence
  and never changes `eventTimestampCoverage` from `unobserved`.

## Validation Evidence

- The first follow-up Windows Node 22 PR run exposed AC-10 by reporting one
  relevant Cursor transcript where the fixture contained two. After the
  denominator fix, the focused Cursor/provider suite passed all 53 tests; the
  refreshed Windows PR job remains the authoritative platform receipt.
- `npm run check` passed on supported Node 24.19.0: root Vitest reported
  1,549 passed and 2 skipped; Harness reported 172 passed; Harness UI reported
  31 passed; Studio reported 293 passed; generated-source and package/archive
  verification also passed.
- The focused Studio Playwright scenario passed at 1440x900, 1024x768, and
  390x844 with no console/page errors or document-level horizontal overflow.
- `node scripts/harness-inspector/visual-contract-check.mjs` passed all 15
  standalone Inspector surface/viewport combinations with no clipped facts,
  below-floor targets, page errors, or horizontal overflow.
- A live local Inspector render over Codex, Cursor, and Claude evidence produced
  58 sessions and 8,322 tool calls. It projected 5,341 per-inference usage rows
  for 44 of 45 Codex sessions, all with same-event context-window evidence, and
  981 per-inference usage rows for all 13 Claude sessions, whose events supplied
  no context-window field. The current workspace supplied no matching Cursor
  session, so Cursor per-inference/context matching remains fixture-backed.
