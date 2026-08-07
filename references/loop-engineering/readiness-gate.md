# Loop Readiness Gate Reference

Use this after `automation-readiness.md` declares a concrete automation
contract and a caller needs an executable, fail-closed decision for a proposed
loop run level. The gate is the executable owner of roadmap item `LC-01`; the
implementation lives in `scripts/loop-readiness/` and is exposed as
`better-harness loop readiness`.

## Contract (v1)

Readiness levels are independent contract values under a partial order — do
not rank them numerically:

- `read-only-observation`: read workspace and provider evidence; write nothing
  outside the run directory.
- `plan-only`: additionally produce a plan artifact; apply nothing.
- `human-approved-apply`: execute a bounded, human-approved apply with
  isolation and rollback.
- `scheduled-read-only`: recurring observation without a human in the loop.
- `scheduled-bounded-apply`: recurring bounded apply; strictest requirement
  set.

Capability observation states: `available`, `partial`, `unavailable`,
`blocked`, `failed`. A required capability that is not `available` — including
one absent from the assessment — prevents the applicable level. The v1
required-capability matrix is data owned by the gate
(`scripts/loop-readiness/contract.mjs`, `readinessContractVersion: 1`); later
versions must not silently relax an existing level.

## Assessment Input

Callers declare observations; the gate never probes hosts or providers:

```json
{
  "kind": "loop-readiness-assessment",
  "readinessContractVersion": 1,
  "observations": [
    { "id": "workspace-read", "state": "available", "evidence": "..." }
  ]
}
```

Each observation carries exactly `id`, `state`, and a non-empty `evidence`
string. Unknown fields, unknown capability ids or states, duplicate ids, or an
unsupported contract version are rejected as invalid input and never become a
decision; a misspelled capability must not silently degrade to `unavailable`.

## CLI and Exit Codes

```text
better-harness loop readiness --level <id> --assessment <file> --json
```

- `0`: `allowed` decision envelope.
- `2`: `prevented` decision envelope listing every blocking capability with
  its observed state.
- `1`: invalid usage or any input the assessment contract rejects.

`--help` (or invoking the CLI with no arguments) prints the levels and this
exit-code contract and exits 0 without emitting a decision.

## Trust Boundary

An `allowed` decision is necessary, never sufficient, authority for a run. The
gate judges declared observations only; truthfulness and freshness stay with
the caller, and binding observations to an actual run window is `LC-06`
wiring. A declared `available` does not prove the capability works — configured
presence never proves observed use.
