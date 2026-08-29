# Harness Inspector Input Reuse

## Traceability

- Spec ID: `harness-inspector-input-reuse`
- Status: Implemented

## Intent

Make provider-reported cache reuse understandable in the Harness Inspector
without implying that cached tokens disappear from the model context window or
that every provider accounts for cached input in the same way. The Session
summary and full Usage and Context Report should surface reuse as a first-class
efficiency signal while preserving the existing evidence and privacy boundary.

## Acceptance Scenarios

### AC-1 — Preserve the provider accounting relationship

Given a normalized model response from Codex/OpenAI or Claude/Anthropic, when
the adapter emits cache usage, then it records whether cache reads are included
in the input counter or reported as a separate input lane. An adapter without
that evidence leaves the relationship unknown; downstream code does not infer
one from platform or model display text.

### AC-2 — Derive reuse only from compatible counters

Given an included-in-input record, reuse is `cache read / input` and uncached
input is `input - cache read`. Given a separate-input-lane record, reuse is
`cache read / (input + cache read + cache creation)` and uncached input is
`input + cache creation`. If required counters are unavailable or internally
inconsistent, the report retains observed absolute counters but does not clamp
or invent a reuse rate.

### AC-3 — Make reuse visible in the Session summary

Given trustworthy session-level reuse evidence, the Usage and context summary
shows an Input reused metric, cached token total, labelled cached-versus-
uncached bar, and observed input denominator. Given absolute-only evidence, it
shows the cache read total and explicitly marks the rate unavailable. Given no
cache evidence, it does not render a cache claim.

### AC-4 — Explain reuse in the full report

Given cache evidence, the full Usage and Context Report places a dedicated
Input reuse section before Context progression. It distinguishes cached,
uncached, and cache-creation input where observed and explains that cached input
still occupies context even when provider caching can reduce cost or latency.

### AC-5 — Label provider accounting honestly

Provider accounting labels state whether the displayed Input total includes
cached input or represents uncached input. Unknown relationships remain marked
as unknown and do not present a derived prompt-input total.

### AC-6 — Keep per-response reuse scannable

Given per-response reuse evidence, each response row exposes a compact reuse
annotation without adding a wide table column or requiring raw prompt/context
content. Narrow layouts remain bounded without horizontal page overflow.

### AC-7 — Keep both Inspector renderers aligned

The standalone `workbench.html` renderer and Harness Studio Inspector render
the same terminology, states, ordering, and accessible labelled bars. The
primary facts remain usable at 1440x900, 1024x768, and 390x844, with keyboard
focus and no browser console or page errors.

### AC-8 — Preserve evidence and privacy boundaries

The feature uses normalized aggregate and per-response counters only. It does
not expose hidden prompt/context text, claim exact monetary savings without a
versioned pricing source, or treat cache reuse as context-window savings.

## Non-goals

- Estimating currency savings or provider billing discounts.
- Predicting cache eligibility, cache lifetime, or latency improvements.
- Adding a host adapter or reverse-engineering an unknown provider relationship.
- Changing context-window capacity, compaction, or reset derivation.

## Plan and Tasks

1. Add a provider-neutral cache accounting mode and pure reuse derivation.
2. Preserve the mode through adapter events, Session summaries, dialogue steps,
   usage progression, and the bounded Inspector report model.
3. Add the summary metric, dedicated report section, honest accounting labels,
   and compact per-response annotations to both renderers.
4. Add behavior tests for included, separate, unknown, zero, and inconsistent
   observations.
5. Run focused Node 24 tests, the repository check, and responsive browser
   validation with screenshots and console/page-error inspection.

## Test and Review Evidence

- `npx vitest run test/sessions/session-cache-accounting.test.mjs test/sessions/session-usage-progression.test.mjs test/sessions/commit-session-link.test.mjs test/reporting/harness-inspector.test.mjs` — 101 tests passed.
- `npm run build -w @qoder-ai/harness-studio` — TypeScript and Studio application build passed.
- `npm run harness-studio:test:browser` — 51 Playwright browser tests passed.
- `PATH=/opt/homebrew/opt/node@24/bin:... npm run check` — 107 root test files (1594 passed, 2 skipped), generated-language check, 20 Harness test files (173 passed), 3 Harness UI test files (31 passed), 62 Studio test files (494 passed), and package verification passed.
- `node scripts/harness-inspector/visual-contract-check.mjs --report <rendered-report> --out <screenshots>` — capability, date, Session Trace, Session Usage, and Session Replay passed at 1440x900, 1024x768, and 390x844 with zero horizontal overflow, clipped text, sub-12px meaningful text, console errors, or page errors.
- A live Codex Session projection retained provider counters and derived 59.8M cached of 61.9M observed input (96.7% reuse) without altering its independently observed context occupancy.
