# Make the Usage report decision-first and keyboard-correct

## Traceability

- Spec ID: inspector-usage-report-clarity
- Status: Implemented

## Intent

Make the standalone Inspector and Harness Studio Usage report answer the
reviewer's primary question first: how much of the latest observed context
window was occupied, when that static snapshot was current, and how the
Session reached it. Remove controls, metric substitutions, and visual encodings
that obscure or misstate that decision, especially for keyboard and narrow-screen
reviewers.

## Acceptance Scenarios

- AC-1: The detailed Usage report visibly identifies itself and places one
  complete `Static snapshot` freshness statement beside the latest observed
  context value. The statement remains readable at wide, compact, and narrow
  widths and is not available only through clipped text.
- AC-2: Summary positions retain stable semantics across providers. Context
  health, input reuse, Session processing availability, and model-call evidence
  do not replace one another with unrelated metrics such as peak context.
  Provider/runtime/provenance methodology is available through one secondary,
  collapsed disclosure after the primary summary.
- AC-3: When all retained responses fit in the focus window, the report renders
  one context chart and omits the duplicate Overview, range sliders, and
  unavailable Previous/Next window actions. Longer Sessions retain the bounded
  Overview and independently adjustable Start and End controls.
- AC-4: Start and End range inputs preserve native keyboard operation without
  changing the selected Response. Interactive charts expose control semantics
  and describe the actual Arrow-key selection model; Escape clears a local
  selection. Returning to Trace restores keyboard focus to the Trace view.
- AC-5: Narrow layouts keep evidence values, chart labels, range controls, and
  response rows readable and operable. Meaningful text remains at least 12px,
  touch-oriented targets are at least 44px, and no document-level horizontal
  overflow is introduced.
- AC-6: Cache reuse explicitly states that cached input still occupies the
  context window. Codex context-layer item counts render as a count inventory,
  not as a proportional bar that resembles token-weighted composition.
- AC-7: Standalone Inspector and Studio retain equivalent terminology,
  information order, conditional explorer behavior, and accessibility
  semantics. Existing provider accounting values, progression points, prompt
  links, privacy omission, compaction evidence, and Context Window arithmetic
  remain unchanged.

## Non-goals

- Changing provider adapters, usage arithmetic, Context Window inference,
  compaction detection, or the portable report schema.
- Adding live refresh, billing, cost, savings, or optimization verdicts.
- Completing the full standalone light/dark theme migration or adding a theme
  selector; this change uses the existing semantic tokens while removing the
  dashboard-like Usage layout.
- Reconstructing token-weighted context categories when a provider retained
  only layer item counts.

## Plan and Tasks

1. Recompose the Usage lead in both renderers around a visible title, latest
   observed Context Window, full static freshness, and stable supporting facts.
2. Move runtime/accounting/provenance facts into a shared collapsed evidence
   disclosure and make long values wrap at narrow widths.
3. Make Overview/window controls conditional on a genuinely bounded focus
   subset; retain one focus chart, response detail, and dense response table for
   short Sessions.
4. Correct standalone key routing, chart control semantics, truthful keyboard
   help, and Trace focus restoration.
5. Remove item-count proportion bars, state the cache/context boundary, and
   tighten wide/compact/narrow styling without changing evidence values.
6. Update behavior, Studio browser, and standalone visual-contract assertions;
   regenerate the documentation routing graph.

## Test and Review Evidence

- AC-1/AC-2/AC-6/AC-7: focused report-model and renderer assertions inspect
  visible copy, stable labels, evidence disclosure, cache boundary, and the
  absence of count-as-composition bars.
- AC-3/AC-4: Studio Playwright and standalone visual checks cover a short
  Session and a long Session, native range-key behavior, selection behavior,
  and focus restoration.
- AC-5: the Inspector visual contract must pass at 1440x900, 1024x768, and
  390x844 with no clipped meaningful text, below-floor type, unreachable
  controls, console/page errors, or document-level overflow.
- Regression: run focused Inspector Vitest files, `npm run
  harness-studio:test`, the focused artifact-host Playwright scenario,
  `node scripts/doc-link-graph/cli.mjs skills/better-harness`, and the doc-link
  graph test.
- Risk: standalone and Studio own parallel renderers. Review their emitted
  labels, conditional branches, keyboard paths, and responsive screenshots as
  one change; a pass in only one host is insufficient.

## Validation Results

- `npm test`: 107 files passed; 1,598 tests passed and 2 skipped.
- `npm run harness-studio:test`: 65 files and 512 tests passed after a clean
  Studio build.
- Focused Studio Playwright: the Inspector Session/Usage/Replay scenario passed,
  including the short-Session branch and Trace focus restoration.
- Standalone visual contract: capability, date, Session Trace, Usage, and Replay
  passed at 1440x900, 1024x768, and 390x844 with zero document overflow,
  below-floor type, clipped text, or console/page errors. The Usage check also
  exercised native range-key adjustment without changing the selected Response.
- Documentation link graph: regenerated and its 8 focused tests passed.
- Preview smoke: `/health` returned `ok`; `/canvas-module.js` returned HTTP 200.
