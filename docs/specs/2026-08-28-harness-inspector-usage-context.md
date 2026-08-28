# Inspect session usage and context evidence

## Traceability

- Spec ID: harness-inspector-usage-context
- Status: Implemented
- Refs: https://github.com/QoderAI/better-harness/pull/122

## Intent

Make Harness Inspector report the token and context evidence that supported
coding-agent sessions without confusing provider-specific accounting or
embedding sensitive system/developer instructions in its portable HTML. The
Inspector should expose what was actually observed, where it came from, and
which fields remain unavailable for Cursor, Codex, Qoder, and Claude Code.

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
- AC-6: Standalone Inspector and native Studio Session Detail expose one docked
  `Usage and context` entry. It progressively discloses token breakdown,
  context-window occupancy, provenance/coverage, runtime metadata, and honest
  unavailable states at wide, compact, and narrow widths.
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
- AC-11: Session Detail keeps a compact `Usage and context` summary in its
  right-hand outline. The summary leads with current context, comparable net
  context growth, derived Session processing, and unique model-call count;
  visualizes only token-weighted context categories; supplies an explicit
  `Other` remainder when categories do not cover the observed used context; and
  never stacks overlapping input/cache/reasoning accounting as if it were
  context composition.
- AC-12: A labelled `View report` action in that right-hand summary opens a
  read-only Usage report inside the existing Session Detail shell. It does not
  nest another modal or expand the narrow outline into the report. The report
  has a stable host-native URL state (`inspector-view=usage` in Studio and
  `session-mode=usage` in the standalone Inspector) and a labelled route back
  to Trace; closing Session Detail retains its existing behavior.
- AC-13: The Usage report leads with context-window occupancy, then shows
  observed per-inference context progression, separate processing accounting,
  the current token-weighted context composition when retained, provider
  accounting, bounded context-layer counts, runtime facts, provenance, and the
  raw-context omission boundary. Missing category, per-inference, runtime, or
  context-window evidence stays explicitly unavailable and is never
  reconstructed from a model-name lookup table.
- AC-14: Studio and standalone Inspector expose the same summary/report
  semantics, labelled controls, and keyboard-reachable navigation at wide,
  compact, and narrow layouts. The main Session evidence remains the primary
  surface until the reviewer explicitly opens the report, and neither surface
  gains document-level horizontal overflow or browser console/page errors.
- AC-15: Qoder assistant usage preserves its observed
  `message.usage.context_usage_ratio` as context occupancy. A Session-local
  `contextWindow` may supply the denominator and derived used-token count only
  when that value was actually retained; otherwise the report shows the
  observed percentage without inventing an absolute window. Qoder
  `compactMetadata` records contribute compaction boundaries.
- AC-16: Claude response usage exposes observed prompt-context tokens as the
  sum of input, cache-read input, and cache-creation input for that inference.
  It remains a used-token-only observation when the transcript has no context
  window, so the report must not infer a model limit or percentage.
- AC-17: Qoder and Claude tool, Skill, MCP, subagent, system-message, and other
  activity counts must not be presented as Cursor-style token composition.
  Category composition remains explicitly unavailable unless a host supplies
  token-weighted categories; partial context observations still appear in the
  summary, progression, and provenance views.
- AC-18: Cursor, Codex, Qoder, and Claude Code project through the same bounded
  Usage report contract while preserving their distinct evidence capabilities.
  Cursor may show native token-weighted categories from a composer-matched
  Context Usage Canvas; Codex may show per-response used/window occupancy and
  compactions; Qoder may show ratio-only or ratio plus an observed Session
  window; Claude Code may show observed prompt tokens without a window. A
  provider with weaker evidence must never inherit fields from a stronger one.
- AC-19: Claude usage observations are unique by Session-local `responseId`.
  Repeated records for the same response contribute one model call and one set
  of counters; exact duplicates are collapsed, synthetic or all-zero usage is
  excluded, and conflicting duplicates select one canonical record while
  retaining a bounded conflict count. The portable report never exposes the raw
  provider response id.
- AC-20: The Usage report keeps provider-reported `totalTokens` distinct from
  derived processed tokens. For a unique Claude response, processed tokens are
  the additive sum of input, cache-read input, cache-creation input, and output;
  the Session processed value is their sum across unique responses and carries
  the basis `derived-accounted-usage`. It is not labelled as provider total,
  billing, or cost.
- AC-21: Context progression reports one point per unique retained inference.
  Each point may expose the absolute prompt snapshot, the net delta from the
  previous comparable response, processed tokens for that call, and output.
  The first point is a baseline, a model change is an incomparable boundary,
  and a negative same-model delta is labelled context shrink/reset rather than
  negative consumption. Missing windows are stated once for the report instead
  of repeated on every progression row.
- AC-22: The Session Detail summary separates current context, net comparable
  context growth, derived Session processed tokens, and unique model-call count.
  The detailed report uses an absolute context-progression chart plus a separate
  processing-accounting visualization; it never presents cache/input/output
  accounting as Cursor-style current-context composition.
- AC-23: Qoder contributes exactly one Usage progression point for each
  retained `model.response.completed` event. A nearby project-transcript
  `assistant` event may enrich that response with its observed context ratio
  when both records agree on model and stop reason, but it never contributes a
  second call. Turn, fork-agent, and other usage-bearing summary events remain
  Session evidence and never become model calls. Unmatched assistant context
  stays available to the Session-current context manifest without being
  invented as a historical response.

## Provider evidence matrix

| Provider | Current context evidence | Token-weighted composition | Progression | Compaction evidence |
| --- | --- | --- | --- | --- |
| Cursor | Native Canvas used/window snapshot, matched by composer id (`host-context-snapshot`) | Native Canvas categories only | Usage counters when retained; Canvas occupancy remains current-snapshot evidence | Unobserved |
| Codex | `last_token_usage.input_tokens` plus `model_context_window` (`prompt-tokens`) | Unavailable; bounded layer counts are not token categories | Per `token_count` response | `compacted` events |
| Qoder | `context_usage_ratio`, optionally paired with a retained Session `contextWindow` | Unavailable | Per canonical model response, enriched by a matched assistant observation | `compactMetadata` records |
| Claude Code | Input + cache-read input + cache-creation input prompt tokens | Unavailable | Per unique assistant response | Unobserved |

## Non-goals

- Treating local Cursor, Codex, Qoder, or Claude Code files as stable public
  host APIs.
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
8. Replace the right-outline fact dump with a compact usage/context summary and
   a `View report` action, while keeping provider accounting and context
   composition as separate visual dimensions.
9. Add a Session-scoped Usage report view with context composition, observed
   per-inference progression, bounded runtime/provenance details, URL state,
   and an explicit return to Trace in both Inspector hosts.
10. Normalize Qoder ratio/window/compaction evidence and Claude prompt-token
    observations without adding a model-window lookup or estimating category
    tokens from activity counts.
11. Generalize context projection and UI formatting for percentage-only,
    used-token-only, and complete used/window observations.
12. Verify the shared report contract against all four providers and retain a
    provider-capability matrix so stronger Cursor/Codex evidence never leaks
    into Qoder/Claude unavailable states.
13. Own response identity, synthetic exclusion, duplicate collapsing, and
    additive processing derivation in one adapter-facing session-analysis
    module (`usage-records.mjs`). Claude collapses with a latest-payload
    canonical record and bounded diagnostics; WorkBuddy collapses with a
    first-observation canonical record and no diagnostics; `session-efficiency`
    shares the same identity keys. An adapter whose counters overlap simply does
    not opt into the additive derivation.
14. Derive the `usageReport` exactly once, in `usage-progression.mjs`, from the
    complete normalized event stream. Report and UI layers only project it:
    `projectUsageReport` bounds and validates but never counts, and a missing
    report projects to the shared `EMPTY_USAGE_REPORT` so no renderer carries a
    local default. Deriving the metrics a second time from a display-bounded
    dialogue is prohibited — it would answer a different question under the same
    field names.
15. Replace the unbounded progression list with an accessible context chart and
    a bounded detail table, then add a separate processing breakdown for hosts
    whose additive accounting basis is known.
16. Surface every retained metric or drop it: baseline context, context
    shrink/reset and model-boundary counts, processing coverage, and whether the
    retained progression is a sample must all be visible in both Inspector
    hosts.
17. Canonicalize Qoder multi-lane usage evidence before report derivation:
    enrich a retained model response from a one-to-one nearby assistant context
    observation, keep non-response summary events out of the call series, and
    cover the real logs-session/project-jsonl/turn-finished shape with a
    behavioral fixture.

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
- AC-11/AC-13: component/report assertions verify `Other` remainder math,
  non-overlapping accounting labels, honest unavailable states, and omission of
  raw context. Category widths are derived only from `contextManifest`
  category estimates plus the observed used/window totals.
- AC-12/AC-14: focused Studio Playwright and standalone Inspector checks open
  the right-side `View report` action, verify their host-native Usage route
  state, return to Trace, exercise keyboard focus, and save
  wide/compact/narrow screenshots with console/page-error and overflow checks.
- AC-15: Qoder provider fixtures cover ratio-only usage, an observed Session
  window, derived used tokens, and compaction metadata. A local schema audit
  checks the same bounded fields without retaining transcript text.
- AC-16: Claude provider and Session-summary fixtures verify prompt-context
  addition across input/cache-read/cache-creation and preserve an unavailable
  window through report projection.
- AC-17: report/UI assertions distinguish the three partial-context states and
  keep category composition unavailable rather than substituting activity
  counts.
- AC-18: one report-projection fixture covers Cursor native categories, Codex
  full used/window occupancy, Qoder percentage-only occupancy, and Claude Code
  used-only prompt context. Local replay counts are recorded separately from
  fixture-backed capability evidence.
- AC-19/AC-20: Claude fixtures include repeated identical response ids,
  synthetic/all-zero responses, and one conflicting duplicate. Assertions cover
  canonical selection, collapsed/conflict counts, unique call count, additive
  processed totals, and unchanged provider-total semantics. The shared
  collapsing and derivation helpers carry their own unit coverage for both
  canonical strategies and for the additive opt-in.
- AC-21/AC-22: `buildUsageReport` tests cover baseline, growth, zero delta,
  same-model shrink, and model-change boundaries, plus partial processing
  coverage and bounded sampling that keeps Session totals complete. A
  report-model test pins the projection to the derived report while the fixture
  dialogue is deliberately shorter, so a reintroduced second derivation fails.
  Studio and standalone visual checks verify the shared summary metrics, chart
  labelling, bounded detail rows, keyboard reachability, and separation between
  context composition and processing accounting.
- AC-23: Qoder provider tests retain the real multi-lane ordering of
  logs-session model responses, project-jsonl assistant context observations,
  and usage-bearing turn/fork summaries. Assertions verify one progression
  point per canonical response, one-to-one context enrichment, unmatched
  context fallback, and exclusion of non-response summary events.
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
- A local Qoder/Claude replay after AC-15 through AC-17 read all 523 discovered
  Qoder Sessions and all 13 Claude Sessions without a read failure. Qoder
  produced 27 bounded context manifests: 3 with observed used/window totals, 18
  percentage-only, and 6 compaction-only. The first Claude replay counted 1,741
  raw response observations, but the AC-19 audit found only 966 actual model
  calls after collapsing 768 repeated records and excluding seven synthetic or
  all-zero observations. AC-19 through AC-22 now use those deduplicated model
  calls for Session processing and progression. Neither provider produced a
  token-weighted category manifest.
- The focused provider, Session-folding, and Inspector suites passed 176 tests;
  the root suite passed 1,552 tests with 2 skipped. Studio built successfully,
  its focused Playwright file passed 23 tests, and the standalone visual
  contract passed all 15 surface/viewport combinations.
- The Canvas preview smoke returned HTTP 200 for both `/health` and
  `/canvas-module.js`, confirming the TSX transform and SDK runtime endpoint
  remained available after the UI changes.
- A four-provider local replay read 93 of 93 Codex Sessions and 8 of 8 Cursor
  Sessions without a failure. Codex produced 93 bounded context manifests, 91
  with complete used/window evidence, from 16,352 usage/context observations.
  No current-workspace Cursor Session matched a Context Usage Canvas. A bounded
  global Cursor schema audit found 2 valid native snapshots, both with composer,
  used/window, category, and item fields (14 categories and 177 items total), so
  current-workspace Cursor context remains fixture-backed rather than borrowed
  from an unrelated composer.
- The AC-19 through AC-22 focused provider, Session-folding, and report suites
  passed 133 tests. A display-bounded 1,100-response fixture retained complete
  Session metrics and a 1,000-point progression sample with both endpoints.
- A real four-provider render of the current workspace discovered 475 Qoder,
  13 Claude Code, 8 Cursor, and 66 Codex source Sessions; the workspace filter
  retained 77 Qoder, 4 Claude Code, no matching Cursor, and 19 Codex Sessions.
  One long Claude Code Session projected 312 unique model calls after collapsing
  177 duplicate records, with a 47,153-token baseline, 370,640-token current
  context, 323,487-token net growth, one shrink/reset, and 73,088,320 derived
  processed tokens.
- The focused native Studio Playwright scenario passed after opening the
  right-outline `View report` entry and checking the detailed Usage report at
  1440x900, 1024x768, and 390x844. The standalone visual contract passed all 15
  surface/layout combinations with zero below-floor text, unreachable clipping,
  page/console errors, or document-level horizontal overflow.
- The final repository Vitest run passed 1,557 tests with 2 skipped; the native
  Studio suite rebuilt successfully and passed all 293 tests. JavaScript syntax,
  TypeScript/build output, `git diff --check`, and the Canvas preview `/health`
  and `/canvas-module.js` endpoints also passed.
- AC-23 replayed the comparable retained Qoder usage Sessions before and after
  canonicalization. Their reported model-call total fell from 127 multi-lane
  observations to 80 canonical responses, exactly matching the retained
  `model.response.completed` count in every Session; the representative Session
  changed from 51 to 31 calls while preserving all 18 matched ratio progression
  points and its 11.6% Session-current occupancy. Five Claude Sessions were
  unchanged, and 18 stable Codex Sessions were unchanged while the active Codex
  Session continued to grow during validation. The focused AC-23 tests passed
  109 assertions, the final root suite passed 1,572 tests with 2 skipped,
  Harness/Harness UI/Studio passed 172/31/293 tests, package verification passed,
  and the 15-surface visual contract plus focused Studio Playwright scenario
  completed without overflow or page errors. A privacy scan of the real portable
  report found no absolute home path, raw response id, encrypted content,
  rate-limit data, or credit data.
