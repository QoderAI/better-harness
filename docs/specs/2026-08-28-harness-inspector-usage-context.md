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

## Non-goals

- Treating local Codex, Claude, or Cursor files as stable public host APIs.
- Showing or exporting raw system prompts, developer messages, `AGENTS.md`,
  `CLAUDE.md`, rules, skills, tool schemas, or conversation/context item text.
- Adding billing claims, account balances, rate limits, or estimated cost.
- Making Cursor transcript modification time authoritative Session chronology.
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

- `npm run check` passed on supported Node 24.19.0: root Vitest reported
  1,548 passed and 2 skipped; Harness reported 172 passed; Harness UI reported
  31 passed; Studio reported 293 passed; generated-source and package/archive
  verification also passed.
- The focused Studio Playwright scenario passed at 1440x900, 1024x768, and
  390x844 with no console/page errors or document-level horizontal overflow.
- `node scripts/harness-inspector/visual-contract-check.mjs` passed all 15
  standalone Inspector surface/viewport combinations with no clipped facts,
  below-floor targets, page errors, or horizontal overflow.
- A live local Inspector render over Codex, Cursor, and Claude evidence produced
  58 sessions and 7,989 tool calls. It projected token evidence for 44 of 45
  Codex sessions and all 13 Claude sessions; the current workspace supplied no
  matching Cursor session, so Cursor context matching remains fixture-backed.
