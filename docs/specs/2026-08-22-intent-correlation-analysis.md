# Intent correlation analysis

## Traceability

- Spec ID: `intent-correlation-analysis`
- Status: Implemented; qodercli provider remains experimental

## Intent

Build a reviewable evidence graph that connects user inputs, bounded execution,
change units, commits, artifacts, and validation outcomes without treating an AI
inference as source truth. Studio should preserve the deterministic Input Trace
and expose optional online analysis as a separate set of proposed claims.

The first consumer is Harness Studio's local workspace Inputs surface. The same
packet and result contracts must also be usable by the canonical
`intent-correlation-analysis` skill, an independent agent, and qodercli so that
the online path can be tested without depending on the Studio UI.

## Problem statement

The current Input Trace establishes an exact relationship between retained user
prompts and file operations, but it cannot answer whether a read or edit served
the prompt's main goal, a supporting goal, validation, incidental exploration,
or unrelated pre-existing work. File-level attribution also becomes ambiguous
when several inputs or concurrent changes touch the same file.

An AI can help interpret those relationships, but it must consume a frozen,
privacy-filtered evidence packet and emit claims that remain inspectable and
rejectable. It must not invent evidence, confirm its own conclusions, or silently
rewrite deterministic links.

## Data contract

### `IntentCorrelationPacketV1`

The packet is a bounded, canonical JSON projection. It contains no absolute
workspace paths and no unrestricted transcript. Every entity and observed edge
has a stable ref included in `allowedRefs`.

```ts
interface IntentCorrelationPacketV1 {
  kind: "IntentCorrelationPacketV1";
  schemaVersion: 1;
  packetDigest: string;
  workspace: { label: string };
  inputs: InputEvidence[];
  executionSlices: ExecutionSliceEvidence[];
  files: FileEvidence[];
  changeUnits: ChangeUnitEvidence[];
  commits: CommitEvidence[];
  artifacts: ArtifactEvidence[];
  validations: ValidationEvidence[];
  observedEdges: ObservedEvidenceEdge[];
  allowedRefs: string[];
  limitations: string[];
}
```

`ExecutionSliceEvidence` spans one retained user input until the next retained
user input in the same Session. Intent is correlated to this slice, not directly
to the whole Session. `ChangeUnitEvidence` is a hunk/blob delta where available;
an edit tool target without a verified delta is represented only as
`edit-targeted` evidence and never as `content-changed`.

### `IntentCorrelationAnalysisV1`

```ts
interface IntentCorrelationAnalysisV1 {
  kind: "IntentCorrelationAnalysisV1";
  schemaVersion: 1;
  packetDigest: string;
  intentProposals: IntentProposal[];
  claims: CorrelationClaim[];
  unassignedRefs: string[];
  unresolved: UnresolvedQuestion[];
}
```

Every claim has a subject, predicate, object, evidence refs, optional counter
evidence and alternatives, a bounded explanation, explicit limitations, and a
four-axis confidence vector (`semanticFit`, `temporalFit`, `changeFit`, and
`acceptanceFit`). There is no aggregate score. Evidence strength
(`direct`, `observed`, `correlated`, or `inferred`) and review state are separate.
Agent output is always `proposed`; only a later human or deterministic workflow
may confirm, reject, or supersede it.

Evidence validity is also topological: a claim must cite its subject directly or
an observed edge that names that subject. Merely citing a valid but unrelated
edge does not make the claim evidence-backed.

Allowed relationships include:

- input to intent: `creates`, `refines`, `constrains`, `clarifies`, `resumes`,
  `verifies`, or `meta`;
- change to intent: `implements`, `tests`, `documents`, `refactors`, `generated`,
  `incidental`, or `preexisting`;
- outcome to intent: `satisfies`, `partially-satisfies`, `conflicts`, or
  `unverified`.

## Acceptance scenarios

### AC-1: deterministic evidence boundary

Given an Inspector-derived Input Trace, the packet builder produces bounded
repository-relative refs, preserves observed links and limitations, and does not
promote a failed or unverified edit target to a content change.

### AC-2: reviewable AI output

Given a valid packet, the skill produces `IntentCorrelationAnalysisV1` with only
allowed refs and predicates, at least one evidence ref per claim, explicit
limitations, no aggregate score, and `reviewStatus: "proposed"`.
For a non-empty packet, a formally valid but empty result is rejected; online
analysis works on an explicitly bounded recent-input batch while the deterministic
Inputs view continues to show the full retained trace.

### AC-3: fail-closed validation

The deterministic validator rejects unknown refs, absolute paths, invented
review states, unsupported predicates, unbounded explanations, digest mismatch,
and content-change claims supported only by `edit-targeted` evidence. Unassigned
evidence is valid.

### AC-4: independent agent forward test

An isolated sub-agent receives a realistic packet and the installed skill but no
expected answer. Its output passes the deterministic validator and preserves at
least one meaningful ambiguity rather than forcing every ref into an Intent.

### AC-5: qodercli forward test

qodercli runs from a neutral temporary directory with this repository as its
plugin source and the packet as its only task attachment. Its JSON output passes
the same validator. Plugin validation and the skill's structural validation also
pass.

### AC-6: Studio online analysis

When a local workspace with Input Trace evidence is open and an analyzer is
configured, `POST /api/intent-analysis` builds a server-side packet, calls the
analyzer once, validates its result, and returns it with no-store headers. The
browser displays proposed Intent relationships separately from observed file
links. Cross-origin requests and concurrent runs fail closed.

### AC-7: unavailable analysis remains honest

When no analyzer is configured, the Inputs surface remains fully usable and the
endpoint returns a capability error. Tests inject a deterministic analyzer and
do not require a live model.

## Plan

1. Add the canonical skill, claim-contract reference, packet fixture, validator,
   and behavior tests.
2. Run structural validation, an isolated sub-agent forward test, and qodercli
   forward test; revise only from observed failures.
3. Add shared TypeScript packet/result types and a bounded packet projection from
   `UserInputTraceV1`.
4. Add an injectable Studio analyzer seam and same-origin online endpoint.
5. Add an Inputs toolbar action and a docked proposed-claims pane with loading,
   unavailable, error, and result states.
6. Run focused unit/server/browser checks, doc-link checks, plugin validation,
   and Review Readiness.

The repository workspace launcher keeps the qodercli provider behind the
explicit `--intent-analysis` flag until realistic current-project forward tests
show stable contract-valid output. The injectable server seam and browser states
remain available to other validated providers.

## Non-goals

- Automatically creating canonical Intent records or changing review state.
- Claiming commit authorship from time/path correlation.
- Reconstructing missing hunks from a current worktree snapshot.
- Sending unrestricted transcripts, absolute paths, secrets, or file contents to
  the analyzer.
- Forcing every input, file, commit, or artifact into an Intent.
- Replacing the existing exact Input Trace or generic Harness evaluation score.
- Adding a new Coding Agent host adapter.

## Risks and controls

- **Plausible but unsupported narratives:** refs and predicates are validated;
  every claim needs cited evidence and limitations.
- **False change attribution:** `edit-targeted` and `content-changed` are distinct,
  and the validator forbids escalation without a delta ref.
- **Prompt injection in retained prompts:** the skill treats packet text as
  untrusted evidence, not instructions, and the online adapter runs with no
  workspace tools.
- **Privacy leakage:** packet fields are bounded and repository-relative; the
  validator rejects native absolute paths.
- **Online instability:** Studio uses an injectable provider, rejects overlapping
  runs, and keeps observed evidence usable when analysis fails.

## Test and review evidence

- Skill structure: `quick_validate.py` passed; `qodercli plugin validate` loaded
  both canonical skills. The pre-existing manifest-field warnings remain
  unchanged.
- Deterministic claim validator: behavior tests cover unknown and unrelated
  refs, edit-target escalation, self-confirmation, aggregate-score, and empty
  result rejection.
- Blind sub-agent: the updated FileEvidence fixture passed with 1 proposed
  Intent, 4 claims, and 2 unresolved questions; it left the delta-less App.tsx
  target unassigned.
- qodercli fixture: a neutral-directory run passed the same validator with 2
  proposed Intents, 4 claims, and 2 unresolved questions after being allowed to
  execute the local gate.
- Studio model/server/shell: 53 focused tests passed. The endpoint accepted a
  valid injected provider, rejected self-confirmation with 502, returned
  no-store, and blocked cross-origin analysis.
- Browser: the focused Inputs Playwright scenario passed at 1440x900, 900x760,
  and 390x844 with the proposed-claim pane visible, no document overflow, and
  no console/page errors.
- Current-project deterministic projection (latest observed during this work):
  67 Sessions and 286 retained inputs; the online batch was bounded to the 8
  most recent inputs, 24 files, 28 edit targets, and 37 observed edges, with no
  absolute workspace path and no edit target promoted to a delta.
- Current-project qodercli evidence did **not** meet the production gate. Across
  the initial result and two correction prompts it separately attempted an
  `edit-targeted -> implements` promotion, overstated evidence strength, and
  emitted malformed alternatives. Every result failed closed. Therefore the
  repository workspace launcher exposes qoder analysis only with explicit
  `--intent-analysis`; it is not enabled by default.
- A concurrent Artifact Code/Diff edit briefly introduced an unrelated type
  error during review, but its owner completed that change before handoff. The
  final Studio typecheck and clean build both passed.
- The exact staged tree, isolated from concurrent Artifact/Markdown changes,
  passed Studio typecheck, clean build, all 175 unit/server tests, and the
  focused Inputs Playwright scenario.
