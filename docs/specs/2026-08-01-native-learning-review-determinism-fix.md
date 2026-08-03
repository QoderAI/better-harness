# Native Learning Review Determinism and Contract Repair

## Traceability

- Spec ID: `native-learning-review-determinism-fix`
- Refs: `docs/specs/2026-08-01-lc05-native-learning-candidate-mining.md` (LC-05)
- Status: Implemented

## Intent

Repair defects found while reviewing the LC-05 native Learning Capture slice. The
method already screens ordinary Task Episodes and validates evidence-bound
decisions, but three behavior defects and two contract inaccuracies survived the
first slice:

1. Applying a native review flipped the whole Learning Loop review to `reviewed`,
   which makes unrelated provider candidates fail `validateLearningLoopReview()`.
2. The reused-signature lookup read Episode signals that the same apply loop had
   already appended, so identical decisions in a different order produced
   different candidates.
3. Screening emitted overlapping groups, so one Episode could be counted in two
   candidates for the same repair route.
4. Protective-intervention screening probed field names no canonical owner emits.
5. The spec described Episode refs as opaque aliases although the packet passes
   the Task Episode id through unchanged.

## Acceptance Scenarios

- **AC-1: Applied review keeps the Learning Loop status honest:** Applying a
  native review leaves `learningLoop.status` at `candidate` because only the
  native groups were reviewed. The applied envelope keeps its own `reviewed`
  status, and the embedded Learning Loop passes `validateLearningLoopReview()`
  even when unreviewed provider candidates for asset-specific patterns are
  present.
- **AC-2: Decision order does not change the outcome:** For one packet and one
  set of decisions, reordering `review.decisions` produces an identical applied
  result, including match signatures, candidate count, and priority scores.
  Signature reuse considers only signals present in the input Episodes, never a
  signal appended by an earlier decision in the same apply call.
- **AC-3: Groups do not overlap by subsumption:** When one screened group's
  Episode set is a strict subset of another group's set with no additional
  allowed pattern, only the larger group is published. The packet records
  `subsumed-group-collapsed` in coverage reason codes, and group-limit truncation
  stays distinct from subsumption collapse.
- **AC-4: Protective screening reads canonical fields only:** Protective state is
  derived from `episode.protectiveInterventionObserved`,
  `permissionSummary.protectedActions`, `permissionSummary.denied`, and a
  `protective-intervention` friction signal. Fields no canonical owner emits are
  no longer probed, and a Task Episode produced by `buildTaskEpisodes()` from
  blocked Hook events is excluded from native groups.
- **AC-5: Episode ref contract is stated accurately:** Documentation states that
  `episodeRef` is the Task Episode id, which is already a fingerprint, while
  evidence refs are opaque aliases. No claim is made that Episode refs are
  aliased or unresolvable.
- **AC-6: Identity coverage is exercised:** Fixtures cover `same-target` and
  `same-task-route` grouping on the report-source Episode shape that carries
  `targetKeys` and `taskRoute`, alongside the existing check-identity path.

## Non-goals

- Do not add a CLI subcommand, skill routing, or report wiring for the native
  method; the capability stays library-level in this slice.
- Do not broaden native pattern inference beyond `recurring-correction`.
- Do not change the review packet schema version; the group set narrows but no
  field is added or removed from a group.
- Do not change provider adapters or the report-source schema.

## Plan and Tasks

1. Compute reused signatures for every matched group from the pre-mutation
   Episode snapshot, skip signals carrying `nativeReview`, and drop the global
   Learning Loop status override in `learning-loop-candidates.mjs`.
2. Collapse subsumed screening groups in `learning-loop-review-packet.mjs` before
   the group limit applies, and report the collapse in coverage reason codes.
3. Replace the speculative protective-field probes with the canonical fields.
4. Correct the LC-05 spec wording about Episode refs and record which Episode
   shapes supply route and target identity.
5. Add regression fixtures for status honesty, decision-order stability,
   subsumption, canonical protective observation, and route/target grouping.

## Privacy and Risk

- **Narrower group set:** Collapsing subsumed groups removes review items. The
  larger group always retains every Episode and evidence ref of the collapsed
  one, so no evidence becomes unreviewable.
- **Behavior change for existing callers:** No shipped caller consumes the native
  API yet, so the applied-status change cannot regress a report. The Learning
  Loop review returned by `buildLearningLoopReview()` is unchanged.
- **Packet digest change:** Fixtures that hard-code a digest over an overlapping
  group set must be regenerated; digests are recomputed from source in
  validation, so no stored artifact can silently pass.

## Test and Review Evidence

- AC-1 to AC-4, AC-6: `node --test test/native-learning-candidate-review.test.mjs`
  passed 21/21, including six new fixtures for status honesty, decision-order
  stability, subsumption collapse, blocked-Hook exclusion, denied-permission
  exclusion, and route/target grouping.
- AC-2 and existing Learning Loop contract:
  `node --test test/native-learning-candidate-review.test.mjs test/learning-loop-review.test.mjs test/session-episode-contract.test.mjs test/report-source-review.test.mjs test/learning-loop-contract.test.mjs`
  passed 91/91.
- Repository regression: `npm test` passed 1085/1085 with 0 failures and 0 skips
  on macOS.
- Reproduction before the fix: applying a review returned `errors: []` while
  `validateLearningLoopReview()` reported
  `candidates[0].asset is required for a reviewed asset-specific candidate`, and
  reversing `review.decisions` changed a two-group packet from one candidate
  (priority 18) to two candidates (priority 18 and 12). Both reproductions now
  fail closed as regression assertions.

## Out of Scope Follow-ups

- The native method still has no CLI subcommand, skill routing, or reference doc,
  so no shipped agent path can reach it. Track wiring in a later LC slice.
- `sourceDigest` duplicates the coverage of `packetDigest`; collapsing them needs
  a packet schema version bump.
