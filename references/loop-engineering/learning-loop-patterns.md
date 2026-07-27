# Learning Loop Detection Patterns

Use this reference from the
[Learning Capture review procedure](../../models/agent-work-loop.md#review-procedure)
when a bounded observation window needs better recall without weakening the
longitudinal effectiveness gate.

This file owns pattern signatures, evidence thresholds, claim classification,
negative controls, and coverage reason codes. It does not own transcript
parsing, durable-owner selection, Skill design, intervention outcomes, or
reader projection. Use [Loop Discovery](loop-discovery.md) for the smallest
durable owner after a candidate is supported.

## Claim boundary

- `opportunity`: one window shows repeatable friction, correction, exploration,
  omission, or a reusable success that was not reused.
- `readiness`: one window shows a broken capture, codify, route, exercise,
  evaluate, or maintain stage around an intervention or durable asset.
- `effectiveness`: a comparable later or held-out window shows benefit without
  guardrail regression. Only the intervention ledger may make this claim.

An Opportunity or Readiness candidate never means that the proposed repair is
effective. `brokenStage` is an internal diagnostic: `capture`, `generalize`,
`codify`, `route`, `exercise`, `evaluate`, or `maintain`. Outcome state remains
owned by the intervention ledger.

## Evidence fields

Normalize bounded Task Episodes before pattern matching. Keep these provenance
classes distinct:

- `host-observed`: explicit invocation, read, token, delivery, or host version
  evidence exposed by the active adapter.
- `deterministic-derived`: timestamps, counts, edits, validation closure,
  redacted target keys, or signatures derived only from normalized facts.
- `ai-reviewed`: task family, semantic correction equivalence, friction type,
  procedure equivalence, or a reviewed signature.
- `unavailable`: the active host or observation boundary does not expose the
  field.

Every normalized signal records field provenance, field coverage, bounded
evidence refs, and a normalization version. Asset-specific signals also carry
a redacted kind/ref/scope plus current-truth, required-step, update, and later
outcome references when available. Never treat a guessed task family, raw
transcript phrase, configured asset count, or aggregate friction count as a
deterministic fact.

## Detector MVP

Two independent, comparable Task Episodes with the same reviewed signature are
the default recurrence threshold. Three episodes, or two with the same explicit
user correction, raise confidence. A single severe safety event may create a
Readiness candidate but must not be called repeated.

Protective Hook/Gate blocks are successful controls, not friction. Only an
explicitly reviewed false positive may enter a correction or control-repair
candidate.

| Pattern | Required signature | Claim | Broken stage | Negative control |
| --- | --- | --- | --- | --- |
| `repeated-rediscovery` | Two episode refs share reviewed task/target and discovery-friction signature | opportunity | generalize | Repeated edits or reads alone |
| `recurring-correction` | Two episode refs share a semantically equivalent explicit user/reviewer correction | opportunity | generalize | Two unrelated validation failures |
| `present-but-not-routed` | Relevant asset is inspected as present; matching task and invocation evidence explicitly show it was not selected | opportunity | route | Inventory with missing invocation events |
| `routed-but-not-applied` | Relevant asset was loaded and the required reviewed step was explicitly not followed | opportunity | exercise | Loaded asset with missing adherence instrumentation |
| `stale-or-conflicting-asset` | A named asset conflicts with current repository truth or a newer governed record | readiness | maintain | File age without a scoped comparison |
| `cross-asset-duplication-or-contradiction` | Two named assets overlap or disagree on the same matching task route | readiness | maintain | Similar wording without a matching task |
| `correction-not-promoted` | Two equivalent corrections have no reviewed discoverable update in their declared owner | opportunity | codify | One correction or an update in another scope |
| `asset-updated-not-reexercised` | A named durable-asset update has no comparable later task evidence | readiness | exercise | A commit or release without a later task |
| `wrong-durable-owner` | A reviewed mandatory invariant depends only on optional guidance | readiness | maintain | Optional convenience guidance in a Skill |
| `unvalidated-intervention` | A declared intervention remains pending without a comparable later result | readiness | evaluate | A valid pending window described as regression |

The broader catalog remains review-only until normalized evidence exists:
`successful-procedure-not-reused`, `local-gain-without-transfer`,
`context-or-skill-regression`, and `unsafe-mutable-memory`. Add deterministic
detection only with positive and negative fixtures plus a source field that
distinguishes observed, partial, and unavailable evidence.

## Coverage reason codes

Always emit coverage, even when no candidate exists:

| Area | Reason codes |
| --- | --- |
| asset coverage | `checked-clean`, `not-evaluable-missing-asset-inventory` |
| capture | `checked-clean`, `not-evaluable-missing-normalized-events` |
| pattern detection | `candidate-found`, `insufficient-episodes`, `insufficient-recurrence` |
| routing | `checked-clean`, `not-evaluable-missing-invocation-events` |
| freshness | `checked-clean`, `candidate-found`, `not-evaluable-missing-freshness-evidence` |
| application | `checked-clean`, `not-evaluable-missing-application-events` |
| evolution | `candidate-found`, `not-evaluable-missing-update-evidence`, `pending-no-later-window`, `comparable-result-observed` |
| effectiveness | `comparable-result-observed`, `pending-no-later-window` |
| memory governance | `checked-clean`, `not-evaluable-missing-memory-policy` |

`checked-clean` means the named check had usable evidence and found no supported
candidate. It does not mean the whole repository is clean.

## Candidate contract

Each candidate contains:

```yaml
id: learning-loop:recurring-correction:<signature>
patternId: recurring-correction
claimType: opportunity
provenance: ai-reviewed
sourceEpisodes: [episode-a, episode-b]
taskFingerprint:
  family: reviewed-task-family
  repoArea: redacted-or-reviewed-area
normalizedSignature: reviewed-signature
asset:
  kind: Rule
  ref: redacted-stable-asset-ref
  scope: project
  currentTruthRefs: []
  requiredStepRefs: []
  updateEvidenceRefs: []
  outcomeEvidenceRefs: []
observedBehavior: concise evidence-bound statement
currentCost:
  episodeCount: 2
  toolCalls: 8
  elapsedMs: 120000
  tokens: 0
  userCorrections: 2
candidateCauses: [reviewed candidate cause]
brokenStage: generalize
recommendedOwner: Rule
intervention: smallest bounded move
primaryMetric: recurrence cost on comparable tasks
guardrails: [false trigger rate, unrelated-task token overhead]
stopOrRevert: explicit narrowing or rollback boundary
confidence: high
priorityScore: 24
evidenceRefs: []
```

`recommendedOwner` is a handoff, not a local decision table. Resolve it through
Loop Discovery. Optional guidance may remain a Skill; mandatory invariants must
not depend only on optional retrieval and normally require a Hook or Gate.

## Review and projection

1. Validate normalized episode fields and coverage.
2. Cluster only explicit signatures; do not cluster raw transcript text.
3. Apply every MVP pattern and its negative control.
4. Separate Opportunity and Readiness from ledger-owned Effectiveness.
5. Route candidate ownership through Loop Discovery.
6. Rank by recurrence, observed cost, confidence, and leverage.
7. Deduplicate one causal chain and preserve every supported candidate in the
   longitudinal diagnostic contract. Project it into Learning Capture's
   lifecycle/repeat detection check when recurrence is supported, into Loop
   Engineering only after the reusable owner and operating pattern are reviewed,
   and into later validation only through the applicable comparison boundary;
   priority moves may still show only the top three.

When no candidate is selected, preserve the reason codes. Missing invocation,
memory-read, adherence, version, token, or later-window evidence is an
observability boundary, not proof that the asset was unused or ineffective.
