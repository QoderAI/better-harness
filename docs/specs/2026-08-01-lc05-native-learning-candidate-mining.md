# Native Learning Candidate Mining

## Traceability

- Spec ID: `lc05-native-learning-candidate-mining`
- Roadmap: `LC-05`
- Status: Implemented

## Intent

Allow ordinary normalized Task Episodes to produce evidence-bound Learning Loop
candidate inputs without requiring an adapter-supplied `learningPatternId`.
The first slice deterministically prepares a bounded, privacy-safe review packet,
accepts an external review decision of `match` or `abstain`, validates that
decision against the packet, and then feeds accepted signals through the existing
`buildLearningLoopReview()` contract.

This is a read-only discovery method. It may identify an `opportunity`, but it
does not call a model, mutate a Harness asset, authorize an intervention, or
claim that an intervention is effective.

## Acceptance Scenarios

- **AC-1: Bounded ordinary-Episode packet:** Given normalized Task Episodes
  with no adapter-supplied `learningPatternId`, deterministic screening emits a
  versioned review packet containing only bounded structural facts, Task Episode
  ids plus opaque evidence aliases, allowed review enums, a source binding over
  only those projected privacy-safe facts, and a packet digest. Raw Episode,
  prompt, path, or transcript content is never directly hashed. Input Episode
  order does not change the packet or digest.
- **AC-2: First-slice pattern boundary:** A reviewed native match can produce
  only `recurring-correction`, backed by an ordinary Episode's explicit
  correction observation or exact failure-edit-same-check-rerun repair shape.
  Provider-supplied `repeated-rediscovery` signals remain supported by the
  existing path, but native rediscovery waits for a privacy-safe work/read trace.
  The resulting native signal has
  `ai-reviewed` field provenance and remains an `opportunity`; no readiness or
  effectiveness claim is produced.
- **AC-3: Match and abstain:** Every deterministically screened group receives
  exactly one `match` or `abstain` decision. A match requires at least two
  distinct Episode refs and evidence from every referenced Episode. Missing,
  incomplete, or insufficiently comparable evidence must remain an abstention
  or an explicit non-clean coverage reason.
- **AC-4: Hard-negative identity boundary:** Episodes are not grouped merely
  because both failed. They need a shared privacy-safe request/task route,
  target, or check identity plus structural friction. Different task, target,
  and check identities therefore abstain before AI review. Route and target
  identity are only available on the report-source Episode projection that
  carries `taskRoute` and `targetKeys`; the `buildTaskEpisodes()` contract shape
  supplies check identity only, so screening it groups on `same-check` alone.
- **AC-5: Protective behavior exclusion:** Permission, Hook, or Guardrail
  denials identified as protective interventions are retained as a minimal
  ordinary Task Episode fact, excluded from native friction groups, and cannot
  become learning candidates.
- **AC-6: Deterministic binding:** Review decisions may reference only group,
  Episode, evidence, pattern, and reason values allowed by the packet. Unknown
  or invented refs, a stale source/packet digest, duplicate decisions, or
  decision/group mismatches fail closed before candidate construction.
- **AC-7: Existing signal compatibility:** Provider-supplied learning signals
  and the historical flat event-to-`learningSignals` path remain supported.
  Missing `userCorrection` stays unavailable instead of being materialized as
  observed false, while explicit false and true values retain provenance.
  Applying a native review appends rather than replaces signals and avoids
  duplicating an equivalent provider/native pattern and signature.
- **AC-8: Boolean evidence states:** Missing observations are represented as
  `unavailable`, not coerced to `false`; explicitly observed false and true
  values remain distinguishable through field provenance or field-coverage
  evidence in packet facts and validation.
- **AC-9: Privacy boundary:** Packet and apply output contain no raw prompt,
  command, transcript, session identifier, credential, email address, or
  Windows, POSIX, or UNC home path. `episodeRef` is the Task Episode id, which
  the Episode contract already emits as `episode:<fingerprint>`, so it is
  privacy-safe without further aliasing and stays resolvable for an authorized
  caller. Evidence refs are opaque aliases that bind privacy-safe source
  evidence IDs or public fingerprints, and each bounded Episode fact carries an
  aggregate digest over the complete accepted identity set. A change outside
  the displayed evidence limit therefore still invalidates an old review.
  Apply output keeps evidence aliases and the aggregate binding opaque; an
  authorized caller can deterministically re-derive the association from the
  source, but the public artifact never resolves or exposes raw evidence IDs.
- **AC-10: Evaluation fixtures:** Positive and hard-negative fixtures report
  expected match, abstain, and coverage counts for native
  `recurring-correction` plus legacy-signal compatibility,
  including single-Episode, protective-intervention, unrelated-failure,
  reordered-input, invented-ref, legacy/native-deduplication, tri-state boolean,
  and privacy-sentinel cases.

## Non-goals

- Do not call an AI model or add provider-specific model routing.
- Do not natively infer patterns beyond first-slice `recurring-correction`.
- Do not natively infer `repeated-rediscovery` from repair, tool-count, or
  target-overlap proxies; add it only after an ordinary privacy-safe work/read
  trace exists. Existing provider-supplied signals remain supported.
- Do not auto-create or modify Memory, Rule, Skill, Hook, Gate, Eval, or other
  Harness components.
- Do not run, schedule, retain, or revert an intervention.
- Do not claim effectiveness, transfer, causality, or cost savings.
- Do not expose raw transcript text to the reviewer.
- Do not replace adapter-supplied learning signals or broaden provider adapters.
- Do not change the report-source schema or automatically insert unreviewed
  native candidates into normal report generation.

## Plan and Tasks

1. Add a capability-owned Learning Loop review-packet module under
   `scripts/harness-analysis/`. It normalizes only privacy-safe structural
   Episode facts, screens bounded comparable pairs, builds opaque evidence alias
   maps by deterministic recomputation, and publishes the allowed decision
   contract.
2. Extend the existing capability owner in `learning-loop-candidates.mjs` with a
   deterministic apply API that validates source and packet digests, exact
   decision coverage, enum domains, distinct Episode membership, evidence
   ownership, privacy-safe reason codes, and the packet allowlist.
3. For accepted matches, append bounded `learningSignals` to cloned Episodes,
   preserve provider signals, reuse an equivalent provider signature when all
   matched Episodes already carry it, and invoke the existing
   `buildLearningLoopReview()` implementation.
4. Add focused fixtures that measure positive matches and abstentions while
   exercising hard negatives, privacy sentinels, binding failures, signal
   compatibility, and deterministic ordering.
5. Run focused tests, document-link integrity, the full test suite, and package
   verification. Perform a Review Readiness Check before any commit.

## Privacy and Risk

- **False grouping:** Shared failure status alone can merge unrelated work.
  Mitigation: require shared normalized task/target/check identity and explicit
  structural friction, then require an evidence-bound human/AI match decision.
- **Protective behavior mislabeled as waste:** Permission and Hook denials can
  be expected safeguards. Mitigation: protective signals fail closed out of
  native groups.
- **Reviewer invention:** A reviewer could add Episode or evidence refs that
  were never observed. Mitigation: opaque allowlists, per-Episode evidence
  ownership, exact group membership, and digest binding.
- **Private content leakage:** Episode IDs, source refs, paths, credentials, or
  text could escape through packets or signatures. Mitigation: fingerprint-only
  Episode ids, opaque evidence aliases, enum-only reviewer prose, no raw text
  fields, privacy sentinel validation, deterministic signatures, and source
  binding over projected safe facts only.
- **Overstated coverage:** Truncation or absent observations could look clean.
  Mitigation: explicit `unavailable`, `insufficient-*`, and `truncated` coverage
  codes; the method never emits `checked-clean` for missing or truncated facts.
- **Contract regression:** Native signals could overwrite or duplicate provider
  signals. Mitigation: clone-and-append semantics and equivalent-signal dedupe.

## Test and Review Evidence

Planned evidence, to be replaced or augmented only by actual command results:

- AC-1, AC-4, AC-5, AC-8, AC-9:
  `node --test test/native-learning-candidate-review.test.mjs`
- AC-2, AC-3, AC-6, AC-7, AC-10:
  `node --test test/native-learning-candidate-review.test.mjs test/learning-loop-review.test.mjs`
- Documentation integrity:
  `node --test test/doc-link-graph.test.mjs`
- Repository regression evidence: `npm test`
- Packaged-runtime evidence: `npm run pack:verify`

## Implementation Evidence

- `learning-loop-review-packet.mjs` owns the versioned privacy-safe projection,
  deterministic screening, membership-independent pattern signature, bounded
  coverage, digest binding, and packet replay validation (AC-1, AC-3 to AC-6,
  AC-8, AC-9).
- `learning-loop-candidates.mjs` exposes the packet API through the existing
  Learning Loop owner and applies reviewed matches through
  `buildLearningLoopReview()` while preserving and deduplicating provider
  signals (AC-2, AC-6, AC-7).
- `episode-contract.mjs` records an ordinary Episode's protective-intervention
  observation and keeps a provider's missing `userCorrection` observation
  unavailable instead of coercing it to false (AC-5, AC-8).
- `native-learning-candidate-review.test.mjs` uses ordinary
  `buildTaskEpisodes()` failure-edit-same-check-rerun events with no
  `learningSignals` for the native positive path. It also covers three-Episode
  grouping, hard negatives, ordinary Hook protection, abstention shape,
  invented refs, evidence-identity replay binding inside and beyond the bounded
  display limit, per-Episode evidence ownership, mixed correction/repair
  friction, distinct-Episode handling, tri-state observations, privacy
  sentinels, truncation, reorder stability, and legacy/flat-signal compatibility
  (AC-1 to AC-10).
- Focused evidence passed after the independent-review revisions: 37/37 tests
  from
  `node --test test/native-learning-candidate-review.test.mjs test/learning-loop-review.test.mjs test/session-episode-contract.test.mjs`.
- Documentation integrity passed: 6/6 tests from
  `node --test test/doc-link-graph.test.mjs`.
- The final post-review full `npm test` completed with 1053 passing, 4 failing,
  and 6 skipped tests.
  All four failures are pre-existing Windows `EPERM` failures where the local
  account cannot create test symlinks; none touch the changed modules or focused
  LC-05 tests.
- Final package verification passed with an isolated temporary npm cache
  configuration; `npm run pack:verify` verified 369 npm entries and 392 runtime
  ZIP entries.
- `git diff --check` passed. No generated documentation graph changed, and no
  files are staged in this worktree.
