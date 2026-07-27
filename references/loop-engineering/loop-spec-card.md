# Loop Spec Card Reference

Use this after `loop-discovery.md` proves a loop candidate, or when a report
needs a compact example of the loop contract. This file shapes the card; it
does not decide the owner, create a Skill, wire automation, or replace the
evidence gate.

Return to `loop-discovery.md` when repeated intent, stable input, verification,
stop condition, safety boundary, state, observability, or evaluation evidence
is still missing.

## Core Card

Every small loop should fit this shape:

```text
WHEN -> SEE -> DO -> CHECK -> STOP -> LEAVE
```

- **When**: bounded trigger, cadence, event, report row, prompt cluster, CI
  signal, review signal, or costly repeated demand.
- **See**: concrete evidence the agent must inspect before acting.
- **Do**: smallest allowed action, including what must stay out of scope.
- **Check**: validation signal that proves whether the action helped.
- **Stop**: success, failure, `needs more evidence`, or human-decision boundary.
- **Leave**: durable artifact, state, patch, report, run log, or unresolved risk
  note that makes the next run replayable.

Add `Owner` only after Loop Discovery has selected one primary owner. Add
`Primitives` only when `loop-primitives.md` is needed and the supporting
primitive is backed by provided or opened evidence; otherwise omit it.

## Evidence Rules

- `When` names a real trigger or recurrence signal. Do not use a topic name
  alone.
- `See` cites exact files, commands, sessions, reports, logs, scan output, CI,
  review comments, external records, or user-provided artifacts.
- Do not cite paths, workflows, tools, test commands, or external records that
  were not provided in the evidence pack or opened during the current task.
- `Do` is bounded enough that a reviewer can tell whether the loop stayed in
  scope. Sensitive edits, shell commands, external writes, broad refactors, and
  policy decisions need a human gate where relevant.
- `Check` names the command, review result, report field, fixture, smoke test,
  human confirmation, or comparison criterion. Do not claim success without it.
- If the evidence pack does not provide a validation command or acceptance
  signal, write `Check: missing validation evidence` instead of inventing an
  ecosystem-default command such as `npm test`, `mvn test`, or `phpunit`.
- `Stop` includes both a pass condition and at least one non-pass boundary such
  as unreproducible input, missing credentials, product decision, risk too
  broad, or repeated attempts without new evidence.
- `Leave` records what changed and what remains uncertain. Purely stateless
  loops should say why no replayable state is needed.
- Static release notes, configured scripts, dependency manifests, badges, or
  README claims are context only. They do not prove recurrence or a new owner
  unless paired with an active advisory, user request, prompt cluster, CI/review
  record, scan output, or observed repeated repair/setup/validation work.

If the evidence is static only, write an unpromoted candidate card with
`Owner: needs more evidence` or cite the existing covered surface.

## Compact Format

```md
# <Loop Name>

When: ...
See: ...
Do: ...
Check: ...
Stop: ...
Leave: ...
Owner: ...
Primitives: primary=<owner>; support=<none|...>; why=...
```

If the candidate cannot fit this shape, it is probably too broad or missing
evidence. Split it or return `needs more evidence`.

## Complete Example

```md
# Test-Driven Repair Loop

When: CI, local test output, or review feedback shows a reproducible failing
test.

See: The failing command, raw error output, related test file, implementation
file, and recent related diff.

Do: Reproduce the failure, form one small hypothesis, make the smallest safe
fix, and add or update regression coverage only when behavior was wrong. Do not
rewrite unrelated modules or broaden the fix from naming similarity alone.

Check: Rerun the original failing test. If it passes and code changed in a
shared path, run one related targeted check.

Stop: Stop when targeted validation passes. Stop with `needs more evidence`
when the failure cannot be reproduced, the fix requires a product decision, or
two attempts fail without new evidence.

Leave: Patch, changed-file list, validation command and result, and residual
risk note.

Owner: Skill for the repeatable repair playbook; script for deterministic test
selection or execution; report for the repair summary. Choose hook or automation
only after Loop Discovery proves an event or cadence owner.
```

Example input:

```text
Trigger: CI failed on `pnpm test checkout-tax.test.ts`
Error: expected 8.25 but received 0
Changed files: src/checkout/tax.ts, src/checkout/summary.ts
```

Acceptable result:

```md
# Repair Summary

Fixed checkout tax amount propagation from `calculateTax()` into the checkout
summary.

Validation:
- `pnpm test checkout-tax.test.ts` passed.

Changed:
- `src/checkout/summary.ts`
- `src/checkout/checkout-tax.test.ts`

Risk:
- Low. The change is scoped to checkout summary tax mapping.
```

Unacceptable result:

```text
I improved the checkout module and cleaned up related files.
```

This is not acceptable because it lacks the failing command, validation
evidence, scope boundary, stop rule, and changed-artifact summary.

## Operating Pattern Catalog

Scenario sketches are owned by the
[operating pattern catalog](patterns/README.md), which groups them as
scheduled inspection, event response, goal completion, proactive discovery,
and system improvement. This file remains the canonical owner of the card
syntax and the complete example above.

Use the catalog only after `loop-discovery.md` proves the loop and selects an
owner. Return here when a chosen pattern needs a compact
`WHEN -> SEE -> DO -> CHECK -> STOP -> LEAVE` card.
