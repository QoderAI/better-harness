# Fail-closed Loop Runtime Readiness Gate

Add a versioned, machine-readable readiness contract and a deterministic
evaluator that decides whether a proposed loop run level is allowed, before any
mutating or scheduled workflow exists. This implements roadmap item `LC-01`.

## Traceability

- Spec ID: 2026-07-31-lc01-loop-readiness-gate
- Story: roadmap `LC-01` (roadmap ID, not a GitHub issue)
- Status: Implemented

## Intent

The [roadmap](../../roadmap.md) requires that no mutating runtime may bypass
`LC-01`, and `LC-06`/`LC-07` depend on it. Today the repository documents an
automation readiness contract in prose
([Automation Readiness](../../references/loop-engineering/automation-readiness.md))
but has no executable owner: nothing can distinguish read-only observation from
plan-only or approved-apply runs, and nothing prevents a run when a required
capability is `blocked`, `partial`, `unavailable`, or `failed`.

This spec adds the smallest executable gate: a versioned readiness-level
contract, a per-level required-capability matrix, and a pure
assessment-in/decision-out evaluator with a parser-safe CLI. The gate makes no
observations itself; callers declare capability observations and the gate fails
closed on anything missing or invalid.

## Readiness Contract (v1)

Readiness levels (ids are stable contract values; levels are independent
contract values under a partial order — `plan-only` and `scheduled-read-only`
are not comparable — so implementations must not introduce a numeric level
ranking):

| Level id | Meaning |
| --- | --- |
| `read-only-observation` | Read workspace and provider evidence; write nothing outside the run directory. |
| `plan-only` | Additionally produce a plan artifact; apply nothing. |
| `human-approved-apply` | Execute a bounded, human-approved apply with isolation and rollback. |
| `scheduled-read-only` | Recurring observation without a human in the loop. |
| `scheduled-bounded-apply` | Recurring bounded apply; strictest requirement set. |

Capability observation states: `available`, `partial`, `unavailable`,
`blocked`, `failed`. A required capability that is not `available` — including
one simply absent from the assessment — prevents the applicable level.

Required-capability matrix (v1):

| Capability id | read-only-observation | plan-only | human-approved-apply | scheduled-read-only | scheduled-bounded-apply |
| --- | --- | --- | --- | --- | --- |
| `workspace-read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `evidence-source` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `privacy-boundary` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `plan-artifact-write` | | ✓ | ✓ | | ✓ |
| `human-approval` | | | ✓ | | ✓ |
| `isolated-execution` | | | ✓ | | ✓ |
| `frozen-pre-state` | | | ✓ | | ✓ |
| `validation-route` | | | ✓ | | ✓ |
| `rollback-reference` | | | ✓ | | ✓ |
| `schedule-trigger` | | | | ✓ | ✓ |
| `stop-condition` | | | | ✓ | ✓ |
| `triage-path` | | | | ✓ | ✓ |
| `budget-policy` | | | | ✓ | ✓ |
| `idempotent-recovery` | | | | | ✓ |

Capability id sources (one row per id, so reviewers can audit the derivation):

| Capability id | Source clause |
| --- | --- |
| `workspace-read`, `evidence-source` | Automation Readiness fields 1 (Target) and 5 (Input pack) |
| `privacy-boundary` | Automation Readiness field 9 (Risk boundary); roadmap invariant "Raw private transcripts … never enter public artifacts" |
| `plan-artifact-write`, `validation-route` | Automation Readiness fields 6 (Sandbox) and 7 (Validation) |
| `human-approval` | Automation Readiness field 6; roadmap Open Decision "Should any provider support automatic apply?" |
| `isolated-execution`, `frozen-pre-state`, `rollback-reference` | Roadmap invariant "Every mutation has a frozen pre-state, explicit authority, isolated execution, objective validation, and a resolvable rollback or compensation boundary" |
| `schedule-trigger`, `stop-condition`, `triage-path`, `budget-policy` | Automation Readiness fields 2 (Trigger), 10 (Stop condition), 8 (Triage path); roadmap invariant "Every loop declares a trigger, … budget, stop condition, and human gate where required" |
| `idempotent-recovery` | Roadmap Non-goal "Do not enable scheduled bounded apply before the readiness, isolation, approval, idempotency, stop, and rollback contracts pass" and the `LC-06` acceptance row |

Intentional v1 narrowing (explicit, so later versions do not treat these as
omissions): the loop-invariant items `stable input`, `state policy`,
`observability`, and `evaluation` are runtime-lifecycle concerns owned by
`LC-06` (state, journal) and `LC-04`/`LC-10` (evaluation, budget accounting
semantics); v1 gates only pre-run readiness. The Automation Readiness field
`Run scope` describes an execution shape, not a readiness capability, and maps
to `LC-06` run forms. `human-approved-apply` does not require `stop-condition`
or `triage-path` because a single approved bounded apply is not a loop; the
mutation invariant's five elements (frozen pre-state, authority, isolation,
validation, rollback) are all required instead. For
`scheduled-bounded-apply`, `human-approval` means the approval binds to the
bounded plan artifact the schedule executes; whether each run needs a fresh
approval is an `LC-06` wiring decision, not weakened here.

The matrix is data, versioned as `readinessContractVersion: 1`, and owned by
the gate; assessments only supply observations. Additions in later versions
must not silently relax an existing level.

### Assessment input contract (v1)

The assessment is a JSON file with exactly these top-level fields:

```json
{
  "kind": "loop-readiness-assessment",
  "readinessContractVersion": 1,
  "observations": [
    { "id": "workspace-read", "state": "available", "evidence": "..." }
  ]
}
```

- `kind` must be `loop-readiness-assessment`; `readinessContractVersion` must
  be an integer the evaluator supports (v1 evaluator supports only `1`).
- Each observation has exactly `id`, `state`, and `evidence`; `evidence` must
  be a non-empty string. Empty or missing `evidence` is invalid input, not a
  softer state.
- An empty `observations` array is valid input (every required capability is
  then absent → `prevented`); a missing or non-array `observations` field is
  malformed input.
- Unknown top-level fields, unknown observation fields, an `id` not defined by
  the contract, an unknown `state` string, or the same `id` observed more than
  once are all invalid input (exit 1), never a decision. Strict rejection is
  the fail-closed choice: a misspelled capability must not silently degrade to
  `unavailable`.

### Evaluator semantics (v1)

- Observations for contract-known capabilities that the requested level does
  not require are ignored: they do not affect the decision and do not appear
  in `blockingCapabilities` or the envelope's `observations` echo.
- A required capability absent from `observations` is reported in
  `blockingCapabilities` with state `unavailable`.
- The boundary between the two non-zero exits is: a structurally valid
  assessment that fails a requirement is a decision (`prevented`, exit 2);
  anything the input contract rejects is invalid input (exit 1) and produces
  no decision.

Versioning rules: `schemaVersion` governs the decision-envelope shape;
`readinessContractVersion` governs level ids, capability ids, matrix
semantics, and the assessment observation semantics. They evolve
independently; the v1 evaluator accepts only contract version 1 and emits only
envelope schema version 1.

Trust boundary: an `allowed` decision is necessary, never sufficient,
authority for a run. The gate cannot detect a caller that misdeclares
`available`; truthfulness and freshness of observations are the caller's
responsibility, and binding observations to an actual run window is `LC-06`
wiring. This mirrors the roadmap invariant "Configured presence never proves
observed use": a declared `available` does not prove the capability works.

## Acceptance Scenarios

- AC-1: A versioned contract module exports the five readiness levels, the five
  capability states, and the v1 required-capability matrix; the evaluator and
  CLI reject an assessment whose `readinessContractVersion` they do not
  support.
- AC-2: Evaluating a level with every required capability observed `available`
  returns an `allowed` decision envelope naming the level, contract version,
  and the evidence strings of the observations it consumed.
- AC-3: Evaluating a level with any required capability observed `blocked`,
  `partial`, `unavailable`, or `failed` — or not present in the assessment at
  all — returns a `prevented` envelope listing every blocking capability with
  its observed state (absent observations report `unavailable`). No allowed
  decision is derivable from defaults.
- AC-4: The CLI (`better-harness loop readiness --level <id> --assessment
  <file> --json`) keeps stdout parser-safe JSON in machine mode and uses exit
  codes: `0` allowed, `2` prevented (documented non-success envelope), `1` for
  every input the assessment contract rejects (invalid usage,
  unreadable/malformed assessment, unknown level, unknown capability id,
  unknown state, duplicate observation id, empty evidence, or unsupported
  contract version). Invalid input never produces an `allowed` or `prevented`
  decision. `--help` exits 0 and documents the levels and the exit-code
  contract; invoking the CLI with no arguments prints the same help and exits
  0 (no decision is emitted); without `--json` the CLI prints a readable
  decision summary for the same exit codes.
- AC-5: The gate reads only the assessment file passed to it. Verifiable
  boundary: `contract.mjs` imports nothing, `evaluate.mjs` imports only the
  contract module, and `cli.mjs` imports only `node:` built-ins plus the two
  gate modules (asserted by a static import-allowlist test); the CLI succeeds
  when spawned from an empty temporary working directory (no workspace
  scanning). The gate CLI hands `--assessment` to the filesystem as given
  (resolved against the caller's working directory); `path.join`/`path.resolve`
  and argv-array spawn per the ARCHITECTURE CLI contract apply to the facade
  and test layers. No further OS-specific behavior is claimed.
- AC-6: `npm test` passes, including a new `test/loop-readiness.test.mjs`
  covering AC-1 through AC-5 with fixture assessments for at least: all
  available; one `blocked`; one explicit `unavailable`; one required
  capability absent; mixed `partial`+`failed`; a non-required capability
  observed `blocked` (must still be `allowed`); empty `observations` array;
  and invalid inputs — unknown level, unknown capability id, unknown state,
  duplicate observation id, empty evidence, unsupported contract version,
  malformed JSON, and an unreadable assessment path. Invalid-input tests
  assert both the exit code and the error envelope/stderr content.
- AC-7: `node --test test/doc-link-graph.test.mjs` passes with this spec's
  links resolving.

## Non-goals

- No loop runtime, scheduler, plan/apply executor, or side-effect journal
  (`LC-06`), and no intervention experiment lifecycle (`LC-07`).
- No host/provider probing and no automatic capability discovery; observations
  are declared by callers (adapter-supplied probes belong to the `HA-*` track).
- No verification of observation truthfulness or freshness; the gate judges
  declared observations only (see Trust boundary).
- The gate writes no files and creates no run directory; the decision is
  emitted on stdout only.
- No `schemas/` top-level promotion: the assessment/decision schema stays
  capability-private under `scripts/loop-readiness/` per the directory ADR.
- No retrofit of existing commands (`harness analyze`, `checkup`, quickstart)
  onto the gate in this change; wiring consumers is follow-up work under
  `LC-06`.

## Plan and Tasks

New capability directory `scripts/loop-readiness/` (business-named, copyable,
testable, per [ARCHITECTURE](../ARCHITECTURE.md) conventions):

1. `scripts/loop-readiness/contract.mjs` — exported level ids, capability
   states, v1 matrix, `readinessContractVersion`; frozen data only, no
   imports.
2. `scripts/loop-readiness/evaluate.mjs` — pure
   `evaluateReadiness({ level, assessment })` returning the decision envelope
   `{ kind: "loop-readiness-decision", schemaVersion: 1,
   readinessContractVersion, level, status: "allowed" | "prevented",
   blockingCapabilities: [{ id, state }], observations: [...] }`; throws typed
   errors for every input the assessment contract rejects so the CLI can map
   them to exit code 1.
3. `scripts/loop-readiness/cli.mjs` — argument parsing, `--help`, `--json`
   machine mode and readable human mode, exit-code mapping per AC-4.
4. Register a `loop` command group (audience `advanced`, summary describing
   the readiness gate) with a `readiness` subcommand (audience `advanced`) in
   `scripts/better-harness-cli/registry.mjs`; the group later hosts `LC-06`
   verbs.
5. `test/loop-readiness.test.mjs` — unit tests over `evaluate.mjs` plus CLI
   spawn tests mirroring the style of `test/support-declarations.test.mjs`
   (argv arrays, exit code plus error-content assertions); fixture assessments
   under `test/fixtures/loop-readiness/`.
6. Docs: add `references/loop-engineering/readiness-gate.md` describing the
   contract and linking it from `references/loop-engineering/README.md` and
   `automation-readiness.md`; regenerate the doc link graph if routing changes.

Decision rationale: the gate is caller-assessed rather than self-probing so it
stays deterministic, testable, and free of provider coupling; fail-closed
semantics follow the existing #11–#18 regression contract style (absence is
`unavailable`, never a default allow; structural doubt is rejection, never a
decision); exit code `2` distinguishes a valid `prevented` decision from
invalid input per the roadmap Definition of Done ("non-zero or a documented
non-success envelope").

## Test and Review Evidence

- `node --test test/loop-readiness.test.mjs` → AC-1..AC-6.
- Mutation regression: removing one required capability observation from a
  passing fixture must flip the decision to `prevented` and list exactly that
  capability with state `unavailable`.
- `node scripts/better-harness.mjs loop readiness --help` exits 0 and documents
  levels and exit codes; `--level bogus` exits 1 with a parser-safe error
  envelope → AC-4.
- Static import-allowlist assertions over the three gate modules, and a CLI
  spawn from an empty temporary directory → AC-5.
- `node --test test/doc-link-graph.test.mjs` → AC-7.
- `npm test` full suite → AC-6.
- Risk: purely additive (new directory, one registry entry, new test/fixtures,
  one reference doc); no existing behavior changes, so blast radius is the CLI
  registry table and doc link graph only.
