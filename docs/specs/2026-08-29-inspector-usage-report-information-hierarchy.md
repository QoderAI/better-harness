# Clarify usage report evidence and context structure

## Traceability

- Spec ID: inspector-usage-report-information-hierarchy
- Status: Implemented
- Related: [Inspect session usage and context evidence](2026-08-28-harness-inspector-usage-context.md)

## Intent

Make the Usage report easier to scan by keeping provenance close to the owning
Session header, removing redundant lead hierarchy, and turning bounded context-
layer counts into a visual structure summary. The report must preserve the
distinction between observed item counts and token-weighted context composition.

## Acceptance Scenarios

- AC-1: The Session title bar and selected Usage mode own the visible view
  identity. The report body does not repeat `Usage and Context Report` or an
  `Evidence details` subheader. It begins with a compact, always-visible
  four-group evidence band followed by six responsive KPI tiles for
  latest context, input reuse, baseline context, net context growth, Session
  processed tokens, and model calls. Evidence is grouped by Observability,
  Runtime, Accounting, and Provenance instead of presented as one undifferentiated
  field grid. Coverage is evidence quality and appears as an Observability fact,
  rather than occupying a standalone heading row or pill.
  The band omits redundant explanatory copy, uses one row through compact
  layouts, and keeps KPI tiles dense enough that downstream analysis begins in
  the first viewport. Current context includes a compact occupancy/composition
  bar and a separately sourced reported-compaction or observed-reset badge.
  Input reuse includes its compact cached/uncached bar and exact retained totals.
  Those two summaries do not repeat as full-width report sections. When Session
  processed tokens are unavailable, the sixth KPI shows the observed peak
  context instead of an unavailable placeholder. Net context is labelled as a
  comparison with baseline rather than lifetime consumption.
- AC-2: Context structure renders each observed layer as a categorical,
  count-weighted segment plus a matching labelled row with its exact item count.
  The visualization is explicitly labelled as item counts, never tokens. It
  does not show percentages or synthesized `K` values when per-layer token sizes
  were not retained, and says `token sizes unavailable`. Compactions move to the
  Current context KPI rather than remaining a duplicate structure fact.
- AC-3: A Session without retained context layers shows an honest unavailable
  state and does not render an empty or invented distribution.
- AC-4: Standalone Inspector and native Studio use the same information order,
  copy, values, categorical mapping, disclosure semantics, and responsive
  behavior at 1440x900, 1024x768, and 390x844.
- AC-5: The Evidence band and Context structure introduce no raw context text;
  prompt previews remain limited to already-retained, Turn-linked evidence owned
  by the linked Usage explorer. The report has no document-level horizontal
  overflow and introduces no browser console or page errors.
- AC-6: Overview is the sole prompt-event index for Context progression. It
  retains one subtle tick at the first linked response for every observed user
  prompt. The selected tick exposes one compact `Tn` anchor; hovering a tick or
  moving to it with Overview keyboard navigation replaces that anchor with an
  immediate prompt-first tooltip containing the retained prompt preview plus
  `Tn`, response, time, and context metadata. Clicking the tick selects that
  response and centres the Focus window. Overview is one composite keyboard
  stop: Left/Right move between prompt events and reveal the same tooltip, with
  no per-prompt tab stops. Focus renders only the context series, response
  selection crosshair, and context/model boundaries; it does not duplicate the
  prompt-event rug or its labels. Selected Response details own the complete
  retained prompt preview and repeat the same `Tn` beside its prompt heading;
  the response table does not add a separate Turn-number column. The default
  Focus window starts at the latest observed
  context reset or model boundary when at least the minimum window remains, and
  its y-scale is derived from that visible window. Copy says `Linked prompt`
  because the marker position is the first linked model response rather than an
  observed prompt timestamp.

## Non-goals

- Estimating layer token sizes from item counts, raw text length, a tokenizer,
  or model-name lookup tables.
- Changing provider adapters, context manifests, token accounting, or
  compaction detection.
- Redesigning the rest of Session Detail or changing the report route.

## Plan and Tasks

1. Add shared presentation helpers for evidence facts and observed context-layer
   counts without changing the portable report model.
2. Let the Session title bar and selected Usage mode own view identity. Remove
   the repeated report title, Evidence details subheader, eyebrow, explanatory
   subtitle, and Coverage pill. Begin with a compact evidence band, group
   Coverage with Observability, and keep the six-tile KPI overview below it.
3. Fold the Current context composition and Input reuse bars into their KPI
   tiles, surface reported compactions beside Current context, and remove the
   now-redundant full-width sections. Use peak context as the fallback KPI when
   Session processed evidence is unavailable.
4. Replace the Context structure definition list with a count-weighted segmented
   bar and exact item-count rows; remove percentages and explicitly mark missing
   per-layer token sizes instead of estimating them.
5. Keep the standalone string renderer and Studio React renderer aligned while
   sharing the existing Inspector stylesheet and semantic color tokens.
6. Make Overview the single linked-prompt event rug, keep one selected `Tn`
   anchor backed by a prompt-first hover/focus tooltip, and let click or
   composite keyboard navigation centre Focus. Remove the duplicate Focus
   prompt lane and Turn table column while repeating the selected `Tn` beside
   the complete prompt in Response details.
7. Add focused rendering assertions, regenerate linked documentation artifacts,
   and run standalone/native visual checks at all three layout widths.

## Test and Review Evidence

- AC-1/AC-2/AC-3: focused behavioral rendering assertions in
  `test/reporting/harness-inspector.test.mjs` and Studio component/browser tests
  assert the absence of repeated visible headings, always-visible facts, exact
  counts, unavailable state, and absence of misleading token claims.
- AC-4/AC-5: `node scripts/harness-inspector/visual-contract-check.mjs` plus the
  focused Studio Inspector Playwright scenario cover wide, compact, and narrow
  layouts, header reflow, overflow, page/console errors, and screenshots.
- Documentation integrity: regenerate `docs/better-harness-doc-links.mmd` and
  run `npx vitest run test/skills-docs/doc-link-graph.test.mjs`.
- Privacy risk: the UI continues to render only bounded layer kinds/counts and
  enumerated evidence facts; no raw context or prompt text enters the report.
- Interpretation risk: the chart aria-label, header copy, and legend say
  `items`; the current-context composition remains the only token-weighted
  category visualization.

## Validation

- `npx vitest run test/reporting/harness-inspector.test.mjs test/reporting/harness-inspector-usage-explorer.test.mjs`
  passed 39 focused reporting tests.
- `npm run typecheck` and `npm run build` passed in
  `packages/harness-studio`.
- The focused Studio Playwright Inspector scenario passed and asserts six KPI
  tiles, no repeated report or Evidence headings, Coverage ownership inside
  Observability, exact context structure counts, and the synchronized Overview
  prompt tooltip / Focus / Response details selection model.
- The standalone visual contract passed all 15 surfaces at 1440x900,
  1024x768, and 390x844 for both the demo and a regenerated real report, with
  zero document overflow, clipped text, sub-12px meaningful text, console
  errors, or page errors.
- The requested Session `01a04647-16fa-7123-87d6-b216f77cdf1e` begins directly
  with the four-group evidence band and KPI row. The repeated report title,
  Evidence details heading, eyebrow, explanatory subtitle, and Coverage pill are
  absent; Coverage remains visible as an Observability fact.
- The compact-density pass keeps four Evidence groups in one row at 1024px and
  brings downstream analysis into the first wide viewport without dropping
  evidence facts.
- `npx vitest run test/skills-docs/doc-link-graph.test.mjs` passed all 8 document
  integrity tests after regenerating `docs/better-harness-doc-links.mmd`.
- Three independent read-only reviewers covered visualization density,
  interaction/accessibility, and evidence semantics. Their common P2 finding
  was the duplicated permanent Turn-chip layer; AC-6 supersedes that layer with
  a single prompt-first Overview event rug.
- The real 60-response / 11-Turn Session
  `01a04772-042c-7451-b637-b9f07e612a1c` defaults Focus to the latest observed
  context cycle (responses 43–60), uses a local 32.3K–41K Focus scale, retains
  the full 08:18:00–08:54:48 Overview range, and has zero wide or narrow
  overflow and browser errors. Its Usage lead contains no visible report-title
  repeat, Evidence details heading, or Coverage pill. Overview retains one
  selected `T11`; hovering it immediately shows the retained prompt followed by
  `Turn 11 · Response 59` metadata, while Focus contains no duplicate prompt
  markers and Response details says `Linked user prompt · T11`.
- The real 899-response Session
  `01a04647-16fa-7123-87d6-b216f77cdf1e` renders 17 Overview prompt ticks and
  one selected `T18`. Hover shows `提交然后 push 吧` with
  `Turn 18 · Response 894` metadata; Focus contains zero prompt markers and the
  page has zero horizontal overflow, console errors, or page errors. Prompt
  ticks and the range handles use separate upper/lower hit areas, including at
  the first and last response positions.
