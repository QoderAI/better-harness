# Session Population Binding

## Traceability

- Spec ID: 2026-07-30-session-population-binding
- Status: Implemented
- Issue: None; focused evidence-integrity maintenance discovered by a validated Better Harness report.

## Intent

Make one evidence-bundle run derive Session facts and lead analysis from one
frozen, privacy-filtered Session population. The binding must prevent an active
Session from entering the lead after it was omitted from facts, without
persisting or exposing the private inventory or weakening bounded lead
selection.

## Acceptance Scenarios

- AC-1: The bundle discovers the frozen Session population once, removes Qoder
  home-only sources and an exact explicit/provider active Session identity
  before either lane hydrates it, and supplies the same eligible snapshot to
  both collectors. With an explicit frozen `until`, exact identity exclusion
  remains enabled while recency-window inference remains disabled.
- AC-2: Public output contains only bounded, versioned bindings: frozen scope
  and omission policy/counts, eligible population count/fingerprint, Session
  all-eligible selection count/fingerprint, and lead bounded selection
  count/fingerprint with a parent-population assertion. It contains no raw
  Session IDs, source paths, prompts, commands, content, Memories, user-home
  payloads, reversible locators, or serialized snapshot.
- AC-3: Bundle validation fails closed with stable redacted error codes when a
  binding is missing or mismatched, a selected fingerprint is not a subset of
  its population, or admission counters do not reconcile. Session admission
  satisfies `taskEpisodes = candidateEpisodes + noRequest + selfAnalysis +
  lowSignal`, `candidateEpisodes = distinctRequests + duplicateRequests`, and
  `distinctRequests = emittedCandidates + candidateBudget`.
- AC-4: Lead admission satisfies `projectedEpisodes = admittedEpisodes +
  zeroSignalDiscardedEpisodes` and `admittedEpisodes = retained taskEpisodes`.
  Selected fingerprints remain lane-specific for bounded strategies; cross-lane
  Episode totals are compared only when selected and projection-policy
  fingerprints match. Legitimate zero-signal filtering remains valid.
- AC-5: Existing scoring, lead stratification and limits, raw-data exclusions,
  provider adapters, and standalone analysis commands remain unchanged.

## Non-Goals

- Reading or migrating raw Sessions, Memories, user-home content, private
  plugin data, or unsanitized generated reports.
- Persisting the shared population snapshot or exposing private identity data.
- All-eligible lead hydration, larger limits, weaker stratification, synthetic
  Task Episodes, or score/weight changes.
- Renderer accessibility work, Core Change Watch work, report edits, installed
  plugin-cache changes, releases, merges, or production publication.
- Provider-adapter changes or a new dependency.

## Plan And Tasks

Allowed files, copied verbatim from the approved Worker package:

1. `docs/specs/2026-07-30-session-population-binding.md`
2. `scripts/session-analysis/session-population.mjs`
3. `scripts/harness-analysis/evidence-bundle/contract.mjs`
4. `scripts/harness-analysis/evidence-bundle/index.mjs`
5. `scripts/harness-analysis/evidence-bundle/session-evidence.mjs`
6. `scripts/harness-analysis/report-run.mjs`
7. `scripts/harness-analysis/task-loop-source.mjs`
8. `test/session-population.test.mjs`
9. `test/better-harness-evidence-bundle.test.mjs`
10. `test/task-loop-source.test.mjs`
11. `CHANGELOG.md`
12. `docs/better-harness-doc-links.mmd`

Tasks:

1. Add sanitized fixtures for exact active-session exclusion, shared snapshot
   reuse, binding mismatch, admission reconciliation, and zero-signal filtering.
2. Preserve a test-only red run that demonstrates active-session divergence and
   missing fail-closed binding before production edits.
3. Implement the private population owner, public binding contract, shared
   orchestration, and bounded lead projection without persistence or new data
   authority.
4. Regenerate the Markdown routing graph, update the changelog, run focused and
   full gates, and mark this spec Implemented only after evidence passes.
5. Perform Review Readiness over the no-issue rationale, Spec, Tests, Risk, AI,
   Refs, generated files, and staged/unstaged boundaries before commit.

## Test And Review Evidence

- Red run: six focused tests failed for the intended missing owner, unshared
  population, non-failing mismatch, and unavailable zero-signal accounting
  before production edits.
- Focused binding tests: nine population, binding, active-session, count
  contradiction, frozen-inventory, and zero-signal tests pass.
- Full Session/bundle/source compatibility: 61/61 tests pass across
  `test/session-population.test.mjs`, `test/better-harness-evidence-bundle.test.mjs`,
  `test/task-loop-source.test.mjs`, and `test/harness-report-run.test.mjs`.
- Real target: a normal-depth Codex bundle for `database-caching` completed with
  both lanes available and the binding `bound`. It recorded exact active
  identity availability, omitted one active Session, bound four eligible
  Sessions to the same parent fingerprint, and reconciled four projected
  Episodes as four explicit zero-signal discards and zero retained Episodes.
- Privacy serialization audit: the focused bundle fixture proves neither the
  private inventory nor its Session IDs appear in serialized output; the real
  target inspection printed only versioned bindings and aggregate counters.
- Documentation: the canonical routing graph regenerated without drift and the
  six documentation checks pass.
- Package gate: `TMPDIR=<clean-temp-root> npm run check` passed 892/892 tests
  plus npm-package (321 entries) and runtime-zip (345 entries) verification.
- Review Readiness: the diff is confined to the approved owner/test/spec/
  changelog files; the optional contract and generated graph files were not
  changed. No dependency, provider adapter, scoring owner, generated report,
  installed cache, raw identity, or private payload changed. The commit must
  carry exactly one required Codex co-author marker.
