# Restore actionable Memory duplicate review

## Traceability

- Spec ID: restore-memory-duplicate-review
- Status: Implemented

## Intent

Restore duplicate-Memory review as a visible, actionable Harness finding
without treating every title similarity as a content duplicate. Exact title
collisions inside the same Memory scope should reach the prioritized repair
flow, while cross-scope names and near-title matches remain provisional leads.

The generated AI Fix Prompt must perform a bounded semantic and provenance
review before changing Memory. It must preserve current authoritative guidance,
intentional variants, and privacy boundaries instead of merging or deleting a
note from title metadata alone.

## Acceptance Scenarios

- AC-1: Two normalized-identical Memory titles in the same scope emit a
  `warning` integrity candidate and project as one ordinary `Medium` Memories
  finding.
- AC-2: A normalized-identical title found only across different scopes, or a
  high-similarity title pair, remains `advisory` and projects as `Low` when no
  stronger candidate is present.
- AC-3: The Memories AI Fix Prompt asks the repair agent to compare the bounded
  candidates' scope, provenance, freshness, and operational meaning; classify
  each group as duplicate, partial overlap, conflict, or intentional
  coexistence; and keep current instructions and repository truth authoritative.
- AC-4: The prompt does not authorize a title-only deletion. It requires an
  explicit Memory-mutation request before merge, rename, or removal, retains
  non-conflicting information and provenance, and keeps raw Memory bodies and
  private paths out of the handoff.
- AC-5: Focused integrity, practice-finding, and final-report tests preserve the
  existing metadata-only deterministic scan and the Plugin/Hook calibration.

## Non-goals

- Do not read Memory bodies in the deterministic asset-integrity pass.
- Do not automatically merge, delete, or rewrite Memory during report
  generation.
- Do not elevate cross-scope overrides or near-title similarity without
  independent evidence.
- Do not change Plugin or Hook severity, report schema, or Canvas layout.

## Plan and Tasks

1. Distinguish same-scope exact-title collisions from cross-scope title matches
   while preserving the bounded, metadata-only index.
2. Restore `warning` only for same-scope exact collisions and expose an additive
   diagnostic count for that class.
3. Give grouped Memories findings calibrated title/reason copy and a dedicated
   bilingual AI Fix Prompt instead of the generic asset-integrity prompt.
4. Update the Memory review reference and focused tests for warning/advisory,
   grouped severity, prompt safety, and final projection.

## Test and Review Evidence

- AC-1/AC-2: `node --test test/agent-asset-integrity.test.mjs` covers same-scope
  exact collisions, cross-scope exact matches, and near-title candidates.
- AC-3/AC-4: `node --test test/practice-findings.test.mjs` checks the dedicated
  Chinese and English prompt boundaries and preserves a Low near-title-only
  finding.
- AC-5: `node --test test/task-loop-report.test.mjs` confirms the ordinary
  finding reaches the final report; `node --test test/doc-link-graph.test.mjs`
  and `git diff --check` cover reference and formatting integrity.

Primary risks are false-positive prioritization, accidental disclosure of
Memory content or paths, and destructive cleanup from metadata-only evidence.
The same-scope boundary, bounded semantic review, explicit authorization gate,
and focused regression tests mitigate those risks.

Implementation evidence on 2026-07-22:

- In the isolated commit snapshot, syntax checks for both changed scripts and
  the focused asset-integrity, practice-finding, final-report, and documentation
  suites passed 81/81. `git diff --check` also passed.
- The same clean snapshot passed 767/770 full-repository tests. The remaining
  three host-plugin tests require
  `skills/loop-blueprint/agents/openai.yaml`, which is absent from the committed
  baseline and unrelated to this Memory review change.
- `npm run pack:verify` reported the same missing package entry, while
  `qodercli plugin validate .` passed its more permissive compatibility check.
